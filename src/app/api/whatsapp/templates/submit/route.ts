// ============================================================
// POST /api/whatsapp/templates/submit — submit a template to Meta for
// approval AND persist it locally. Auth: API key, `templates:manage`,
// `account_id` in the body.
//
// When WHATSAPP_TEMPLATES_DRY_RUN=true, skips the network call and
// inserts a row with a synthetic `dry-run-<uuid>` meta_template_id so
// local dev can exercise the flow without a real Meta App.
// ============================================================

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { decrypt } from '@/lib/whatsapp/encryption';
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api';
import { validateTemplatePayload, type TemplatePayload } from '@/lib/whatsapp/template-validators';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';

function isDryRun(): boolean {
  return process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' || process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1';
}

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

    if (body.category === 'Authentication') {
      return fail('bad_request', 'AUTHENTICATION templates are not supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".', 400);
    }

    try {
      validateTemplatePayload(body);
    } catch (e) {
      return fail('bad_request', e instanceof Error ? e.message : 'Validation failed', 400);
    }

    let metaTemplateId: string;
    let metaStatus: string;

    if (isDryRun()) {
      metaTemplateId = `dry-run-${randomUUID()}`;
      metaStatus = 'PENDING';
    } else {
      const config = await prisma.whatsappConfig.findUnique({ where: { accountId: account.id } });
      if (!config) return fail('bad_request', 'WhatsApp not configured for this account.', 400);
      if (!config.wabaId) return fail('bad_request', 'WABA ID missing — reconnect the account.', 400);

      const accessToken = decrypt(config.accessToken);

      try {
        await ensureImageHeaderHandle(body, accessToken);
      } catch (e) {
        return fail('bad_request', e instanceof Error ? e.message : 'Header image upload failed', 400);
      }

      const metaPayload = buildMetaTemplatePayload(body);
      try {
        const meta = await submitMessageTemplate({ wabaId: config.wabaId, accessToken, payload: metaPayload });
        metaTemplateId = meta.id;
        metaStatus = meta.status;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta submit failed';
        await prisma.messageTemplate.upsert({
          where: { accountId_name_language: { accountId: account.id, name: body.name, language: body.language ?? 'en_US' } },
          create: buildRow(account.id, body, { status: 'DRAFT', metaTemplateId: null, submissionError: message }),
          update: buildRow(account.id, body, { status: 'DRAFT', metaTemplateId: null, submissionError: message }),
        });
        const isRateLimit = /\b429\b/.test(message);
        return fail(
          'meta_error',
          isRateLimit ? 'Meta rate limit hit (100 template creates per hour). Try again later.' : message,
          isRateLimit ? 429 : 502
        );
      }
    }

    const row = await prisma.messageTemplate.upsert({
      where: {
        accountId_name_language: { accountId: account.id, name: body.name, language: body.language ?? 'en_US' },
      },
      create: buildRow(account.id, body, { status: normalizeStatus(metaStatus), metaTemplateId, submissionError: null }),
      update: buildRow(account.id, body, { status: normalizeStatus(metaStatus), metaTemplateId, submissionError: null }),
    });

    return ok({ success: true, template: row, dry_run: isDryRun() });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

function buildRow(
  accountId: string,
  payload: TemplatePayload,
  extras: { status: string; metaTemplateId: string | null; submissionError: string | null }
) {
  return {
    accountId,
    name: payload.name,
    category: payload.category,
    language: payload.language ?? 'en_US',
    headerType: payload.header_type ?? null,
    headerContent: payload.header_content ?? null,
    headerMediaUrl: payload.header_media_url ?? null,
    headerHandle: payload.header_handle ?? null,
    bodyText: payload.body_text,
    footerText: payload.footer_text ?? null,
    buttons: (payload.buttons as object[] | undefined) ?? undefined,
    sampleValues: (payload.sample_values as object | undefined) ?? undefined,
    status: extras.status,
    metaTemplateId: extras.metaTemplateId,
    submissionError: extras.submissionError,
    rejectionReason: null,
    lastSubmittedAt: new Date(),
  };
}
