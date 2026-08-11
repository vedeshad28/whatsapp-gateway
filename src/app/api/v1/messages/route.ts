// ============================================================
// POST /api/v1/messages — send a WhatsApp message via the public API.
//
// Takes a phone number — what an external automation actually has —
// resolves-or-creates the contact + conversation, then runs the
// shared send core.
//
// Auth: API key with the `messages:send` scope. `account_id` in the
// body selects which of the key's client's connected accounts to
// send from (a key can belong to a client that owns many accounts).
//
// Body:
//   {
//     "account_id": "<uuid>",                // required — one of your provisioned accounts
//     "to": "+14155550123",                  // required, E.164
//     "type": "template",                    // text|template|image|video|document|audio (default: text)
//     "text": "Hello!",                      // text body, or media caption
//     "media_url": "https://…/file.pdf",     // required for image/video/document/audio
//     "filename": "invoice.pdf",             // optional, document filename
//     "template": {
//       "name": "invoice_ready",
//       "language": "en_US",
//       "params": ["A123"] | { "body": [...] }
//     },
//     "reply_to_message_id": "<uuid>",
//     "name": "Jane Doe"
//   }
//
// Response (201):
//   { "data": { "message_id", "whatsapp_message_id", "conversation_id",
//               "contact_id", "contact_created" } }
// ============================================================

import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const accountId = typeof body.account_id === 'string' ? body.account_id : '';
    if (!accountId) {
      return fail('bad_request', "'account_id' is required", 400);
    }
    const account = await requireAccountAccess(ctx, accountId);

    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!to) {
      return fail('bad_request', "'to' is required", 400);
    }

    const type = typeof body.type === 'string' ? body.type : 'text';

    const template =
      body.template && typeof body.template === 'object'
        ? (body.template as Record<string, unknown>)
        : null;
    const templateParams = Array.isArray(template?.params)
      ? (template.params as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : undefined;
    const templateMessageParams =
      template?.params && !Array.isArray(template.params)
        ? template.params
        : undefined;

    const interactivePayload =
      body.interactive_payload && typeof body.interactive_payload === 'object'
        ? (body.interactive_payload as InteractiveMessagePayload)
        : null;

    validateSendMessageParams({
      messageType: type,
      contentText: typeof body.text === 'string' ? body.text : null,
      mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
      templateName: typeof template?.name === 'string' ? template.name : null,
      interactivePayload,
    });

    const resolved = await resolveConversationByPhone(
      account.id,
      to,
      typeof body.name === 'string' ? body.name : null
    );

    const result = await sendMessageToConversation(account.id, {
      conversationId: resolved.conversationId,
      messageType: type,
      contentText: typeof body.text === 'string' ? body.text : null,
      mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
      filename: typeof body.filename === 'string' ? body.filename : null,
      templateName: typeof template?.name === 'string' ? template.name : null,
      templateLanguage:
        typeof template?.language === 'string' ? template.language : null,
      templateParams,
      templateMessageParams,
      interactivePayload,
      replyToMessageId:
        typeof body.reply_to_message_id === 'string'
          ? body.reply_to_message_id
          : null,
    });

    return ok(
      {
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        conversation_id: resolved.conversationId,
        contact_id: resolved.contactId,
        contact_created: resolved.contactCreated,
      },
      201
    );
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
