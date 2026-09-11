// ============================================================
// GET    /api/account/automations/[id]?workspace_id=<id>
// PATCH  /api/account/automations/[id] { workspace_id, name?, description?,
//   trigger_type?, trigger_config?, is_active?, steps? }
// DELETE /api/account/automations/[id] { workspace_id }
//
// PATCH's `steps` (if present) replaces the whole tree — delete-then-
// insert, same non-transactional-but-resilient approach the pre-trim
// engine was already tolerant of (a step disappearing mid-read just
// ends that run's remaining steps, not a hard crash).
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
import { flattenSteps, loadStepsTree, type BuilderStep } from '@/lib/whatsapp/automations/steps-tree';
import { validateStepsForActivation, validateTriggerForActivation } from '@/lib/whatsapp/automations/validate';

async function loadOwnedAutomation(accountId: string, id: string) {
  const automation = await prisma.automation.findUnique({ where: { id } });
  if (!automation || automation.accountId !== accountId) return null;
  return automation;
}

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
    if (!accountId) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });

    const automation = await loadOwnedAutomation(accountId, id);
    if (!automation) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });

    const steps = await prisma.automationStep.findMany({ where: { automationId: id } });

    return NextResponse.json({
      data: {
        id: automation.id,
        name: automation.name,
        description: automation.description,
        trigger_type: automation.triggerType,
        trigger_config: automation.triggerConfig,
        is_active: automation.isActive,
        execution_count: automation.executionCount,
        last_executed_at: automation.lastExecutedAt,
        steps: loadStepsTree(steps),
      },
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | {
          workspace_id?: unknown;
          name?: unknown;
          description?: unknown;
          trigger_type?: unknown;
          trigger_config?: unknown;
          is_active?: unknown;
          steps?: unknown;
        }
      | null;
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

    const existing = await loadOwnedAutomation(accountId, id);
    if (!existing) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });

    const triggerType = typeof body.trigger_type === 'string' ? body.trigger_type : existing.triggerType;
    const triggerConfig =
      body.trigger_config && typeof body.trigger_config === 'object'
        ? (body.trigger_config as Record<string, unknown>)
        : (existing.triggerConfig as Record<string, unknown>);
    const stepsProvided = Array.isArray(body.steps);
    const steps = stepsProvided ? (body.steps as BuilderStep[]) : null;
    const isActive = typeof body.is_active === 'boolean' ? body.is_active : existing.isActive;

    if (isActive) {
      const stepsForValidation = steps ?? loadStepsTree(await prisma.automationStep.findMany({ where: { automationId: id } }));
      const issues = [
        ...validateTriggerForActivation(triggerType, triggerConfig),
        ...validateStepsForActivation(stepsForValidation),
      ];
      if (issues.length > 0) {
        return NextResponse.json({ error: 'Automation is not valid to activate', issues }, { status: 422 });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.automation.update({
        where: { id },
        data: {
          name: typeof body.name === 'string' ? body.name : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          triggerType,
          triggerConfig: triggerConfig as Prisma.InputJsonValue,
          isActive,
        },
      });
      if (steps) {
        await tx.automationStep.deleteMany({ where: { automationId: id } });
        const rows = flattenSteps(steps, id);
        if (rows.length > 0) {
          await tx.automationStep.createMany({
            data: rows.map((r) => ({ ...r, stepConfig: r.stepConfig as Prisma.InputJsonValue })),
          });
        }
      }
    });

    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const existing = await loadOwnedAutomation(accountId, id);
    if (!existing) return NextResponse.json({ error: 'Automation not found' }, { status: 404 });

    await prisma.automation.delete({ where: { id } });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
