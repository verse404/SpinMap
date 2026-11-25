import { NextRequest, NextResponse } from 'next/server';
import { designMelbourneRoute } from '@/lib/route-designer';
import {
  checkRateLimit,
  sanitizePreferencesText,
  validateAddressInput,
  verifyCsrfToken,
} from '@/lib/security';

const VALID_CITIES = new Set(['melbourne', 'sydney']);
const VALID_TERRAINS = new Set(['flat', 'balanced', 'hilly']);
const VALID_SHAPES = new Set(['loop', 'oneway']);
const VALID_MUST_HAVES = new Set(['carFree', 'cafe', 'water', 'tramFree']);

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Dedicated endpoint rate limit (25 route generations / minute / IP)
  const forwarded = request.headers.get('x-forwarded-for');
  const clientIp = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
  if (!checkRateLimit(`design:${clientIp}`, 25, 60_000)) {
    return NextResponse.json(
      { error: 'Rate limit reached. Please wait a moment before designing another route.' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  // 2. Cryptographic CSRF token verification on state/action POST
  const csrfHeader = request.headers.get('x-csrf-token');
  const csrfValid = await verifyCsrfToken(csrfHeader);
  if (!csrfValid) {
    return NextResponse.json(
      { error: 'Security session expired. Please refresh the page and try again.' },
      { status: 403, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  // 3. Parse and strictly validate untrusted JSON body
  let body: Record<string, unknown>;
  try {
    const rawText = await request.text();
    if (rawText.length > 4_096) {
      return NextResponse.json({ error: 'Request payload too large.' }, { status: 413 });
    }
    body = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request.' }, { status: 400 });
  }

  const city: 'melbourne' | 'sydney' =
    typeof body.city === 'string' && VALID_CITIES.has(body.city)
      ? (body.city as 'melbourne' | 'sydney')
      : 'melbourne';

  // Optional strict GPS coordinate validation for "Use My Current Location" & "Pick on Map"
  let startCoords: { lat: number; lng: number } | undefined;
  if (body.startCoords && typeof body.startCoords === 'object') {
    const sc = body.startCoords as Record<string, unknown>;
    const lat = Number(sc.lat);
    const lng = Number(sc.lng);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -85 &&
      lat <= 85 &&
      lng >= -180 &&
      lng <= 180
    ) {
      startCoords = { lat, lng };
    } else {
      return NextResponse.json(
        { error: 'Invalid GPS coordinates provided.' },
        { status: 400, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
      );
    }
  }

  const rawAddress = validateAddressInput(body.address);
  const address = rawAddress ?? (startCoords ? 'My Current Location' : null);
  if (!address) {
    return NextResponse.json(
      {
        error:
          city === 'sydney'
            ? 'Please enter a valid Sydney street address, tap "Use My Location", or pick a starting spot on the map.'
            : 'Please enter a valid Melbourne street address, tap "Use My Location", or pick a starting spot on the map.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  const promptText = sanitizePreferencesText(body.promptText);
  const rawKm = Number(body.targetKm);
  const targetKm = Number.isFinite(rawKm) ? Math.max(6, Math.min(75, Math.round(rawKm))) : 20;
  const terrain =
    typeof body.terrain === 'string' && VALID_TERRAINS.has(body.terrain)
      ? (body.terrain as 'flat' | 'balanced' | 'hilly')
      : 'flat';
  const shape =
    typeof body.shape === 'string' && VALID_SHAPES.has(body.shape)
      ? (body.shape as 'loop' | 'oneway')
      : 'loop';

  const mustHaves = Array.isArray(body.mustHaves)
    ? body.mustHaves.filter((item): item is string => typeof item === 'string' && VALID_MUST_HAVES.has(item))
    : [];
  const rawVar = Number(body.variationIndex);
  const variationIndex = Number.isFinite(rawVar) ? Math.max(0, Math.min(5, Math.floor(rawVar))) : 0;

  try {
    const designed = await designMelbourneRoute({
      city,
      address,
      startCoords,
      promptText,
      targetKm,
      terrain,
      shape,
      mustHaves,
      variationIndex,
    });

    return NextResponse.json(designed, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    const safeMsg =
      err instanceof Error && err.message.startsWith('Could not locate')
        ? err.message
        : `Unable to design a route from that starting point right now. Please try a nearby ${city === 'sydney' ? 'Sydney' : 'Melbourne'} suburb.`;
    return NextResponse.json(
      { error: safeMsg },
      { status: 422, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }
}
