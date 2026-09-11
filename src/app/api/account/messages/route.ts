// ============================================================
// POST /api/account/messages — send a text message from the inbox.
//
// Body: { workspace_id, conversation_id } or { workspace_id, to, name? }
// plus { text }. Session-gated (agent+) twin of POST /api/v1/messages
// — reuses the exact same `resolveConversationByPhone` +
// `sendMessageToConversation` core the gateway's public API and
// salon-saas's sends already run through. Text-only for now (media/
// template/interactive composer lands in a later phase).
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
  SessionError,
} from '@/lib/auth/session-context';
import { canSendMessages } from '@/lib/auth/roles';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message';

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | {
          workspace_id?: unknown;
          conversation_id?: unknown;
          to?: unknown;
          name?: unknown;
          text?: unknown;
        }
      | null;

    if (typeof body?.workspace_id !== 'string' || typeof body.text !== 'string' || !body.text.trim()) {
      return NextResponse.json(
        { error: "'workspace_id' and a non-empty 'text' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canSendMessages(membership.role)) {
      throw new SessionError('Viewers cannot send messages', 403);
    }
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Connect a WhatsApp number first (Settings → WhatsApp)' },
        { status: 400 }
      );
    }

    let conversationId: string;
    if (typeof body.conversation_id === 'string') {
      const conversation = await prisma.conversation.findUnique({ where: { id: body.conversation_id } });
      if (!conversation || conversation.accountId !== accountId) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
      conversationId = conversation.id;
    } else if (typeof body.to === 'string' && body.to.trim()) {
      const resolved = await resolveConversationByPhone(
        accountId,
        body.to.trim(),
        typeof body.name === 'string' ? body.name : null
      );
      conversationId = resolved.conversationId;
    } else {
      return NextResponse.json({ error: "Either 'conversation_id' or 'to' is required" }, { status: 400 });
    }

    const result = await sendMessageToConversation(accountId, {
      conversationId,
      messageType: 'text',
      contentText: body.text.trim(),
      mediaUrl: null,
      filename: null,
      templateName: null,
      templateLanguage: null,
      interactivePayload: null,
      replyToMessageId: null,
    });

    return NextResponse.json(
      { data: { message_id: result.messageId, whatsapp_message_id: result.whatsappMessageId, conversation_id: conversationId } },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return toSessionErrorResponse(err);
  }
}
