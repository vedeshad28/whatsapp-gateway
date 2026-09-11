// ============================================================
// GET  /api/account/invitations?workspace_id=<id>  — list pending invites. Admin+.
// POST /api/account/invitations { workspace_id, email, role }  — Admin+.
//
// There's no email transport wired up yet (see the forgot-password
// page's header comment for the same gap) — POST returns the redeem
// link directly in the response so the inviter can copy/share it
// manually, same "shown once" pattern as API key creation.
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
import { createWorkspaceInvitation } from '@/lib/invitations/create-invitation';

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const workspaceId = new URL(request.url).searchParams.get('workspace_id');
    if (!workspaceId) {
      return NextResponse.json({ error: "'workspace_id' query param is required" }, { status: 400 });
    }
    const membership = requireWorkspaceMembership(ctx, workspaceId);
    if (!canManageMembers(membership.role)) {
      throw new SessionError('Only owners and admins can view invitations', 403);
    }

    const rows = await prisma.workspaceInvitation.findMany({
      where: { workspaceId, redeemedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      data: rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        expires_at: row.expiresAt,
        expired: row.expiresAt.getTime() <= Date.now(),
        created_at: row.createdAt,
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
      | { workspace_id?: unknown; email?: unknown; role?: unknown }
      | null;

    if (
      typeof body?.workspace_id !== 'string' ||
      typeof body.email !== 'string' ||
      !body.email.includes('@') ||
      !isWorkspaceRole(body.role)
    ) {
      return NextResponse.json(
        { error: "'workspace_id', a valid 'email', and a valid 'role' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canManageMembers(membership.role)) {
      throw new SessionError('Only owners and admins can invite members', 403);
    }
    if (body.role === 'owner') {
      return NextResponse.json(
        { error: "Invite as admin and use transfer-ownership instead of inviting an 'owner'" },
        { status: 400 }
      );
    }

    const { invitation, redeemPath } = await createWorkspaceInvitation({
      workspaceId: body.workspace_id,
      email: body.email,
      role: body.role,
      invitedById: ctx.userId,
    });

    return NextResponse.json(
      {
        data: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expires_at: invitation.expiresAt,
          /** Plaintext redeem token — shown once, share this link manually (no email transport yet). */
          redeem_path: redeemPath,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}

/** DELETE { workspace_id, invitation_id } — admin+ revokes a pending invite. */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireSession();
    const body = (await request.json().catch(() => null)) as
      | { workspace_id?: unknown; invitation_id?: unknown }
      | null;

    if (typeof body?.workspace_id !== 'string' || typeof body.invitation_id !== 'string') {
      return NextResponse.json(
        { error: "'workspace_id' and 'invitation_id' are required" },
        { status: 400 }
      );
    }
    const membership = requireWorkspaceMembership(ctx, body.workspace_id);
    if (!canManageMembers(membership.role)) {
      throw new SessionError('Only owners and admins can revoke invitations', 403);
    }

    const invitation = await prisma.workspaceInvitation.findUnique({
      where: { id: body.invitation_id },
    });
    if (!invitation || invitation.workspaceId !== body.workspace_id) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    }

    await prisma.workspaceInvitation.delete({ where: { id: invitation.id } });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
