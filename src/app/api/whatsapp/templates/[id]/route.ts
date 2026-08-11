// ============================================================
// Per-template lifecycle endpoint. Auth: API key, `templates:manage`.
//
// PATCH  — edit an existing Meta-side template (re-submits, status → PENDING).
// DELETE — remove on Meta (if submitted) and drop the local row.
// ============================================================

import { prisma } from '@/lib/db';
import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { decrypt } from '@/lib/whatsapp/encryption';
import { deleteMessageTemplate, editMessageTemplate } from '@/lib/whatsapp/meta-api';
import { validateTemplatePayload, type TemplatePayload } from '@/lib/whatsapp/template-validators';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle';

const EDITABLE_STATUSES = new Set(['APPROVED', 'REJECTED', 'PAUSED']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDryRun(): boolean {
  return process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' || process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1';
}

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

    const existing = await prisma.messageTemplate.findFirst({ where: { id, accountId: account.id } });
    if (!existing) return fail('not_found', 'Template not found.', 404);
    if (!existing.metaTemplateId) {
      return fail('bad_request', 'This template was never submitted to Meta — submit it instead.', 400);
    }
    if (!existing.status || !EDITABLE_STATUSES.has(existing.status)) {
      return fail('bad_request', `Templates in status ${existing.status} cannot be edited.`, 400);
    }
    if (body.category === 'Authentication') {
      return fail('bad_request', 'AUTHENTICATION templates are not editable here.', 400);
    }

    try {
      validateTemplatePayload(body);
    } catch (e) {
      return fail('bad_request', e instanceof Error ? e.message : 'Validation failed.', 400);
    }

    if (!isDryRun()) {
      const config = await prisma.whatsappConfig.findUnique({ where: { accountId: account.id } });
      if (!config) return fail('bad_request', 'WhatsApp not configured.', 400);
      const accessToken = decrypt(config.accessToken);

      try {
        await ensureImageHeaderHandle(body, accessToken);
      } catch (e) {
        return fail('bad_request', e instanceof Error ? e.message : 'Header image upload failed.', 400);
      }

      const metaPayload = buildMetaTemplatePayload(body);
      try {
        await editMessageTemplate({
          metaTemplateId: existing.metaTemplateId,
          accessToken,
          components: metaPayload.components,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta edit failed.';
        await prisma.messageTemplate.update({
          where: { id },
          data: { submissionError: message, lastSubmittedAt: new Date() },
        });
        return fail('meta_error', message, 502);
      }
    }

    const row = await prisma.messageTemplate.update({
      where: { id },
      data: {
        category: body.category,
        headerType: body.header_type ?? null,
        headerContent: body.header_content ?? null,
        headerMediaUrl: body.header_media_url ?? null,
        headerHandle: body.header_handle ?? null,
        bodyText: body.body_text,
        footerText: body.footer_text ?? null,
        buttons: (body.buttons as object[] | undefined) ?? undefined,
        sampleValues: (body.sample_values as object | undefined) ?? undefined,
        status: 'PENDING',
        submissionError: null,
        rejectionReason: null,
        lastSubmittedAt: new Date(),
      },
    });

    return ok({ success: true, template: row, dry_run: isDryRun() });
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

    const existing = await prisma.messageTemplate.findFirst({ where: { id, accountId: account.id } });
    if (!existing) return fail('not_found', 'Template not found.', 404);

    if (existing.metaTemplateId && !isDryRun()) {
      const config = await prisma.whatsappConfig.findUnique({ where: { accountId: account.id } });
      if (!config?.wabaId) return fail('bad_request', 'WhatsApp not configured — cannot delete on Meta.', 400);
      const accessToken = decrypt(config.accessToken);
      try {
        await deleteMessageTemplate({
          wabaId: config.wabaId,
          accessToken,
          name: existing.name,
          metaTemplateId: existing.metaTemplateId,
        });
      } catch (e) {
        return fail('meta_error', e instanceof Error ? e.message : 'Meta delete failed.', 502);
      }
    }

    await prisma.messageTemplate.delete({ where: { id } });

    return ok({ success: true, dry_run: isDryRun() });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
