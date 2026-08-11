// ============================================================
// Auto-provisions the "invoice_ready" template on first successful
// connect, so a calling app (salon-saas) can send invoices immediately
// without a human first visiting Meta WhatsApp Manager. Best-effort:
// failures are logged and swallowed — connect still succeeds, and the
// account can submit a template manually via /api/whatsapp/templates/submit
// as a fallback.
//
// UTILITY category (not MARKETING) — utility templates get faster,
// more reliable approval since they're transactional, not promotional.
// ============================================================

import { prisma } from '@/lib/db';
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export const DEFAULT_INVOICE_TEMPLATE_NAME = 'invoice_ready';

export async function ensureDefaultInvoiceTemplate(
  accountId: string,
  wabaId: string,
  accessToken: string
): Promise<void> {
  const existing = await prisma.messageTemplate.findFirst({
    where: { accountId, name: DEFAULT_INVOICE_TEMPLATE_NAME, language: 'en_US' },
  });
  if (existing) return;

  const publicBaseUrl = process.env.GATEWAY_PUBLIC_BASE_URL;
  if (!publicBaseUrl) {
    console.warn(
      '[default-invoice-template] GATEWAY_PUBLIC_BASE_URL is not set — skipping auto-template creation'
    );
    return;
  }

  const payload: TemplatePayload = {
    name: DEFAULT_INVOICE_TEMPLATE_NAME,
    category: 'Utility',
    language: 'en_US',
    header_type: 'document',
    header_media_url: `${publicBaseUrl}/sample-invoice.pdf`,
    body_text: 'Hi {{1}}, your invoice {{2}} for ₹{{3}} is attached. Thank you for your business!',
  };

  try {
    const metaPayload = buildMetaTemplatePayload(payload);
    const meta = await submitMessageTemplate({ wabaId, accessToken, payload: metaPayload });

    await prisma.messageTemplate.create({
      data: {
        accountId,
        name: payload.name,
        category: payload.category,
        language: payload.language,
        headerType: payload.header_type,
        headerMediaUrl: payload.header_media_url,
        bodyText: payload.body_text,
        status: normalizeStatus(meta.status),
        metaTemplateId: meta.id,
        lastSubmittedAt: new Date(),
      },
    });
  } catch (err) {
    console.warn(
      '[default-invoice-template] auto-creation failed — account can submit one manually:',
      err
    );
  }
}
