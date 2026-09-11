// ============================================================
// Dashboard session tokens — issuance, lookup, revocation.
//
// Mirrors src/lib/api-keys/keys.ts + src/lib/api-keys/store.ts: the
// plaintext token is a full-entropy random string handed to the
// browser as an httpOnly cookie, the DB stores only its SHA-256 hash.
// Same rationale as that file for using a fast hash here (the token
// is CSPRNG output, not a user-chosen secret — no KDF needed).
// ============================================================

import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';

export const SESSION_COOKIE_NAME = 'gateway_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashSessionToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Issue a fresh session for `userId`. Persists the hash, returns the plaintext token + expiry to set on the cookie. */
export async function createSession(
  userId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Resolve a plaintext session-cookie value into the signed-in user
 * plus their workspace memberships. Returns null for a missing,
 * unknown, or expired session — callers don't need to distinguish
 * why, same pattern as `findActiveKeyByHash`.
 */
export async function getSessionUser(tokenPlaintext: string | null | undefined) {
  if (!tokenPlaintext) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(tokenPlaintext) },
    include: {
      user: {
        include: {
          memberships: { include: { workspace: true } },
        },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  return session;
}

/** Revoke a session by its plaintext token (logout). No-op if it doesn't exist. */
export async function destroySession(tokenPlaintext: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { tokenHash: hashSessionToken(tokenPlaintext) },
  });
}
