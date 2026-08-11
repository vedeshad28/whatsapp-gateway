// ============================================================
// GET /api/whatsapp/config/verify-registration?account_id=<uuid>
//
// Diagnostic endpoint — confirms the account's saved phone number is
// actually reachable on Meta's side (vs just locally marked connected).
// ============================================================

import { prisma } from '@/lib/db';
import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { decrypt } from '@/lib/whatsapp/encryption';
import { getSubscribedApps, verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');
    const accountId = new URL(request.url).searchParams.get('account_id') ?? '';
    if (!accountId) return fail('bad_request', "'account_id' query param is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    const config = await prisma.whatsappConfig.findUnique({ where: { accountId: account.id } });
    if (!config) {
      return ok({ live: false, checks: { config_exists: false }, message: 'No WhatsApp configuration saved yet.' });
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.accessToken);
    } catch {
      return ok({
        live: false,
        checks: { config_exists: true, token_decryptable: false },
        message: "Stored access token can't be decrypted — likely ENCRYPTION_KEY changed.",
      });
    }

    const checks = {
      config_exists: true,
      token_decryptable: true,
      phone_metadata_ok: false,
      waba_subscribed_to_app: null as boolean | null,
      locally_marked_registered: config.registeredAt != null,
    };
    const errors: string[] = [];

    try {
      await verifyPhoneNumber({ phoneNumberId: config.phoneNumberId, accessToken });
      checks.phone_metadata_ok = true;
    } catch (err) {
      errors.push(`Phone metadata check failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (config.wabaId) {
      try {
        const subs = await getSubscribedApps({ wabaId: config.wabaId, accessToken });
        checks.waba_subscribed_to_app = subs.length > 0;
        if (!checks.waba_subscribed_to_app) {
          errors.push('WABA has no subscribed apps. Re-save the configuration to subscribe.');
        }
      } catch (err) {
        errors.push(`WABA subscription check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      errors.push("No WABA ID on file — webhooks can't be wired without it.");
    }

    const live =
      checks.phone_metadata_ok && (checks.waba_subscribed_to_app ?? false) && checks.locally_marked_registered;

    return ok({
      live,
      checks,
      errors,
      last_registration_error: config.lastRegistrationError,
      registered_at: config.registeredAt,
      subscribed_apps_at: config.subscribedAppsAt,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
