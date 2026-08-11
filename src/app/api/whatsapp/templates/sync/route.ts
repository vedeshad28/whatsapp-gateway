// ============================================================
// POST /api/whatsapp/templates/sync — pull templates from Meta into
// the local message_templates table. Auth: API key,
// `templates:manage`, `account_id` in the body.
// ============================================================

import { prisma } from '@/lib/db';
import { requireApiKey, requireAccountAccess } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { decrypt } from '@/lib/whatsapp/encryption';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';
import type { TemplateButton, TemplateSampleValues } from '@/types';

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

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

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'templates:manage');
    const body = (await request.json().catch(() => null)) as { account_id?: string } | null;
    const accountId = body?.account_id ?? '';
    if (!accountId) return fail('bad_request', "'account_id' is required", 400);
    const account = await requireAccountAccess(ctx, accountId);

    const config = await prisma.whatsappConfig.findUnique({ where: { accountId: account.id } });
    if (!config) return fail('bad_request', 'WhatsApp not configured for this account.', 400);
    if (!config.wabaId) return fail('bad_request', 'WABA ID missing — reconnect the account.', 400);

    const accessToken = decrypt(config.accessToken);

    const metaTemplates: MetaTemplate[] = [];
    let nextUrl: string | null = `${META_API_BASE}/${config.wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`;
    const PAGE_CAP = 20;
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
        return fail('meta_error', metaErr, 502);
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
        accountId: account.id,
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
          where: { accountId: account.id, name: t.name, language: t.language },
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

    return ok({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
