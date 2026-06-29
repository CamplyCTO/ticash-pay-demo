import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Minimal, dependency-free HS256 JWT + token/OTP helpers. The codebase already
 * hand-rolls HMAC signatures for every provider (Lytex/BenCash/Sumsub); access
 * tokens follow the same approach (no jsonwebtoken dependency). Refresh tokens
 * are opaque random strings stored only as a SHA-256 hash.
 */

export interface JwtClaims {
  sub: string; // app_users.id
  role: 'customer' | 'agent';
  ext: string; // external_id (ledger ownerId) the request is scoped to
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Sign an HS256 access token. `nowMs` is injectable for deterministic tests. */
export function signAccessToken(
  claims: Pick<JwtClaims, 'sub' | 'role' | 'ext'>,
  secret: string,
  ttlSec: number,
  nowMs: number = Date.now(),
): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: JwtClaims = { ...claims, iat, exp: iat + ttlSec };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

/** Verify signature + expiry. Returns the claims, or null if invalid/expired. */
export function verifyAccessToken(token: string, secret: string, nowMs: number = Date.now()): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const expected = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  if (!constantTimeEqual(sig, expected)) return null;
  let claims: JwtClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(nowMs / 1000)) return null;
  return claims;
}

/** SHA-256 hex — used to store OTP codes and refresh tokens (never the raw value). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** A high-entropy opaque refresh token. */
export function newRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

/** A numeric OTP code of the given length (cryptographically random). */
export function newOtpCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i++) code += randomInt(0, 10).toString();
  return code;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
