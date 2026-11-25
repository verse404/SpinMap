import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

test('Security Audit: zero unsafe DOM sinks, native dialogs, or localStorage auth across src/', () => {
  const srcFiles = [
    'src/middleware.ts',
    'src/lib/security.ts',
    'src/lib/cities.ts',
    'src/lib/client-store.ts',
    'src/lib/cycling-utils.ts',
    'src/lib/routes-data.ts',
    'src/lib/sydney-routes-data.ts',
    'src/lib/sydney-anchors.ts',
    'src/lib/route-designer.ts',
    'src/app/layout.tsx',
    'src/app/page.tsx',
    'src/app/sydney/page.tsx',
    'src/app/api/v1/weather/route.ts',
    'src/app/api/v1/csrf/route.ts',
    'src/app/api/v1/gpx/[slug]/route.ts',
    'src/app/api/v1/design-route/route.ts',
    'src/app/api/v1/pitstops/route.ts',
    'src/app/api/v1/reroute/route.ts',
    'src/app/api/v1/geocode-city/route.ts',
    'src/components/MapLibreStage.tsx',
    'src/components/RouteDesignerPanel.tsx',
    'src/components/WeatherWindowPopover.tsx',
    'src/components/MelbVeloExplorer.tsx',
  ];

  for (const rel of srcFiles) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!code.includes('dangerouslySetInnerHTML'), `Forbidden dangerouslySetInnerHTML in ${rel}`);
    assert.ok(!code.includes('.innerHTML'), `Forbidden .innerHTML in ${rel}`);
    assert.ok(!code.includes('outerHTML'), `Forbidden outerHTML in ${rel}`);
    assert.ok(!code.includes('insertAdjacentHTML'), `Forbidden insertAdjacentHTML in ${rel}`);
    assert.ok(!code.includes('document.write'), `Forbidden document.write in ${rel}`);
    assert.ok(!code.includes('localStorage'), `Forbidden localStorage in ${rel}`);
    assert.ok(!code.includes('style={{'), `Forbidden inline style={{}} breaking strict nonce CSP in ${rel}`);
    assert.ok(!/\balert\s*\(/.test(code), `Forbidden native alert() in ${rel}`);
  }
});

test('Security Audit: package.json dev and start scripts bind strictly to 127.0.0.1 (never 0.0.0.0)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.dev.includes('127.0.0.1'), 'dev script must bind to 127.0.0.1');
  assert.ok(pkg.scripts.start.includes('127.0.0.1'), 'start script must bind to 127.0.0.1');
  assert.ok(!pkg.scripts.dev.includes('0.0.0.0'), 'dev script must not bind to 0.0.0.0');
});

test('Security Audit: POST /api/v1/design-route enforces CSRF verification, rate limiting, and allow-list validation', () => {
  const routeApi = fs.readFileSync(
    path.join(ROOT, 'src/app/api/v1/design-route/route.ts'),
    'utf8'
  );
  assert.ok(routeApi.includes('verifyCsrfToken'), 'POST endpoint must verify CSRF token');
  assert.ok(routeApi.includes('checkRateLimit'), 'POST endpoint must enforce rate limiting');
  assert.ok(routeApi.includes('validateAddressInput'), 'POST endpoint must validate address allow-list');
  assert.ok(routeApi.includes('status: 403'), 'POST endpoint must reject invalid CSRF with 403');
});

test('Security Audit: POST /api/v1/reroute enforces CSRF verification, rate limiting, and coordinate bounds', () => {
  const rerouteApi = fs.readFileSync(path.join(ROOT, 'src/app/api/v1/reroute/route.ts'), 'utf8');
  assert.ok(rerouteApi.includes('verifyCsrfToken'), 'POST /api/v1/reroute must verify CSRF token');
  assert.ok(rerouteApi.includes('checkRateLimit'), 'POST /api/v1/reroute must enforce rate limiting');
  assert.ok(rerouteApi.includes('status: 403'), 'POST /api/v1/reroute must reject invalid CSRF with 403');
  assert.ok(rerouteApi.includes('rawWps.length > 8'), 'POST /api/v1/reroute must cap waypoint count');
});
