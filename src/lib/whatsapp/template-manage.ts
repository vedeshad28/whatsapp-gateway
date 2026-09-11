// ============================================================
// Core template-lifecycle logic — the guts of what used to live only
// in src/app/api/whatsapp/templates/{submit,sync,[id]}/route.ts,
// extracted so session-gated dashboard routes
// (src/app/api/account/templates/**) can call the exact same
// submit/sync/edit/delete behavior an API-key caller gets, instead of
// re-implementing it. Same extraction pattern as
// src/lib/whatsapp/connect-account.ts and broadcast-send.ts.
//
// Deliberately auth-agnostic: every function takes a plain
// `accountId` the caller has already verified access to (via
// requireAccountAccess for API keys, or requireWorkspaceAccountAccess
// for sessions) — this module has no opinion on how that check
// happened.
// ============================================================

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  submitMessageTemplate,
  editMessageTemplate,
  deleteMessageTemplate,
} from '@/lib/whatsapp/meta-api';
import { validateTemplatePayload, type TemplatePayload } from '@/lib/whatsapp/template-validators';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';
import type { TemplateButton, TemplateSampleValues } from '@/types';

export type TemplateManageErrorCode = 'bad_request' | 'meta_error' | 'not_found';

export class TemplateManageError extends Error {
  readonly code: TemplateManageErrorCode;
  readonly status: number;
  constructor(code: TemplateManageErrorCode, message: string, status: number) {
    super(message);
    this.name = 'TemplateManageError';
    this.code = code;
    this.status = status;
  }
}

export const EDITABLE_STATUSES = new Set(['APPROVED', 'REJECTED', 'PAUSED']);

export function isDryRun(): boolean {
  return process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' || process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1';
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

export async function submitTemplate(accountId: string, payload: TemplatePayload) {
  if (payload.category === 'Authentication') {
    throw new TemplateManageError(
      'bad_request',
      'AUTHENTICATION templates are not supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
      400
    );
  }

  try {
    validateTemplatePayload(payload);
  } catch (e) {
    throw new TemplateManageError('bad_request', e instanceof Error ? e.message : 'Validation failed', 400);
  }

  let metaTemplateId: string;
  let metaStatus: string;

  if (isDryRun()) {
    metaTemplateId = `dry-run-${randomUUID()}`;
    metaStatus = 'PENDING';
  } else {
    const config = await prisma.whatsappConfig.findUnique({ where: { accountId } });
    if (!config) throw new TemplateManageError('bad_request', 'WhatsApp not configured for this account.', 400);
    if (!config.wabaId) throw new TemplateManageError('bad_request', 'WABA ID missing — reconnect the account.', 400);

    const accessToken = decrypt(config.accessToken);

    try {
      await ensureImageHeaderHandle(payload, accessToken);
    } catch (e) {
      throw new TemplateManageError('bad_request', e instanceof Error ? e.message : 'Header image upload failed', 400);
    }

    const metaPayload = buildMetaTemplatePayload(payload);
    try {
      const meta = await submitMessageTemplate({ wabaId: config.wabaId, accessToken, payload: metaPayload });
      metaTemplateId = meta.id;
      metaStatus = meta.status;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Meta submit failed';
      await prisma.messageTemplate.upsert({
        where: {
          accountId_name_language: { accountId, name: payload.name, language: payload.language ?? 'en_US' },
        },
        create: buildRow(accountId, payload, { status: 'DRAFT', metaTemplateId: null, submissionError: message }),
        update: buildRow(accountId, payload, { status: 'DRAFT', metaTemplateId: null, submissionError: message }),
      });
      const isRateLimit = /\b429\b/.test(message);
      throw new TemplateManageError(
        'meta_error',
        isRateLimit ? 'Meta rate limit hit (100 template creates per hour). Try again later.' : message,
        isRateLimit ? 429 : 502
      );
    }
  }

  const row = await prisma.messageTemplate.upsert({
    where: { accountId_name_language: { accountId, name: payload.name, language: payload.language ?? 'en_US' } },
    create: buildRow(accountId, payload, { status: normalizeStatus(metaStatus), metaTemplateId, submissionError: null }),
    update: buildRow(accountId, payload, { status: normalizeStatus(metaStatus), metaTemplateId, submissionError: null }),
  });

  return { template: row, dry_run: isDryRun() };
}

export async function editTemplate(accountId: string, templateId: string, payload: TemplatePayload) {
  const existing = await prisma.messageTemplate.findFirst({ where: { id: templateId, accountId } });
  if (!existing) throw new TemplateManageError('not_found', 'Template not found.', 404);
  if (!existing.metaTemplateId) {
    throw new TemplateManageError('bad_request', 'This template was never submitted to Meta — submit it instead.', 400);
  }
  if (!existing.status || !EDITABLE_STATUSES.has(existing.status)) {
    throw new TemplateManageError('bad_request', `Templates in status ${existing.status} cannot be edited.`, 400);
  }
  if (payload.category === 'Authentication') {
    throw new TemplateManageError('bad_request', 'AUTHENTICATION templates are not editable here.', 400);
  }

  try {
    validateTemplatePayload(payload);
  } catch (e) {
    throw new TemplateManageError('bad_request', e instanceof Error ? e.message : 'Validation failed.', 400);
  }

  if (!isDryRun()) {
    const config = await prisma.whatsappConfig.findUnique({ where: { accountId } });
    if (!config) throw new TemplateManageError('bad_request', 'WhatsApp not configured.', 400);
    const accessToken = decrypt(config.accessToken);

    try {
      await ensureImageHeaderHandle(payload, accessToken);
    } catch (e) {
      throw new TemplateManageError('bad_request', e instanceof Error ? e.message : 'Header image upload failed.', 400);
    }

    const metaPayload = buildMetaTemplatePayload(payload);
    try {
      await editMessageTemplate({
        metaTemplateId: existing.metaTemplateId,
        accessToken,
        components: metaPayload.components,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Meta edit failed.';
      await prisma.messageTemplate.update({
        where: { id: templateId },
        data: { submissionError: message, lastSubmittedAt: new Date() },
      });
      throw new TemplateManageError('meta_error', message, 502);
    }
  }

  const row = await prisma.messageTemplate.update({
    where: { id: templateId },
    data: {
      category: payload.category,
      headerType: payload.header_type ?? null,
      headerContent: payload.header_content ?? null,
      headerMediaUrl: payload.header_media_url ?? null,
      headerHandle: payload.header_handle ?? null,
      bodyText: payload.body_text,
      footerText: payload.footer_text ?? null,
      buttons: (payload.buttons as object[] | undefined) ?? undefined,
      sampleValues: (payload.sample_values as object | undefined) ?? undefined,
      status: 'PENDING',
      submissionError: null,
      rejectionReason: null,
      lastSubmittedAt: new Date(),
    },
  });

  return { template: row, dry_run: isDryRun() };
}

export async function deleteTemplate(accountId: string, templateId: string): Promise<void> {
  const existing = await prisma.messageTemplate.findFirst({ where: { id: templateId, accountId } });
  if (!existing) throw new TemplateManageError('not_found', 'Template not found.', 404);

  if (existing.metaTemplateId && !isDryRun()) {
    const config = await prisma.whatsappConfig.findUnique({ where: { accountId } });
    if (!config?.wabaId) {
      throw new TemplateManageError('bad_request', 'WhatsApp not configured — cannot delete on Meta.', 400);
    }
    const accessToken = decrypt(config.accessToken);
    try {
      await deleteMessageTemplate({
        wabaId: config.wabaId,
        accessToken,
        name: existing.name,
        metaTemplateId: existing.metaTemplateId,
      });
    } catch (e) {
      throw new TemplateManageError('meta_error', e instanceof Error ? e.message : 'Meta delete failed.', 502);
    }
  }

  await prisma.messageTemplate.delete({ where: { id: templateId } });
}

// ----------------------------------------------------------
// Sync — pull every template from Meta into the local table.
// ----------------------------------------------------------

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const PAGE_CAP = 20;

interface MetaButton {
  type: string;
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[] | string;
}
interface MetaTemplateComponent {
  type: string;
  text?: string;
  format?: string;
  buttons?: MetaButton[];
  example?: { header_text?: string[]; header_handle?: string[]; body_text?: string[][] };
}
interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: MetaTemplateComponent[];
  quality_score?: { score?: string } | string;
}

function normalizeCategory(meta: string): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase();
  if (upper === 'UTILITY') return 'Utility';
  if (upper === 'AUTHENTICATION') return 'Authentication';
  return 'Marketing';
}

function normalizeQualityScore(raw: MetaTemplate['quality_score']): string | null {
  const score = typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null;
  if (!score) return null;
  const upper = score.toUpperCase();
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED' ? upper : null;
}

function parseButtons(metaButtons: MetaButton[] | undefined): TemplateButton[] {
  if (!metaButtons?.length) return [];
  const out: TemplateButton[] = [];
  for (const b of metaButtons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text });
        break;
      case 'URL':
        out.push({ type: 'URL', text: b.text, url: b.url ?? '', example: Array.isArray(b.example) ? b.example[0] : b.example });
        break;
      case 'PHONE_NUMBER':
        out.push({ type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number ?? '' });
        break;
      case 'COPY_CODE':
        out.push({ type: 'COPY_CODE', text: b.text, example: Array.isArray(b.example) ? b.example[0] ?? '' : b.example ?? '' });
        break;
    }
  }
  return out;
}

function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined
): TemplateSampleValues | null {
  const bodySample = body?.example?.body_text?.[0];
  const headerSample = header?.example?.header_text;
  if (!bodySample?.length && !headerSample?.length) return null;
  const sv: TemplateSampleValues = {};
  if (bodySample?.length) sv.body = bodySample;
  if (headerSample?.length) sv.header = headerSample;
  return sv;
}

export async function syncTemplates(accountId: string) {
  const config = await prisma.whatsappConfig.findUnique({ where: { accountId } });
  if (!config) throw new TemplateManageError('bad_request', 'WhatsApp not configured for this account.', 400);
  if (!config.wabaId) throw new TemplateManageError('bad_request', 'WABA ID missing — reconnect the account.', 400);

  const accessToken = decrypt(config.accessToken);

  const metaTemplates: MetaTemplate[] = [];
  let nextUrl: string | null = `${META_API_BASE}/${config.wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`;
  let pageCount = 0;

  while (nextUrl && pageCount < PAGE_CAP) {
    pageCount++;
    const metaRes: Response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!metaRes.ok) {
      let metaErr = `Meta API error: ${metaRes.status}`;
      try {
        const errBody = await metaRes.json();
        if (errBody?.error?.message) metaErr = errBody.error.message;
      } catch {
        /* not JSON */
      }
      throw new TemplateManageError('meta_error', metaErr, 502);
    }
    const metaBody: { data?: MetaTemplate[]; paging?: { next?: string } } = await metaRes.json();
    if (metaBody.data) metaTemplates.push(...metaBody.data);
    nextUrl = metaBody.paging?.next ?? null;
  }

  let inserted = 0;
  let updated = 0;
  const errors: { name: string; language: string; message: string }[] = [];

  for (const t of metaTemplates) {
    const comp = t.components ?? [];
    const bodyC = comp.find((c) => c.type === 'BODY');
    const headerC = comp.find((c) => c.type === 'HEADER');
    const footerC = comp.find((c) => c.type === 'FOOTER');
    const buttonsC = comp.find((c) => c.type === 'BUTTONS');

    const headerFormat = headerC?.format?.toUpperCase();
    const headerType =
      headerFormat === 'TEXT' || headerFormat === 'IMAGE' || headerFormat === 'VIDEO' || headerFormat === 'DOCUMENT'
        ? headerFormat.toLowerCase()
        : null;

    const data = {
      accountId,
      name: t.name,
      category: normalizeCategory(t.category),
      language: t.language,
      headerType,
      headerContent: headerC?.text ?? null,
      headerHandle: headerC?.example?.header_handle?.[0] ?? null,
      bodyText: bodyC?.text ?? '',
      footerText: footerC?.text ?? null,
      buttons: (parseButtons(buttonsC?.buttons) as object[] | undefined) ?? undefined,
      sampleValues: (extractSampleValues(bodyC, headerC) as object | undefined) ?? undefined,
      status: normalizeStatus(t.status),
      metaTemplateId: t.id,
      qualityScore: normalizeQualityScore(t.quality_score),
    };

    try {
      const existing = await prisma.messageTemplate.findFirst({
        where: { accountId, name: t.name, language: t.language },
        select: { id: true },
      });
      if (existing) {
        await prisma.messageTemplate.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.messageTemplate.create({ data });
        inserted++;
      }
    } catch (err) {
      errors.push({ name: t.name, language: t.language, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    success: errors.length === 0,
    total: metaTemplates.length,
    inserted,
    updated,
    errors,
    truncated: pageCount >= PAGE_CAP && nextUrl !== null,
  };
}
