// ============================================================
// Outbound webhook delivery.
//
// `dispatchWebhookEvent` finds the account's active endpoints
// subscribed to an event, signs one JSON payload, and POSTs it to
// each in parallel. It is best-effort and never throws — callers fire
// it from the inbound webhook handler, where a failed delivery must
// not affect the 200 OK returned to Meta.
//
// Delivery semantics:
//   - At-most-once per event, single attempt with a short timeout.
//   - Each consecutive failure bumps `failureCount`; once it crosses
//     MAX_CONSECUTIVE_FAILURES the endpoint is auto-disabled
//     (`isActive = false`) so a dead sink stops being hit. A success
//     resets the counter and stamps `lastDeliveryAt`.
//   - Durable retry-with-backoff would need a queue/worker (a
//     follow-up); in-process retries here would burn the request's
//     duration budget without a real durability guarantee.
//
// Ported from wacrm onto Prisma; logic unchanged.
// ============================================================

import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/whatsapp/encryption';
import { buildSignatureHeader } from '@/lib/webhooks/sign';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { WebhookEvent } from '@/lib/webhooks/events';

/** Per-endpoint HTTP timeout. Kept short — this runs inline in a request. */
export const DELIVERY_TIMEOUT_MS = 5000;

/** Auto-disable an endpoint after this many consecutive failures. */
export const MAX_CONSECUTIVE_FAILURES = 15;

interface EndpointRow {
  id: string;
  url: string;
  secret: string;
}

/**
 * Deliver `event` (+ `data`) to every active endpoint of `accountId`
 * subscribed to it. Never throws.
 */
export async function dispatchWebhookEvent(
  accountId: string,
  event: WebhookEvent,
  data: unknown
): Promise<void> {
  try {
    const rows = await prisma.webhookEndpoint.findMany({
      where: { accountId, isActive: true, events: { has: event } },
      select: { id: true, url: true, secret: true },
    });

    if (rows.length === 0) return;

    // Sign the exact bytes we send so a receiver can recompute the
    // HMAC over the raw request body. `id` is a per-delivery uuid the
    // receiver can dedupe on (deliveries are at-least-once and may
    // repeat / arrive out of order).
    const payload = JSON.stringify({
      id: randomUUID(),
      event,
      occurred_at: new Date().toISOString(),
      account_id: accountId,
      data,
    });
    const tsSeconds = Math.floor(Date.now() / 1000);

    await Promise.allSettled(
      rows.map((row) => deliverOne(row as EndpointRow, event, payload, tsSeconds))
    );
  } catch (err) {
    console.error('[webhooks] dispatch failed:', err);
  }
}

async function deliverOne(
  row: EndpointRow,
  event: WebhookEvent,
  payload: string,
  tsSeconds: number
): Promise<void> {
  // SSRF guard: refuse to POST to a host that resolves to a private /
  // loopback / link-local address. Counts as a failure so a
  // misconfigured internal URL surfaces and eventually auto-disables.
  if (!(await isDeliverableUrl(row.url))) {
    console.warn('[webhooks] refusing non-public delivery target for', row.id);
    await recordFailure(row.id);
    return;
  }

  let secret: string;
  try {
    secret = decrypt(row.secret);
  } catch (err) {
    console.error('[webhooks] secret decrypt failed for', row.id, err);
    await recordFailure(row.id);
    return;
  }

  try {
    const res = await fetch(row.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Event': event,
        'X-Gateway-Webhook-Id': row.id,
        'X-Gateway-Signature': buildSignatureHeader(payload, secret, tsSeconds),
      },
      body: payload,
      // Do NOT follow redirects — a public URL could 3xx-bounce to an
      // internal address, bypassing the SSRF check above.
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`endpoint responded ${res.status}`);

    await prisma.webhookEndpoint.update({
      where: { id: row.id },
      data: { failureCount: 0, lastDeliveryAt: new Date() },
    });
  } catch (err) {
    console.warn(
      `[webhooks] delivery to ${row.id} failed:`,
      err instanceof Error ? err.message : err
    );
    await recordFailure(row.id);
  }
}

/**
 * Atomic increment (+ auto-disable at the threshold). A read-modify-
 * write here would lose increments when two deliveries to the same
 * endpoint run concurrently, so a dead endpoint might never reach the
 * disable threshold — a raw SQL update keeps the `+1` and the disable
 * decision in one statement.
 */
async function recordFailure(endpointId: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE webhook_endpoints
      SET failure_count = failure_count + 1,
          is_active = CASE
            WHEN failure_count + 1 >= ${MAX_CONSECUTIVE_FAILURES} THEN false
            ELSE is_active
          END
      WHERE id = ${endpointId}::uuid
    `;
  } catch (err) {
    console.error('[webhooks] record_webhook_failure failed for', endpointId, err);
  }
}
