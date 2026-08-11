// ============================================================
// GET  /api/v1/webhooks?account_id=<uuid> — list webhook endpoints (scope: webhooks:manage)
// POST /api/v1/webhooks                    — register an endpoint    (scope: webhooks:manage)
//
// POST returns the signing `secret` in plaintext exactly once — store
// it to verify the `X-Gateway-Signature` on deliveries. The gateway
// keeps only an encrypted copy and can never show it again.
// ============================================================

import { prisma } from '@/lib/db';
import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { encrypt } from '@/lib/whatsapp/encryption';
import { normalizeEvents } from '@/lib/webhooks/events';
import {
  serializeWebhookEndpoint,
  generateWebhookSecret,
  normalizeWebhookUrl,
} from '@/lib/webhooks/endpoints';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const accountId = new URL(request.url).searchParams.get('account_id') ?? '';
    if (!accountId) {
      return fail('bad_request', "'account_id' query param is required", 400);
    }
    const account = await requireAccountAccess(ctx, accountId);

    const rows = await prisma.webhookEndpoint.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
    });

    return okList(
      rows.map((r) =>
        serializeWebhookEndpoint({
          id: r.id,
          url: r.url,
          events: r.events,
          is_active: r.isActive,
          last_delivery_at: r.lastDeliveryAt?.toISOString() ?? null,
          failure_count: r.failureCount,
          created_at: r.createdAt.toISOString(),
        })
      ),
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const accountId = typeof body.account_id === 'string' ? body.account_id : '';
    if (!accountId) {
      return fail('bad_request', "'account_id' is required", 400);
    }
    const account = await requireAccountAccess(ctx, accountId);

    const url = normalizeWebhookUrl(body.url);
    if (!url) {
      return fail('bad_request', "'url' must be a valid https:// URL", 400);
    }

    const events = normalizeEvents(body.events);
    if (!events) {
      return fail(
        'bad_request',
        "'events' must be a non-empty array of known event names",
        400
      );
    }

    const secret = generateWebhookSecret();

    const created = await prisma.webhookEndpoint.create({
      data: { accountId: account.id, url, secret: encrypt(secret), events },
    });

    return ok(
      {
        ...serializeWebhookEndpoint({
          id: created.id,
          url: created.url,
          events: created.events,
          is_active: created.isActive,
          last_delivery_at: created.lastDeliveryAt?.toISOString() ?? null,
          failure_count: created.failureCount,
          created_at: created.createdAt.toISOString(),
        }),
        secret,
      },
      201
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
