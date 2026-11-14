// ============================================================
// /api/v1/accounts/{id}/template-catalog
//
//   GET  — status of every template in Salonify's curated list (booking messages, salon alerts, the
//          invoice document, the verification code) on this account, refreshed from Meta first.
//   POST — submit the templates named in the body to Meta. Body: { "names": ["invoice_ready_v3", ...],
//          "app_base_url": "https://app.example.com" (optional, enables the booking button links) }.
//          Only templates the account is missing are submitted; safe to call repeatedly.
//
// Both return { data: { templates: [{ name, group, status, error }] } }.
//
// Templates Salonify sends from its own shared number (group `platform`, e.g. the daily summary) are
// hidden and cannot be submitted unless the caller opts in: `?include_platform=true` on GET,
// `"include_platform": true` in the POST body. A salon's own number never needs them.
//
// Auth: API key with the `accounts:manage` scope — this is account setup, like booking-templates.
// ============================================================

import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getCatalogStatuses, submitCatalogTemplates } from '@/lib/whatsapp/template-catalog';
import { isDryRun, syncTemplates, TemplateManageError } from '@/lib/whatsapp/template-manage';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');
    const { id: accountId } = await params;
    await requireAccountAccess(ctx, accountId);

    const includePlatform = new URL(request.url).searchParams.get('include_platform') === 'true';

    if (!isDryRun()) await syncTemplates(accountId);
    return ok({ templates: await getCatalogStatuses(accountId, { includePlatform }) });
  } catch (e) {
    if (e instanceof TemplateManageError) return fail(e.code, e.message, e.status);
    return toApiErrorResponse(e);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireApiKey(request, 'accounts:manage');
    const { id: accountId } = await params;
    await requireAccountAccess(ctx, accountId);

    const body = (await request.json().catch(() => null)) as
      | { names?: unknown; app_base_url?: unknown; include_platform?: unknown }
      | null;
    const names = Array.isArray(body?.names) ? body.names.filter((n): n is string => typeof n === 'string') : [];
    if (names.length === 0) return fail('bad_request', "'names' must list at least one template", 400);
    const appBaseUrl = typeof body?.app_base_url === 'string' ? body.app_base_url : null;
    const includePlatform = body?.include_platform === true;

    return ok({ templates: await submitCatalogTemplates(accountId, names, { appBaseUrl, includePlatform }) });
  } catch (e) {
    if (e instanceof TemplateManageError) return fail(e.code, e.message, e.status);
    return toApiErrorResponse(e);
  }
}
