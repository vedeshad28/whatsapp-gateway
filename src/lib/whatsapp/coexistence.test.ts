import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listWabaPhoneNumbers, requestSmbAppDataSync } from './meta-api';
import { describeAppMessage, isCoexistenceWebhookField, mapHistoryStatus } from './coexistence-webhook';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('listWabaPhoneNumbers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse({ data: [{ id: 'PN1', display_phone_number: '+91 98765 43210' }] }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs /{waba_id}/phone_numbers with the bearer token', async () => {
    const result = await listWabaPhoneNumbers({ wabaId: 'WABA_1', accessToken: 'tok' });
    expect(result).toEqual([{ id: 'PN1', display_phone_number: '+91 98765 43210' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/WABA_1/phone_numbers');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('returns an empty list when Meta sends no data', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({}));
    expect(await listWabaPhoneNumbers({ wabaId: 'WABA_1', accessToken: 'tok' })).toEqual([]);
  });

  it('surfaces a Meta error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token.' } }), { status: 400 }),
    );
    await expect(listWabaPhoneNumbers({ wabaId: 'WABA_1', accessToken: 'bad' })).rejects.toThrow(
      'Invalid OAuth access token.',
    );
  });
});

describe('requestSmbAppDataSync', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse({ messaging_product: 'whatsapp', request_id: 'REQ_1' }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs sync_type to /{phone_number_id}/smb_app_data', async () => {
    const result = await requestSmbAppDataSync({ phoneNumberId: 'PN1', accessToken: 'tok', syncType: 'history' });
    expect(result).toEqual({ requestId: 'REQ_1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/PN1/smb_app_data');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ messaging_product: 'whatsapp', sync_type: 'history' });
  });
});

describe('coexistence webhook helpers', () => {
  it('recognises only the coexistence fields', () => {
    expect(isCoexistenceWebhookField('smb_message_echoes')).toBe(true);
    expect(isCoexistenceWebhookField('smb_app_state_sync')).toBe(true);
    expect(isCoexistenceWebhookField('history')).toBe(true);
    expect(isCoexistenceWebhookField('messages')).toBe(false);
  });

  it('renders text, captioned media and placeholders', () => {
    const base = { id: 'w1', timestamp: '1' };
    expect(describeAppMessage({ ...base, type: 'text', text: { body: 'See you at 4' } })).toBe('See you at 4');
    expect(describeAppMessage({ ...base, type: 'image', image: { caption: 'Style ref' } })).toBe('Style ref');
    expect(describeAppMessage({ ...base, type: 'image' })).toBe('[image]');
    expect(describeAppMessage({ ...base, type: 'document', document: { filename: 'bill.pdf' } })).toBe('bill.pdf');
    expect(describeAppMessage({ ...base, type: 'sticker' })).toBe('[sticker]');
  });

  it('maps history delivery states', () => {
    expect(mapHistoryStatus('READ', true)).toBe('read');
    expect(mapHistoryStatus('DELIVERED', true)).toBe('delivered');
    expect(mapHistoryStatus('ERROR', true)).toBe('failed');
    expect(mapHistoryStatus('PENDING', true)).toBe('sent');
    expect(mapHistoryStatus(undefined, true)).toBe('sent');
    expect(mapHistoryStatus('READ', false)).toBe('delivered');
  });
});
