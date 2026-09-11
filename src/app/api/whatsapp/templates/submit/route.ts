// ============================================================
// POST /api/whatsapp/templates/submit — submit a template to Meta for
// approval AND persist it locally. Auth: API key, `templates:manage`,
// `account_id` in the body.
//
// When WHATSAPP_TEMPLATES_DRY_RUN=true, skips the network call and
// inserts a row with a synthetic `dry-run-<uuid>` meta_template_id so
// local dev can exercise the flow without a real Meta App.
//
// The actual submit logic lives in src/lib/whatsapp/template-manage.ts
// — extracted during the CRM restoration so the dashboard's session-
// gated equivalent (src/app/api/account/templates/route.ts POST) can
// share it instead of re-implementing it. This file's request/
// response shape is unchanged.
// ============================================================

import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { submitTemplate, TemplateManageError } from '@/lib/whatsapp/template-manage';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'templates:manage');

    const body = (await request.json().catch(() => null)) as
      | (TemplatePayload & { account_id?: string })
      | null;
    if (!body) return fail('bad_request', 'Invalid JSON body', 400);

    const accountId = body.account_id ?? '';
    if (!accountId) return fail('bad_request', "'account_id' is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    try {
      const result = await submitTemplate(account.id, body);
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
