// ============================================================
// GET /api/account — the signed-in user's own profile + every
// workspace they belong to (most CRM users belong to exactly one,
// created at signup, but the shape allows more later — e.g. a user
// invited into a second workspace). PATCH renames a workspace.
//
// Dashboard-session-gated only (see src/lib/auth/session-context.ts)
// — this is the CRM's own resource, unrelated to the gateway's
// `/api/v1/*` surface.
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
} from '@/lib/auth/session-context';

const MAX_NAME_LEN = 80;

export async function GET() {
  try {
    const ctx = await requireSession();
    const workspaces = await prisma.workspace.findMany({
      where: { id: { in: ctx.memberships.map((m) => m.workspaceId) } },
    });

    return NextResponse.json({
      data: {
        user: { id: ctx.userId, email: ctx.email, name: ctx.name },
        workspaces: workspaces.map((w) => {
          const role = ctx.memberships.find((m) => m.workspaceId === w.id)!.role;
          return {
            id: w.id,
            name: w.name,
            default_currency: w.defaultCurrency,
            role,
          };
        }),
      },
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | { workspace_id?: unknown; name?: unknown }
      | null;

    if (typeof body?.workspace_id !== 'string') {
      return NextResponse.json({ error: "'workspace_id' is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only owners and admins can rename a workspace' },
        { status: 403 }
      );
    }

    if (typeof body.name !== 'string') {
      return NextResponse.json({ error: "'name' must be a string" }, { status: 400 });
    }
    const name = body.name.trim();
    if (name.length === 0 || name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Workspace name must be 1-${MAX_NAME_LEN} characters` },
        { status: 400 }
      );
    }

    const workspace = await prisma.workspace.update({
      where: { id: membership.workspaceId },
      data: { name },
    });

    return NextResponse.json({ data: { id: workspace.id, name: workspace.name } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
