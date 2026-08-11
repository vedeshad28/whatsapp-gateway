// ============================================================
// API key store — the auth-path data access for public API keys.
//
// Ported from wacrm's Supabase version onto Prisma/plain Postgres.
// Behaviour unchanged: findActiveKeyByHash rejects revoked/expired
// keys so callers never re-check liveness; touchLastUsed is a
// fire-and-forget bump.
//
// Semantic change from wacrm: a key belongs to a Client (the calling
// application), not directly to a single Account — a Client can own
// many Accounts (e.g. salon-saas owns one Account per salon tenant).
// ============================================================

import { prisma } from '@/lib/db';

export interface ApiKeyRow {
  id: string;
  client_id: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
}

/**
 * Look up an active key by its SHA-256 hash. Returns null if no row
 * matches, or if the matching row is revoked or expired.
 */
export async function findActiveKeyByHash(
  hash: string
): Promise<ApiKeyRow | null> {
  const row = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
  if (!row) return null;

  const revokedAt = row.revokedAt;
  const expiresAt = row.expiresAt;
  if (revokedAt) return null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) return null;

  return {
    id: row.id,
    client_id: row.clientId,
    name: row.name,
    scopes: row.scopes,
    expires_at: expiresAt === null ? null : expiresAt.toISOString(),
    revoked_at: null,
  };
}

/** Fetch the client name for `/api/v1/me` and similar identity probes. */
export async function getClientName(clientId: string): Promise<string | null> {
  const row = await prisma.client.findUnique({ where: { id: clientId } });
  return row?.name ?? null;
}

/**
 * Best-effort `last_used_at` bump. Fire-and-forget from the auth
 * path — a failed update just means the column lags; it must never
 * fail the request the caller is actually making.
 */
export function touchLastUsed(id: string): void {
  void prisma.apiKey
    .update({ where: { id }, data: { lastUsedAt: new Date() } })
    .catch((err: unknown) => {
      console.warn('[api-keys/store] last_used_at bump failed:', err);
    });
}
