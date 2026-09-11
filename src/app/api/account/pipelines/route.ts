// ============================================================
// GET /api/account/pipelines?workspace_id=<id>
//
// Returns the workspace's pipeline (with its stages), auto-creating
// one default pipeline + 4 default stages on first call so there's
// no separate "create your first pipeline" step — mirrors how
// getOrCreateWorkspaceAccount lazily provisions the Account.
// One pipeline per workspace for now; multi-pipeline support is a
// straightforward extension (add a create/list UI) if ever needed.
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
} from '@/lib/auth/session-context';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';

const DEFAULT_STAGES = [
  { name: 'New', color: '#64748b' },
  { name: 'Contacted', color: '#3b82f6' },
  { name: 'Won', color: '#22c55e' },
  { name: 'Lost', color: '#ef4444' },
];

async function getOrCreatePipeline(accountId: string) {
  const existing = await prisma.pipeline.findFirst({
    where: { accountId },
    include: { stages: { orderBy: { position: 'asc' } } },
  });
  if (existing) return existing;

  return prisma.pipeline.create({
    data: {
      accountId,
      name: 'Sales Pipeline',
      stages: {
        create: DEFAULT_STAGES.map((stage, i) => ({ ...stage, position: i })),
      },
    },
    include: { stages: { orderBy: { position: 'asc' } } },
  });
}

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
      return NextResponse.json({ data: null });
    }

    const pipeline = await getOrCreatePipeline(accountId);
    return NextResponse.json({
      data: {
        id: pipeline.id,
        name: pipeline.name,
        stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name, color: s.color, position: s.position })),
      },
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
