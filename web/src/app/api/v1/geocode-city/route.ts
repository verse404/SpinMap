import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, validateAddressInput } from '@/lib/security';

export interface ResolvedCityResult {
  id: string;
  name: string;
  regionLabel: string;
  center: [number, number];
  overviewBounds: [[number, number], [number, number]];
  geoBounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
}

const POPULAR_GLOBAL_CITIES: Record<string, ResolvedCityResult> = {
  brisbane: {
    id: 'brisbane',
    name: 'Brisbane',
    regionLabel: 'Greater Brisbane',
    center: [153.0251, -27.4698],
    overviewBounds: [
      [152.92, -27.56],
      [153.14, -27.38],
    ],
    geoBounds: { minLng: 152.7, maxLng: 153.35, minLat: -27.8, maxLat: -27.15 },
  },
  'gold coast': {
    id: 'gold-coast',
    name: 'Gold Coast',
    regionLabel: 'Gold Coast',
    center: [153.4, -28.0167],
    overviewBounds: [
      [153.32, -28.14],
      [153.54, -27.9],
    ],
    geoBounds: { minLng: 153.2, maxLng: 153.6, minLat: -28.25, maxLat: -27.8 },
  },
  tokyo: {
    id: 'tokyo',
    name: 'Tokyo',
    regionLabel: 'Greater Tokyo',
    center: [139.7671, 35.6812],
    overviewBounds: [
      [139.62, 35.58],
      [139.88, 35.78],
    ],
    geoBounds: { minLng: 139.4, maxLng: 140.1, minLat: 35.45, maxLat: 35.9 },
  },
  amsterdam: {
    id: 'amsterdam',
    name: 'Amsterdam',
    regionLabel: 'Greater Amsterdam',
    center: [4.9041, 52.3676],
    overviewBounds: [
      [4.78, 52.29],
      [5.02, 52.43],
    ],
    geoBounds: { minLng: 4.65, maxLng: 5.15, minLat: 52.2, maxLat: 52.5 },
  },
  'san francisco': {
    id: 'san-francisco',
    name: 'San Francisco',
    regionLabel: 'San Francisco Bay',
    center: [-122.4194, 37.7749],
    overviewBounds: [
      [-122.52, 37.7],
      [-122.35, 37.84],
    ],
    geoBounds: { minLng: -122.6, maxLng: -122.2, minLat: 37.6, maxLat: 37.9 },
  },
  london: {
    id: 'london',
    name: 'London',
    regionLabel: 'Greater London',
    center: [-0.1276, 51.5072],
    overviewBounds: [
      [-0.25, 51.43],
      [0.02, 51.58],
    ],
    geoBounds: { minLng: -0.45, maxLng: 0.25, minLat: 51.3, maxLat: 51.7 },
  },
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const forwarded = request.headers.get('x-forwarded-for');
  const clientIp = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
  if (!checkRateLimit(`city:${clientIp}`, 35, 60_000)) {
    return NextResponse.json({ error: 'Too many city searches.' }, { status: 429 });
  }

  const rawQ = validateAddressInput(request.nextUrl.searchParams.get('q'));
  if (!rawQ) {
    return NextResponse.json({ error: 'Please enter a valid city name.' }, { status: 400 });
  }

  const lower = rawQ.toLowerCase();
  if (POPULAR_GLOBAL_CITIES[lower]) {
    return NextResponse.json(
      { city: POPULAR_GLOBAL_CITIES[lower] },
      { headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' } }
    );
  }

  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '3',
      q: rawQ,
      'accept-language': 'en',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        'User-Agent': 'SpinMap/1.0 (Visual Cycling Route Explorer)',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      throw new Error('City geocoder unavailable');
    }
    const items = (await res.json()) as Array<{
      lat?: string;
      lon?: string;
      name?: string;
      display_name?: string;
    }>;
    const top = items[0];
    const lat = Number(top?.lat);
    const lng = Number(top?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { error: `Could not find "${rawQ}". Try a major city name like "Brisbane", "Tokyo", or "London".` },
        { status: 404 }
      );
    }
    const cleanName = (top.name || top.display_name?.split(',')[0] || rawQ).trim().slice(0, 48);
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32) || 'custom-city';

    const resolved: ResolvedCityResult = {
      id: slug,
      name: cleanName,
      regionLabel: cleanName,
      center: [lng, lat],
      overviewBounds: [
        [Math.max(-179.5, lng - 0.12), Math.max(-84.5, lat - 0.09)],
        [Math.min(179.5, lng + 0.12), Math.min(84.5, lat + 0.09)],
      ],
      geoBounds: {
        minLng: Math.max(-179.5, lng - 0.35),
        maxLng: Math.min(179.5, lng + 0.35),
        minLat: Math.max(-84.5, lat - 0.3),
        maxLat: Math.min(84.5, lat + 0.3),
      },
    };

    return NextResponse.json(
      { city: resolved },
      { headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' } }
    );
  } catch {
    return NextResponse.json(
      { error: 'Unable to look up that city right now. Please try again.' },
      { status: 502 }
    );
  }
}
