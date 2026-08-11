// ============================================================
// Resolve (or create) the conversation for a phone number.
//
// The public API knows a *phone number*, not an internal UUID. This
// helper finds-or-creates the contact and its conversation so the
// shared `sendMessageToConversation` core can run unchanged.
//
// Ported from wacrm onto Prisma. Dropped: the `user_id` audit-owner
// resolution — this gateway has no human-user model, contacts and
// conversations are account-scoped only.
// ============================================================

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { SendMessageError } from '@/lib/whatsapp/send-message';
import { prisma } from '@/lib/db';

export interface ResolvedConversation {
  conversationId: string;
  contactId: string;
  /** True if this call created the contact (vs matched an existing one). */
  contactCreated: boolean;
}

/**
 * Find or create the contact + conversation for `phone` within
 * `accountId`. Throws `SendMessageError` (shared with the send core,
 * so the route maps one error family) on a bad phone, a missing
 * WhatsApp config, or a DB failure.
 */
export async function resolveConversationByPhone(
  accountId: string,
  phone: string,
  name?: string | null
): Promise<ResolvedConversation> {
  const sanitized = sanitizePhoneForMeta(phone);
  if (!isValidE164(sanitized)) {
    throw new SendMessageError(
      'bad_request',
      "'to' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  // Fail fast (and create nothing) when the account has no WhatsApp
  // connected — the same error the send would raise anyway.
  const config = await prisma.whatsappConfig.findUnique({
    where: { accountId },
    select: { id: true },
  });
  if (!config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  // ---- contact -------------------------------------------------
  let contactId: string;
  let contactCreated = false;

  const existing = await findExistingContact(accountId, sanitized);
  if (existing) {
    contactId = existing.id;
    if (name && name !== existing.name) {
      await prisma.contact.update({ where: { id: existing.id }, data: { name } });
    }
  } else {
    try {
      const created = await prisma.contact.create({
        data: { accountId, phone: sanitized, name: name || sanitized },
      });
      contactId = created.id;
      contactCreated = true;
    } catch (err) {
      // Lost a race against a concurrent create — the unique index
      // rejected the duplicate. Re-resolve.
      if (isUniqueViolation(err)) {
        const raced = await findExistingContact(accountId, sanitized);
        if (raced) {
          contactId = raced.id;
        } else {
          throw new SendMessageError('db_error', 'Failed to create contact', 500);
        }
      } else {
        console.error('[resolve-conversation] contact create error:', err);
        throw new SendMessageError('db_error', 'Failed to create contact', 500);
      }
    }
  }

  // ---- conversation -------------------------------------------
  const conversationId = await findOrCreateConversationRow(accountId, contactId);

  return { conversationId, contactId, contactCreated };
}

/**
 * Find (oldest-first) or create the single conversation for
 * `(accountId, contactId)`. Handles the unique-index race the same
 * way the contact create does: on a conflict from a concurrent
 * create, re-resolve the winning row rather than failing the send.
 */
async function findOrCreateConversationRow(
  accountId: string,
  contactId: string
): Promise<string> {
  const existing = await prisma.conversation.findFirst({
    where: { accountId, contactId },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing.id;

  try {
    const created = await prisma.conversation.create({ data: { accountId, contactId } });
    return created.id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await prisma.conversation.findFirst({
        where: { accountId, contactId },
        orderBy: { createdAt: 'asc' },
      });
      if (raced) return raced.id;
    }
    console.error('[resolve-conversation] conversation create error:', err);
    throw new SendMessageError('db_error', 'Failed to resolve conversation', 500);
  }
}
