import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/security';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const POST_ALLOWED_PATHS = new Set(['/api/v1/design-route', '/api/v1/reroute']);
const BOT_PROBE_REGEX =
  /^\/(wp-admin|wp-login|wp-content|wp-includes|xmlrpc|phpmyadmin|cgi-bin|administrator)|\.(php|env|git|sql|bak|asp|aspx|jsp)$/i;

function isTrustedOrigin(origin: string, request: NextRequest): boolean {
  if (origin === request.nextUrl.origin) return true;

  const renderUrl = process.env.RENDER_EXTERNAL_URL?.trim().replace(/\/+$/, '');
  if (renderUrl && origin === renderUrl) return true;

  const vercelUrls = [
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((host) => `https://${host.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')}`);
  if (vercelUrls.includes(origin)) return true;

  const extraOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (extraOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    const originHost = parsed.host.toLowerCase();
    const originHostname = parsed.hostname.toLowerCase();
    if (originHostname === '127.0.0.1' || originHostname === 'localhost') {
      return true;
    }

    // Support reverse proxies (e.g. Render, Vercel, Cloud Run) forwarding the public Host
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0].trim().toLowerCase();
    const hostHeader = request.headers.get('host')?.trim().toLowerCase();
    if (forwardedHost && originHost === forwardedHost) return true;
    if (hostHeader && originHost === hostHeader) return true;

    return false;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest): NextResponse {
  // 0. Drop common automated scanner/probe paths immediately without running SSR
  if (BOT_PROBE_REGEX.test(request.nextUrl.pathname)) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: {
        'Cache-Control': 'public, max-age=86400',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
      },
    });
  }

  // 1. Enforce strict HTTP method allow-list (POST permitted only on CSRF-verified design/reroute endpoints)
  const isPostEndpoint = POST_ALLOWED_PATHS.has(request.nextUrl.pathname);
  const methodAllowed =
    READ_METHODS.has(request.method) || (isPostEndpoint && request.method === 'POST');
  if (!methodAllowed) {
    return new NextResponse('Method Not Allowed', {
      status: 405,
      headers: { Allow: isPostEndpoint ? 'POST, OPTIONS' : 'GET, HEAD' },
    });
  }

  // 2. Enforce rate limiting & trusted origin check on BFF API endpoints (exempt /api/healthz for Render probes)
  if (
    request.nextUrl.pathname.startsWith('/api/') &&
    request.nextUrl.pathname !== '/api/healthz'
  ) {
    const forwarded = request.headers.get('x-forwarded-for');
    const clientIp = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
    if (!checkRateLimit(clientIp, 90, 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const origin = request.headers.get('origin');
    if (origin && !isTrustedOrigin(origin, request)) {
      return NextResponse.json({ error: 'Cross-origin access denied.' }, { status: 403 });
    }
  }

  // 3. Generate per-request cryptographic CSP nonce
  // Note: Omit 'strict-dynamic' so 'self' static Next.js chunk scripts (/_next/static/chunks/*.js)
  // are permitted alongside nonced inline hydration scripts.
  const nonceBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  const isDev = process.env.NODE_ENV !== 'production';
  const scriptSrc = isDev
    ? `'self' blob: 'nonce-${nonce}' 'unsafe-eval'`
    : `'self' blob: 'nonce-${nonce}'`;
  const styleSrc = isDev ? `'self' 'unsafe-inline'` : `'self' 'nonce-${nonce}'`;

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    "img-src 'self' data: blob: https://server.arcgisonline.com https://*.tile-cyclosm.openstreetmap.fr https://tiles.openfreemap.org",
    "connect-src 'self' blob: https://server.arcgisonline.com https://*.tile-cyclosm.openstreetmap.fr https://tiles.openfreemap.org",
    "font-src 'self' data: https://tiles.openfreemap.org",
    "frame-src 'self' https://maps.google.com https://www.google.com",
    "worker-src 'self' blob:",
    "child-src 'self' blob: https://maps.google.com https://www.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|images/|maplibre/).*)'],
};
