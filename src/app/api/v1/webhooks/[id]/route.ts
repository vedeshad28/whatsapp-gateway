// ============================================================
// GET    /api/v1/webhooks/{id} — read an endpoint   (webhooks:manage)
// PATCH  /api/v1/webhooks/{id} — update url/events/is_active
// DELETE /api/v1/webhooks/{id} — remove an endpoint
//
// All scoped to the caller's client (via the endpoint's account): a
// foreign id → 404 (never 403). The signing secret is never returned
// here — it's shown once at creation only.
// ============================================================

import { prisma } from '@/lib/db';
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { normalizeEvents } from '@/lib/webhooks/events';
import { serializeWebhookEndpoint, normalizeWebhookUrl } from '@/lib/webhooks/endpoints';

function toApiShape(row: {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastDeliveryAt: Date | null;
  failureCount: number;
  createdAt: Date;
}) {
  return serializeWebhookEndpoint({
    id: row.id,
    url: row.url,
    events: row.events,
    is_active: row.isActive,
    last_delivery_at: row.lastDeliveryAt?.toISOString() ?? null,
    failure_count: row.failureCount,
    created_at: row.createdAt.toISOString(),
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');
    const { id } = await params;

    const row = await prisma.webhookEndpoint.findFirst({
      where: { id, account: { clientId: ctx.clientId } },
    });
    if (!row) return fail('not_found', 'Webhook not found', 404);

    return ok(toApiShape(row));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const updates: {
      url?: string;
      events?: string[];
      isActive?: boolean;
      failureCount?: number;
    } = {};

    if ('url' in body) {
      const url = normalizeWebhookUrl(body.url);
      if (!url) {
        return fail('bad_request', "'url' must be a valid https:// URL", 400);
      }
      updates.url = url;
    }

    if ('events' in body) {
      const events = normalizeEvents(body.events);
      if (!events) {
        return fail(
          'bad_request',
          "'events' must be a non-empty array of known event names",
          400
        );
      }
      updates.events = events;
    }

    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean') {
        return fail('bad_request', "'is_active' must be a boolean", 400);
      }
      updates.isActive = body.is_active;
      // Re-enabling a disabled endpoint clears its failure streak so it
      // isn't instantly re-disabled by a single stale failure.
      if (body.is_active === true) updates.failureCount = 0;
    }

    if (Object.keys(updates).length === 0) {
      return fail('bad_request', 'No updatable fields provided', 400);
    }

    const existing = await prisma.webhookEndpoint.findFirst({
      where: { id, account: { clientId: ctx.clientId } },
      select: { id: true },
    });
    if (!existing) return fail('not_found', 'Webhook not found', 404);

    const updated = await prisma.webhookEndpoint.update({ where: { id }, data: updates });

    return ok(toApiShape(updated));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');
    const { id } = await params;

    const existing = await prisma.webhookEndpoint.findFirst({
      where: { id, account: { clientId: ctx.clientId } },
      select: { id: true },
    });
    if (!existing) return fail('not_found', 'Webhook not found', 404);

    await prisma.webhookEndpoint.delete({ where: { id } });

    return ok({ id, deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
