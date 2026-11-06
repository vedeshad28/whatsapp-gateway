import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  whatsappConfig: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));
const metaMock = vi.hoisted(() => ({
  registerPhoneNumber: vi.fn(),
  subscribeWabaToApp: vi.fn(),
  verifyPhoneNumber: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  exchangeForLongLivedToken: vi.fn(),
  listWabaPhoneNumbers: vi.fn(),
  requestSmbAppDataSync: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/whatsapp/meta-api', () => metaMock);
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (s: string) => `enc:${s}`, decrypt: (s: string) => s }));
vi.mock('@/lib/whatsapp/default-invoice-template', () => ({ ensureDefaultInvoiceTemplate: vi.fn() }));

import { connectAccount } from './connect-account';
import { deriveRegistrationPin } from './registration-pin';

const KEY = 'ab'.repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ENCRYPTION_KEY', KEY);
  vi.stubEnv('META_APP_ID', 'app');
  vi.stubEnv('META_APP_SECRET', 'secret');
  prismaMock.whatsappConfig.findFirst.mockResolvedValue(null);
  prismaMock.whatsappConfig.findUnique.mockResolvedValue(null);
  metaMock.exchangeCodeForToken.mockResolvedValue({ accessToken: 'short' });
  metaMock.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long' });
  metaMock.verifyPhoneNumber.mockResolvedValue({ id: 'PN1', display_phone_number: '+91 98765 43210' });
  metaMock.registerPhoneNumber.mockResolvedValue({ success: true, alreadyRegistered: false });
  metaMock.subscribeWabaToApp.mockResolvedValue(undefined);
  metaMock.requestSmbAppDataSync.mockResolvedValue({ requestId: 'R1' });
});

describe('deriveRegistrationPin', () => {
  it('is a stable 6-digit number per phone number id', () => {
    const pin = deriveRegistrationPin('PN1');
    expect(pin).toMatch(/^\d{6}$/);
    expect(deriveRegistrationPin('PN1')).toBe(pin);
    expect(deriveRegistrationPin('PN2')).not.toBe(pin);
  });

  it('depends on the server secret', () => {
    const pin = deriveRegistrationPin('PN1');
    vi.stubEnv('ENCRYPTION_KEY', 'cd'.repeat(32));
    expect(deriveRegistrationPin('PN1')).not.toBe(pin);
  });

  it('returns null without a secret or a phone number id', () => {
    expect(deriveRegistrationPin('')).toBeNull();
    vi.stubEnv('ENCRYPTION_KEY', '');
    expect(deriveRegistrationPin('PN1')).toBeNull();
  });
});

describe('connectAccount registration', () => {
  it('registers an Embedded Signup number with the derived PIN when none is typed', async () => {
    const result = await connectAccount('acc1', { phoneNumberId: 'PN1', wabaId: 'W1', code: 'c', accessToken: '' });

    expect(metaMock.registerPhoneNumber).toHaveBeenCalledWith({
      phoneNumberId: 'PN1',
      accessToken: 'long',
      pin: deriveRegistrationPin('PN1'),
    });
    expect(result).toMatchObject({ success: true, registered: true, registration_skipped: false });
  });

  it('prefers a PIN the user typed', async () => {
    await connectAccount('acc1', { phoneNumberId: 'PN1', wabaId: 'W1', code: 'c', accessToken: '', pin: '123456' });

    expect(metaMock.registerPhoneNumber).toHaveBeenCalledWith(expect.objectContaining({ pin: '123456' }));
  });

  it('does not auto-register a pasted-token connect with no PIN', async () => {
    const result = await connectAccount('acc1', { phoneNumberId: 'PN1', wabaId: 'W1', accessToken: 'tok' });

    expect(metaMock.registerPhoneNumber).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, registered: false, registration_skipped: true });
  });

  it('does not re-register a number that is already registered', async () => {
    prismaMock.whatsappConfig.findUnique.mockResolvedValue({ phoneNumberId: 'PN1', registeredAt: new Date(), subscribedAppsAt: new Date() });

    await connectAccount('acc1', { phoneNumberId: 'PN1', wabaId: 'W1', code: 'c', accessToken: '' });

    expect(metaMock.registerPhoneNumber).not.toHaveBeenCalled();
  });

  it('saves the connection as disconnected and reports Meta\'s error when auto-registration fails', async () => {
    metaMock.registerPhoneNumber.mockRejectedValue(new Error('Two-step verification PIN incorrect'));

    const result = await connectAccount('acc1', { phoneNumberId: 'PN1', wabaId: 'W1', code: 'c', accessToken: '' });

    expect(result).toMatchObject({ success: false, registered: false, registration_error: 'Two-step verification PIN incorrect' });
    expect(prismaMock.whatsappConfig.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'disconnected', lastRegistrationError: 'Two-step verification PIN incorrect' }),
    });
  });

  it('never registers a coexistence number, and finds its phone number from the WABA', async () => {
    metaMock.listWabaPhoneNumbers.mockResolvedValue([{ id: 'PN1', display_phone_number: '+91 98765 43210' }]);

    const result = await connectAccount('acc1', { phoneNumberId: '', wabaId: 'W1', code: 'c', accessToken: '', coexistence: true });

    expect(metaMock.listWabaPhoneNumbers).toHaveBeenCalledWith({ wabaId: 'W1', accessToken: 'long' });
    expect(metaMock.registerPhoneNumber).not.toHaveBeenCalled();
    expect(metaMock.requestSmbAppDataSync).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ success: true });
  });

  it('refuses a coexistence signup whose WABA has several numbers', async () => {
    metaMock.listWabaPhoneNumbers.mockResolvedValue([
      { id: 'PN1', display_phone_number: 'a' },
      { id: 'PN2', display_phone_number: 'b' },
    ]);

    await expect(
      connectAccount('acc1', { phoneNumberId: '', wabaId: 'W1', code: 'c', accessToken: '', coexistence: true }),
    ).rejects.toThrow('more than one phone number');
  });
});
