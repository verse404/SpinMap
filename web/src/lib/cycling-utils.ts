import type { CyclingRoute, RouteLandmark } from '@/lib/routes-data';

export type BikeTypeId = 'cruiser' | 'ebike' | 'road' | 'gravel';

export interface BikeProfile {
  id: BikeTypeId;
  icon: string;
  label: string;
  speedKmh: number;
  note: string;
}

export const BIKE_PROFILES: readonly BikeProfile[] = [
  { id: 'cruiser', icon: '🚲', label: 'Cruiser', speedKmh: 16, note: 'Relaxed upright pace' },
  { id: 'ebike', icon: '⚡', label: 'E-Bike', speedKmh: 23, note: 'Assisted hills & headwinds' },
  { id: 'road', icon: '🚴', label: 'Road', speedKmh: 26, note: 'Fast sealed tarmac pace' },
  { id: 'gravel', icon: '🌲', label: 'Gravel', speedKmh: 21, note: 'All-surface paths & trails' },
];

export function getBikeProfile(id: BikeTypeId): BikeProfile {
  return BIKE_PROFILES.find((b) => b.id === id) ?? BIKE_PROFILES[0];
}

export function estimateRideMinutes(route: CyclingRoute, bikeType: BikeTypeId): number {
  const profile = getBikeProfile(bikeType);
  // Add realistic climbing penalty (smaller on e-bike)
  const climbFactor = bikeType === 'ebike' ? 0.015 : bikeType === 'road' ? 0.035 : 0.05;
  const gravelFactor = route.isGravel && bikeType === 'road' ? 1.15 : 1.0;
  const baseMins = (route.distanceKm / profile.speedKmh) * 60 * gravelFactor;
  return Math.max(15, Math.round(baseMins + route.elevationM * climbFactor));
}

export function formatRideDuration(totalMins: number): string {
  const h = Math.floor(totalMins / 60);
  const m = Math.round((totalMins % 60) / 5) * 5;
  const safeM = m === 60 ? 55 : m;
  if (h === 0) return `0h ${Math.max(15, safeM)}m`;
  return `${h}h ${String(safeM).padStart(2, '0')}m`;
}

export function getBikeSuitabilityNote(
  route: CyclingRoute,
  bikeType: BikeTypeId
): { tone: 'good' | 'warn'; label: string } {
  if (route.isGravel && bikeType === 'road') {
    return { tone: 'warn', label: '⚠️ Gravel trail · 28mm+ tyres advised' };
  }
  if (route.elevationM >= 220 && bikeType === 'cruiser') {
    return { tone: 'warn', label: '⛰️ Steep climb for a cruiser bike' };
  }
  if (bikeType === 'ebike' && route.elevationM >= 180) {
    return { tone: 'good', label: '⚡ E-Bike flattens these hills' };
  }
  if (route.isGravel && bikeType === 'gravel') {
    return { tone: 'good', label: '🌲 Ideal gravel match' };
  }
  if (route.isFlat && bikeType === 'cruiser') {
    return { tone: 'good', label: '🥞 Effortless cruiser ride' };
  }
  return { tone: 'good', label: `${getBikeProfile(bikeType).icon} Great match` };
}

export interface WindSegmentFeature {
  type: 'Feature';
  properties: { kind: 'tailwind' | 'crosswind' | 'headwind'; color: string };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}

export interface RouteWindSummary {
  tailwindPct: number;
  crosswindPct: number;
  headwindPct: number;
  finishType: 'tailwind' | 'crosswind' | 'headwind';
  finishLabel: string;
  features: WindSegmentFeature[];
}

function segmentBearingDeg(a: [number, number], b: [number, number]): number {
  const latAvg = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const dx = (b[0] - a[0]) * Math.cos(latAvg);
  const dy = b[1] - a[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export function analyzeRouteWind(
  coords: [number, number][],
  windFromDeg: number,
  windKmh: number
): RouteWindSummary {
  if (coords.length < 2) {
    return {
      tailwindPct: 33,
      crosswindPct: 34,
      headwindPct: 33,
      finishType: 'crosswind',
      finishLabel: 'Calm breeze',
      features: [],
    };
  }

  // Meteorological wind_direction_10m is where wind blows FROM; wind pushes riders TOWARD +180°
  const windToDeg = (windFromDeg + 180) % 360;

  let tailLen = 0;
  let crossLen = 0;
  let headLen = 0;
  let finishDotSum = 0;
  let finishLen = 0;

  const features: WindSegmentFeature[] = [];
  const startFinishIdx = Math.floor((coords.length - 1) * 0.68);

  let currentKind: 'tailwind' | 'crosswind' | 'headwind' | null = null;
  let currentPts: [number, number][] = [];

  const colorFor = (k: 'tailwind' | 'crosswind' | 'headwind') =>
    k === 'tailwind' ? '#10b981' : k === 'headwind' ? '#f59e0b' : '#3b82f6';

  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i];
    const b = coords[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen < 1e-7) continue;

    const brg = segmentBearingDeg(a, b);
    const diffRad = ((brg - windToDeg) * Math.PI) / 180;
    const alignment = Math.cos(diffRad); // +1 tailwind, -1 headwind

    const kind: 'tailwind' | 'crosswind' | 'headwind' =
      alignment >= 0.35 ? 'tailwind' : alignment <= -0.35 ? 'headwind' : 'crosswind';

    if (kind === 'tailwind') tailLen += segLen;
    else if (kind === 'headwind') headLen += segLen;
    else crossLen += segLen;

    if (i >= startFinishIdx) {
      finishDotSum += alignment * segLen;
      finishLen += segLen;
    }

    if (kind === currentKind) {
      currentPts.push(b);
    } else {
      if (currentKind && currentPts.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { kind: currentKind, color: colorFor(currentKind) },
          geometry: { type: 'LineString', coordinates: currentPts },
        });
      }
      currentKind = kind;
      currentPts = [a, b];
    }
  }

  if (currentKind && currentPts.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { kind: currentKind, color: colorFor(currentKind) },
      geometry: { type: 'LineString', coordinates: currentPts },
    });
  }

  const total = tailLen + crossLen + headLen || 1;
  const tailwindPct = Math.round((tailLen / total) * 100);
  const headwindPct = Math.round((headLen / total) * 100);
  const crosswindPct = Math.max(0, 100 - tailwindPct - headwindPct);

  const finishAvg = finishLen > 0 ? finishDotSum / finishLen : 0;
  const finishType: 'tailwind' | 'crosswind' | 'headwind' =
    finishAvg >= 0.28 ? 'tailwind' : finishAvg <= -0.28 ? 'headwind' : 'crosswind';

  const finishLabel =
    windKmh < 10
      ? 'Calm air across the route'
      : finishType === 'tailwind'
        ? '🍃 Tailwind finish home'
        : finishType === 'headwind'
          ? '💨 Headwind finish — try Reverse'
          : '🌬️ Crosswind finish';

  return { tailwindPct, crosswindPct, headwindPct, finishType, finishLabel, features };
}

export function reverseCyclingRoute(route: CyclingRoute): CyclingRoute {
  const revCoords = [...route.coordinates].reverse();
  const revElev = [...route.elevProfile].reverse();
  const revLandmarks: RouteLandmark[] = [...route.landmarks]
    .reverse()
    .map((lm) => ({
      ...lm,
      ratio: Math.max(0, Math.min(1, Math.round((1 - lm.ratio) * 1000) / 1000)),
    }));

  const revHighlights = [...route.highlights].reverse().map((hl) => ({
    ...hl,
    landmarkIndex: Math.max(0, revLandmarks.length - 1 - hl.landmarkIndex),
  }));

  const origin = revCoords[0];
  const dest = revCoords[revCoords.length - 1];
  const mids = revLandmarks
    .slice(1, Math.max(1, revLandmarks.length - 1))
    .map((lm) => `${lm.lngLat[1].toFixed(5)},${lm.lngLat[0].toFixed(5)}`)
    .join('|');

  const revGmapsUrl =
    origin && dest
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin[1].toFixed(5)},${origin[0].toFixed(5)}&destination=${dest[1].toFixed(5)},${dest[0].toFixed(5)}${mids ? `&waypoints=${encodeURIComponent(mids)}` : ''}&travelmode=bicycling`
      : route.gmapsUrl;

  const subParts = route.subtitle.split('→').map((s) => s.trim()).filter(Boolean);
  const revSubtitle = subParts.length > 1 ? subParts.reverse().join(' → ') : `${route.subtitle} (Reversed)`;

  return {
    ...route,
    subtitle: revSubtitle,
    gmapsUrl: revGmapsUrl,
    coordinates: revCoords,
    elevProfile: revElev,
    landmarks: revLandmarks,
    highlights: revHighlights,
  };
}
