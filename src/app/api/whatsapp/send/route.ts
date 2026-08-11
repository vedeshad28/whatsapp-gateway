// ============================================================
// POST /api/whatsapp/send — thin adapter over sendMessageToConversation.
//
// Targets a thread by an existing `conversation_id`, or a `contact_id`
// (find-or-create the conversation). Auth: API key with
// `messages:send`; `account_id` in the body picks which account.
// ============================================================

import { prisma } from '@/lib/db';
import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const limit = checkRateLimit(`send:${ctx.keyId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400);

    const accountId = typeof body.account_id === 'string' ? body.account_id : '';
    if (!accountId) return fail('bad_request', "'account_id' is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    const conversationIdInput = typeof body.conversation_id === 'string' ? body.conversation_id : null;
    const contactId = typeof body.contact_id === 'string' ? body.contact_id : null;
    const messageType = typeof body.message_type === 'string' ? body.message_type : '';

    if ((!conversationIdInput && !contactId) || !messageType) {
      return fail('bad_request', 'Either conversation_id or contact_id, plus message_type, are required', 400);
    }

    const contentText = typeof body.content_text === 'string' ? body.content_text : null;
    const mediaUrl = typeof body.media_url === 'string' ? body.media_url : null;
    const templateName = typeof body.template_name === 'string' ? body.template_name : null;
    const interactivePayload = (body.interactive_payload as never) ?? null;

    try {
      validateSendMessageParams({ messageType, contentText, mediaUrl, templateName, interactivePayload });
    } catch (err) {
      if (err instanceof SendMessageError) return fail(err.code, err.message, err.status);
      throw err;
    }

    let conversationId: string | null = null;

    if (conversationIdInput) {
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationIdInput, accountId: account.id },
        select: { id: true },
      });
      if (!conv) return fail('not_found', 'Conversation not found', 404);
      conversationId = conv.id;
    } else {
      const contactRow = await prisma.contact.findFirst({
        where: { id: contactId!, accountId: account.id },
        select: { id: true },
      });
      if (!contactRow) return fail('not_found', 'Contact not found', 404);

      const existing = await prisma.conversation.findFirst({
        where: { accountId: account.id, contactId: contactRow.id },
      });
      conversationId = existing
        ? existing.id
        : (await prisma.conversation.create({ data: { accountId: account.id, contactId: contactRow.id } })).id;
    }

    try {
      const result = await sendMessageToConversation(account.id, {
        conversationId: conversationId!,
        messageType,
        contentText,
        mediaUrl,
        filename: typeof body.filename === 'string' ? body.filename : null,
        templateName,
        templateLanguage: typeof body.template_language === 'string' ? body.template_language : null,
        templateParams: body.template_params as string[] | undefined,
        templateMessageParams: body.template_message_params,
        interactivePayload,
        replyToMessageId: typeof body.reply_to_message_id === 'string' ? body.reply_to_message_id : null,
      });

      return ok({ success: true, message_id: result.messageId, whatsapp_message_id: result.whatsappMessageId });
    } catch (err) {
      if (err instanceof SendMessageError) return fail(err.code, err.message, err.status);
      throw err;
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
