// ============================================================
// GET /api/account/conversations/[id]/messages?workspace_id=<id>
//
// Oldest-first message history for one conversation — same `Message`
// rows the gateway's send/receive paths already populate.
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
} from '@/lib/auth/session-context';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    const accountId = await resolveWorkspaceAccountId(membership);
    const { id } = await params;

    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation || conversation.accountId !== accountId) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });

    // Fetching a conversation's messages is how the Inbox UI marks it
    // read — reset unread_count unconditionally rather than guarding on
    // "was it > 0", since a no-op update costs nothing and this also
    // covers a message arriving while the conversation is already open.
    if (conversation.unreadCount !== 0) {
      await prisma.conversation.update({
        where: { id },
        data: { unreadCount: 0 },
      });
    }

    return NextResponse.json({
      data: messages.map((m) => ({
        id: m.id,
        sender_type: m.senderType,
        content_type: m.contentType,
        content_text: m.contentText,
        media_url: toSessionMediaUrl(m.mediaUrl, workspaceId),
        template_name: m.templateName,
        status: m.status,
        error_message: m.errorMessage,
        created_at: m.createdAt,
      })),
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

// `Message.mediaUrl` is stored as `/api/whatsapp/media/{mediaId}` — the
// API-key-gated path salon-saas-style consumers use. The Inbox UI runs
// under session auth instead, so rewrite it to the session-gated
// counterpart the browser can actually fetch (see
// src/app/api/account/media/[mediaId]/route.ts).
function toSessionMediaUrl(mediaUrl: string | null, workspaceId: string): string | null {
  if (!mediaUrl) return null;
  const mediaId = mediaUrl.split('/').pop();
  if (!mediaId) return null;
  return `/api/account/media/${mediaId}?workspace_id=${workspaceId}`;
}
