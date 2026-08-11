// ============================================================
// Outbound message send — the core that both `/api/whatsapp/send`
// and the public `/api/v1/messages` endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation.
//
// Ported from wacrm onto Prisma. Dropped: the Flow-run pause side
// effect (step 5 in the original) — Flows/automations aren't part of
// this gateway, there's nothing to pause.
// ============================================================

import { prisma } from '@/lib/db';
import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape.
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName, interactivePayload } =
    params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

/** Map a Prisma `MessageTemplate` row into the snake_case shape `meta-api.ts`/`template-send-builder.ts` expect. */
function toTemplateRecord(row: {
  id: string;
  name: string;
  category: string;
  language: string | null;
  headerType: string | null;
  headerContent: string | null;
  headerHandle: string | null;
  headerMediaUrl: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: unknown;
  status: string | null;
  metaTemplateId: string | null;
}): MessageTemplate {
  return {
    id: row.id,
    // user_id has no equivalent in this gateway's schema; templates
    // are account-scoped, not user-scoped. Cast satisfies the shared
    // (wacrm-originated) type without reintroducing a human-user column.
    user_id: '',
    name: row.name,
    category: row.category as MessageTemplate['category'],
    language: row.language ?? undefined,
    header_type: (row.headerType ?? undefined) as MessageTemplate['header_type'],
    header_content: row.headerContent ?? undefined,
    header_handle: row.headerHandle ?? undefined,
    header_media_url: row.headerMediaUrl ?? undefined,
    body_text: row.bodyText,
    footer_text: row.footerText ?? undefined,
    buttons: (row.buttons as MessageTemplate['buttons']) ?? undefined,
    status: row.status as MessageTemplate['status'],
    meta_template_id: row.metaTemplateId ?? undefined,
    created_at: '',
  };
}

export async function sendMessageToConversation(
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    interactivePayload,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError('bad_request', 'conversation_id is required', 400);
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

  // Credit check — reject early if wallet has no balance
  const wallet = await prisma.accountWallet.findUnique({ where: { accountId } });
  if (!wallet || wallet.balance <= 0) {
    throw new SendMessageError(
      'insufficient_credits',
      'Insufficient WhatsApp credits. Please recharge your account.',
      402
    );
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, accountId },
    include: { contact: true },
  });

  if (!conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError('bad_request', 'Contact phone number not found', 400);
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError('bad_request', 'Invalid phone number format', 400);
  }

  const config = await prisma.whatsappConfig.findUnique({ where: { accountId } });
  if (!config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  const accessToken = decrypt(config.accessToken);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(config.accessToken)) {
    void prisma.whatsappConfig
      .update({ where: { id: config.id }, data: { accessToken: encrypt(accessToken) } })
      .catch((err: unknown) => {
        console.warn('[send-message] access_token GCM upgrade failed:', err);
      });
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation.
  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const parent = await prisma.message.findFirst({
      where: { id: replyToMessageId, conversationId },
      select: { messageId: true },
    });
    if (!parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.messageId) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.messageId;
    }
  }

  // Template row (for header + button components).
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const row = await prisma.messageTemplate.findFirst({
      where: {
        accountId,
        name: templateName,
        language: templateLanguage || 'en_US',
      },
    });
    if (row) {
      const candidate = toTemplateRecord(row);
      if (!isMessageTemplate(candidate)) {
        throw new SendMessageError(
          'template_malformed',
          'Template row is malformed locally — run "Sync from Meta" to repair it.',
          500
        );
      }
      templateRow = candidate;
    }
  }

  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'template') {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: phone,
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'interactive') {
      const p = interactivePayload!;
      if (p.kind === 'buttons') {
        const result = await sendInteractiveButtons({
          phoneNumberId: config.phoneNumberId,
          accessToken,
          to: phone,
          bodyText: p.body,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          buttons: p.buttons,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendInteractiveList({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: phone,
        bodyText: p.body,
        buttonLabel: p.button_label,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
        sections: p.sections,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage({
      phoneNumberId: config.phoneNumberId,
      accessToken,
      to: phone,
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };

  // Send via Meta — retry across phone-number variants if Meta rejects
  // with "recipient not in allowed list"; persist a working variant
  // back to the contact so the next send goes straight through.
  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  try {
    const variants = phoneVariants(sanitizedPhone);
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingPhone = variant;
        lastError = null;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(message)) {
          throw err;
        }
        lastError = err;
        console.warn(
          `[send-message] variant "${variant}" rejected by Meta, trying next…`
        );
      }
    }

    if (lastError) throw lastError;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[send-message] Meta send failed for all variants:', message);
    throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
  }

  if (workingPhone !== sanitizedPhone) {
    console.log(
      `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
    );
    await prisma.contact.update({ where: { id: contact.id }, data: { phone: workingPhone } });
  }

  const interactiveBody =
    messageType === 'interactive' ? interactivePayload!.body : null;

  const messageRecord = await prisma.message.create({
    data: {
      accountId,
      conversationId,
      senderType: 'agent',
      contentType: messageType,
      contentText: interactiveBody ?? contentText ?? null,
      mediaUrl: mediaUrl || null,
      templateName: templateName || null,
      interactivePayload:
        messageType === 'interactive'
          ? (interactivePayload as unknown as object)
          : undefined,
      messageId: waMessageId,
      status: 'sent',
      replyToMessageId: replyToMessageId || null,
    },
  });

  const lastMessageText =
    messageType === 'interactive'
      ? interactivePayloadPreviewText(interactivePayload!)
      : contentText || `[${messageType}]`;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageText, lastMessageAt: new Date() },
  });

  // Deduct 1 credit after successful send
  const updatedWallet = await prisma.accountWallet.update({
    where: { accountId },
    data: { balance: { decrement: 1 } },
  });
  await prisma.walletTransaction.create({
    data: {
      accountId,
      type: 'DEBIT',
      amount: 1,
      balance: updatedWallet.balance,
      description: `Message to ${contact.phone}`,
    },
  });

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}
