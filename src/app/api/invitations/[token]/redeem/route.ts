// ============================================================
// POST /api/invitations/[token]/redeem — session-gated. Adds the
// signed-in user as a WorkspaceMember at the invited role, marks the
// invitation redeemed. Requires the signed-in user's email to match
// the invited email, so a valid link can't be redeemed by whoever
// happens to click it while signed into an unrelated account.
// ============================================================

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { requireSession, toSessionErrorResponse } from '@/lib/auth/session-context';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const ctx = await requireSession();

    const limit = checkRateLimit(`invite-redeem:${ctx.userId}`, RATE_LIMITS.invitationRedeem);
    if (!limit.success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { token } = await params;
    const invitation = await prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { workspace: true },
    });

    if (!invitation || invitation.redeemedAt || invitation.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'This invitation is invalid or has expired' }, { status: 404 });
    }

    if (invitation.email.toLowerCase() !== ctx.email.toLowerCase()) {
      return NextResponse.json(
        { error: `This invitation was sent to ${invitation.email} — sign in with that email to accept it` },
        { status: 403 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: invitation.workspaceId, userId: ctx.userId },
        },
        create: { workspaceId: invitation.workspaceId, userId: ctx.userId, role: invitation.role },
        update: { role: invitation.role },
      });
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { redeemedAt: new Date() },
      });
    });

    return NextResponse.json({
      data: { workspace_id: invitation.workspaceId, workspace_name: invitation.workspace.name },
    });
  } catch (err) {
    return toSessionErrorResponse(err);
  }
}
