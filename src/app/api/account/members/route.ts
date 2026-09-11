// ============================================================
// GET /api/account/members?workspace_id=<id>
//
// Lists every member of the given workspace. Any member can call it
// — the Members tab is shown to admins+, but agents/viewers see a
// read-only roster too. Emails are only included when the caller is
// admin+ (mirrors wacrm's "agent/viewer sees names only" policy).
//
// DELETE /api/account/members  { workspace_id, user_id }
// Admin+ removes a member. Can't remove the last owner.
// ============================================================

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  requireSession,
  requireWorkspaceMembership,
  toSessionErrorResponse,
  SessionError,
} from '@/lib/auth/session-context';
import { canManageMembers, isWorkspaceRole } from '@/lib/auth/roles';

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);

    const rows = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    const canSeeEmails = canManageMembers(membership.role);

    return NextResponse.json({
      data: rows.map((row) => ({
        user_id: row.userId,
        name: row.user.name,
        email: canSeeEmails ? row.user.email : null,
        role: row.role,
        joined_at: row.createdAt,
      })),
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

/** PATCH { workspace_id, user_id, role } — admin+ changes a member's role. Can't demote the last owner. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | { workspace_id?: unknown; user_id?: unknown; role?: unknown }
      | null;

    if (
      typeof body?.workspace_id !== 'string' ||
      typeof body.user_id !== 'string' ||
      !isWorkspaceRole(body.role)
    ) {
      return NextResponse.json(
        { error: "'workspace_id', 'user_id', and a valid 'role' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canManageMembers(membership.role)) {
      throw new SessionError('Only owners and admins can change member roles', 403);
    }

    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: body.workspace_id, userId: body.user_id } },
    });
    if (!target) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    if (target.role === 'owner' && body.role !== 'owner') {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId: body.workspace_id, role: 'owner' },
      });
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'A workspace must have at least one owner — transfer ownership first' },
          { status: 400 }
        );
      }
    }

    const updated = await prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId: body.workspace_id, userId: body.user_id } },
      data: { role: body.role },
    });

    return NextResponse.json({ data: { user_id: updated.userId, role: updated.role } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | { workspace_id?: unknown; user_id?: unknown }
      | null;

    if (typeof body?.workspace_id !== 'string' || typeof body.user_id !== 'string') {
      return NextResponse.json(
        { error: "'workspace_id' and 'user_id' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canManageMembers(membership.role)) {
      throw new SessionError('Only owners and admins can remove members', 403);
    }

    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: body.workspace_id, userId: body.user_id } },
    });
    if (!target) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    if (target.role === 'owner') {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId: body.workspace_id, role: 'owner' },
      });
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: 'A workspace must have at least one owner — transfer ownership first' },
          { status: 400 }
        );
      }
    }

    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: body.workspace_id, userId: body.user_id } },
    });

    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
