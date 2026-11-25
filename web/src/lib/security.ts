/**
 * Multi-tiered secret resolution, CSRF HMAC verification, and input validation
 * per mandatory-secure-web-skills. Uses Web Crypto API (Node 20+ & Edge compatible).
 *
 * TODO(security): SpinMap is stateless without persistent user accounts; OAuth 2.0 / OIDC
 * login, MFA, Argon2id + leaked-password checks, __Host-session cookies, and sandboxed
 * community file uploads are deferred to Phase 2 user accounts.
 */
let ephemeralDevSecret: string | null = null;

function randomHex32(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getServerSecret(): string {
  const envSecret =
    process.env.SPINMAP_INTERNAL_SECRET?.trim() || process.env.MELBVELO_INTERNAL_SECRET?.trim();
  if (envSecret && envSecret.length >= 32) {
    return envSecret;
  }
  if (process.env.NODE_ENV === 'production') {
    // Ephemeral secret in local self-hosted preview with explicit warning
    if (!ephemeralDevSecret) {
      console.warn(
        '[SpinMap Security Warning] SPINMAP_INTERNAL_SECRET unset; using ephemeral instance-isolated secret.'
      );
      ephemeralDevSecret = randomHex32();
    }
    return ephemeralDevSecret;
  }
  if (!ephemeralDevSecret) {
    console.warn(
      '[SpinMap Security Warning] Generating ephemeral instance-isolated secret for local development.'
    );
    ephemeralDevSecret = randomHex32();
  }
  return ephemeralDevSecret;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const CSRF_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function createCsrfToken(): Promise<string> {
  const ts = String(Date.now());
  const nonceBytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(nonceBytes);
  const salt = Array.from(nonceBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const payload = `${ts}.${salt}`;
  const mac = await hmacSha256Hex(getServerSecret(), payload);
  return `${payload}.${mac}`;
}

export async function verifyCsrfToken(token: unknown): Promise<boolean> {
  if (typeof token !== 'string') return false;
  const parts = token.trim().split('.');
  if (parts.length !== 3) return false;
  const [tsStr, salt, providedMac] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > CSRF_TTL_MS) {
    return false;
  }
  if (!/^[0-9a-f]{24}$/.test(salt) || !/^[0-9a-f]{64}$/.test(providedMac)) {
    return false;
  }
  const expectedMac = await hmacSha256Hex(getServerSecret(), `${tsStr}.${salt}`);
  return timingSafeEqualStr(providedMac, expectedMac);
}

const SLUG_ALLOWLIST_REGEX = /^[a-z0-9-]{2,48}$/;

export function validateRouteSlug(rawSlug: unknown): string | null {
  if (typeof rawSlug !== 'string') return null;
  const trimmed = rawSlug.trim();
  return SLUG_ALLOWLIST_REGEX.test(trimmed) ? trimmed : null;
}

const ADDRESS_ALLOWLIST_REGEX = /^[A-Za-z0-9\s,.'/#&()-]{2,140}$/;

export function validateAddressInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!ADDRESS_ALLOWLIST_REGEX.test(cleaned)) return null;
  return cleaned;
}

export function sanitizePreferencesText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

export function isWithinGreaterMelbourne(lng: number, lat: number): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= 144.3 &&
    lng <= 145.75 &&
    lat >= -38.55 &&
    lat <= -37.4
  );
}

export function isWithinCityBounds(city: 'melbourne' | 'sydney', lng: number, lat: number): boolean {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (city === 'sydney') {
    return lng >= 150.55 && lng <= 151.45 && lat >= -34.25 && lat <= -33.4;
  }
  return isWithinGreaterMelbourne(lng, lat);
}

export function maskStreetNumber(label: string): string {
  // Mask exact street/unit numbers in display labels to avoid surfacing street-door PII
  return label.replace(/^\s*\d+[A-Za-z]?(?:\/\d+)?\s*,?\s*/, '').trim() || 'Your Starting Point';
}

export function escapeXml(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Sliding-window rate limiter per client IP
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(clientKey: string, limit = 90, windowMs = 60_000): boolean {
  const now = Date.now();
  if (rateBuckets.size > 5_000) {
    for (const [k, v] of rateBuckets.entries()) {
      if (v.resetAt <= now) rateBuckets.delete(k);
    }
  }
  const bucket = rateBuckets.get(clientKey);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(clientKey, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) {
    return false;
  }
  bucket.count += 1;
  return true;
}
