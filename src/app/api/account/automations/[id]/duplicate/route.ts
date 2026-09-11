// ============================================================
// POST /api/account/automations/[id]/duplicate { workspace_id }
//
// Clones the automation row + every step, remapping parent-step
// references via an old-id -> new-id map. The copy is always created
// inactive, regardless of the source's state — a duplicate shouldn't
// silently start firing.
// ============================================================

import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
  SessionError,
} from '@/lib/auth/session-context';
import { canSendMessages } from '@/lib/auth/roles';
import { resolveWorkspaceAccountId } from '@/lib/auth/workspace-account';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as { workspace_id?: unknown } | null;
    if (typeof body?.workspace_id !== 'string') {
      return NextResponse.json({ error: "'workspace_id' is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canSendMessages(membership.role)) {
      throw new SessionError('Viewers cannot manage automations', 403);
    }
    const accountId = await resolveWorkspaceAccountId(membership);
    const { id } = await params;
    if (!accountId) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });

    const source = await prisma.automation.findUnique({ where: { id } });
    if (!source || source.accountId !== accountId) {
      return NextResponse.json({ error: 'Automation not found' }, { status: 404 });
    }
    const sourceSteps = await prisma.automationStep.findMany({ where: { automationId: id } });

    const copy = await prisma.$transaction(async (tx) => {
      const created = await tx.automation.create({
        data: {
          accountId,
          name: `${source.name} (copy)`,
          description: source.description,
          triggerType: source.triggerType,
          triggerConfig: source.triggerConfig as Prisma.InputJsonValue,
          isActive: false,
          createdByUserId: ctx.userId,
        },
      });

      const idMap = new Map<string, string>();
      for (const step of sourceSteps) idMap.set(step.id, crypto.randomUUID());

      if (sourceSteps.length > 0) {
        await tx.automationStep.createMany({
          data: sourceSteps.map((step) => ({
            id: idMap.get(step.id)!,
            automationId: created.id,
            parentStepId: step.parentStepId ? idMap.get(step.parentStepId) ?? null : null,
            branch: step.branch,
            stepType: step.stepType,
            stepConfig: step.stepConfig as Prisma.InputJsonValue,
            position: step.position,
          })),
        });
      }

      return created;
    });

    return NextResponse.json({ data: { id: copy.id } }, { status: 201 });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
