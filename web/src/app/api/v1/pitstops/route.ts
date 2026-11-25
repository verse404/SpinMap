import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/security';

export type PitStopKind = 'cafe' | 'water' | 'toilet' | 'repair';

export interface PitStopPoi {
  id: string;
  kind: PitStopKind;
  icon: string;
  name: string;
  lngLat: [number, number];
}

const VALID_KINDS = new Set<PitStopKind>(['cafe', 'water', 'toilet', 'repair']);

const KIND_ICON: Record<PitStopKind, string> = {
  cafe: '☕',
  water: '🚰',
  toilet: '🚻',
  repair: '🔧',
};

const KIND_FALLBACK_NAME: Record<PitStopKind, string> = {
  cafe: 'Local Cycling Cafe',
  water: 'Drinking Water Fountain',
  toilet: 'Public Restroom',
  repair: 'Bike Shop & Pump Station',
};

const KIND_QUERY: Record<PitStopKind, { paramKey: 'amenity' | 'q'; paramVal: string; allowedTypes: Set<string> }> = {
  cafe: {
    paramKey: 'amenity',
    paramVal: 'cafe',
    allowedTypes: new Set(['cafe', 'bakery', 'coffee_shop']),
  },
  water: {
    paramKey: 'q',
    paramVal: 'drinking water',
    allowedTypes: new Set(['drinking_water', 'water_point', 'fountain']),
  },
  toilet: {
    paramKey: 'q',
    paramVal: 'toilets',
    allowedTypes: new Set(['toilets']),
  },
  repair: {
    paramKey: 'q',
    paramVal: 'bicycle shop',
    allowedTypes: new Set(['bicycle', 'bicycle_repair_station', 'bicycle_rental']),
  },
};

const PITSTOP_CACHE = new Map<string, { expiresAt: number; items: PitStopPoi[] }>();

async function fetchKindFromNominatim(
  kind: PitStopKind,
  viewbox: string
): Promise<PitStopPoi[]> {
  const cacheKey = `${kind}:${viewbox}`;
  const now = Date.now();
  const cached = PITSTOP_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.items;
  }

  const cfg = KIND_QUERY[kind];
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '8',
    bounded: '1',
    viewbox,
    'accept-language': 'en',
  });
  params.set(cfg.paramKey, cfg.paramVal);

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      'User-Agent': 'SpinMap/1.0 (Visual Cycling Route Explorer)',
      'Accept-Language': 'en',
    },
    signal: AbortSignal.timeout(4500),
  });

  if (!res.ok) {
    return [];
  }

  const rows = (await res.json()) as Array<{
    place_id?: number;
    lat?: string;
    lon?: string;
    name?: string;
    type?: string;
    display_name?: string;
  }>;

  const out: PitStopPoi[] = [];
  for (const row of rows) {
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (row.type && !cfg.allowedTypes.has(row.type)) continue;

    const placeHint = (row.display_name || '')
      .split(',')
      .map((s) => s.trim())
      .find((part) => part.length > 2 && !/^\d+$/.test(part));
    const rawName = (row.name || '').trim()
      ? (row.name || '').trim()
      : placeHint
        ? `${KIND_FALLBACK_NAME[kind]} (${placeHint})`
        : KIND_FALLBACK_NAME[kind];

    out.push({
      id: `${kind}-${row.place_id ?? out.length}`,
      kind,
      icon: KIND_ICON[kind],
      name: rawName.slice(0, 68),
      lngLat: [lng, lat],
    });
    if (out.length >= 6) break;
  }

  if (PITSTOP_CACHE.size > 200) {
    PITSTOP_CACHE.clear();
  }
  PITSTOP_CACHE.set(cacheKey, { expiresAt: now + 10 * 60_000, items: out });
  return out;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const forwarded = request.headers.get('x-forwarded-for');
  const clientIp = forwarded ? forwarded.split(',')[0].trim() : '127.0.0.1';
  if (!checkRateLimit(`pitstops:${clientIp}`, 35, 60_000)) {
    return NextResponse.json(
      { error: 'Too many pit-stop lookups. Please wait a moment.' },
      { status: 429 }
    );
  }

  const sp = request.nextUrl.searchParams;
  const minLat = Number(sp.get('minLat'));
  const minLng = Number(sp.get('minLng'));
  const maxLat = Number(sp.get('maxLat'));
  const maxLng = Number(sp.get('maxLng'));

  if (
    !Number.isFinite(minLat) ||
    !Number.isFinite(minLng) ||
    !Number.isFinite(maxLat) ||
    !Number.isFinite(maxLng) ||
    minLat < -85 ||
    maxLat > 85 ||
    minLng < -180 ||
    maxLng > 180 ||
    maxLat <= minLat ||
    maxLng <= minLng ||
    maxLat - minLat > 0.45 ||
    maxLng - minLng > 0.45
  ) {
    return NextResponse.json(
      { error: 'Invalid bounding box for pit-stop search.' },
      { status: 400 }
    );
  }

  const rawKinds = (sp.get('kinds') || 'cafe,water')
    .split(',')
    .map((s) => s.trim() as PitStopKind);
  const kinds = Array.from(new Set(rawKinds.filter((k) => VALID_KINDS.has(k))));
  if (kinds.length === 0) {
    return NextResponse.json({ pitstops: [], live: true }, { status: 200 });
  }

  // Round viewbox to 2 decimal places (~1 km grid) for high cache hit rate
  const viewbox = `${minLng.toFixed(2)},${maxLat.toFixed(2)},${maxLng.toFixed(2)},${minLat.toFixed(2)}`;

  try {
    const settled = await Promise.allSettled(
      kinds.map((k) => fetchKindFromNominatim(k, viewbox))
    );
    const pitstops: PitStopPoi[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        pitstops.push(...r.value);
      }
    }

    return NextResponse.json(
      { pitstops, live: true },
      {
        status: 200,
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=600',
        },
      }
    );
  } catch {
    return NextResponse.json(
      { pitstops: [], live: false },
      {
        status: 200,
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
