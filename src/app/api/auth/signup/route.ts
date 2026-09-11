// ============================================================
// POST /api/auth/signup — creates a Client + Workspace + User +
// owning WorkspaceMember in one transaction, then signs the new user
// in.
//
// This is the ONLY place a bare Client gains a Workspace on top of
// it (see prisma/schema.prisma's Client.workspace comment). Every
// other Client (e.g. salon-saas's) is created without one, via
// POST /api/v1/... under an existing API key — that path is
// untouched by this file.
//
// Exception: when `invite_token` is present (the invitee clicked
// "Create an account" from /join/[token]), skip the Client/Workspace
// creation entirely — they're about to redeem an invite into an
// *existing* Workspace, so minting a throwaway personal one here
// would just leave them with a pointless empty second workspace.
// This route doesn't validate the token itself; the subsequent
// /api/invitations/[token]/redeem call does that fully. A stale or
// invalid token just means the user ends up with a bare account and
// no workspace until a fresh invite arrives — not a security issue,
// just a degraded case.
// ============================================================

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, password, name, workspaceName, invite_token: inviteToken } = (body ??
    {}) as Record<string, unknown>;
  const skipWorkspace = typeof inviteToken === 'string' && inviteToken.trim().length > 0;

  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  const normalizedEmail = email.trim().toLowerCase();
  const displayName = typeof name === 'string' && name.trim() ? name.trim() : null;
  const wsName =
    typeof workspaceName === 'string' && workspaceName.trim()
      ? workspaceName.trim()
      : `${displayName ?? normalizedEmail}'s workspace`;

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json(
      { error: 'An account with this email already exists' },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);

  const user = skipWorkspace
    ? await prisma.user.create({
        data: { email: normalizedEmail, passwordHash, name: displayName },
      })
    : await prisma.$transaction(async (tx) => {
        const client = await tx.client.create({ data: { name: wsName } });
        const workspace = await tx.workspace.create({
          data: { clientId: client.id, name: wsName },
        });
        const createdUser = await tx.user.create({
          data: { email: normalizedEmail, passwordHash, name: displayName },
        });
        await tx.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: createdUser.id, role: 'owner' },
        });
        return createdUser;
      });

  const { token, expiresAt } = await createSession(user.id);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return NextResponse.json(
    { data: { id: user.id, email: user.email, name: user.name } },
    { status: 201 }
  );
}
