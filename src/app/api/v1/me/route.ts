// ============================================================
// GET /api/v1/me — public API identity probe.
//
// Requires nothing but a valid key (no scope) and returns the client
// the key is bound to plus the scopes it carries. Integrators use it
// to verify their key works before wiring up real calls.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { getClientName } from '@/lib/api-keys/store';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request);
    const name = await getClientName(ctx.clientId);
    return ok({
      client: { id: ctx.clientId, name },
      key: { id: ctx.keyId, scopes: ctx.scopes },
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
