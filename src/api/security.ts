import type { FastifyInstance } from 'fastify';

export interface RateLimitRule {
  max: number;
  windowMs: number;
}

export interface SecurityConfig {
  hsts: 'auto' | 'on' | 'off';
  rateLimit: { auth: RateLimitRule; global: RateLimitRule };
  // (bodyLimit + trustProxy are applied at the Fastify constructor, not here)
}

/** Which rate-limit bucket a path falls into — or null for unlimited (health/webhooks). */
function bucketFor(url: string, cfg: SecurityConfig): { name: string; rule: RateLimitRule } | null {
  if (url === '/health' || url.startsWith('/webhooks/')) return null; // platform probes + provider callbacks
  if (url.startsWith('/app/auth/')) return { name: 'auth', rule: cfg.rateLimit.auth }; // brute-force surface
  return { name: 'global', rule: cfg.rateLimit.global };
}

/**
 * Registers WS-6 hardening: a per-IP fixed-window rate limiter (stricter on the
 * auth surface) and security response headers. In-memory + per-instance — a
 * baseline; a Redis-backed store would make it global across instances.
 */
export function applySecurity(app: FastifyInstance, cfg: SecurityConfig): void {
  const hits = new Map<string, { count: number; reset: number }>();

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0] ?? req.url;
    const bucket = bucketFor(url, cfg);
    if (!bucket) return;
    const key = `${bucket.name}:${req.ip}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + bucket.rule.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    // Bounded memory: sweep expired entries when the map grows large.
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    if (entry.count > bucket.rule.max) {
      req.log.warn({ audit: 'rate_limit_exceeded', ip: req.ip, bucket: bucket.name, url }, 'rate limit exceeded');
      reply
        .header('Retry-After', String(Math.ceil((entry.reset - now) / 1000)))
        .status(429)
        .send({ error: 'Too Many Requests', code: 'RATE_LIMITED', message: 'too many requests, slow down' });
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-DNS-Prefetch-Control', 'off');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    const secure = cfg.hsts === 'on' || (cfg.hsts === 'auto' && req.headers['x-forwarded-proto'] === 'https');
    if (secure) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return payload;
  });
}

export interface SecureConfigInput {
  requireSecureConfig: boolean;
  jwtSecret: string;
  basicAuthUser: string;
  basicAuthPass: string;
  useInMemory: boolean;
}

const INSECURE_DEFAULT_SECRET = 'dev-insecure-secret-change-me';

/**
 * Fail-fast guard: refuse to start in production with insecure defaults. No-op
 * unless SECURE_CONFIG=1, so dev/test are unaffected.
 */
export function assertSecureConfig(c: SecureConfigInput): void {
  if (!c.requireSecureConfig) return;
  const issues: string[] = [];
  if (!c.jwtSecret || c.jwtSecret === INSECURE_DEFAULT_SECRET) issues.push('AUTH_JWT_SECRET must be set to a strong secret (not the dev default)');
  else if (c.jwtSecret.length < 32) issues.push('AUTH_JWT_SECRET must be at least 32 characters');
  if (!c.basicAuthUser || !c.basicAuthPass) issues.push('admin BASIC_AUTH_USER/BASIC_AUTH_PASS must be set');
  if (c.useInMemory) issues.push('STORE must be Postgres in production (STORE=memory is for dev/tests)');
  if (issues.length > 0) {
    throw new Error(`Refusing to start — insecure production config:\n - ${issues.join('\n - ')}`);
  }
}
