// ============================================================
// GET /api/account/automations/[id]/logs?workspace_id=<id>
//
// Last 100 execution logs, newest first, joined to the contact for
// name/phone display.
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireSession, requireWorkspaceMembership, toSessionErrorResponse } from '@/lib/auth/session-context';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    const accountId = await resolveWorkspaceAccountId(membership);
    const { id } = await params;
    if (!accountId) return NextResponse.json({ data: [] });

    const automation = await prisma.automation.findUnique({ where: { id } });
    if (!automation || automation.accountId !== accountId) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 });
    }

    const logs = await prisma.automationLog.findMany({
      where: { automationId: id },
      include: { contact: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return NextResponse.json({
      data: logs.map((l) => ({
        id: l.id,
        contact_name: l.contact?.name ?? null,
        contact_phone: l.contact?.phone ?? null,
        trigger_event: l.triggerEvent,
        status: l.status,
        error_message: l.errorMessage,
        steps_executed: l.stepsExecuted,
        created_at: l.createdAt,
      })),
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
