import { NextRequest, NextResponse } from 'next/server';

const CITY_METEO: Record<
  'melbourne' | 'sydney',
  { lat: number; lng: number; tz: string; fallbackTemp: number; fallbackWind: number; fallbackLabel: string }
> = {
  melbourne: {
    lat: -37.8136,
    lng: 144.9631,
    tz: 'Australia/Melbourne',
    fallbackTemp: 21,
    fallbackWind: 16,
    fallbackLabel: 'Bay Breeze ↗',
  },
  sydney: {
    lat: -33.8688,
    lng: 151.2093,
    tz: 'Australia/Sydney',
    fallbackTemp: 23,
    fallbackWind: 15,
    fallbackLabel: 'Harbour Breeze ↗',
  },
};

export interface HourlyRideSlot {
  isoTime: string;
  hourLabel: string;
  tempC: number;
  windKmh: number;
  precipProb: number;
  score: number;
}

function compassArrow(deg: number): { label: string; arrow: string } {
  const dirs = [
    { label: 'N', arrow: '↓' },
    { label: 'NE', arrow: '↙' },
    { label: 'E', arrow: '←' },
    { label: 'SE', arrow: '↖' },
    { label: 'S', arrow: '↑' },
    { label: 'SW', arrow: '↗' },
    { label: 'W', arrow: '→' },
    { label: 'NW', arrow: '↘' },
  ];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

function formatHourShort(isoLocal: string): string {
  const match = isoLocal.match(/T(\d{2}):/);
  if (!match) return isoLocal.slice(-5);
  const h = Number(match[1]);
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

function formatClockTime(isoLocal: string): string {
  const match = isoLocal.match(/T(\d{2}):(\d{2})/);
  if (!match) return '';
  const h = Number(match[1]);
  const m = match[2];
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rawCity = request.nextUrl.searchParams.get('city');
  const city: 'melbourne' | 'sydney' = rawCity === 'sydney' ? 'sydney' : 'melbourne';
  const cfg = CITY_METEO[city];

  const rawLat = request.nextUrl.searchParams.get('lat');
  const rawLng = request.nextUrl.searchParams.get('lng');
  const parsedLat = rawLat !== null ? Number(rawLat) : NaN;
  const parsedLng = rawLng !== null ? Number(rawLng) : NaN;
  const hasCustomCoords =
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    parsedLat >= -85 &&
    parsedLat <= 85 &&
    parsedLng >= -180 &&
    parsedLng <= 180;

  const lat = hasCustomCoords ? parsedLat.toFixed(4) : cfg.lat.toFixed(4);
  const lng = hasCustomCoords ? parsedLng.toFixed(4) : cfg.lng.toFixed(4);
  const tz = hasCustomCoords ? 'auto' : encodeURIComponent(cfg.tz);

  const fetchUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,wind_speed_10m,precipitation_probability&daily=sunrise,sunset&forecast_days=2&timezone=${tz}`;

  try {
    const res = await fetch(fetchUrl, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      throw new Error('Upstream weather unavailable');
    }
    const data = (await res.json()) as {
      current?: {
        time?: string;
        temperature_2m?: number;
        wind_speed_10m?: number;
        wind_direction_10m?: number;
      };
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        wind_speed_10m?: number[];
        precipitation_probability?: number[];
      };
      daily?: {
        sunrise?: string[];
        sunset?: string[];
      };
    };

    const current = data.current;
    const tempC =
      typeof current?.temperature_2m === 'number'
        ? Math.round(current.temperature_2m)
        : cfg.fallbackTemp;
    const windKmh =
      typeof current?.wind_speed_10m === 'number'
        ? Math.round(current.wind_speed_10m)
        : cfg.fallbackWind;
    const windDeg =
      typeof current?.wind_direction_10m === 'number' ? Math.round(current.wind_direction_10m) : 205;
    const dir = compassArrow(windDeg);

    const currentHourPrefix = (current?.time || '').slice(0, 13);
    const times = data.hourly?.time ?? [];
    const temps = data.hourly?.temperature_2m ?? [];
    const winds = data.hourly?.wind_speed_10m ?? [];
    const precips = data.hourly?.precipitation_probability ?? [];

    let startIdx = times.findIndex((t) => t.slice(0, 13) >= currentHourPrefix);
    if (startIdx < 0) startIdx = 0;

    const hourly: HourlyRideSlot[] = [];
    for (let i = startIdx; i < Math.min(times.length, startIdx + 10); i += 1) {
      const tC = Math.round(Number(temps[i] ?? tempC));
      const wKmh = Math.round(Number(winds[i] ?? windKmh));
      const pProb = Math.round(Number(precips[i] ?? 10));
      // Comfort score 0..100 for cycling (ideal 16-24°C, low wind, low rain)
      const tempPenalty = Math.abs(tC - 20) * 2.2;
      const windPenalty = Math.max(0, wKmh - 10) * 1.8;
      const rainPenalty = pProb * 0.9;
      const score = Math.max(5, Math.min(100, Math.round(100 - tempPenalty - windPenalty - rainPenalty)));
      hourly.push({
        isoTime: times[i],
        hourLabel: formatHourShort(times[i]),
        tempC: tC,
        windKmh: wKmh,
        precipProb: pProb,
        score,
      });
    }

    // Best upcoming ride window
    let bestSlot: HourlyRideSlot | null = null;
    for (const slot of hourly) {
      if (!bestSlot || slot.score > bestSlot.score) {
        bestSlot = slot;
      }
    }

    // Compute minutes until today's (or next) sunset in location's local clock
    const nowLocalStr = current?.time ?? '';
    const sunsetRaw = data.daily?.sunset?.[0] ?? '';
    let sunsetLabel = formatClockTime(sunsetRaw) || '7:45 pm';
    let minutesToSunset: number | null = null;

    const parseLocalMins = (s: string): number | null => {
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!m) return null;
      return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 60000;
    };
    const nowM = parseLocalMins(nowLocalStr);
    const sun0M = parseLocalMins(sunsetRaw);
    const sun1M = parseLocalMins(data.daily?.sunset?.[1] ?? '');
    if (nowM !== null && sun0M !== null) {
      if (sun0M > nowM) {
        minutesToSunset = Math.round(sun0M - nowM);
      } else if (sun1M !== null) {
        minutesToSunset = -1; // Already past sunset today
        sunsetLabel = `${formatClockTime(sunsetRaw)} (past sunset)`;
      }
    }

    return NextResponse.json(
      {
        city,
        tempC,
        windKmh,
        windDeg,
        windLabel: `${dir.label} Breeze ${dir.arrow}`,
        sunsetLabel,
        minutesToSunset,
        bestWindowLabel: bestSlot
          ? `${bestSlot.hourLabel} (${bestSlot.tempC}°C · ${bestSlot.windKmh} km/h · ${bestSlot.precipProb}% rain)`
          : 'Great conditions now',
        hourly,
        live: true,
      },
      {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=300',
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        city,
        tempC: cfg.fallbackTemp,
        windKmh: cfg.fallbackWind,
        windDeg: 205,
        windLabel: cfg.fallbackLabel,
        sunsetLabel: '7:45 pm',
        minutesToSunset: 240,
        bestWindowLabel: 'Light breeze & mild skies',
        hourly: [],
        live: false,
      },
      {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
