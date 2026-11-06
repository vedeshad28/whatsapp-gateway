import crypto from 'crypto';

/**
 * Two-step verification PIN used to register a number that came through
 * Embedded Signup, where nobody typed one in.
 *
 * Meta's /register call needs a 6-digit PIN: for a number with no PIN it
 * sets one, for a number that already has one it must match. We derive the
 * PIN from ENCRYPTION_KEY and the phone_number_id instead of storing it, so
 * it can be recomputed whenever the number has to be re-registered and no
 * schema change is needed. Rotating ENCRYPTION_KEY changes the derived PIN
 * (it already invalidates every stored access token), so a number registered
 * under the old key would then need its PIN entered by hand.
 */
export function deriveRegistrationPin(phoneNumberId: string): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !phoneNumberId) return null;

  const digest = crypto
    .createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`whatsapp-registration-pin:${phoneNumberId}`)
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}
