import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing for email/phone + password login (WS-0 v2). scrypt with a
 * per-password random salt; stored as `scrypt$<saltHex>$<hashHex>`. No new deps —
 * same hand-rolled-crypto style as the JWT tokens. Verification is constant-time.
 */
const KEYLEN = 64;

export function hashPassword(password: string): string {
  if (password.length < 6) throw new Error('password too short');
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  } catch {
    return false;
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
