// ============================================================
// POST /api/account/transfer-ownership { workspace_id, new_owner_user_id }
//
// Owner-only: hands the workspace to another existing member, demotes
// the caller to admin. Atomic — never leaves a workspace with zero or
// two owners mid-request.
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
  SessionError,
} from '@/lib/auth/session-context';

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | { workspace_id?: unknown; new_owner_user_id?: unknown }
      | null;

    if (typeof body?.workspace_id !== 'string' || typeof body.new_owner_user_id !== 'string') {
      return NextResponse.json(
        { error: "'workspace_id' and 'new_owner_user_id' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (membership.role !== 'owner') {
      throw new SessionError('Only the current owner can transfer ownership', 403);
    }
    if (body.new_owner_user_id === ctx.userId) {
      return NextResponse.json({ error: 'Already the owner' }, { status: 400 });
    }

    const target = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: body.workspace_id, userId: body.new_owner_user_id },
      },
    });
    if (!target) {
      return NextResponse.json(
        { error: 'The new owner must already be a member of this workspace' },
        { status: 404 }
      );
    }

    await prisma.$transaction([
      prisma.workspaceMember.update({
        where: {
          workspaceId_userId: { workspaceId: body.workspace_id, userId: body.new_owner_user_id },
        },
        data: { role: 'owner' },
      }),
      prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: body.workspace_id, userId: ctx.userId } },
        data: { role: 'admin' },
      }),
    ]);

    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
