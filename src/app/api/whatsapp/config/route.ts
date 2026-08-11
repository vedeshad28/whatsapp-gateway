// ============================================================
// GET    /api/whatsapp/config?account_id=<uuid>  — connection status
// POST   /api/whatsapp/config                     — save/connect
// DELETE /api/whatsapp/config?account_id=<uuid>   — disconnect
//
// Auth: API key with `accounts:manage`. Ported from wacrm's
// session-based version onto API-key + account-id-in-request auth —
// there's no human login here, the calling app manages the account.
// ============================================================

import { prisma } from '@/lib/db';
import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
} from '@/lib/whatsapp/meta-api';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { ensureDefaultInvoiceTemplate } from '@/lib/whatsapp/default-invoice-template';

/**
 * Resolve the plaintext access token for this connect request.
 *
 * Two supported inputs:
 *   - `code` — the Embedded Signup popup's authorization code. Exchanged
 *     server-side (needs the app secret) for a short-lived token, then
 *     upgraded to a long-lived one. This is the one-click path.
 *   - `access_token` — an already-obtained token, pasted in directly.
 *     Kept for manual/advanced use (e.g. Meta test numbers where a
 *     token is issued straight from the dashboard, no signup flow).
 */
async function resolveAccessToken(code: string | undefined, accessTokenPlain: string): Promise<string> {
  if (!code) return accessTokenPlain;

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('META_APP_ID/META_APP_SECRET are not configured on the gateway — cannot exchange the signup code');
  }

  const shortLived = await exchangeCodeForToken({ code, appId, appSecret });
  try {
    const longLived = await exchangeForLongLivedToken({
      shortLivedToken: shortLived.accessToken,
      appId,
      appSecret,
    });
    return longLived.accessToken;
  } catch (err) {
    console.warn('[whatsapp/config] long-lived token exchange failed, using short-lived token:', err);
    return shortLived.accessToken;
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');
    const accountId = new URL(request.url).searchParams.get('account_id') ?? '';
    if (!accountId) return fail('bad_request', "'account_id' query param is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    const config = await prisma.whatsappConfig.findUnique({ where: { accountId: account.id } });
    if (!config) {
      return ok({ connected: false, reason: 'no_config' });
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.accessToken);
    } catch {
      return ok({ connected: false, reason: 'token_corrupted', needs_reset: true });
    }

    try {
      const phoneInfo = await verifyPhoneNumber({ phoneNumberId: config.phoneNumberId, accessToken });
      return ok({
        connected: true,
        phone_info: phoneInfo,
        registered_at: config.registeredAt,
        subscribed_apps_at: config.subscribedAppsAt,
        last_registration_error: config.lastRegistrationError,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error';
      return ok({ connected: false, reason: 'meta_api_error', message });
    }
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

    const phoneNumberId = typeof body.phone_number_id === 'string' ? body.phone_number_id : '';
    const wabaId = typeof body.waba_id === 'string' ? body.waba_id : null;
    const code = typeof body.code === 'string' ? body.code : undefined;
    const accessTokenInput = typeof body.access_token === 'string' ? body.access_token : '';
    const pin = typeof body.pin === 'string' ? body.pin : undefined;

    if (!phoneNumberId || (!code && !accessTokenInput)) {
      return fail('bad_request', "'phone_number_id' and either 'code' or 'access_token' are required", 400);
    }
    if (pin !== undefined && pin !== '' && !/^\d{6}$/.test(pin)) {
      return fail('bad_request', 'PIN must be exactly 6 digits', 400);
    }

    let accessTokenPlain: string;
    try {
      accessTokenPlain = await resolveAccessToken(code, accessTokenInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to exchange signup code';
      return fail('bad_request', message, 400);
    }

    // Reject if another account has already claimed this phone_number_id
    // — one WhatsApp number maps to exactly one gateway account.
    const claimed = await prisma.whatsappConfig.findFirst({
      where: { phoneNumberId, accountId: { not: account.id } },
    });
    if (claimed) {
      return fail(
        'bad_request',
        'This WhatsApp phone number is already connected to another account on this gateway.',
        409
      );
    }

    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken: accessTokenPlain });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error';
      return fail('bad_request', `Meta API error: ${message}`, 400);
    }

    const existing = await prisma.whatsappConfig.findUnique({ where: { accountId: account.id } });
    const sameNumber = existing?.phoneNumberId === phoneNumberId && existing?.registeredAt != null;

    let registeredAt: Date | null = existing?.registeredAt ?? null;
    let registrationError: string | null = null;
    let registrationSkipped = false;

    const needsRegistration = !sameNumber || Boolean(pin);
    if (needsRegistration) {
      if (!pin) {
        registrationSkipped = true;
      } else {
        try {
          await registerPhoneNumber({ phoneNumberId, accessToken: accessTokenPlain, pin });
          registeredAt = new Date();
        } catch (err) {
          registrationError = err instanceof Error ? err.message : 'Unknown Meta API error';
        }
      }
    }

    let subscribedAppsAt: Date | null = null;
    if (wabaId) {
      try {
        await subscribeWabaToApp({ wabaId, accessToken: accessTokenPlain });
        subscribedAppsAt = new Date();
      } catch (err) {
        console.warn('[whatsapp/config] subscribed_apps failed (non-fatal):', err);
      }

      // Best-effort — a calling app should be able to send an invoice
      // immediately after connecting, without a human first visiting
      // Meta WhatsApp Manager to author a template.
      if (!registrationError) {
        await ensureDefaultInvoiceTemplate(account.id, wabaId, accessTokenPlain);
      }
    }

    const data = {
      phoneNumberId,
      wabaId,
      accessToken: encrypt(accessTokenPlain),
      verifiedName: phoneInfo.verified_name ?? null,
      displayPhoneNumber: phoneInfo.display_phone_number ?? null,
      status: registrationError ? 'disconnected' : 'connected',
      connectedAt: registrationError ? null : new Date(),
      registeredAt: registrationError ? null : registeredAt,
      subscribedAppsAt,
      lastRegistrationError: registrationError,
    };

    if (existing) {
      await prisma.whatsappConfig.update({ where: { accountId: account.id }, data });
    } else {
      await prisma.whatsappConfig.create({ data: { accountId: account.id, ...data } });
    }

    if (registrationError) {
      return ok({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        phone_info: phoneInfo,
      });
    }

    return ok({
      success: true,
      saved: true,
      registered: registeredAt != null,
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
    });
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

    await prisma.whatsappConfig.deleteMany({ where: { accountId: account.id } });
    return ok({ success: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
