// ============================================================
// GET  /api/account/automations?workspace_id=<id>  — list, newest first
// POST /api/account/automations { workspace_id, name, description?,
//   trigger_type, trigger_config?, is_active?, steps? }
//
// Steps (if present) go through flattenSteps — the nested
// condition-branch tree the builder edits, converted to the DB's flat
// parentStepId/branch/position rows. Activation validation runs
// whenever the automation would end up is_active: true.
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
import { flattenSteps, type BuilderStep } from '@/lib/whatsapp/automations/steps-tree';
import { validateStepsForActivation, validateTriggerForActivation } from '@/lib/whatsapp/automations/validate';

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

    const automations = await prisma.automation.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      data: automations.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        trigger_type: a.triggerType,
        is_active: a.isActive,
        execution_count: a.executionCount,
        last_executed_at: a.lastExecutedAt,
        created_at: a.createdAt,
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
          name?: unknown;
          description?: unknown;
          trigger_type?: unknown;
          trigger_config?: unknown;
          is_active?: unknown;
          steps?: unknown;
        }
      | null;

    if (
      typeof body?.workspace_id !== 'string' ||
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      typeof body.trigger_type !== 'string'
    ) {
      return NextResponse.json(
        { error: "'workspace_id', a non-empty 'name', and 'trigger_type' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canSendMessages(membership.role)) {
      throw new SessionError('Viewers cannot manage automations', 403);
    }
    const accountId = await resolveWorkspaceAccountId(membership);
    if (!accountId) {
      return NextResponse.json({ error: 'Connect a WhatsApp number first (Settings → WhatsApp)' }, { status: 400 });
    }

    const triggerConfig =
      body.trigger_config && typeof body.trigger_config === 'object' ? (body.trigger_config as Record<string, unknown>) : {};
    const steps = Array.isArray(body.steps) ? (body.steps as BuilderStep[]) : [];
    const isActive = body.is_active === true;

    if (isActive) {
      const issues = [
        ...validateTriggerForActivation(body.trigger_type, triggerConfig),
        ...validateStepsForActivation(steps),
      ];
      if (issues.length > 0) {
        return NextResponse.json({ error: 'Automation is not valid to activate', issues }, { status: 422 });
      }
    }

    const automation = await prisma.$transaction(async (tx) => {
      const created = await tx.automation.create({
        data: {
          accountId,
          name: body.name as string,
          description: typeof body.description === 'string' ? body.description : null,
          triggerType: body.trigger_type as string,
          triggerConfig: triggerConfig as Prisma.InputJsonValue,
          isActive,
          createdByUserId: ctx.userId,
        },
      });
      if (steps.length > 0) {
        const rows = flattenSteps(steps, created.id);
        await tx.automationStep.createMany({
          data: rows.map((r) => ({ ...r, stepConfig: r.stepConfig as Prisma.InputJsonValue })),
        });
      }
      return created;
    });

    return NextResponse.json({ data: { id: automation.id } }, { status: 201 });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
