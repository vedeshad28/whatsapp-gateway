// ============================================================
// POST /api/auth/logout — revokes the current session and clears the
// cookie. Idempotent: calling it with no/invalid cookie is a no-op
// success, not an error.
// ============================================================

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destroySession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await destroySession(token);
  }
  store.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ data: { success: true } });
}
