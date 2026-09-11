// ============================================================
// GET /api/invitations/[token]/peek — public (no auth). Lets the
// /join/[token] page show "You've been invited to <workspace> as
// <role>" before the visitor signs in or signs up, without requiring
// a session first. Never reveals anything if the token is invalid.
// ============================================================

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limit = checkRateLimit(`invite-peek:${ip}`, RATE_LIMITS.invitationPeek);
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

  return NextResponse.json({
    data: {
      workspace_name: invitation.workspace.name,
      email: invitation.email,
      role: invitation.role,
    },
  });
}
