// ============================================================
// PATCH  /api/account/deals/[id]  { workspace_id, stage_id?, title?, value?, status?, notes? }
// DELETE /api/account/deals/[id]?workspace_id=<id>
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

const VALID_STATUSES = ['open', 'won', 'lost'] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | {
          workspace_id?: unknown;
          stage_id?: unknown;
          title?: unknown;
          value?: unknown;
          status?: unknown;
          notes?: unknown;
        }
      | null;

    if (typeof body?.workspace_id !== 'string') {
      return NextResponse.json({ error: "'workspace_id' is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canSendMessages(membership.role)) {
      throw new SessionError('Viewers cannot edit deals', 403);
    }
    const accountId = await resolveWorkspaceAccountId(membership);
    const { id } = await params;

    const deal = await prisma.deal.findUnique({ where: { id } });
    if (!deal || deal.accountId !== accountId) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};

    if (typeof body.stage_id === 'string') {
      const stage = await prisma.pipelineStage.findUnique({ where: { id: body.stage_id } });
      if (!stage || stage.pipelineId !== deal.pipelineId) {
        return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
      }
      data.stageId = stage.id;

      // Stage (which Kanban column) and status (open/won/lost, what
      // the dashboard's win totals aggregate on) are separate fields
      // — moving a deal into a stage literally named "Won"/"Lost"
      // implies the status change too, so the dashboard reflects it
      // without a second manual step. An explicit `status` in the
      // same request (below) still wins over this inference.
      const stageName = stage.name.trim().toLowerCase();
      if (stageName === 'won') data.status = 'won';
      else if (stageName === 'lost') data.status = 'lost';
      else if (!(typeof body.status === 'string' && VALID_STATUSES.includes(body.status as (typeof VALID_STATUSES)[number]))) {
        data.status = 'open';
      }
    }
    if (typeof body.title === 'string' && body.title.trim()) {
      data.title = body.title.trim();
    }
    if (typeof body.value === 'number' && Number.isFinite(body.value)) {
      data.value = Math.trunc(body.value);
    }
    if (typeof body.status === 'string') {
      if (!(VALID_STATUSES as readonly string[]).includes(body.status)) {
        return NextResponse.json({ error: "'status' must be open, won, or lost" }, { status: 400 });
      }
      data.status = body.status;
    }
    if (typeof body.notes === 'string') {
      data.notes = body.notes;
    }

    const updated = await prisma.deal.update({ where: { id }, data });
    return NextResponse.json({ data: { id: updated.id, stage_id: updated.stageId, status: updated.status } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function DELETE(
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
    if (!canSendMessages(membership.role)) {
      throw new SessionError('Viewers cannot delete deals', 403);
    }
    const accountId = await resolveWorkspaceAccountId(membership);
    const { id } = await params;

    const deal = await prisma.deal.findUnique({ where: { id } });
    if (!deal || deal.accountId !== accountId) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    await prisma.deal.delete({ where: { id } });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
