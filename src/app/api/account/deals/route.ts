// ============================================================
// GET  /api/account/deals?workspace_id=<id>&pipeline_id=<id>
// POST /api/account/deals { workspace_id, pipeline_id, stage_id, title, value?, contact_id?, currency? }
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

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');
    const pipelineId = url.searchParams.get('pipeline_id');
    if (!workspaceId || !pipelineId) {
      return NextResponse.json(
        { error: "'workspace_id' and 'pipeline_id' query params are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ data: [] });
    }

    const pipeline = await prisma.pipeline.findUnique({ where: { id: pipelineId } });
    if (!pipeline || pipeline.accountId !== accountId) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
    }

    const deals = await prisma.deal.findMany({
      where: { pipelineId },
      include: { contact: true, assignedTo: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      data: deals.map((d) => ({
        id: d.id,
        stage_id: d.stageId,
        title: d.title,
        value: d.value,
        currency: d.currency,
        status: d.status,
        notes: d.notes,
        expected_close_date: d.expectedCloseDate,
        contact: d.contact ? { id: d.contact.id, name: d.contact.name, phone: d.contact.phone } : null,
        assigned_to: d.assignedTo ? { id: d.assignedTo.id, name: d.assignedTo.name } : null,
        created_at: d.createdAt,
      })),
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | {
          workspace_id?: unknown;
          pipeline_id?: unknown;
          stage_id?: unknown;
          title?: unknown;
          value?: unknown;
          currency?: unknown;
          contact_id?: unknown;
        }
      | null;

    if (
      typeof body?.workspace_id !== 'string' ||
      typeof body.pipeline_id !== 'string' ||
      typeof body.stage_id !== 'string' ||
      typeof body.title !== 'string' ||
      !body.title.trim()
    ) {
      return NextResponse.json(
        { error: "'workspace_id', 'pipeline_id', 'stage_id', and a non-empty 'title' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canSendMessages(membership.role)) {
      throw new SessionError('Viewers cannot create deals', 403);
    }
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ error: 'Connect a WhatsApp number first (Settings → WhatsApp)' }, { status: 400 });
    }

    const [pipeline, stage] = await Promise.all([
      prisma.pipeline.findUnique({ where: { id: body.pipeline_id } }),
      prisma.pipelineStage.findUnique({ where: { id: body.stage_id } }),
    ]);
    if (!pipeline || pipeline.accountId !== accountId) {
      return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
    }
    if (!stage || stage.pipelineId !== pipeline.id) {
      return NextResponse.json({ error: 'Stage not found' }, { status: 404 });
    }

    if (typeof body.contact_id === 'string') {
      const contact = await prisma.contact.findUnique({ where: { id: body.contact_id } });
      if (!contact || contact.accountId !== accountId) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }
    }

    const deal = await prisma.deal.create({
      data: {
        accountId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: body.title.trim(),
        value: typeof body.value === 'number' && Number.isFinite(body.value) ? Math.trunc(body.value) : 0,
        currency: typeof body.currency === 'string' && body.currency ? body.currency : undefined,
        contactId: typeof body.contact_id === 'string' ? body.contact_id : null,
      },
    });

    return NextResponse.json({ data: { id: deal.id } }, { status: 201 });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
