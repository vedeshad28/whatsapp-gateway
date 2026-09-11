// ============================================================
// Dashboard user password hashing — pure, server-side, no Supabase.
//
// Why scrypt (not bcrypt/argon2)
//   Both would be fine; scrypt is chosen because it's built into
//   Node's `crypto` module, matching this codebase's existing
//   preference for no-dependency crypto primitives (see
//   src/lib/whatsapp/encryption.ts for AES-256-GCM the same way).
//   Unlike API keys (src/lib/api-keys/keys.ts), a user password IS
//   attacker-guessable, so this deliberately uses a slow, memory-hard
//   KDF rather than a fast hash.
// ============================================================

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Hash a plaintext password. Returns `<salt-hex>:<derived-key-hex>`, persist as-is in `users.password_hash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await scrypt(password, salt);
  return `${salt.toString('hex')}:${derivedKey.toString('hex')}`;
}

/** Constant-time verify a plaintext password against a stored `hashPassword` output. */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, salt);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
