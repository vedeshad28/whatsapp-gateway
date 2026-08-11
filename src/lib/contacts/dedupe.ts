import { prisma } from '@/lib/db';
import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils';

/**
 * Contact de-duplication helpers, shared by the inbound webhook and
 * the API's find-or-create-by-phone path, so both agree on what "same
 * number" means.
 *
 * The canonical key is `normalizePhone` (digits-only). `phonesMatch`
 * adds trunk-prefix tolerance (last-8-digit match) for the softer
 * "possible duplicate" comparison.
 */

/** Canonical de-dup key for a phone string (digits only). */
export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

/** Minimal shape we need back from a contacts lookup. */
export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
}

/**
 * Find an existing contact in `accountId` whose phone matches `phone`,
 * or null. Pre-filters in SQL by the last-8-digit suffix (so we don't
 * pull every contact), then applies the strict `phonesMatch` in JS on
 * the small candidate set.
 */
export async function findExistingContact(
  accountId: string,
  phone: string
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  const candidates = await prisma.contact.findMany({
    where: { accountId, phone: { endsWith: suffix } },
    select: { id: true, phone: true, name: true },
  });

  return candidates.find((c) => phonesMatch(c.phone, phone)) ?? null;
}

/**
 * True when an existing contact is an *exact* normalized match for
 * `phone` (vs only a fuzzy trunk-variant match).
 */
export function isExactMatch(existing: ExistingContact, phone: string): boolean {
  return normalizeKey(existing.phone) === normalizeKey(phone);
}

/**
 * True for a unique-constraint violation. Used as the backstop when
 * the DB unique index rejects a racing insert that slipped past the
 * in-app check. Prisma surfaces this as error code `P2002`.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: string }).code === 'P2002';
}

/**
 * De-duplicate rows by normalized phone, keeping the first occurrence
 * of each. Rows with an empty normalized phone are dropped. Returns
 * the unique rows plus the count removed as in-file duplicates.
 */
export function dedupeByPhone<T extends { phone: string }>(
  rows: T[]
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeKey(row.phone);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}
