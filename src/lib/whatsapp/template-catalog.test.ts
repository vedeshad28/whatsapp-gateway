import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  messageTemplate: { findMany: vi.fn() },
}));
const manageMock = vi.hoisted(() => {
  class TemplateManageError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    TemplateManageError,
    isDryRun: vi.fn(() => false),
    submitTemplate: vi.fn(),
    submitAuthenticationTemplate: vi.fn(),
    syncTemplates: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/whatsapp/template-manage', () => manageMock);

import {
  buildInvoiceTemplate,
  CATALOG_TEMPLATE_NAMES,
  getCatalogStatuses,
  INVOICE_TEMPLATE,
  submitCatalogTemplates,
} from './template-catalog';

function stored(rows: Array<{ name: string; status?: string | null; submissionError?: string | null }>) {
  prismaMock.messageTemplate.findMany.mockResolvedValue(
    rows.map((r) => ({ status: null, submissionError: null, rejectionReason: null, ...r })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GATEWAY_PUBLIC_BASE_URL', 'https://gw.example.com/');
  manageMock.isDryRun.mockReturnValue(false);
  manageMock.submitTemplate.mockResolvedValue({});
  manageMock.submitAuthenticationTemplate.mockResolvedValue({});
  manageMock.syncTemplates.mockResolvedValue(undefined);
  stored([]);
});

describe('catalog', () => {
  it('lists the invoice, booking and verification templates', () => {
    expect(CATALOG_TEMPLATE_NAMES).toContain(INVOICE_TEMPLATE);
    expect(CATALOG_TEMPLATE_NAMES).toContain('booking_confirmed');
    expect(CATALOG_TEMPLATE_NAMES).toContain('salon_new_booking');
    expect(CATALOG_TEMPLATE_NAMES).toContain('booking_otp');
    expect(new Set(CATALOG_TEMPLATE_NAMES).size).toBe(CATALOG_TEMPLATE_NAMES.length);
  });

  it('builds the invoice template with a document header and six body variables', () => {
    const t = buildInvoiceTemplate('https://gw.example.com/');
    expect(t).toMatchObject({ name: 'invoice_ready_v3', category: 'Utility', language: 'en', header_type: 'document' });
    expect(t.header_media_url).toBe('https://gw.example.com/sample-invoice.pdf');
    expect(t.body_text.match(/\{\{\d\}\}/g)).toHaveLength(6);
    expect(t.sample_values?.body).toHaveLength(6);
  });

  it('groups templates and reports missing ones', async () => {
    stored([{ name: 'booking_confirmed', status: 'approved' }]);

    const statuses = await getCatalogStatuses('acc1');
    const byName = new Map(statuses.map((s) => [s.name, s]));

    expect(byName.get('booking_confirmed')).toMatchObject({ group: 'booking_customer', status: 'APPROVED' });
    expect(byName.get('salon_new_booking')).toMatchObject({ group: 'booking_salon', status: 'MISSING' });
    expect(byName.get(INVOICE_TEMPLATE)).toMatchObject({ group: 'invoice', status: 'MISSING' });
    expect(byName.get('booking_otp')).toMatchObject({ group: 'verification', status: 'MISSING' });
  });

  it('rewrites Meta\'s permission error into plain words', async () => {
    stored([
      {
        name: 'booking_otp',
        status: 'DRAFT',
        submissionError: 'Application does not have permission for this action — subcode 2388185',
      },
    ]);

    const otp = (await getCatalogStatuses('acc1')).find((s) => s.name === 'booking_otp');

    expect(otp?.error).toMatch(/hasn't allowed Salonify to create templates/);
  });
});

describe('submitCatalogTemplates', () => {
  it('submits only the named templates that are missing', async () => {
    stored([{ name: 'booking_confirmed', status: 'APPROVED' }]);

    await submitCatalogTemplates('acc1', [INVOICE_TEMPLATE, 'booking_confirmed']);

    expect(manageMock.syncTemplates).toHaveBeenCalledWith('acc1');
    expect(manageMock.submitTemplate).toHaveBeenCalledTimes(1);
    expect(manageMock.submitTemplate).toHaveBeenCalledWith('acc1', expect.objectContaining({ name: INVOICE_TEMPLATE }));
  });

  it('retries a template whose earlier submit failed, but not one in review', async () => {
    stored([
      { name: 'booking_declined', status: 'DRAFT', submissionError: 'boom' },
      { name: 'booking_cancelled', status: 'PENDING' },
    ]);

    await submitCatalogTemplates('acc1', ['booking_declined', 'booking_cancelled']);

    expect(manageMock.submitTemplate).toHaveBeenCalledTimes(1);
    expect(manageMock.submitTemplate).toHaveBeenCalledWith('acc1', expect.objectContaining({ name: 'booking_declined' }));
  });

  it('submits the verification code through the authentication path', async () => {
    await submitCatalogTemplates('acc1', ['booking_otp']);

    expect(manageMock.submitAuthenticationTemplate).toHaveBeenCalledWith(
      'acc1',
      expect.objectContaining({ name: 'booking_otp', language: 'en' }),
    );
    expect(manageMock.submitTemplate).not.toHaveBeenCalled();
  });

  it('rejects names that are not in the catalog without submitting anything', async () => {
    await expect(submitCatalogTemplates('acc1', [INVOICE_TEMPLATE, 'drop_table'])).rejects.toThrow('Unknown template(s): drop_table');
    expect(manageMock.submitTemplate).not.toHaveBeenCalled();
    expect(manageMock.syncTemplates).not.toHaveBeenCalled();
  });

  it("keeps going when one template fails and reports that template's error", async () => {
    manageMock.submitTemplate.mockImplementation(async (_acc: string, payload: { name: string }) => {
      if (payload.name === 'booking_declined') throw new Error('Application does not have permission — subcode 2388185');
    });

    const statuses = await submitCatalogTemplates('acc1', ['booking_declined', 'booking_cancelled']);

    expect(manageMock.submitTemplate).toHaveBeenCalledTimes(2);
    expect(statuses.find((s) => s.name === 'booking_declined')?.error).toMatch(/hasn't allowed Salonify/);
    expect(statuses.find((s) => s.name === 'booking_cancelled')?.error).toBeNull();
  });

  it('reports a clear error for the invoice template when the public URL is not configured', async () => {
    vi.stubEnv('GATEWAY_PUBLIC_BASE_URL', '');

    const statuses = await submitCatalogTemplates('acc1', [INVOICE_TEMPLATE]);

    expect(manageMock.submitTemplate).not.toHaveBeenCalled();
    expect(statuses.find((s) => s.name === INVOICE_TEMPLATE)?.error).toMatch(/GATEWAY_PUBLIC_BASE_URL/);
  });
});
