// ============================================================
// Per-template lifecycle endpoint. Auth: API key, `templates:manage`.
//
// PATCH  — edit an existing Meta-side template (re-submits, status → PENDING).
// DELETE — remove on Meta (if submitted) and drop the local row.
//
// The actual edit/delete logic lives in src/lib/whatsapp/template-manage.ts
// — see submit/route.ts's header comment for why. This file's
// request/response shape is unchanged.
// ============================================================

import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { editTemplate, deleteTemplate, isDryRun, TemplateManageError } from '@/lib/whatsapp/template-manage';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return fail('bad_request', 'Invalid template id.', 400);

    const ctx = await requireApiKey(request, 'templates:manage');

    const body = (await request.json().catch(() => null)) as (TemplatePayload & { account_id?: string }) | null;
    if (!body) return fail('bad_request', 'Invalid JSON body.', 400);
    const accountId = body.account_id ?? '';
    if (!accountId) return fail('bad_request', "'account_id' is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    try {
      const result = await editTemplate(account.id, id, body);
      return ok({ success: true, template: result.template, dry_run: result.dry_run });
    } catch (e) {
      if (e instanceof TemplateManageError) {
        return fail(e.code, e.message, e.status);
      }
      throw e;
    }
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return fail('bad_request', 'Invalid template id.', 400);

    const ctx = await requireApiKey(request, 'templates:manage');
    const accountId = new URL(request.url).searchParams.get('account_id') ?? '';
    if (!accountId) return fail('bad_request', "'account_id' query param is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    try {
      await deleteTemplate(account.id, id);
      return ok({ success: true, dry_run: isDryRun() });
    } catch (e) {
      if (e instanceof TemplateManageError) {
        return fail(e.code, e.message, e.status);
      }
      throw e;
    }
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
