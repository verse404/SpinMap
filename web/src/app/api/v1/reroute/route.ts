import { NextRequest, NextResponse } from 'next/server';
import { rerouteFromWaypoints } from '@/lib/route-designer';
import { checkRateLimit, sanitizePreferencesText, verifyCsrfToken } from '@/lib/security';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const forwarded = request.headers.get('x-forwarded-for');
  const clientIp = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
  if (!checkRateLimit(`reroute:${clientIp}`, 30, 60_000)) {
    return NextResponse.json(
      { error: 'Too many reroute edits. Please wait a moment.' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  const csrfValid = await verifyCsrfToken(request.headers.get('x-csrf-token'));
  if (!csrfValid) {
    return NextResponse.json(
      { error: 'Security session expired. Please refresh and try again.' },
      { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 6_144) {
      return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
    }
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request.' }, { status: 400 });
  }

  const rawWps = body.waypoints;
  if (!Array.isArray(rawWps) || rawWps.length < 2 || rawWps.length > 8) {
    return NextResponse.json(
      { error: 'Provide between 2 and 8 waypoints to recalculate your route.' },
      { status: 400 }
    );
  }

  const waypoints: Array<{ lngLat: [number, number]; label: string; icon: string; photoUrl: string; note: string }> = [];
  for (const item of rawWps) {
    if (!item || typeof item !== 'object') {
      return NextResponse.json({ error: 'Malformed waypoint item.' }, { status: 400 });
    }
    const rec = item as Record<string, unknown>;
    const ll = rec.lngLat;
    if (!Array.isArray(ll) || ll.length !== 2) {
      return NextResponse.json({ error: 'Invalid waypoint coordinates.' }, { status: 400 });
    }
    const lng = Number(ll[0]);
    const lat = Number(ll[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -85 || lat > 85) {
      return NextResponse.json({ error: 'Waypoint coordinates out of range.' }, { status: 400 });
    }
    const photoStr = typeof rec.photoUrl === 'string' && rec.photoUrl.startsWith('/images/')
      ? rec.photoUrl
      : '/images/greenway.jpg';

    waypoints.push({
      lngLat: [lng, lat],
      label: sanitizePreferencesText(rec.label).slice(0, 64) || 'Custom Stop',
      icon: sanitizePreferencesText(rec.icon).slice(0, 4) || '📍',
      photoUrl: photoStr,
      note: sanitizePreferencesText(rec.note).slice(0, 120) || 'Custom edited stop',
    });
  }

  const routeName = sanitizePreferencesText(body.routeName).slice(0, 80) || 'Custom Edited Route';

  try {
    const updatedRoute = await rerouteFromWaypoints(routeName, waypoints);
    return NextResponse.json(
      { route: updatedRoute },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      }
    );
  } catch {
    return NextResponse.json(
      { error: 'Could not recalculate bikeways for those waypoints.' },
      { status: 422, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }
}
