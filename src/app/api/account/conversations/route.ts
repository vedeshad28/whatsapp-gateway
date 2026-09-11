// ============================================================
// GET /api/account/conversations?workspace_id=<id>
//
// Lists the workspace's conversations, newest activity first —
// the same `Conversation` rows the gateway's own send/receive paths
// already maintain (lastMessageText/lastMessageAt kept in sync by
// sendMessageToConversation and the inbound webhook handler).
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
} from '@/lib/auth/session-context';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ data: [] });
    }

    const conversations = await prisma.conversation.findMany({
      where: { accountId },
      include: { contact: true },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    return NextResponse.json({
      data: conversations.map((c) => ({
        id: c.id,
        contact: { id: c.contact.id, name: c.contact.name, phone: c.contact.phone },
        last_message_text: c.lastMessageText,
        last_message_at: c.lastMessageAt,
        unread_count: c.unreadCount,
      })),
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
