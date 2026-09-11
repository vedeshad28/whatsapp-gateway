// ============================================================
// POST /api/auth/login — verifies email + password, issues a session
// cookie. Deliberately returns the same generic error for "no such
// user" and "wrong password" so the response can't be used to
// enumerate registered emails.
// ============================================================

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

const GENERIC_ERROR = 'Incorrect email or password';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const { token, expiresAt } = await createSession(user.id);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return NextResponse.json({
    data: { id: user.id, email: user.email, name: user.name },
  });
}
