// ============================================================
// Public API authentication — resolve a request's API key into a
// client context, and (separately) resolve+verify a specific account
// that context is allowed to act on.
//
// Every `/api/v1` and `/api/whatsapp` route does:
//
//   try {
//     const ctx = await requireApiKey(request, "messages:send");
//     const accountId = await requireAccountAccess(ctx, requestedAccountId);
//     // ctx.clientId — the key's owning client; scope every query by it
//   } catch (err) {
//     return toApiErrorResponse(err);
//   }
//
// Semantic change from wacrm: a key authenticates a *Client* (the
// calling application, e.g. salon-saas), not a single Account
// directly. A Client can own many Accounts (one per connected WABA —
// e.g. one per salon tenant). Every request that acts on an account
// must pass that account's id explicitly, and `requireAccountAccess`
// verifies it belongs to the authenticated client — this is the
// tenancy boundary now that there's no human session / RLS to lean on.
// ============================================================

import { prisma } from '@/lib/db';
import { findActiveKeyByHash, touchLastUsed } from '@/lib/api-keys/store';
import { hashApiKey, looksLikeApiKey } from '@/lib/api-keys/keys';
import { hasScope, type ApiScope } from '@/lib/api-keys/scopes';
import { forbidden, notFound, unauthorized, rateLimited } from '@/lib/api/v1/respond';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export interface ApiKeyContext {
  authType: 'api_key';
  /** The client this key belongs to. Every Account it touches must have this clientId. */
  clientId: string;
  keyId: string;
  scopes: string[];
}

function extractKey(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const value = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : header.trim();
  return value.length > 0 ? value : null;
}

/**
 * Authenticate a public-API request and (optionally) enforce a single
 * scope. Throws an `ApiError` (mapped to the envelope by
 * `toApiErrorResponse`) on any failure:
 *
 *   401 unauthorized — no key, malformed, unknown, revoked, expired
 *   403 forbidden    — valid key without the required scope
 *   429 rate_limited — per-key budget exhausted
 */
export async function requireApiKey(
  request: Request,
  scope?: ApiScope
): Promise<ApiKeyContext> {
  const presented = extractKey(request);
  if (!presented || !looksLikeApiKey(presented)) {
    throw unauthorized();
  }

  const row = await findActiveKeyByHash(hashApiKey(presented));
  if (!row) {
    throw unauthorized();
  }

  const limit = checkRateLimit(`apikey:${row.id}`, RATE_LIMITS.publicApi);
  if (!limit.success) {
    throw rateLimited(limit);
  }

  if (scope && !hasScope(row.scopes, scope)) {
    throw forbidden(`This API key is missing the '${scope}' scope`);
  }

  touchLastUsed(row.id);

  return {
    authType: 'api_key',
    clientId: row.client_id,
    keyId: row.id,
    scopes: row.scopes,
  };
}

/**
 * Verify `accountId` belongs to `ctx.clientId` and return it. Every
 * route that acts on a specific account (send, connect, templates,
 * webhooks) must call this before touching the account's data — it's
 * the tenancy check that replaces wacrm's RLS.
 *
 * Throws 404 rather than 403 on a mismatch so a caller can't use the
 * response to probe which account ids exist under another client.
 */
export async function requireAccountAccess(
  ctx: ApiKeyContext,
  accountId: string
): Promise<{ id: string; externalRef: string | null; label: string | null }> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account || account.clientId !== ctx.clientId) {
    throw notFound('Account not found');
  }
  return { id: account.id, externalRef: account.externalRef, label: account.label };
}
