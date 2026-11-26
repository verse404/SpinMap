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

interface WeatherPayload {
  city: 'melbourne' | 'sydney';
  tempC: number;
  windKmh: number;
  windDeg: number;
  windLabel: string;
  sunsetLabel: string;
  minutesToSunset: number | null;
  bestWindowLabel: string;
  hourly: HourlyRideSlot[];
  live: boolean;
  provider?: string;
}

const WEATHER_CACHE = new Map<string, { expiresAt: number; payload: WeatherPayload }>();

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

function formatHourFromDate(date: Date, tz: string | null, lng: number): string {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hour12: true,
      }).formatToParts(date);
      const h = parts.find((p) => p.type === 'hour')?.value ?? '12';
      const dp = (parts.find((p) => p.type === 'dayPeriod')?.value ?? 'pm').toLowerCase();
      return `${h}${dp}`;
    } catch {
      // Fall through to solar offset estimate
    }
  }
  const offsetHours = Math.round(lng / 15);
  const localH = ((date.getUTCHours() + offsetHours) % 24 + 24) % 24;
  if (localH === 0) return '12am';
  if (localH < 12) return `${localH}am`;
  if (localH === 12) return '12pm';
  return `${localH - 12}pm`;
}

function formatClockFromDate(date: Date, tz: string | null, lng: number): string {
  if (tz) {
    try {
      const str = new Intl.DateTimeFormat('en-AU', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(date);
      return str.replace(/\s+/g, ' ').toLowerCase();
    } catch {
      // Fall through to solar offset estimate
    }
  }
  const offsetMins = Math.round(lng / 15) * 60;
  const localMs = date.getTime() + offsetMins * 60_000;
  const d = new Date(localMs);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
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

function computeComfortScore(tempC: number, windKmh: number, precipProb: number): number {
  const tempPenalty = Math.abs(tempC - 20) * 2.2;
  const windPenalty = Math.max(0, windKmh - 10) * 1.8;
  const rainPenalty = precipProb * 0.9;
  return Math.max(5, Math.min(100, Math.round(100 - tempPenalty - windPenalty - rainPenalty)));
}

/**
 * Pure NOAA astronomical solar sunset calculation (100% offline, accurate to ~2 min worldwide).
 */
function computeAstronomicalSunset(
  latDeg: number,
  lngDeg: number,
  tz: string | null
): { sunsetLabel: string; minutesToSunset: number | null } {
  const now = new Date();
  const offsetMs = Math.round(lngDeg / 15) * 3600_000;
  const localRef = new Date(now.getTime() + offsetMs);
  const startOfYear = Date.UTC(localRef.getUTCFullYear(), 0, 1);
  const localMidnightUtc = Date.UTC(
    localRef.getUTCFullYear(),
    localRef.getUTCMonth(),
    localRef.getUTCDate()
  );
  const doy = Math.floor((localMidnightUtc - startOfYear) / 86_400_000) + 1;

  const gamma = ((2 * Math.PI) / 365) * (doy - 1);
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const latRad = (latDeg * Math.PI) / 180;
  const zenithRad = (90.833 * Math.PI) / 180;
  const cosHa =
    Math.cos(zenithRad) / (Math.cos(latRad) * Math.cos(decl)) - Math.tan(latRad) * Math.tan(decl);
  if (cosHa < -1 || cosHa > 1) {
    return { sunsetLabel: '7:45 pm', minutesToSunset: 240 };
  }

  const haDeg = (Math.acos(cosHa) * 180) / Math.PI;
  // Local solar sunset in UTC minutes from local-date 00:00 UTC
  const sunsetUtcMins = 720 - 4 * (lngDeg - haDeg) - eqtime;
  const sunsetMs = localMidnightUtc + Math.round(sunsetUtcMins * 60_000);
  const sunsetDate = new Date(sunsetMs);
  const diffMins = Math.round((sunsetMs - now.getTime()) / 60_000);
  const clock = formatClockFromDate(sunsetDate, tz, lngDeg);

  if (diffMins > 0) {
    return { sunsetLabel: clock, minutesToSunset: diffMins };
  }
  return { sunsetLabel: `${clock} (past sunset)`, minutesToSunset: -1 };
}

async function fetchFromOpenMeteo(
  city: 'melbourne' | 'sydney',
  latNum: number,
  lngNum: number,
  tzParam: string,
  cfg: (typeof CITY_METEO)['melbourne']
): Promise<WeatherPayload | null> {
  const fetchUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latNum.toFixed(4)}&longitude=${lngNum.toFixed(4)}&current=temperature_2m,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,wind_speed_10m,precipitation_probability&daily=sunrise,sunset&forecast_days=2&timezone=${tzParam}`;
  const res = await fetch(fetchUrl, {
    headers: { 'User-Agent': 'SpinMap/1.0 (+https://github.com/verse404/SpinMap)' },
    signal: AbortSignal.timeout(2800),
  });
  if (!res.ok) return null;

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
      sunset?: string[];
    };
  };

  const current = data.current;
  const tempC =
    typeof current?.temperature_2m === 'number' ? Math.round(current.temperature_2m) : cfg.fallbackTemp;
  const windKmh =
    typeof current?.wind_speed_10m === 'number' ? Math.round(current.wind_speed_10m) : cfg.fallbackWind;
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
    hourly.push({
      isoTime: times[i],
      hourLabel: formatHourShort(times[i]),
      tempC: tC,
      windKmh: wKmh,
      precipProb: pProb,
      score: computeComfortScore(tC, wKmh, pProb),
    });
  }

  let bestSlot: HourlyRideSlot | null = null;
  for (const slot of hourly) {
    if (!bestSlot || slot.score > bestSlot.score) bestSlot = slot;
  }

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
      minutesToSunset = -1;
      sunsetLabel = `${formatClockTime(sunsetRaw)} (past sunset)`;
    }
  }

  return {
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
    provider: 'open-meteo',
  };
}

async function fetchFromMetNorway(
  city: 'melbourne' | 'sydney',
  latNum: number,
  lngNum: number,
  knownTz: string | null
): Promise<WeatherPayload | null> {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latNum.toFixed(4)}&lon=${lngNum.toFixed(4)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SpinMap/1.0 (+https://github.com/verse404/SpinMap)' },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) return null;

  const json = (await res.json()) as {
    properties?: {
      timeseries?: Array<{
        time?: string;
        data?: {
          instant?: {
            details?: {
              air_temperature?: number;
              wind_speed?: number;
              wind_from_direction?: number;
            };
          };
          next_1_hours?: {
            details?: { precipitation_amount?: number };
          };
        };
      }>;
    };
  };

  const series = json.properties?.timeseries ?? [];
  if (series.length === 0) return null;

  const nowMs = Date.now();
  let startIdx = series.findIndex((item) => {
    const ms = item.time ? Date.parse(item.time) : 0;
    return ms >= nowMs - 30 * 60_000;
  });
  if (startIdx < 0) startIdx = 0;

  const firstDetails = series[startIdx]?.data?.instant?.details;
  const tempC = Math.round(firstDetails?.air_temperature ?? 21);
  const windKmh = Math.round((firstDetails?.wind_speed ?? 4.2) * 3.6);
  const windDeg = Math.round(firstDetails?.wind_from_direction ?? 205);
  const dir = compassArrow(windDeg);

  const hourly: HourlyRideSlot[] = [];
  for (let i = startIdx; i < Math.min(series.length, startIdx + 10); i += 1) {
    const entry = series[i];
    const det = entry?.data?.instant?.details;
    const tC = Math.round(det?.air_temperature ?? tempC);
    const wKmh = Math.round((det?.wind_speed ?? windKmh / 3.6) * 3.6);
    const rainMm = entry?.data?.next_1_hours?.details?.precipitation_amount ?? 0;
    const pProb = rainMm <= 0 ? 0 : Math.min(95, Math.round(25 + rainMm * 30));
    const entryDate = entry?.time ? new Date(entry.time) : new Date(nowMs + i * 3600_000);
    hourly.push({
      isoTime: entry?.time ?? entryDate.toISOString(),
      hourLabel: formatHourFromDate(entryDate, knownTz, lngNum),
      tempC: tC,
      windKmh: wKmh,
      precipProb: pProb,
      score: computeComfortScore(tC, wKmh, pProb),
    });
  }

  let bestSlot: HourlyRideSlot | null = null;
  for (const slot of hourly) {
    if (!bestSlot || slot.score > bestSlot.score) bestSlot = slot;
  }

  const { sunsetLabel, minutesToSunset } = computeAstronomicalSunset(latNum, lngNum, knownTz);

  return {
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
    provider: 'met.no',
  };
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

  const latNum = hasCustomCoords ? parsedLat : cfg.lat;
  const lngNum = hasCustomCoords ? parsedLng : cfg.lng;
  const knownTz = hasCustomCoords ? null : cfg.tz;
  const tzParam = hasCustomCoords ? 'auto' : encodeURIComponent(cfg.tz);

  const cacheKey = `${latNum.toFixed(2)},${lngNum.toFixed(2)},${knownTz ?? 'auto'}`;
  const cached = WEATHER_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload, {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  let payload: WeatherPayload | null = null;
  try {
    payload = await fetchFromOpenMeteo(city, latNum, lngNum, tzParam, cfg);
  } catch {
    payload = null;
  }

  if (!payload) {
    try {
      payload = await fetchFromMetNorway(city, latNum, lngNum, knownTz);
    } catch {
      payload = null;
    }
  }

  if (payload) {
    if (WEATHER_CACHE.size > 150) WEATHER_CACHE.clear();
    WEATHER_CACHE.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, payload });
    return NextResponse.json(payload, {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  const astro = computeAstronomicalSunset(latNum, lngNum, knownTz);
  return NextResponse.json(
    {
      city,
      tempC: cfg.fallbackTemp,
      windKmh: cfg.fallbackWind,
      windDeg: 205,
      windLabel: cfg.fallbackLabel,
      sunsetLabel: astro.sunsetLabel,
      minutesToSunset: astro.minutesToSunset,
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
