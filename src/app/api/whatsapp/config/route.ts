// ============================================================
// GET    /api/whatsapp/config?account_id=<uuid>  — connection status
// POST   /api/whatsapp/config                     — save/connect
// DELETE /api/whatsapp/config?account_id=<uuid>   — disconnect
//
// Auth: API key with `accounts:manage`. Ported from wacrm's
// session-based version onto API-key + account-id-in-request auth —
// there's no human login here, the calling app manages the account.
//
// The actual connect/status/disconnect logic lives in
// src/lib/whatsapp/connect-account.ts — extracted during the CRM
// restoration so the dashboard's session-gated equivalent
// (src/app/api/account/whatsapp/route.ts, for workspace-owned
// accounts) can share it instead of re-implementing the Meta API
// orchestration. This file's request/response shape is unchanged.
// ============================================================

import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  getConnectionStatus,
  connectAccount,
  disconnectAccount,
  ConnectAccountError,
} from '@/lib/whatsapp/connect-account';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');
    const accountId = new URL(request.url).searchParams.get('account_id') ?? '';
    if (!accountId) return fail('bad_request', "'account_id' query param is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    return ok(await getConnectionStatus(account.id));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail('bad_request', 'Request body must be a JSON object', 400);

    const accountId = typeof body.account_id === 'string' ? body.account_id : '';
    if (!accountId) return fail('bad_request', "'account_id' is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    try {
      const result = await connectAccount(account.id, {
        phoneNumberId: typeof body.phone_number_id === 'string' ? body.phone_number_id : '',
        wabaId: typeof body.waba_id === 'string' ? body.waba_id : null,
        code: typeof body.code === 'string' ? body.code : undefined,
        accessToken: typeof body.access_token === 'string' ? body.access_token : '',
        pin: typeof body.pin === 'string' ? body.pin : undefined,
      });
      return ok(result);
    } catch (err) {
      if (err instanceof ConnectAccountError) {
        return fail('bad_request', err.message, err.status);
      }
      throw err;
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');
    const accountId = new URL(request.url).searchParams.get('account_id') ?? '';
    if (!accountId) return fail('bad_request', "'account_id' query param is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    await disconnectAccount(account.id);
    return ok({ success: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
