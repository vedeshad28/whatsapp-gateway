// ============================================================
// POST /api/v1/accounts — provision a new gateway account.
//
// Doesn't exist in wacrm (it assumes a human signs up and creates
// their own account through the dashboard). This gateway is driven by
// calling applications, not humans, so account creation is an API
// call: a client (e.g. salon-saas) provisions one account per WABA it
// wants to connect (e.g. one per salon tenant), passing its own
// opaque `external_ref` (e.g. its tenant UUID) to find the account
// again later without the gateway knowing what a "tenant" is.
//
// Auth: API key with the `accounts:manage` scope.
// ============================================================

import { prisma } from '@/lib/db';
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    const externalRef =
      body && typeof body.external_ref === 'string' ? body.external_ref : null;
    const label = body && typeof body.label === 'string' ? body.label : null;

    // Idempotent by (client, external_ref): calling this again for the
    // same tenant returns the existing account rather than creating a
    // second one — a calling app can safely retry without tracking
    // whether provisioning already happened.
    if (externalRef) {
      const existing = await prisma.account.findUnique({
        where: { clientId_externalRef: { clientId: ctx.clientId, externalRef } },
      });
      if (existing) {
        return ok(
          { account_id: existing.id, external_ref: existing.externalRef, label: existing.label },
          200
        );
      }
    }

    const created = await prisma.account.create({
      data: { clientId: ctx.clientId, externalRef, label },
    });

    return ok(
      { account_id: created.id, external_ref: created.externalRef, label: created.label },
      201
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');

    const externalRef = new URL(request.url).searchParams.get('external_ref');

    const accounts = await prisma.account.findMany({
      where: { clientId: ctx.clientId, ...(externalRef ? { externalRef } : {}) },
      include: { whatsappConfig: { select: { status: true, displayPhoneNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return ok({
      accounts: accounts.map((a) => ({
        account_id: a.id,
        external_ref: a.externalRef,
        label: a.label,
        whatsapp_status: a.whatsappConfig?.status ?? 'not_connected',
        display_phone_number: a.whatsappConfig?.displayPhoneNumber ?? null,
      })),
    });
  } catch (err) {
    if (err instanceof Error) return fail('internal', err.message, 500);
    return toApiErrorResponse(err);
  }
}
