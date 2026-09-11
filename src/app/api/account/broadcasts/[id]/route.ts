// ============================================================
// GET /api/account/broadcasts/[id]?workspace_id=<id>
// Detail + full per-recipient status list, for the progress/audit view.
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

    const broadcast = await prisma.broadcast.findUnique({
      where: { id },
      include: {
        template: true,
        audienceTag: true,
        recipients: { include: { contact: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!broadcast || broadcast.accountId !== accountId) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        id: broadcast.id,
        name: broadcast.name,
        template_name: broadcast.template.name,
        audience_tag: broadcast.audienceTag ? broadcast.audienceTag.name : null,
        status: broadcast.status,
        total_recipients: broadcast.totalRecipients,
        sent_count: broadcast.sentCount,
        failed_count: broadcast.failedCount,
        created_at: broadcast.createdAt,
        completed_at: broadcast.completedAt,
        recipients: broadcast.recipients.map((r) => ({
          id: r.id,
          contact: { id: r.contact.id, name: r.contact.name, phone: r.contact.phone },
          status: r.status,
          error_message: r.errorMessage,
          sent_at: r.sentAt,
        })),
      },
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
