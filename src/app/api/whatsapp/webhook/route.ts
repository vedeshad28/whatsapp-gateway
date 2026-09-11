// ============================================================
// Meta-facing inbound webhook. Public, HMAC-verified.
//
// GET  — Meta's subscribe-time verification handshake (hub.challenge).
// POST — delivery status updates + inbound messages + template
//        lifecycle events. Ported from wacrm, with the CRM-only
//        fan-out dropped: no automations engine, no Flows runner, no
//        AI auto-reply, no message_reactions mirroring. What's kept:
//        persisting inbound messages/contacts/conversations, mirroring
//        delivery status onto `messages` (and, as of the Broadcasts
//        restoration, onto `broadcast_recipients` too — see
//        handleStatusUpdate), the template-lifecycle handler, and
//        outbound webhook dispatch to whichever calling app owns the
//        account.
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/whatsapp/encryption';
import { getMediaUrl } from '@/lib/whatsapp/meta-api';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook';
import { runAutomationsForTrigger } from '@/lib/whatsapp/automations/engine';

export const maxDuration = 60;

// Meta's raw statuses map 1:1 onto `BroadcastRecipientStatus` except
// `pending`, which is a gateway-only initial state Meta never sends.
type BroadcastRecipientStatusValue = 'sent' | 'delivered' | 'read' | 'failed';
const BROADCAST_RECIPIENT_STATUSES: readonly string[] = ['sent', 'delivered', 'read', 'failed'];

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  context?: { id: string };
  interactive?: {
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      metadata: { display_phone_number: string; phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: WhatsAppMessage[];
      statuses?: Array<{
        id: string;
        status: string;
        timestamp: string;
        recipient_id: string;
        errors?: Array<{
          code: number;
          title: string;
          message?: string;
          error_data?: { details?: string };
        }>;
      }>;
    };
    field: string;
  }>;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const challenge = searchParams.get('hub.challenge');
  const verifyToken = searchParams.get('hub.verify_token');

  if (mode !== 'subscribe' || !challenge || !verifyToken) {
    return NextResponse.json({ error: 'Missing verification parameters' }, { status: 400 });
  }

  // A single Meta App serves every connected account, so the verify
  // token is checked against the platform-wide META_WEBHOOK_VERIFY_TOKEN
  // env var, not a per-account value.
  if (verifyToken !== process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ error: 'Verification token mismatch' }, { status: 403 });
  }

  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] rejected request with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: { entry?: WhatsAppWebhookEntry[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    await processWebhook(body);
  } catch (err) {
    console.error('[webhook] processing failed:', err);
  }

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

async function processWebhook(body: { entry?: WhatsAppWebhookEntry[] }) {
  if (!body.entry) return;

  for (const entry of body.entry) {
    for (const change of entry.changes) {
      if (isTemplateWebhookField(change.field)) {
        await handleTemplateWebhookChange({ field: change.field, value: change.value as unknown });
        continue;
      }

      const value = change.value;

      if (value.statuses) {
        for (const status of value.statuses) {
          await handleStatusUpdate(status);
        }
      }

      if (!value.messages || !value.contacts) continue;

      const phoneNumberId = value.metadata.phone_number_id;
      const config = await prisma.whatsappConfig.findFirst({ where: { phoneNumberId } });
      if (!config) {
        console.error('[webhook] no config found for phone_number_id:', phoneNumberId);
        continue;
      }

      const accessToken = decrypt(config.accessToken);

      for (let i = 0; i < value.messages.length; i++) {
        const message = value.messages[i];
        const contact = value.contacts[i] || value.contacts[0];
        await processMessage(message, contact, config.accountId, accessToken);
      }
    }
  }
}

async function handleStatusUpdate(status: {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string; message?: string; error_data?: { details?: string } }>;
}) {
  // Human-readable failure reason, local-only — never added to the
  // dispatchWebhookEvent payload below, which salon-saas's callback
  // contract pins to exactly {whatsapp_message_id, conversation_id, status}.
  const firstError = status.errors?.[0];
  const errorMessage =
    status.status === 'failed' && firstError
      ? (firstError.error_data?.details ?? firstError.title ?? firstError.message ?? null)
      : null;

  await prisma.message.updateMany({
    where: { messageId: status.id },
    data: { status: status.status, ...(errorMessage ? { errorMessage } : {}) },
  });

  const msgRow = await prisma.message.findFirst({
    where: { messageId: status.id },
    select: { id: true, accountId: true, conversationId: true },
  });

  if (msgRow) {
    await dispatchWebhookEvent(msgRow.accountId, 'message.status_updated', {
      whatsapp_message_id: status.id,
      conversation_id: msgRow.conversationId,
      status: status.status,
    });

    // Broadcast recipient status sync — best-effort, additive, never
    // blocks or fails the status-mirroring path above (which
    // salon-saas's delivery-status callback depends on). A no-op
    // (0 rows matched) for the common case of a non-broadcast message.
    if (BROADCAST_RECIPIENT_STATUSES.includes(status.status as BroadcastRecipientStatusValue)) {
      try {
        await prisma.broadcastRecipient.updateMany({
          where: { messageId: msgRow.id },
          data: { status: status.status as BroadcastRecipientStatusValue },
        });
      } catch (err) {
        console.warn('[webhook] broadcast recipient status sync failed (non-fatal):', err);
      }
    }
  }
}

async function processMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  accountId: string,
  accessToken: string
) {
  const senderPhone = normalizePhone(message.from);
  const contactName = contact.profile.name;

  const contactOutcome = await findOrCreateContact(accountId, senderPhone, contactName);
  if (!contactOutcome) return;
  const contactRecord = contactOutcome.contact;

  const convResult = await findOrCreateConversation(accountId, contactRecord.id);
  if (!convResult) return;
  const conversation = convResult.conversation;

  if (convResult.created) {
    await dispatchWebhookEvent(accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactRecord.id,
    });
  }

  const { contentText, mediaUrl, interactiveReplyId } = await parseMessageContent(message, accessToken);

  // Needed before the insert below, so it reflects prior messages only —
  // used to fire the 'first_inbound_message' automation trigger and to
  // let Flows' keyword/first-message entry match correctly.
  const isFirstInboundMessage =
    (await prisma.message.count({
      where: { conversationId: conversation.id, senderType: 'customer' },
    })) === 0;

  const ALLOWED_CONTENT_TYPES = new Set([
    'text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive',
  ]);
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type) ? message.type : 'text';

  await prisma.message.create({
    data: {
      accountId,
      conversationId: conversation.id,
      senderType: 'customer',
      contentType,
      contentText,
      mediaUrl,
      messageId: message.id,
      status: 'delivered',
      createdAt: new Date(parseInt(message.timestamp, 10) * 1000),
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageText: contentText || `[${message.type}]`,
      lastMessageAt: new Date(),
      unreadCount: { increment: 1 },
    },
  });

  await dispatchWebhookEvent(accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: message.id,
    content_type: contentType,
    text: contentText,
  });

  // Fire any automations that react to this inbound message. Never
  // awaited beyond the dispatch call itself (runAutomationsForTrigger
  // never throws, per its own contract) — a slow or failing automation
  // must not delay this webhook's 200 OK to Meta.
  //
  // TODO(Phase 5b — Flows): once the flow runner lands, await
  // dispatchInboundToFlows() here first and suppress
  // new_message_received/keyword_match/interactive_reply when it
  // reports `consumed: true` — a customer navigating a bot menu
  // shouldn't also fork into a keyword-triggered automation. Until
  // then every content-level trigger fires unconditionally.
  const flowConsumed = false;
  const automationTriggers: Parameters<typeof runAutomationsForTrigger>[0]['triggerType'][] = [];
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
    if (interactiveReplyId) automationTriggers.push('interactive_reply');
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created');
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message');

  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: contentText ?? undefined,
        conversation_id: conversation.id,
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err));
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string
): Promise<{ contentText: string | null; mediaUrl: string | null; interactiveReplyId: string | null }> {
  const verifyAndBuildUrl = async (mediaId: string): Promise<string | null> => {
    try {
      await getMediaUrl({ mediaId, accessToken });
      return `/api/whatsapp/media/${mediaId}`;
    } catch (error) {
      console.error(`[webhook] media verification failed for ${mediaId}:`, error);
      return null;
    }
  };

  switch (message.type) {
    case 'text':
      return { contentText: message.text?.body || null, mediaUrl: null, interactiveReplyId: null };
    case 'image':
      return message.image?.id
        ? {
            contentText: message.image.caption || null,
            mediaUrl: await verifyAndBuildUrl(message.image.id),
            interactiveReplyId: null,
          }
        : { contentText: null, mediaUrl: null, interactiveReplyId: null };
    case 'video':
      return message.video?.id
        ? {
            contentText: message.video.caption || null,
            mediaUrl: await verifyAndBuildUrl(message.video.id),
            interactiveReplyId: null,
          }
        : { contentText: null, mediaUrl: null, interactiveReplyId: null };
    case 'document':
      return message.document?.id
        ? {
            contentText: message.document.caption || message.document.filename || null,
            mediaUrl: await verifyAndBuildUrl(message.document.id),
            interactiveReplyId: null,
          }
        : { contentText: null, mediaUrl: null, interactiveReplyId: null };
    case 'audio':
      return message.audio?.id
        ? { contentText: null, mediaUrl: await verifyAndBuildUrl(message.audio.id), interactiveReplyId: null }
        : { contentText: null, mediaUrl: null, interactiveReplyId: null };
    case 'location':
      if (message.location) {
        const loc = message.location;
        return {
          contentText: [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
            .filter(Boolean)
            .join(' - '),
          mediaUrl: null,
          interactiveReplyId: null,
        };
      }
      return { contentText: null, mediaUrl: null, interactiveReplyId: null };
    case 'interactive': {
      // Tap on a button/list reply we sent — either a plain interactive
      // send, or (once Flows/Automations land) a bot-driven menu. No
      // branching needed here: whoever sent the original interactive
      // message left `reply.id` as the thing to match against, and
      // Flows' node config / Automations' `interactive_reply` trigger
      // both just look this id up themselves.
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      return reply?.id
        ? { contentText: reply.title || reply.id, mediaUrl: null, interactiveReplyId: reply.id }
        : { contentText: '[Interactive reply]', mediaUrl: null, interactiveReplyId: null };
    }
    default:
      return {
        contentText: `[Unsupported message type: ${message.type}]`,
        mediaUrl: null,
        interactiveReplyId: null,
      };
  }
}

async function findOrCreateContact(accountId: string, phone: string, name: string) {
  const existingContact = await findExistingContact(accountId, phone);
  if (existingContact) {
    if (name && name !== existingContact.name) {
      await prisma.contact.update({ where: { id: existingContact.id }, data: { name } });
    }
    return { contact: existingContact, wasCreated: false };
  }

  try {
    const created = await prisma.contact.create({
      data: { accountId, phone, name: name || phone },
    });
    return { contact: created, wasCreated: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await findExistingContact(accountId, phone);
      if (raced) return { contact: raced, wasCreated: false };
    }
    console.error('[webhook] contact create error:', err);
    return null;
  }
}

async function findOrCreateConversation(accountId: string, contactId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { accountId, contactId },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return { conversation: existing, created: false };

  try {
    const created = await prisma.conversation.create({ data: { accountId, contactId } });
    return { conversation: created, created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await prisma.conversation.findFirst({
        where: { accountId, contactId },
        orderBy: { createdAt: 'asc' },
      });
      if (raced) return { conversation: raced, created: false };
    }
    console.error('[webhook] conversation create error:', err);
    return null;
  }
}
