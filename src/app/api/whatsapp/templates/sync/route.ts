// ============================================================
// POST /api/whatsapp/templates/sync — pull templates from Meta into
// the local message_templates table. Auth: API key,
// `templates:manage`, `account_id` in the body.
//
// The actual sync logic lives in src/lib/whatsapp/template-manage.ts
// — see submit/route.ts's header comment for why. This file's
// request/response shape is unchanged.
// ============================================================

import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { syncTemplates, TemplateManageError } from '@/lib/whatsapp/template-manage';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'templates:manage');
    const body = (await request.json().catch(() => null)) as { account_id?: string } | null;
    const accountId = body?.account_id ?? '';
    if (!accountId) return fail('bad_request', "'account_id' is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    try {
      const result = await syncTemplates(account.id);
      return ok(result);
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
