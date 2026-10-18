// ============================================================
// /api/v1/accounts/{id}/booking-templates
//
//   POST — make sure this account has the WhatsApp templates the salon app's online booking sends
//          (one-time code, customer booking messages, salon alerts). Submits whatever is missing to
//          Meta; safe to call repeatedly. Body (optional): { "app_base_url": "https://app.example.com" }
//          — enables the "Manage booking" / "Open requests" buttons.
//   GET  — current status of each of those templates, refreshed from Meta first.
//
// Both return { data: { templates: [{ name, status, error }], ready } } where `ready` is true once
// every template is APPROVED.
//
// Auth: API key with the `accounts:manage` scope — this is account setup, like provisioning.
// ============================================================

import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  getBookingTemplateStatuses,
  provisionBookingTemplates,
  type BookingTemplateStatus,
} from '@/lib/whatsapp/booking-templates';
import { isDryRun, syncTemplates, TemplateManageError } from '@/lib/whatsapp/template-manage';

function respond(templates: BookingTemplateStatus[]) {
  return ok({ templates, ready: templates.every((t) => t.status === 'APPROVED') });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');
    const { id: accountId } = await params;
    await requireAccountAccess(ctx, accountId);

    const body = (await request.json().catch(() => null)) as { app_base_url?: unknown } | null;
    const appBaseUrl = typeof body?.app_base_url === 'string' ? body.app_base_url : null;

    return respond(await provisionBookingTemplates(accountId, { appBaseUrl }));
  } catch (e) {
    if (e instanceof TemplateManageError) return fail(e.code, e.message, e.status);
    return toApiErrorResponse(e);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');
    const { id: accountId } = await params;
    await requireAccountAccess(ctx, accountId);

    if (!isDryRun()) await syncTemplates(accountId);
    return respond(await getBookingTemplateStatuses(accountId));
  } catch (e) {
    if (e instanceof TemplateManageError) return fail(e.code, e.message, e.status);
    return toApiErrorResponse(e);
  }
}
