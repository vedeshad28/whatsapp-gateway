/**
 * Handlers for the webhook fields a coexistence number adds. While the
 * salon keeps using the WhatsApp Business app on their phone, Meta mirrors
 * that activity to us:
 *
 *   - smb_message_echoes   — messages the business sends from the phone app
 *   - smb_app_state_sync   — the phone app's contacts (one-time, plus changes)
 *   - history              — up to 180 days of past chats (one-time, chunked)
 *
 * ─── Setup requirement (out-of-band) ──────────────────────────────
 * These fields are NOT subscribed to by default. In Meta App Dashboard
 * → WhatsApp → Configuration → Webhooks, toggle all three (plus
 * `account_update` if you want offboarding events).
 *
 * Mirrored rows are stored only — no automations, no outbound webhook
 * events, no unread bump — so replaying months of history never fires a
 * bot or notifies anyone.
 */

import { prisma } from '@/lib/db';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

const COEXISTENCE_WEBHOOK_FIELDS = new Set(['smb_message_echoes', 'smb_app_state_sync', 'history']);

export function isCoexistenceWebhookField(field: string): boolean {
  return COEXISTENCE_WEBHOOK_FIELDS.has(field);
}

interface AppMessage {
  id: string;
  from?: string;
  to?: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  history_context?: { status?: string };
}

interface CoexistenceValue {
  metadata?: { phone_number_id?: string };
  message_echoes?: AppMessage[];
  state_sync?: Array<{
    type?: string;
    action?: string;
    contact?: { full_name?: string; first_name?: string; phone_number?: string };
  }>;
  history?: Array<{
    metadata?: { phase?: number; chunk_order?: number; progress?: number };
    threads?: Array<{ id: string; messages?: AppMessage[] }>;
    errors?: Array<{ code?: number; title?: string; message?: string }>;
  }>;
}

/** Plain-text rendering of a mirrored message; media is not downloaded, so it shows as a placeholder. */
export function describeAppMessage(message: AppMessage): string {
  switch (message.type) {
    case 'text':
      return message.text?.body ?? '';
    case 'image':
      return message.image?.caption || '[image]';
    case 'video':
      return message.video?.caption || '[video]';
    case 'document':
      return message.document?.caption || message.document?.filename || '[document]';
    default:
      return `[${message.type}]`;
  }
}

/** Maps the `history_context.status` Meta puts on historical messages to our Message.status values. */
export function mapHistoryStatus(status: string | undefined, fromBusiness: boolean): string {
  if (!fromBusiness) return 'delivered';
  switch (status?.toUpperCase()) {
    case 'READ':
    case 'PLAYED':
      return 'read';
    case 'DELIVERED':
      return 'delivered';
    case 'ERROR':
      return 'failed';
    default:
      return 'sent';
  }
}

export async function handleCoexistenceWebhookChange(args: {
  field: string;
  /** The webhook entry's id — the WABA id, used when the payload has no phone_number_id. */
  entryId: string;
  value: unknown;
}): Promise<void> {
  const value = (args.value ?? {}) as CoexistenceValue;
  const phoneNumberId = value.metadata?.phone_number_id;

  const config = await prisma.whatsappConfig.findFirst({
    where: phoneNumberId ? { phoneNumberId } : { wabaId: args.entryId },
    select: { accountId: true },
  });
  if (!config) {
    console.error('[webhook] no config for coexistence event:', args.field, phoneNumberId ?? args.entryId);
    return;
  }

  switch (args.field) {
    case 'smb_message_echoes':
      for (const echo of value.message_echoes ?? []) {
        await mirrorMessages(config.accountId, echo.to ?? '', [echo], () => true);
      }
      break;
    case 'smb_app_state_sync':
      for (const item of value.state_sync ?? []) {
        await syncContact(config.accountId, item);
      }
      break;
    case 'history':
      for (const chunk of value.history ?? []) {
        if (chunk.errors?.length) {
          console.warn('[webhook] history sync declined or failed:', JSON.stringify(chunk.errors));
          continue;
        }
        for (const thread of chunk.threads ?? []) {
          const threadPhone = normalizePhone(thread.id);
          await mirrorMessages(
            config.accountId,
            thread.id,
            thread.messages ?? [],
            (m) => (m.from ? normalizePhone(m.from) !== threadPhone : m.to != null)
          );
        }
      }
      break;
  }
}

async function findOrCreateContactId(accountId: string, phone: string, name?: string): Promise<string | null> {
  const existing = await findExistingContact(accountId, phone);
  if (existing) return existing.id;
  try {
    const created = await prisma.contact.create({ data: { accountId, phone, name: name || phone } });
    return created.id;
  } catch (err) {
    if (isUniqueViolation(err)) return (await findExistingContact(accountId, phone))?.id ?? null;
    console.error('[webhook] coexistence contact create error:', err);
    return null;
  }
}

async function findOrCreateConversationId(accountId: string, contactId: string) {
  const existing = await prisma.conversation.findFirst({
    where: { accountId, contactId },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;
  try {
    return await prisma.conversation.create({ data: { accountId, contactId } });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return prisma.conversation.findFirst({ where: { accountId, contactId }, orderBy: { createdAt: 'asc' } });
    }
    console.error('[webhook] coexistence conversation create error:', err);
    return null;
  }
}

/**
 * Stores messages exchanged with one customer, skipping any whose wamid
 * is already saved (a send made through this gateway, or a replayed
 * chunk), and advances the conversation preview only if they are newer
 * than what it already shows.
 */
async function mirrorMessages(
  accountId: string,
  customerPhoneRaw: string,
  messages: AppMessage[],
  isFromBusiness: (message: AppMessage) => boolean
): Promise<void> {
  const phone = normalizePhone(customerPhoneRaw);
  if (!phone || messages.length === 0) return;

  const contactId = await findOrCreateContactId(accountId, phone);
  if (!contactId) return;
  const conversation = await findOrCreateConversationId(accountId, contactId);
  if (!conversation) return;

  const known = await prisma.message.findMany({
    where: { accountId, messageId: { in: messages.map((m) => m.id) } },
    select: { messageId: true },
  });
  const knownIds = new Set(known.map((m) => m.messageId));
  const fresh = messages.filter((m) => !knownIds.has(m.id));
  if (fresh.length === 0) return;

  const rows = fresh.map((m) => {
    const fromBusiness = isFromBusiness(m);
    return {
      accountId,
      conversationId: conversation.id,
      senderType: fromBusiness ? 'agent' : 'customer',
      contentType: 'text',
      contentText: describeAppMessage(m),
      messageId: m.id,
      status: mapHistoryStatus(m.history_context?.status, fromBusiness),
      createdAt: new Date(parseInt(m.timestamp, 10) * 1000),
    };
  });
  await prisma.message.createMany({ data: rows });

  const newest = rows.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  if (!conversation.lastMessageAt || newest.createdAt > conversation.lastMessageAt) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageText: newest.contentText || `[${fresh.length} messages]`, lastMessageAt: newest.createdAt },
    });
  }
}

async function syncContact(
  accountId: string,
  item: NonNullable<CoexistenceValue['state_sync']>[number]
): Promise<void> {
  // Removing a contact in the phone app must not delete CRM history here.
  if (item.type !== 'contact' || item.action === 'remove') return;
  const phone = normalizePhone(item.contact?.phone_number ?? '');
  if (!phone) return;
  const name = item.contact?.full_name || item.contact?.first_name || undefined;

  const existing = await findExistingContact(accountId, phone);
  if (existing) {
    if (name && (!existing.name || existing.name === existing.phone)) {
      await prisma.contact.update({ where: { id: existing.id }, data: { name } });
    }
    return;
  }
  await findOrCreateContactId(accountId, phone, name);
}
