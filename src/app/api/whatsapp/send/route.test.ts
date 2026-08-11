import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for the `contact_id` send path: sending an approved template to a
// single contact from the Contact detail view. The route must find-or-create
// the contact's conversation server-side, then run the normal send +
// persistence path — no inbound message required to bootstrap a thread.
//
// Auth (`requireApiKey`/`requireAccountAccess`) and the Meta call are mocked;
// Prisma is mocked with a tiny in-memory fake scoped to what this route touches.
// ---------------------------------------------------------------------------

const conversationInserts: Array<Record<string, unknown>> = [];
const messageInserts: Array<Record<string, unknown>> = [];

let existingConversation: Record<string, unknown> | null = null;
let contactRow: Record<string, unknown> | null = null;
let createdConversationId: string | null = null;
// Conversations created during the request become retrievable by id — the
// shared send core reloads the conversation (with its contact) from just
// the id, so the mock must model insert-then-select-by-id.
let conversationsById: Record<string, Record<string, unknown>> = {};

const CONTACT = { id: 'contact-1', accountId: 'acct-1', phone: '+15551234567' };

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({ authType: 'api_key', clientId: 'client-1', keyId: 'key-1', scopes: ['messages:send'] })),
  requireAccountAccess: vi.fn(async () => ({ id: 'acct-1', externalRef: null, label: null })),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      findFirst: vi.fn(async (args: { where: { id?: string } }) => {
        if (args.where.id) return conversationsById[args.where.id] ?? null;
        return existingConversation;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdConversationId = 'conv-new';
        conversationInserts.push(data);
        const row = { id: 'conv-new', ...data, contact: CONTACT };
        conversationsById['conv-new'] = row;
        return row;
      }),
      update: vi.fn(async () => ({})),
    },
    contact: {
      findFirst: vi.fn(async () => contactRow),
    },
    whatsappConfig: {
      findUnique: vi.fn(async () => ({
        id: 'cfg-1',
        accountId: 'acct-1',
        phoneNumberId: 'PNID-1',
        accessToken: 'enc-token',
      })),
    },
    messageTemplate: {
      findFirst: vi.fn(async () => null),
    },
    message: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        messageInserts.push(data);
        return { id: 'msg-1', ...data };
      }),
    },
  },
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc-token'),
  isLegacyFormat: vi.fn(() => false),
}));

const { sendTemplateMessage } = vi.hoisted(() => ({
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid-1' })),
}));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage,
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
}));

import { POST } from './route';

function postContactTemplate(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify({
        account_id: 'acct-1',
        contact_id: 'contact-1',
        message_type: 'template',
        template_name: 'order_update',
        template_language: 'en_US',
        template_message_params: { body: ['Acme', '#1234'] },
        template_params: ['Acme', '#1234'],
        ...overrides,
      }),
    })
  );
}

describe('POST /api/whatsapp/send — contact_id template path', () => {
  beforeEach(() => {
    conversationInserts.length = 0;
    messageInserts.length = 0;
    existingConversation = null;
    createdConversationId = null;
    conversationsById = {};
    contactRow = CONTACT;
    sendTemplateMessage.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a conversation for a contact with none, then sends the template', async () => {
    const res = await postContactTemplate();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.success).toBe(true);
    expect(json.data.whatsapp_message_id).toBe('wamid-1');

    expect(conversationInserts).toHaveLength(1);
    expect(conversationInserts[0]).toMatchObject({ accountId: 'acct-1', contactId: 'contact-1' });

    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    const args = (sendTemplateMessage.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(args.to).toBe('15551234567');
    expect(args.templateName).toBe('order_update');

    expect(messageInserts).toHaveLength(1);
    expect(messageInserts[0]).toMatchObject({
      conversationId: 'conv-new',
      contentType: 'template',
      templateName: 'order_update',
      senderType: 'agent',
    });
    void createdConversationId;
  });

  it('reuses an existing conversation instead of creating a duplicate', async () => {
    existingConversation = { id: 'conv-existing', accountId: 'acct-1', contactId: 'contact-1', contact: CONTACT };
    conversationsById['conv-existing'] = existingConversation;

    const res = await postContactTemplate();
    expect(res.status).toBe(200);

    expect(conversationInserts).toHaveLength(0);
    expect(messageInserts[0]).toMatchObject({ conversationId: 'conv-existing' });
  });

  it('404s when the contact is not in the caller account', async () => {
    contactRow = null;

    const res = await postContactTemplate();
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error.message).toMatch(/contact not found/i);
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('400s when neither conversation_id nor contact_id is provided', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
        body: JSON.stringify({ account_id: 'acct-1', message_type: 'template', template_name: 'x' }),
      })
    );
    expect(res.status).toBe(400);
  });
});
