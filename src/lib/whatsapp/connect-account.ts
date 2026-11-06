// ============================================================
// Core WhatsApp-connect logic — the guts of what used to live only
// in src/app/api/whatsapp/config/route.ts, extracted so a session-
// gated dashboard route (src/app/api/account/whatsapp/route.ts) can
// call the exact same connect/status/disconnect behavior an API-key
// caller (salon-saas) gets, instead of re-implementing it.
//
// Deliberately auth-agnostic: every function here takes a plain
// `accountId` the caller has already verified access to (via
// requireAccountAccess for API keys, or requireWorkspaceAccountAccess
// for sessions) — this module has no opinion on how that check
// happened.
// ============================================================

import { prisma } from '@/lib/db';
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listWabaPhoneNumbers,
  requestSmbAppDataSync,
} from '@/lib/whatsapp/meta-api';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { deriveRegistrationPin } from '@/lib/whatsapp/registration-pin';
import { ensureDefaultInvoiceTemplate } from '@/lib/whatsapp/default-invoice-template';

export class ConnectAccountError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ConnectAccountError';
    this.status = status;
  }
}

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
    console.warn('[connect-account] long-lived token exchange failed, using short-lived token:', err);
    return shortLived.accessToken;
  }
}

export async function getConnectionStatus(accountId: string) {
  const config = await prisma.whatsappConfig.findUnique({ where: { accountId } });
  if (!config) {
    return { connected: false as const, reason: 'no_config' };
  }

  let accessToken: string;
  try {
    accessToken = decrypt(config.accessToken);
  } catch {
    return { connected: false as const, reason: 'token_corrupted', needs_reset: true };
  }

  try {
    const phoneInfo = await verifyPhoneNumber({ phoneNumberId: config.phoneNumberId, accessToken });
    return {
      connected: true as const,
      phone_info: phoneInfo,
      registered_at: config.registeredAt,
      subscribed_apps_at: config.subscribedAppsAt,
      last_registration_error: config.lastRegistrationError,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error';
    return { connected: false as const, reason: 'meta_api_error', message };
  }
}

export interface ConnectAccountInput {
  /** Empty is allowed only for a coexistence signup, which reports just the WABA — see `coexistence`. */
  phoneNumberId: string;
  wabaId: string | null;
  code?: string;
  accessToken: string;
  pin?: string;
  /**
   * The number is already live in the WhatsApp Business app and is being
   * linked alongside it (Embedded Signup's coexistence flow). Such a number
   * must not go through /register, and its phone_number_id is looked up from
   * the WABA when the caller doesn't have it.
   */
  coexistence?: boolean;
}

async function resolveCoexistencePhoneNumberId(wabaId: string, accessToken: string): Promise<string> {
  let numbers;
  try {
    numbers = await listWabaPhoneNumbers({ wabaId, accessToken });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error';
    throw new ConnectAccountError(`Meta API error: ${message}`, 400);
  }
  const [first, ...rest] = numbers;
  if (!first) {
    throw new ConnectAccountError('No phone number was found on the connected WhatsApp account yet — try again in a minute.', 400);
  }
  if (rest.length > 0) {
    throw new ConnectAccountError(
      'This WhatsApp account has more than one phone number, so the one to link cannot be chosen automatically.',
      400
    );
  }
  return first.id;
}

/** Contacts and chat history can each be requested once per onboarding; failures are non-fatal. */
async function requestCoexistenceSync(phoneNumberId: string, accessToken: string): Promise<void> {
  for (const syncType of ['smb_app_state_sync', 'history'] as const) {
    try {
      await requestSmbAppDataSync({ phoneNumberId, accessToken, syncType });
    } catch (err) {
      console.warn(`[connect-account] coexistence ${syncType} request failed (non-fatal):`, err);
    }
  }
}

export async function connectAccount(accountId: string, input: ConnectAccountInput) {
  const { wabaId, code, accessToken: accessTokenInput, pin } = input;
  const coexistence = input.coexistence === true;
  let phoneNumberId = input.phoneNumberId;

  if ((!phoneNumberId && !(coexistence && wabaId)) || (!code && !accessTokenInput)) {
    throw new ConnectAccountError("'phone_number_id' and either 'code' or 'access_token' are required", 400);
  }
  if (pin !== undefined && pin !== '' && !/^\d{6}$/.test(pin)) {
    throw new ConnectAccountError('PIN must be exactly 6 digits', 400);
  }

  let accessTokenPlain: string;
  try {
    accessTokenPlain = await resolveAccessToken(code, accessTokenInput);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to exchange signup code';
    throw new ConnectAccountError(message, 400);
  }

  if (!phoneNumberId && wabaId) {
    phoneNumberId = await resolveCoexistencePhoneNumberId(wabaId, accessTokenPlain);
  }

  const claimed = await prisma.whatsappConfig.findFirst({
    where: { phoneNumberId, accountId: { not: accountId } },
  });
  if (claimed) {
    throw new ConnectAccountError(
      'This WhatsApp phone number is already connected to another account on this gateway.',
      409
    );
  }

  let phoneInfo;
  try {
    phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken: accessTokenPlain });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error';
    throw new ConnectAccountError(`Meta API error: ${message}`, 400);
  }

  const existing = await prisma.whatsappConfig.findUnique({ where: { accountId } });
  const sameNumber = existing?.phoneNumberId === phoneNumberId && existing?.registeredAt != null;

  let registeredAt: Date | null = existing?.registeredAt ?? null;
  let registrationError: string | null = null;
  let registrationSkipped = false;

  // A coexistence number is already registered via the Business app; calling
  // /register would take it over from the app instead of sharing it.
  const alreadyLinked = existing?.phoneNumberId === phoneNumberId && existing?.subscribedAppsAt != null;
  if (coexistence) {
    registeredAt = existing?.registeredAt ?? new Date();
  }

  // An Embedded Signup connect (a `code`, not a pasted token) has no PIN field, and Meta refuses to send
  // from a number that was never registered ("Account not registered", #133010) — so register it with
  // a PIN derived from a server secret. A typed PIN always wins.
  const registrationPin = pin || (code ? deriveRegistrationPin(phoneNumberId) : null);
  const needsRegistration = !coexistence && (!sameNumber || Boolean(pin));
  if (needsRegistration) {
    if (!registrationPin) {
      registrationSkipped = true;
    } else {
      try {
        await registerPhoneNumber({ phoneNumberId, accessToken: accessTokenPlain, pin: registrationPin });
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
      console.warn('[connect-account] subscribed_apps failed (non-fatal):', err);
    }

    if (coexistence && subscribedAppsAt && !alreadyLinked) {
      await requestCoexistenceSync(phoneNumberId, accessTokenPlain);
    }

    if (!registrationError) {
      await ensureDefaultInvoiceTemplate(accountId, wabaId, accessTokenPlain);
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
    await prisma.whatsappConfig.update({ where: { accountId }, data });
  } else {
    await prisma.whatsappConfig.create({ data: { accountId, ...data } });
  }

  if (registrationError) {
    return {
      success: false as const,
      saved: true,
      registered: false,
      registration_error: registrationError,
      phone_info: phoneInfo,
    };
  }

  return {
    success: true as const,
    saved: true,
    registered: registeredAt != null,
    registration_skipped: registrationSkipped,
    phone_info: phoneInfo,
  };
}

export async function disconnectAccount(accountId: string): Promise<void> {
  await prisma.whatsappConfig.deleteMany({ where: { accountId } });
}
