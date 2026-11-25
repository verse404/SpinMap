'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import MapLibreStage, { getNearestLandmark } from '@/components/MapLibreStage';
import RouteDesignerPanel from '@/components/RouteDesignerPanel';
import WeatherWindowPopover, { type LiveWeatherState } from '@/components/WeatherWindowPopover';
import { buildGlobalCityConfig, CITY_LIST, type CityConfig } from '@/lib/cities';
import { loadSpinMapPrefs, saveSpinMapPrefs } from '@/lib/client-store';
import {
  analyzeRouteWind,
  BIKE_PROFILES,
  estimateRideMinutes,
  formatRideDuration,
  getBikeSuitabilityNote,
  reverseCyclingRoute,
  type BikeTypeId,
} from '@/lib/cycling-utils';
import type { CyclingRoute, RouteLandmark } from '@/lib/routes-data';
import type { PitStopKind, PitStopPoi } from '@/app/api/v1/pitstops/route';
import type { ResolvedCityResult } from '@/app/api/v1/geocode-city/route';

const GLOBAL_CITY_CHIPS = [
  'Brisbane',
  'Gold Coast',
  'Tokyo',
  'Amsterdam',
  'San Francisco',
  'London',
] as const;

const VALID_BIKE_IDS = new Set<BikeTypeId>(BIKE_PROFILES.map((b) => b.id));

function findInsertWaypointIndex(
  landmarks: readonly RouteLandmark[],
  newLngLat: [number, number]
): number {
  if (landmarks.length <= 1) return landmarks.length;
  let bestIdx = landmarks.length - 1;
  let bestAdded = Infinity;
  for (let i = 0; i < landmarks.length - 1; i += 1) {
    const a = landmarks[i].lngLat;
    const b = landmarks[i + 1].lngLat;
    const dAB = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dAP = Math.hypot(newLngLat[0] - a[0], newLngLat[1] - a[1]);
    const dPB = Math.hypot(b[0] - newLngLat[0], b[1] - newLngLat[1]);
    const added = dAP + dPB - dAB;
    if (added < bestAdded) {
      bestAdded = added;
      bestIdx = i + 1;
    }
  }
  return bestIdx;
}

const VIBES = [
  { id: 'all', icon: '✨', label: 'All Rides' },
  { id: 'flat', icon: '🥞', label: 'Super Flat' },
  { id: 'coastal', icon: '🌊', label: 'Coastal' },
  { id: 'river', icon: '🌿', label: 'River & Gums' },
  { id: 'hills', icon: '⛰️', label: 'Hills' },
  { id: 'city', icon: '☕', label: 'Leafy City' },
] as const;

const EFFORTS = [
  { id: 'any', label: 'Any Time' },
  { id: 'short', label: '⚡ < 1 hr' },
  { id: 'medium', label: '🌤️ 1–2 hrs' },
  { id: 'long', label: '🏆 2+ hrs' },
] as const;

const kmFormatter = new Intl.NumberFormat('en-AU', {
  style: 'unit',
  unit: 'kilometer',
  unitDisplay: 'short',
  maximumFractionDigits: 1,
});

const mFormatter = new Intl.NumberFormat('en-AU', {
  style: 'unit',
  unit: 'meter',
  unitDisplay: 'short',
  maximumFractionDigits: 0,
});

function escapeXmlClient(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function downloadClientGpx(route: CyclingRoute, customFileName?: string) {
  const trkpts = route.coordinates
    .map(([lng, lat]) => `      <trkpt lat="${lat.toFixed(5)}" lon="${lng.toFixed(5)}"></trkpt>`)
    .join('\n');

  const gpxXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="SpinMap" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${escapeXmlClient(route.name)}</name>`,
    `    <desc>${escapeXmlClient(route.subtitle)}</desc>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${escapeXmlClient(route.name)}</name>`,
    '    <trkseg>',
    trkpts,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ].join('\n');

  const blob = new Blob([gpxXml], { type: 'application/gpx+xml;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = customFileName || 'spinmap-custom-ride.gpx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

interface MelbVeloExplorerProps {
  cityConfig: CityConfig;
  routes: readonly CyclingRoute[];
  csrfToken: string;
}

export default function MelbVeloExplorer({
  cityConfig,
  routes,
  csrfToken,
}: MelbVeloExplorerProps) {
  const [activeCityConfig, setActiveCityConfig] = useState<CityConfig>(cityConfig);
  const [citySearchOpen, setCitySearchOpen] = useState<boolean>(false);
  const [cityQuery, setCityQuery] = useState<string>('');
  const [citySearching, setCitySearching] = useState<boolean>(false);
  const [citySearchError, setCitySearchError] = useState<string | null>(null);

  const [vibe, setVibe] = useState<string>('all');
  const [effort, setEffort] = useState<string>('any');
  const [bikeType, setBikeType] = useState<BikeTypeId>('cruiser');
  const [customRoute, setCustomRoute] = useState<CyclingRoute | null>(null);
  const [customRationale, setCustomRationale] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(routes[0].id);
  const [reversedIds, setReversedIds] = useState<Set<string>>(() => new Set());
  const [scrubRatio, setScrubRatio] = useState<number>(0.34);
  const [pillExpanded, setPillExpanded] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const [onlySaved, setOnlySaved] = useState<boolean>(false);
  const [isDraggingScrub, setIsDraggingScrub] = useState<boolean>(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [pickLocationMode, setPickLocationMode] = useState<boolean>(false);
  const [externalPickRequest, setExternalPickRequest] = useState<{
    coords: [number, number];
    nonce: number;
    label?: string;
  } | null>(null);
  const [liveGpsTriggerNonce, setLiveGpsTriggerNonce] = useState<number>(0);

  const [windOverlay, setWindOverlay] = useState<boolean>(false);
  const [weatherOpen, setWeatherOpen] = useState<boolean>(false);
  const [activePitKinds, setActivePitKinds] = useState<PitStopKind[]>([]);
  const [pitStops, setPitStops] = useState<PitStopPoi[]>([]);
  const [loadingPitStops, setLoadingPitStops] = useState<boolean>(false);
  const [editWaypointsMode, setEditWaypointsMode] = useState<boolean>(false);
  const [rerouting, setRerouting] = useState<boolean>(false);
  const [activeCsrf, setActiveCsrf] = useState<string>(csrfToken);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [weather, setWeather] = useState<LiveWeatherState>({
    tempC: 22,
    windKmh: 15,
    windDeg: 205,
    windLabel: cityConfig.defaultWindLabel,
    sunsetLabel: '7:45 pm',
    minutesToSunset: 240,
    bestWindowLabel: 'Light breeze & mild skies',
    hourly: [],
  });

  const svgScrubRef = useRef<SVGSVGElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsHydratedRef = useRef<boolean>(false);
  const recentCustomByCityRef = useRef<Record<string, { route: CyclingRoute; rationale: string }>>({});

  const showToast = useCallback((message: string) => {
    setToastMsg(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);

  // Keep activeCityConfig synced when navigating between built-in city pages (/ vs /sydney)
  useEffect(() => {
    setActiveCityConfig(cityConfig);
  }, [cityConfig]);

  // Hydrate persistent IndexedDB state (saved rides, bike type, recent custom route) & ?route= URL param
  useEffect(() => {
    let active = true;
    const urlSlug =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('route')
        : null;
    if (urlSlug && routes.some((r) => r.id === urlSlug)) {
      setSelectedId(urlSlug);
    }

    loadSpinMapPrefs()
      .then((prefs) => {
        if (!active) return;
        if (Array.isArray(prefs.savedIds)) {
          setSavedIds(new Set(prefs.savedIds.filter((s): s is string => typeof s === 'string')));
        }
        if (prefs.bikeType && VALID_BIKE_IDS.has(prefs.bikeType)) {
          setBikeType(prefs.bikeType);
        }
        if (prefs.recentCustomByCity && typeof prefs.recentCustomByCity === 'object') {
          recentCustomByCityRef.current = { ...prefs.recentCustomByCity };
          const savedCustom = recentCustomByCityRef.current[cityConfig.id];
          if (savedCustom?.route && Array.isArray(savedCustom.route.coordinates)) {
            setCustomRoute(savedCustom.route);
            setCustomRationale(savedCustom.rationale || '');
          }
        }
        prefsHydratedRef.current = true;
      })
      .catch(() => {
        prefsHydratedRef.current = true;
      });

    return () => {
      active = false;
    };
  }, [cityConfig.id, routes]);

  // Persist non-sensitive UI preferences to IndexedDB whenever they change
  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    if (customRoute) {
      recentCustomByCityRef.current = {
        ...recentCustomByCityRef.current,
        [activeCityConfig.id]: { route: customRoute, rationale: customRationale ?? '' },
      };
    }
    void saveSpinMapPrefs({
      savedIds: Array.from(savedIds),
      bikeType,
      recentCustomByCity: recentCustomByCityRef.current,
    });
  }, [activeCityConfig.id, bikeType, customRationale, customRoute, savedIds]);

  // Sync shareable ?route=<slug> query parameter in browser URL without page reload
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (selectedId && selectedId !== 'custom-designed-route') {
        url.searchParams.set('route', selectedId);
      } else {
        url.searchParams.delete('route');
      }
      window.history.replaceState(null, '', url.toString());
    } catch {
      // Safe no-op in sandboxed contexts
    }
  }, [selectedId]);

  // Fetch live weather, wind direction, sunset countdown & hourly best ride window
  useEffect(() => {
    let active = true;
    const isBuiltIn = activeCityConfig.id === 'melbourne' || activeCityConfig.id === 'sydney';
    const targetCoords = userLocation ?? (!isBuiltIn ? activeCityConfig.center : null);
    const weatherQuery = targetCoords
      ? `/api/v1/weather?city=${encodeURIComponent(isBuiltIn ? activeCityConfig.id : 'melbourne')}&lat=${targetCoords[1].toFixed(4)}&lng=${targetCoords[0].toFixed(4)}`
      : `/api/v1/weather?city=${encodeURIComponent(activeCityConfig.id)}`;

    fetch(weatherQuery)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data && typeof data.tempC === 'number') {
          setWeather({
            tempC: data.tempC,
            windKmh: typeof data.windKmh === 'number' ? data.windKmh : 15,
            windDeg: typeof data.windDeg === 'number' ? data.windDeg : 205,
            windLabel: String(data.windLabel || activeCityConfig.defaultWindLabel),
            sunsetLabel: String(data.sunsetLabel || '7:45 pm'),
            minutesToSunset:
              typeof data.minutesToSunset === 'number' ? data.minutesToSunset : null,
            bestWindowLabel: String(data.bestWindowLabel || 'Great conditions now'),
            hourly: Array.isArray(data.hourly) ? data.hourly : [],
          });
        }
      })
      .catch(() => {
        // Graceful offline fallback
      });
    return () => {
      active = false;
    };
  }, [activeCityConfig.center, activeCityConfig.defaultWindLabel, activeCityConfig.id, userLocation]);

  const allRoutes = useMemo(() => {
    return customRoute ? [customRoute, ...routes] : routes;
  }, [customRoute, routes]);

  const filteredRoutes = useMemo(() => {
    return allRoutes.filter((r) => {
      if (onlySaved && !savedIds.has(r.id)) return false;
      if (vibe === 'flat' && !r.isFlat) return false;
      if (vibe !== 'all' && vibe !== 'flat' && r.vibe !== vibe) return false;
      if (effort !== 'any' && r.effort !== effort) return false;
      return true;
    });
  }, [allRoutes, onlySaved, savedIds, vibe, effort]);

  const baseActiveRoute: CyclingRoute = useMemo(() => {
    return (
      filteredRoutes.find((r) => r.id === selectedId) ??
      filteredRoutes[0] ??
      allRoutes[0]
    );
  }, [filteredRoutes, selectedId, allRoutes]);

  const isReversed = reversedIds.has(baseActiveRoute.id);

  const activeRoute: CyclingRoute = useMemo(() => {
    return isReversed ? reverseCyclingRoute(baseActiveRoute) : baseActiveRoute;
  }, [baseActiveRoute, isReversed]);

  const estimatedRideMinutes = useMemo(
    () => estimateRideMinutes(activeRoute, bikeType),
    [activeRoute, bikeType]
  );
  const dynamicDurationLabel = useMemo(
    () => formatRideDuration(estimatedRideMinutes),
    [estimatedRideMinutes]
  );
  const bikeSuitability = useMemo(
    () => getBikeSuitabilityNote(activeRoute, bikeType),
    [activeRoute, bikeType]
  );
  const windSummary = useMemo(
    () => analyzeRouteWind(activeRoute.coordinates, weather.windDeg, weather.windKmh),
    [activeRoute.coordinates, weather.windDeg, weather.windKmh]
  );

  // Fetch nearby OpenStreetMap cyclist pit-stops (cafes, drinking water, toilets, bike repair)
  useEffect(() => {
    if (activePitKinds.length === 0) {
      setPitStops([]);
      setLoadingPitStops(false);
      return;
    }

    const coords = activeRoute.coordinates;
    if (coords.length === 0) return;

    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    const pad = 0.012;
    const midLat = (minLat + maxLat) / 2;
    const midLng = (minLng + maxLng) / 2;
    const halfLat = Math.min(0.19, (maxLat - minLat) / 2 + pad);
    const halfLng = Math.min(0.19, (maxLng - minLng) / 2 + pad);

    const params = new URLSearchParams({
      minLat: (midLat - halfLat).toFixed(4),
      minLng: (midLng - halfLng).toFixed(4),
      maxLat: (midLat + halfLat).toFixed(4),
      maxLng: (midLng + halfLng).toFixed(4),
      kinds: activePitKinds.join(','),
    });

    const controller = new AbortController();
    setLoadingPitStops(true);

    fetch(`/api/v1/pitstops?${params.toString()}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { pitstops: [] }))
      .then((data: { pitstops?: PitStopPoi[] }) => {
        if (!controller.signal.aborted) {
          setPitStops(Array.isArray(data.pitstops) ? data.pitstops : []);
          setLoadingPitStops(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadingPitStops(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [activePitKinds, activeRoute.id, activeRoute.coordinates.length]);

  const executeReroute = useCallback(
    async (
      waypoints: Array<{
        lngLat: [number, number];
        label: string;
        icon: string;
        photoUrl: string;
        note: string;
      }>,
      routeName: string
    ) => {
      setRerouting(true);
      const postOnce = async (tokenToUse: string) =>
        fetch('/api/v1/reroute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': tokenToUse,
          },
          body: JSON.stringify({ routeName, waypoints }),
        });

      try {
        let res = await postOnce(activeCsrf);
        if (res.status === 403) {
          const refreshRes = await fetch('/api/v1/csrf');
          if (refreshRes.ok) {
            const refreshed = (await refreshRes.json()) as { csrfToken?: string };
            if (typeof refreshed.csrfToken === 'string') {
              setActiveCsrf(refreshed.csrfToken);
              res = await postOnce(refreshed.csrfToken);
            }
          }
        }
        const data = (await res.json()) as { route?: CyclingRoute; error?: string };
        if (!res.ok || !data.route) {
          showToast(data.error || 'Could not recalculate bikeways for that stop.');
          return;
        }
        setCustomRoute(data.route);
        setCustomRationale(`Edited with ${data.route.landmarks.length} waypoints along live OSM bikeways`);
        setReversedIds((prev) => {
          const next = new Set(prev);
          next.delete('custom-designed-route');
          return next;
        });
        setSelectedId('custom-designed-route');
        showToast(
          `✏️ Rerouted: ${kmFormatter.format(data.route.distanceKm)} · +${mFormatter.format(data.route.elevationM)}`
        );
      } catch {
        showToast('Network error while recalculating route.');
      } finally {
        setRerouting(false);
      }
    },
    [activeCsrf, showToast]
  );

  const handleWaypointDragged = useCallback(
    (landmarkIndex: number, newLngLat: [number, number]) => {
      const updated = activeRoute.landmarks.slice(0, 8).map((lm, i) =>
        i === landmarkIndex
          ? {
              lngLat: newLngLat,
              label: lm.label.includes('(Moved)') ? lm.label : `${lm.label} (Moved)`,
              icon: lm.icon,
              photoUrl: lm.photoUrl,
              note: 'Adjusted by dragging on map',
            }
          : {
              lngLat: lm.lngLat,
              label: lm.label,
              icon: lm.icon,
              photoUrl: lm.photoUrl,
              note: lm.note,
            }
      );
      if (updated.length >= 2) {
        void executeReroute(updated, activeRoute.name);
      }
    },
    [activeRoute.landmarks, activeRoute.name, executeReroute]
  );

  const handleMapInsertStop = useCallback(
    (lngLat: [number, number], stopLabel = 'Added Map Stop', stopIcon = '📌') => {
      if (activeRoute.landmarks.length >= 8) {
        showToast('Maximum 8 stops reached — drag an existing pin to reshape the route');
        return;
      }
      const insertAt = findInsertWaypointIndex(activeRoute.landmarks, lngLat);
      const nextWaypoints = activeRoute.landmarks.map((lm) => ({
        lngLat: lm.lngLat,
        label: lm.label,
        icon: lm.icon,
        photoUrl: lm.photoUrl,
        note: lm.note,
      }));
      nextWaypoints.splice(insertAt, 0, {
        lngLat,
        label: stopLabel,
        icon: stopIcon,
        photoUrl: activeRoute.photoUrl,
        note: 'Added directly on the map',
      });
      void executeReroute(nextWaypoints, activeRoute.name);
    },
    [activeRoute.landmarks, activeRoute.name, activeRoute.photoUrl, executeReroute, showToast]
  );

  const handleExploreGlobalCity = useCallback(
    async (rawName: string) => {
      const trimmed = rawName.trim();
      if (trimmed.length < 2) return;
      setCitySearching(true);
      setCitySearchError(null);
      try {
        const res = await fetch(`/api/v1/geocode-city?q=${encodeURIComponent(trimmed)}`);
        const data = (await res.json()) as { city?: ResolvedCityResult; error?: string };
        if (!res.ok || !data.city) {
          setCitySearchError(data.error || `Could not find "${trimmed}".`);
          return;
        }
        const nextCfg = buildGlobalCityConfig(data.city);
        setActiveCityConfig(nextCfg);
        setCitySearchOpen(false);
        setCityQuery('');
        setWeatherOpen(false);
        setEditWaypointsMode(false);
        setPickLocationMode(false);
        setUserLocation(nextCfg.center);
        setExternalPickRequest({
          coords: nextCfg.center,
          nonce: Date.now(),
          label: nextCfg.name,
        });
        showToast(`🌍 Flying to ${nextCfg.name} & designing a local bikeway ride…`);
      } catch {
        setCitySearchError('Network error looking up that city.');
      } finally {
        setCitySearching(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setScrubRatio((prev) => {
        if (prev >= 0.985) {
          setIsPlaying(false);
          return 1;
        }
        return prev + 0.014;
      });
    }, 48);
    return () => clearInterval(timer);
  }, [isPlaying]);

  // True-to-scale elevation geometry (minimum 140m vertical ceiling so flat routes draw visibly flat!)
  const elevGeometry = useMemo(() => {
    const pts = activeRoute.elevProfile;
    const minE = Math.min(...pts);
    const maxE = Math.max(...pts);
    const span = Math.max(maxE - minE, 140);
    const w = 360;
    const h = 52;
    const padX = 8;
    const padY = 7;

    const coords = pts.map((v, idx) => {
      const x = padX + (idx / (pts.length - 1)) * (w - padX * 2);
      const y = h - padY - ((v - minE) / span) * (h - padY * 2);
      return [x, y] as const;
    });

    const lineD = coords
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`)
      .join(' ');
    const areaD = `${lineD} L ${(w - padX).toFixed(1)} ${h - 2} L ${padX} ${h - 2} Z`;

    const cursorX = padX + scrubRatio * (w - padX * 2);
    const fIdx = scrubRatio * (pts.length - 1);
    const i0 = Math.floor(fIdx);
    const i1 = Math.min(pts.length - 1, Math.ceil(fIdx));
    const currentAlt = Math.round(pts[i0] + (pts[i1] - pts[i0]) * (fIdx - i0));
    const cursorY = h - padY - ((currentAlt - minE) / span) * (h - padY * 2);

    return { w, h, padX, padY, minE, span, lineD, areaD, cursorX, cursorY, currentAlt };
  }, [activeRoute, scrubRatio]);

  const activeLandmark = getNearestLandmark(activeRoute, scrubRatio);
  const activeLandmarkIdx = activeRoute.landmarks.findIndex(
    (lm) => lm.label === activeLandmark.label
  );
  const isSaved = savedIds.has(activeRoute.id);

  const handleScrubPointer = (clientX: number) => {
    const svg = svgScrubRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    setIsPlaying(false);
    setScrubRatio(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
  };

  const handleScrubKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIsPlaying(false);
      setScrubRatio((prev) => Math.min(1, prev + 0.05));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setIsPlaying(false);
      setScrubRatio((prev) => Math.max(0, prev - 0.05));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setIsPlaying(false);
      setScrubRatio(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setIsPlaying(false);
      setScrubRatio(1);
    }
  };

  const handleCopyRidePlan = async () => {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    const summary = [
      `SpinMap Ride: ${activeRoute.name}`,
      `${kmFormatter.format(activeRoute.distanceKm)} · +${mFormatter.format(activeRoute.elevationM)} climb · ${dynamicDurationLabel}`,
      `Route: ${activeRoute.subtitle}`,
      `Google Maps: ${activeRoute.gmapsUrl}`,
      shareUrl ? `SpinMap Link: ${shareUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(summary);
        showToast('📋 Copied ride plan & shareable SpinMap link');
        return;
      }
    } catch {
      // Fallback toast below
    }
    showToast('Open Google Maps or download GPX to share this ride');
  };

  const isGlobalCityActive =
    activeCityConfig.id !== 'melbourne' && activeCityConfig.id !== 'sydney';

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 space-y-3.5">
      {/* Compact Top Bar: Brand + City Switcher + Global City Search + Clickable Weather + Saved Shortlist */}
      <header className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-[var(--border-card)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-[var(--accent-main)] text-[var(--accent-fg)] font-bold text-sm shadow-sm">
              SM
            </span>
            <div>
              <h1 className="text-base sm:text-lg font-semibold tracking-tight text-[var(--fg-main)] leading-tight">
                SpinMap
              </h1>
              <p className="text-xs text-[var(--fg-muted)] leading-tight">
                Visual cycling routes · {activeCityConfig.name}
              </p>
            </div>
          </div>

          <div className="relative flex items-center gap-1.5">
            <nav
              aria-label="City selector"
              className="inline-flex items-center p-0.5 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-card)] text-xs"
            >
              {CITY_LIST.map((city) => {
                const active = city.id === activeCityConfig.id;
                return (
                  <Link
                    key={city.id}
                    id={`city-tab-${city.id}`}
                    href={city.href}
                    onClick={() => {
                      if (city.id === cityConfig.id && isGlobalCityActive) {
                        setActiveCityConfig(cityConfig);
                        setUserLocation(null);
                      }
                    }}
                    className={`px-3 py-1 rounded-full font-medium transition-colors ${
                      active
                        ? 'bg-[var(--bg-card)] text-[var(--fg-main)] shadow-xs font-semibold'
                        : 'text-[var(--fg-muted)] hover:text-[var(--fg-main)]'
                    }`}
                  >
                    {city.name}
                  </Link>
                );
              })}
              <button
                id="btn-explore-any-city"
                type="button"
                onClick={() => {
                  setCitySearchOpen((prev) => !prev);
                  setWeatherOpen(false);
                }}
                aria-expanded={citySearchOpen}
                className={`px-3 py-1 rounded-full font-medium cursor-pointer transition-colors ${
                  isGlobalCityActive || citySearchOpen
                    ? 'bg-[var(--accent-main)] text-[var(--accent-fg)] shadow-xs font-semibold'
                    : 'text-[var(--fg-muted)] hover:text-[var(--fg-main)]'
                }`}
                title="Explore cycling routes in any city worldwide"
              >
                {isGlobalCityActive ? `🌍 ${activeCityConfig.name} ▾` : '🌍 Any City ▾'}
              </button>
            </nav>

            {citySearchOpen && (
              <div
                id="global-city-popover"
                role="dialog"
                aria-label="Explore any city worldwide"
                className="absolute start-0 top-full mt-2 w-[310px] sm:w-[340px] z-40 rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] shadow-xl p-3 space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--fg-main)]">
                    🌍 Fly SpinMap to Any City
                  </span>
                  <button
                    type="button"
                    onClick={() => setCitySearchOpen(false)}
                    className="px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[var(--fg-muted)] hover:text-[var(--fg-main)] cursor-pointer"
                    aria-label="Close city search"
                  >
                    ✕
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleExploreGlobalCity(cityQuery);
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    id="input-global-city"
                    type="text"
                    value={cityQuery}
                    onChange={(e) => {
                      setCityQuery(e.target.value);
                      if (citySearchError) setCitySearchError(null);
                    }}
                    placeholder="City name (e.g. Brisbane, Tokyo, Paris)"
                    maxLength={60}
                    className="flex-1 px-2.5 py-1.5 rounded-xl bg-[var(--bg-page)] border border-[var(--border-card)] text-[var(--fg-main)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:border-[var(--accent-main)]"
                  />
                  <button
                    id="btn-global-city-go"
                    type="submit"
                    disabled={citySearching || cityQuery.trim().length < 2}
                    className="px-3 py-1.5 rounded-xl bg-[var(--accent-main)] text-[var(--accent-fg)] font-semibold cursor-pointer disabled:opacity-60"
                  >
                    {citySearching ? '…' : 'Go'}
                  </button>
                </form>

                <div className="flex flex-wrap gap-1.5">
                  {GLOBAL_CITY_CHIPS.map((cityName) => (
                    <button
                      key={cityName}
                      type="button"
                      disabled={citySearching}
                      onClick={() => void handleExploreGlobalCity(cityName)}
                      className="px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] text-[var(--fg-main)] hover:border-[var(--accent-main)] border border-transparent cursor-pointer transition-colors"
                    >
                      {cityName}
                    </button>
                  ))}
                </div>

                {citySearchError && (
                  <div className="text-red-600 dark:text-red-400">{citySearchError}</div>
                )}

                {isGlobalCityActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCityConfig(cityConfig);
                      setUserLocation(null);
                      setCitySearchOpen(false);
                      showToast(`Returned to ${cityConfig.name}`);
                    }}
                    className="w-full py-1.5 rounded-xl bg-[var(--bg-page)] border border-[var(--border-card)] text-[var(--fg-main)] font-medium hover:bg-[var(--bg-subtle)] cursor-pointer"
                  >
                    ↩ Back to {cityConfig.name}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative">
            <button
              id="melb-weather-pill"
              type="button"
              onClick={() => {
                setWeatherOpen((prev) => !prev);
                setCitySearchOpen(false);
              }}
              aria-expanded={weatherOpen}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border cursor-pointer transition-colors shadow-xs ${
                weatherOpen
                  ? 'bg-[var(--bg-subtle)] border-[var(--accent-main)] text-[var(--fg-main)]'
                  : 'bg-[var(--bg-card)] border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)]'
              }`}
              title="Click for hourly Best Window to Ride & sunset countdown"
            >
              <span>🌤️ {weather.tempC}°C</span>
              <span className="text-[var(--fg-muted)]">·</span>
              <span>
                💨 {weather.windKmh} km/h {weather.windLabel}
              </span>
              {weather.windKmh >= 20 && (
                <span className="text-[var(--accent-main)] font-medium hidden sm:inline">
                  · {activeCityConfig.windShelterTip}
                </span>
              )}
              <span className="text-[var(--fg-muted)] ms-0.5">▾</span>
            </button>

            {weatherOpen && (
              <WeatherWindowPopover
                locationName={activeCityConfig.name}
                weather={weather}
                estimatedRideMinutes={estimatedRideMinutes}
                onClose={() => setWeatherOpen(false)}
              />
            )}
          </div>

          <button
            id="saved-rides-badge"
            type="button"
            onClick={() => {
              if (savedIds.size === 0 && !onlySaved) {
                showToast('Tap "♡ Save" on any ride to bookmark it here');
                return;
              }
              setOnlySaved((prev) => !prev);
            }}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-mono tabular-nums cursor-pointer transition-colors shadow-xs ${
              onlySaved
                ? 'bg-[var(--accent-main)] text-[var(--accent-fg)] font-semibold'
                : 'bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)]'
            }`}
            title="Filter to your saved rides"
          >
            ♥ Saved {savedIds.size}
          </button>
        </div>
      </header>

      {/* Sleek Compact Custom Route Architect (keeps Map + Scenic Stage cleanly above the fold) */}
      <RouteDesignerPanel
        cityConfig={activeCityConfig}
        csrfToken={csrfToken}
        kmFormat={(km) => kmFormatter.format(km)}
        pickLocationMode={pickLocationMode}
        externalPickRequest={externalPickRequest}
        liveGpsTriggerNonce={liveGpsTriggerNonce}
        designedSummary={
          customRoute && customRationale
            ? {
                rationale: customRationale,
                routeName: customRoute.name,
                gmapsUrl: customRoute.gmapsUrl,
              }
            : null
        }
        onTogglePickLocationMode={() => {
          setEditWaypointsMode(false);
          setPickLocationMode((prev) => {
            const next = !prev;
            if (next) showToast('📌 Click anywhere on the map to set your starting location');
            return next;
          });
        }}
        onUserLocationChange={setUserLocation}
        onRouteDesigned={({ route, rationale, startCoords }) => {
          setIsPlaying(false);
          setPickLocationMode(false);
          setEditWaypointsMode(false);
          setUserLocation(startCoords);
          setCustomRoute(route);
          setCustomRationale(rationale);
          setReversedIds((prev) => {
            const next = new Set(prev);
            next.delete(route.id);
            return next;
          });
          setOnlySaved(false);
          setVibe('all');
          setEffort('any');
          setSelectedId(route.id);
          setScrubRatio(0);
          setPillExpanded(false);
          showToast('✨ Custom route designed from your starting location!');
        }}
        onPreviewDesignedRoute={() => {
          if (customRoute) {
            setSelectedId(customRoute.id);
            setScrubRatio(0);
            setPillExpanded(false);
            setIsPlaying(true);
          }
        }}
      />

      {/* 1A Split Stage: MapLibre Outdoor Stage (start) + Editorial Scenic Photo & Scrubber (end) */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch select-none">
        <MapLibreStage
          cityConfig={activeCityConfig}
          filteredRoutes={filteredRoutes}
          activeRoute={activeRoute}
          scrubRatio={scrubRatio}
          pillExpanded={pillExpanded}
          isPlaying={isPlaying}
          userLocation={userLocation}
          pickLocationMode={pickLocationMode}
          windOverlay={windOverlay}
          windSummary={windSummary}
          windLabel={weather.windLabel}
          pitStops={pitStops}
          activePitKinds={activePitKinds}
          loadingPitStops={loadingPitStops}
          editWaypointsMode={editWaypointsMode}
          rerouting={rerouting}
          kmFormat={(km) => kmFormatter.format(km)}
          onSelectRoute={(routeId) => {
            setIsPlaying(false);
            setSelectedId(routeId);
            setScrubRatio(0.34);
            setPillExpanded(false);
          }}
          onSelectLandmark={(ratio, toggleIfSame, lm: RouteLandmark) => {
            setIsPlaying(false);
            if (toggleIfSame && activeLandmark.label === lm.label) {
              setPillExpanded((prev) => !prev);
            } else {
              setScrubRatio(ratio);
              setPillExpanded(false);
            }
          }}
          onTogglePillExpanded={setPillExpanded}
          onTogglePlay={() => {
            if (isPlaying) {
              setIsPlaying(false);
              return;
            }
            if (scrubRatio >= 0.98) setScrubRatio(0);
            setIsPlaying(true);
          }}
          onMapPickLocation={(lngLat) => {
            setPickLocationMode(false);
            setExternalPickRequest({ coords: lngLat, nonce: Date.now() });
          }}
          onCancelPickLocation={() => setPickLocationMode(false)}
          onRequestLiveGps={() => {
            setPickLocationMode(false);
            setEditWaypointsMode(false);
            setLiveGpsTriggerNonce((prev) => prev + 1);
          }}
          onToggleWindOverlay={() => {
            setWindOverlay((prev) => {
              const next = !prev;
              showToast(
                next
                  ? `🍃 Wind overlay on — ${windSummary.finishLabel}`
                  : 'Wind overlay hidden'
              );
              return next;
            });
          }}
          onTogglePitKind={(kind) => {
            setActivePitKinds((prev) =>
              prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]
            );
          }}
          onPitStopClick={(poi) => {
            if (editWaypointsMode) {
              handleMapInsertStop(poi.lngLat, poi.name, poi.icon);
            } else {
              showToast(`${poi.icon} ${poi.name} — tap ✏️ Edit Stops to add it to your route`);
            }
          }}
          onToggleEditWaypoints={() => {
            setPickLocationMode(false);
            setPillExpanded(false);
            setEditWaypointsMode((prev) => {
              const next = !prev;
              if (next) showToast('✏️ Drag any landmark pin or click the map to add a stop');
              return next;
            });
          }}
          onWaypointDragged={handleWaypointDragged}
          onMapInsertStop={(lngLat) => handleMapInsertStop(lngLat)}
        />

        {/* Right: Clean Unobstructed Scenic Photo Stage + Dedicated Action Bar + Scrubber + Highlights */}
        <div className="md:col-span-6 rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] overflow-hidden flex flex-col justify-between shadow-sm">
          <div className="relative h-52 sm:h-56 w-full overflow-hidden bg-[var(--bg-subtle)]">
            <img
              src={activeLandmark.photoUrl || activeRoute.photoUrl}
              alt={`${activeRoute.name} — ${activeLandmark.label}`}
              className="w-full h-full object-cover transition-all duration-300"
            />
            <div className="absolute inset-0 hero-photo-scrim" />

            {/* Clean Top-Start Context Badges only (photo breathes unobstructed!) */}
            <div className="absolute top-3 start-3 end-3 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-900/75 text-white backdrop-blur-xs">
                  {activeRoute.comfortBadge}
                </span>
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-900/75 text-white backdrop-blur-xs">
                  {activeRoute.tramBadge}
                </span>
              </div>
              <span className="shrink-0 px-2.5 py-1 rounded-full font-mono tabular-nums text-xs font-semibold bg-slate-900/80 text-white backdrop-blur-xs">
                {dynamicDurationLabel} · {kmFormatter.format(activeRoute.distanceKm)}
              </span>
            </div>

            {/* Bottom Title Overlay */}
            <div className="absolute bottom-3 start-3.5 end-3.5">
              <h2 className="text-lg font-semibold text-white leading-snug tracking-tight">
                {activeRoute.name}
              </h2>
              <p className="text-xs text-slate-200 leading-snug line-clamp-1">
                {activeRoute.subtitle}
              </p>
            </div>
          </div>

          {/* Dedicated Primary Action Strip (zero overlap on photography at any screen width) */}
          <div className="px-3.5 py-2.5 border-b border-[var(--border-card)] bg-[var(--bg-subtle)]/55 flex flex-wrap items-center justify-between gap-2">
            <a
              id="btn-open-google-maps"
              href={activeRoute.gmapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#1a73e8] text-white cursor-pointer hover:opacity-95 active:scale-98 transition-all shadow-xs"
            >
              🧭 Open in Google Maps ↗
            </a>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                id="btn-reverse-route"
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setScrubRatio(0);
                  const flipped = reverseCyclingRoute(activeRoute);
                  const nextWind = analyzeRouteWind(
                    flipped.coordinates,
                    weather.windDeg,
                    weather.windKmh
                  );
                  setReversedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(baseActiveRoute.id)) next.delete(baseActiveRoute.id);
                    else next.add(baseActiveRoute.id);
                    return next;
                  });
                  showToast(`🔄 Direction reversed — ${nextWind.finishLabel}`);
                }}
                className={`px-2.5 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                  isReversed
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)]'
                }`}
                title="Reverse route direction to ride with a tailwind finish home"
              >
                🔄 {isReversed ? 'Reversed' : 'Reverse'}
              </button>

              <button
                id="btn-save-route"
                type="button"
                onClick={() => {
                  setSavedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(activeRoute.id)) {
                      next.delete(activeRoute.id);
                      showToast('Removed from saved rides');
                    } else {
                      next.add(activeRoute.id);
                      showToast(`Saved "${activeRoute.shortName}"`);
                    }
                    return next;
                  });
                }}
                className={`px-2.5 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                  isSaved
                    ? 'bg-[var(--accent-main)] text-[var(--accent-fg)]'
                    : 'bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                {isSaved ? '♥ Saved' : '♡ Save'}
              </button>

              <button
                id="btn-share-route"
                type="button"
                onClick={() => void handleCopyRidePlan()}
                className="px-2.5 py-1.5 rounded-full text-xs font-medium bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors"
                title="Copy route summary and shareable link"
              >
                📋 Share
              </button>

              <a
                id="btn-download-gpx"
                href={
                  activeRoute.id === 'custom-designed-route' || isReversed
                    ? '#download-custom-gpx'
                    : `/api/v1/gpx/${encodeURIComponent(activeRoute.id)}`
                }
                onClick={(e) => {
                  if (activeRoute.id === 'custom-designed-route' || isReversed) {
                    e.preventDefault();
                    const fname = isReversed
                      ? `${activeRoute.id}-reversed.gpx`
                      : 'spinmap-custom-ride.gpx';
                    downloadClientGpx(activeRoute, fname);
                    showToast(`Downloading ${fname}`);
                    return;
                  }
                  showToast(`Downloading ${activeRoute.id}.gpx`);
                }}
                className="px-2.5 py-1.5 rounded-full text-xs font-semibold bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors"
              >
                ⬇ GPX
              </a>
            </div>
          </div>

          {/* Bike Type & Pace Selector Bar + Live Suitability Tip */}
          <div
            id="bike-type-selector"
            className="px-3.5 py-2 border-b border-[var(--border-card)] bg-[var(--bg-page)]/60 flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <div className="inline-flex flex-wrap items-center gap-1">
              {BIKE_PROFILES.map((bp) => {
                const active = bikeType === bp.id;
                return (
                  <button
                    key={bp.id}
                    id={`btn-bike-${bp.id}`}
                    type="button"
                    onClick={() => setBikeType(bp.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium cursor-pointer transition-colors ${
                      active
                        ? 'bg-[var(--accent-main)] text-[var(--accent-fg)] shadow-xs'
                        : 'bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)]'
                    }`}
                    title={`${bp.label} (~${bp.speedKmh} km/h avg) — ${bp.note}`}
                  >
                    <span>{bp.icon}</span>
                    <span>{bp.label}</span>
                  </button>
                );
              })}
            </div>
            <span
              className={`px-2 py-0.5 rounded-full font-medium ${
                bikeSuitability.tone === 'warn'
                  ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                  : 'text-[var(--fg-muted)]'
              }`}
            >
              {bikeSuitability.label}
            </span>
          </div>

          {/* True-Scale Interactive Elevation Scrubber + Surface Bar + Clickable Highlights */}
          <div className="p-3.5 space-y-3 flex-1 flex flex-col justify-between">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-[var(--fg-main)] truncate">
                  {activeLandmark.icon} {activeLandmark.label}
                </span>
                <span className="font-mono tabular-nums text-[var(--fg-muted)] shrink-0">
                  {kmFormatter.format(activeRoute.distanceKm * scrubRatio)} · Alt{' '}
                  {mFormatter.format(elevGeometry.currentAlt)}
                </span>
              </div>

              <div
                tabIndex={0}
                role="slider"
                aria-label="Route elevation and landmark scrubber"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(scrubRatio * 100)}
                onKeyDown={handleScrubKeyDown}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setIsDraggingScrub(true);
                  handleScrubPointer(e.clientX);
                }}
                onPointerMove={(e) => {
                  if (isDraggingScrub || e.pointerType === 'mouse') {
                    handleScrubPointer(e.clientX);
                  }
                }}
                onPointerUp={() => setIsDraggingScrub(false)}
                onPointerCancel={() => setIsDraggingScrub(false)}
                className="w-full rounded-xl border border-[var(--border-card)] bg-[var(--bg-page)] px-2 py-1.5 cursor-ew-resize touch-none focus:outline-none focus:border-[var(--accent-main)]"
                title={`Drag, hover, or press Left/Right arrows to glide cyclist along the ${activeCityConfig.name} map`}
              >
                <svg
                  ref={svgScrubRef}
                  viewBox={`0 0 ${elevGeometry.w} ${elevGeometry.h}`}
                  className="w-full h-12 block"
                  aria-hidden="true"
                >
                  <path d={elevGeometry.areaD} fill={activeRoute.ribbonHex} opacity="0.2" />
                  <path
                    d={elevGeometry.lineD}
                    fill="none"
                    stroke={activeRoute.ribbonHex}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {activeRoute.landmarks.map((lm) => {
                    const lx = elevGeometry.padX + lm.ratio * (elevGeometry.w - elevGeometry.padX * 2);
                    const pts = activeRoute.elevProfile;
                    const fIdx = lm.ratio * (pts.length - 1);
                    const i0 = Math.floor(fIdx);
                    const i1 = Math.min(pts.length - 1, Math.ceil(fIdx));
                    const val = pts[i0] + (pts[i1] - pts[i0]) * (fIdx - i0);
                    const ly =
                      elevGeometry.h -
                      elevGeometry.padY -
                      ((val - elevGeometry.minE) / elevGeometry.span) *
                        (elevGeometry.h - elevGeometry.padY * 2);
                    return (
                      <circle
                        key={lm.label}
                        cx={lx}
                        cy={ly}
                        r="3.2"
                        fill="var(--bg-card)"
                        stroke={activeRoute.ribbonHex}
                        strokeWidth="1.8"
                      />
                    );
                  })}
                  <line
                    x1={elevGeometry.cursorX}
                    y1={2}
                    x2={elevGeometry.cursorX}
                    y2={elevGeometry.h - 2}
                    stroke="var(--fg-main)"
                    strokeWidth="1.2"
                    strokeDasharray="2 2"
                  />
                  <circle
                    cx={elevGeometry.cursorX}
                    cy={elevGeometry.cursorY}
                    r="4.8"
                    fill="var(--accent-main)"
                    stroke="var(--bg-card)"
                    strokeWidth="2"
                  />
                </svg>
              </div>
            </div>

            {/* Visual Surface Proportion Bar */}
            <div className="space-y-1">
              <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-[var(--bg-subtle)]">
                {activeRoute.surfaces.map((seg) => (
                  <div
                    key={seg.label}
                    ref={(node) => {
                      if (node) {
                        node.style.width = `${seg.pct}%`;
                        node.style.backgroundColor = seg.color;
                      }
                    }}
                    className="h-full transition-all"
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--fg-muted)]">
                <div className="flex flex-wrap items-center gap-3">
                  {activeRoute.surfaces.map((seg) => (
                    <span key={seg.label} className="inline-flex items-center gap-1.5">
                      <span
                        ref={(node) => {
                          if (node) node.style.backgroundColor = seg.color;
                        }}
                        className="w-2 h-2 rounded-full inline-block"
                      />
                      <span>
                        {seg.pct}% {seg.label}
                      </span>
                    </span>
                  ))}
                </div>
                <span className="font-mono tabular-nums">
                  +{mFormatter.format(activeRoute.elevationM)} climb
                  {weather.windKmh >= 10 ? ` · ${windSummary.finishLabel}` : ''}
                </span>
              </div>
            </div>

            {/* 3 Clickable Landmark Highlight Micro-Cards (synced with active landmark) */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--border-card)] text-xs">
              {activeRoute.highlights.map((hl) => {
                const isCurrentStop = hl.landmarkIndex === activeLandmarkIdx;
                return (
                  <button
                    key={hl.title}
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      const targetIdx = Math.max(
                        0,
                        Math.min(hl.landmarkIndex, activeRoute.landmarks.length - 1)
                      );
                      const targetLm = activeRoute.landmarks[targetIdx];
                      setScrubRatio(targetLm.ratio);
                      setPillExpanded(true);
                    }}
                    className={`text-start p-2 rounded-xl flex items-center gap-2 min-w-0 cursor-pointer transition-colors ${
                      isCurrentStop
                        ? 'bg-[var(--bg-subtle)] border border-[var(--accent-main)]'
                        : 'bg-[var(--bg-page)] border border-[var(--border-card)] hover:border-[var(--accent-main)]'
                    }`}
                  >
                    <span className="text-sm shrink-0">{hl.icon}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--fg-main)] truncate leading-tight">
                        {hl.title}
                      </div>
                      <div className="text-[var(--fg-muted)] truncate leading-tight">{hl.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Curated City Route Gallery + Vibe & Effort Filters right where they belong */}
      <section aria-label={`Curated ${cityConfig.name} cycling routes`} className="space-y-2.5 select-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav aria-label="Ride vibe and flatness filters" className="flex flex-wrap items-center gap-1.5">
            {VIBES.map((v) => {
              const active = vibe === v.id;
              const isFlatChip = v.id === 'flat';
              return (
                <button
                  key={v.id}
                  id={`vibe-${v.id}`}
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setVibe(v.id);
                    setPillExpanded(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-all ${
                    active
                      ? 'bg-[var(--accent-main)] text-[var(--accent-fg)] shadow-xs'
                      : isFlatChip
                        ? 'bg-[var(--bg-subtle)] text-[var(--fg-main)] border border-[var(--accent-main)] hover:opacity-90'
                        : 'bg-[var(--bg-card)] text-[var(--fg-main)] border border-[var(--border-card)] hover:bg-[var(--bg-subtle)]'
                  }`}
                >
                  <span>{v.icon}</span>
                  <span>{v.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex flex-wrap items-center gap-1">
            {EFFORTS.map((ef) => {
              const active = effort === ef.id;
              return (
                <button
                  key={ef.id}
                  id={`effort-${ef.id}`}
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setEffort(ef.id);
                    setPillExpanded(false);
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                    active
                      ? 'bg-[var(--bg-subtle)] text-[var(--fg-main)] border border-[var(--accent-main)]'
                      : 'text-[var(--fg-muted)] hover:text-[var(--fg-main)]'
                  }`}
                >
                  {ef.label}
                </button>
              );
            })}
          </div>
        </div>

        {filteredRoutes.length === 0 ? (
          <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-card)] flex items-center justify-between gap-3 text-xs">
            <span className="text-[var(--fg-muted)]">No routes match that filter combination.</span>
            <button
              type="button"
              onClick={() => {
                setOnlySaved(false);
                setVibe('all');
                setEffort('any');
              }}
              className="px-3 py-1.5 rounded-full bg-[var(--accent-main)] text-[var(--accent-fg)] font-medium cursor-pointer"
            >
              Show All Rides
            </button>
          </div>
        ) : (
          <div
            className={`grid grid-cols-2 sm:grid-cols-4 gap-2.5 ${
              customRoute ? 'lg:grid-cols-4 xl:grid-cols-8' : 'lg:grid-cols-7'
            }`}
          >
            {filteredRoutes.map((r) => {
              const selected = r.id === activeRoute.id;
              return (
                <button
                  key={r.id}
                  id={`route-card-${r.id}`}
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setSelectedId(r.id);
                    setScrubRatio(0.34);
                    setPillExpanded(false);
                  }}
                  className={`group text-start rounded-xl overflow-hidden bg-[var(--bg-card)] transition-all cursor-pointer flex flex-col ${
                    selected
                      ? 'border-2 border-[var(--accent-main)] shadow-md'
                      : 'border border-[var(--border-card)] opacity-90 hover:opacity-100 shadow-xs'
                  }`}
                >
                  <div className="relative h-20 w-full overflow-hidden bg-[var(--bg-subtle)]">
                    <img
                      src={r.photoUrl}
                      alt={r.shortName}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <span className="absolute bottom-1.5 start-1.5 px-1.5 py-0.5 rounded text-xs font-mono tabular-nums font-medium bg-slate-900/80 text-white">
                      {r.isFlat
                        ? `🥞 ${formatRideDuration(estimateRideMinutes(r, bikeType))}`
                        : formatRideDuration(estimateRideMinutes(r, bikeType))}
                    </span>
                    {savedIds.has(r.id) && (
                      <span className="absolute top-1.5 end-2 text-xs text-white">♥</span>
                    )}
                  </div>
                  <div className="p-2.5 space-y-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        ref={(node) => {
                          if (node) node.style.backgroundColor = r.ribbonHex;
                        }}
                        className="w-2 h-2 rounded-full shrink-0"
                      />
                      <span className="text-xs font-semibold text-[var(--fg-main)] truncate">
                        {r.shortName}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--fg-muted)] font-mono tabular-nums truncate">
                      {kmFormatter.format(r.distanceKm)} · +{mFormatter.format(r.elevationM)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Non-Overlapping Floating Viewport Toast */}
      {toastMsg && (
        <div
          id="spinmap-toast"
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-xs font-medium bg-slate-900 text-white shadow-xl border border-slate-700"
        >
          {toastMsg}
        </div>
      )}
    </main>
  );
}
