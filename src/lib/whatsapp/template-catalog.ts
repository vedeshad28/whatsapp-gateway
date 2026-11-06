// ============================================================
// The curated list of WhatsApp templates the salon app can send — booking messages, salon alerts,
// the invoice document and the verification code — with status lookup and "submit these ones".
//
// Meta approves templates per WhatsApp Business Account, so each salon with its own number needs its
// own copy. The salon app shows this list on Settings > WhatsApp and lets the owner choose which
// templates to submit. Booking-only callers keep using booking-templates.ts, which this builds on.
//
// The variable ORDER of every template is a contract with the salon backend
// (BookingMessageFormatter, WhatsAppInvoiceSendService). Change one side, change the other.
// ============================================================

import { prisma } from '@/lib/db';
import {
  BOOKING_OTP_TEMPLATE,
  BOOKING_TEMPLATE_LANGUAGE,
  buildBookingUtilityTemplates,
  OTP_EXPIRY_MINUTES,
  type BookingTemplateOptions,
} from '@/lib/whatsapp/booking-templates';
import {
  isDryRun,
  submitAuthenticationTemplate,
  submitTemplate,
  syncTemplates,
  TemplateManageError,
} from '@/lib/whatsapp/template-manage';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

/** The invoice template the salon backend sends (WhatsAppInvoiceSendService.INVOICE_TEMPLATE_NAME). */
export const INVOICE_TEMPLATE = 'invoice_ready_v3';

export type CatalogGroup = 'booking_customer' | 'booking_salon' | 'invoice' | 'verification';

export interface CatalogTemplateStatus {
  name: string;
  group: CatalogGroup;
  /** APPROVED / PENDING / REJECTED / DRAFT (submit failed) / MISSING (not submitted yet). */
  status: string;
  error: string | null;
}

interface CatalogEntry {
  name: string;
  group: CatalogGroup;
  submit: (accountId: string) => Promise<unknown>;
}

export interface CatalogOptions extends BookingTemplateOptions {
  /** Public https origin of this gateway, where the sample invoice PDF is served. Defaults to GATEWAY_PUBLIC_BASE_URL. */
  publicBaseUrl?: string | null;
}

/** Same wording as the template approved on Salonify's own account. */
export function buildInvoiceTemplate(publicBaseUrl: string): TemplatePayload {
  return {
    name: INVOICE_TEMPLATE,
    category: 'Utility',
    language: BOOKING_TEMPLATE_LANGUAGE,
    header_type: 'document',
    header_media_url: `${publicBaseUrl.replace(/\/$/, '')}/sample-invoice.pdf`,
    body_text:
      'Hi {{1}}! 🎉\n\nThank you for your service with *{{2}}*, reachable at {{3}}.\n\nHere is your invoice {{4}} for ₹{{5}}.\n\nPowered by {{6}}. Have a great day!',
    sample_values: {
      body: ['Jane Doe', 'Glamour Studio', '+91 98765 43210', 'INV-1001', '1200', 'Salonify'],
    },
  };
}

const PERMISSION_DENIED = /2388185|does not have permission to create message template/i;

/** Meta's raw message is accurate but unreadable for a salon owner; map the one we keep seeing. */
function friendlyError(message: string | null): string | null {
  if (!message) return null;
  if (PERMISSION_DENIED.test(message)) {
    return "WhatsApp hasn't allowed Salonify to create templates on this account yet. Try again later or create it in WhatsApp Manager.";
  }
  return message;
}

function buildCatalog(options: CatalogOptions): CatalogEntry[] {
  const entries: CatalogEntry[] = [
    {
      name: INVOICE_TEMPLATE,
      group: 'invoice',
      submit: async (accountId) => {
        const base = options.publicBaseUrl ?? process.env.GATEWAY_PUBLIC_BASE_URL;
        if (!base) {
          throw new TemplateManageError('bad_request', 'GATEWAY_PUBLIC_BASE_URL is not set on the gateway.', 400);
        }
        return submitTemplate(accountId, buildInvoiceTemplate(base));
      },
    },
    ...buildBookingUtilityTemplates(options).map<CatalogEntry>((payload) => ({
      name: payload.name,
      group: payload.name.startsWith('salon_') ? 'booking_salon' : 'booking_customer',
      submit: (accountId) => submitTemplate(accountId, payload),
    })),
    {
      name: BOOKING_OTP_TEMPLATE,
      group: 'verification',
      submit: (accountId) =>
        submitAuthenticationTemplate(accountId, {
          name: BOOKING_OTP_TEMPLATE,
          language: BOOKING_TEMPLATE_LANGUAGE,
          expiryMinutes: OTP_EXPIRY_MINUTES,
        }),
    },
  ];
  return entries;
}

export const CATALOG_TEMPLATE_NAMES: string[] = buildCatalog({}).map((e) => e.name);

/** Status of every catalog template on this account, from what the gateway has stored (sync first for live data). */
export async function getCatalogStatuses(accountId: string, options: CatalogOptions = {}): Promise<CatalogTemplateStatus[]> {
  const catalog = buildCatalog(options);
  const rows = await prisma.messageTemplate.findMany({
    where: { accountId, language: BOOKING_TEMPLATE_LANGUAGE, name: { in: catalog.map((e) => e.name) } },
    select: { name: true, status: true, submissionError: true, rejectionReason: true },
  });
  const byName = new Map(rows.map((r) => [r.name, r]));
  return catalog.map(({ name, group }) => {
    const row = byName.get(name);
    if (!row) return { name, group, status: 'MISSING', error: null };
    return {
      name,
      group,
      status: (row.status ?? 'PENDING').toUpperCase(),
      error: friendlyError(row.submissionError ?? row.rejectionReason ?? null),
    };
  });
}

/**
 * Submits the named catalog templates this account doesn't have yet. Safe to call repeatedly: it first
 * pulls the account's templates from Meta (so nothing is created twice), only submits ones that are
 * missing or whose earlier submit failed, and never touches an existing or in-review template.
 * One template failing does not stop the rest; its error comes back in the status list.
 */
export async function submitCatalogTemplates(
  accountId: string,
  names: string[],
  options: CatalogOptions = {},
): Promise<CatalogTemplateStatus[]> {
  const catalog = buildCatalog(options);
  const byName = new Map(catalog.map((e) => [e.name, e]));
  const unknown = names.filter((n) => !byName.has(n));
  if (unknown.length > 0) {
    throw new TemplateManageError('bad_request', `Unknown template(s): ${unknown.join(', ')}`, 400);
  }

  if (!isDryRun()) await syncTemplates(accountId);

  const before = new Map((await getCatalogStatuses(accountId, options)).map((s) => [s.name, s]));
  const failures = new Map<string, string>();

  for (const name of new Set(names)) {
    const current = before.get(name);
    if (current && current.status !== 'MISSING' && current.status !== 'DRAFT') continue;
    try {
      await byName.get(name)!.submit(accountId);
    } catch (e) {
      failures.set(name, e instanceof Error ? e.message : 'Submit failed');
    }
  }

  return (await getCatalogStatuses(accountId, options)).map((s) => ({
    ...s,
    error: friendlyError(failures.get(s.name) ?? null) ?? s.error,
  }));
}
