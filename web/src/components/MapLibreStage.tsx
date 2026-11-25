'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { CityConfig } from '@/lib/cities';
import type { RouteWindSummary } from '@/lib/cycling-utils';
import type { CyclingRoute, RouteLandmark } from '@/lib/routes-data';
import type { PitStopKind, PitStopPoi } from '@/app/api/v1/pitstops/route';

const PIT_STOP_TOGGLES: ReadonlyArray<{ kind: PitStopKind; icon: string; label: string }> = [
  { kind: 'cafe', icon: '☕', label: 'Cafes' },
  { kind: 'water', icon: '🚰', label: 'Water' },
  { kind: 'toilet', icon: '🚻', label: 'Toilets' },
  { kind: 'repair', icon: '🔧', label: 'Repair' },
];

const PIT_STOP_BORDER: Record<PitStopKind, string> = {
  cafe: '#b45309',
  water: '#0284c7',
  toilet: '#64748b',
  repair: '#7c3aed',
};

interface MapLibreStageProps {
  cityConfig: CityConfig;
  filteredRoutes: readonly CyclingRoute[];
  activeRoute: CyclingRoute;
  scrubRatio: number;
  pillExpanded: boolean;
  isPlaying: boolean;
  userLocation: [number, number] | null;
  pickLocationMode: boolean;
  windOverlay: boolean;
  windSummary: RouteWindSummary | null;
  windLabel: string;
  pitStops: readonly PitStopPoi[];
  activePitKinds: readonly PitStopKind[];
  loadingPitStops: boolean;
  editWaypointsMode: boolean;
  rerouting: boolean;
  kmFormat: (km: number) => string;
  onSelectRoute: (routeId: string) => void;
  onSelectLandmark: (ratio: number, toggleIfSame: boolean, lm: RouteLandmark) => void;
  onTogglePillExpanded: (expanded: boolean) => void;
  onTogglePlay: () => void;
  onMapPickLocation: (lngLat: [number, number]) => void;
  onCancelPickLocation: () => void;
  onRequestLiveGps: () => void;
  onToggleWindOverlay: () => void;
  onTogglePitKind: (kind: PitStopKind) => void;
  onPitStopClick: (poi: PitStopPoi) => void;
  onToggleEditWaypoints: () => void;
  onWaypointDragged: (landmarkIndex: number, newLngLat: [number, number]) => void;
  onMapInsertStop: (lngLat: [number, number]) => void;
}

// Instant inline Melbourne basemap style (verified watermark-free Esri World Topo + CyclOSM Bike Lanes)
const MELBOURNE_BASEMAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'melb-voyager-tiles': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles © Esri — OpenStreetMap & GIS User Community',
    },
    'melb-cyclosm-tiles': {
      type: 'raster',
      tiles: [
        'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        'https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
        'https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap · CyclOSM',
    },
  },
  layers: [
    {
      id: 'melb-bg',
      type: 'background',
      paint: { 'background-color': '#eef4f7' },
    },
    {
      id: 'melb-voyager-layer',
      type: 'raster',
      source: 'melb-voyager-tiles',
      minzoom: 0,
      maxzoom: 20,
    },
    {
      id: 'melb-cyclosm-layer',
      type: 'raster',
      source: 'melb-cyclosm-tiles',
      minzoom: 0,
      maxzoom: 20,
      layout: { visibility: 'none' },
    },
  ],
};

function buildFreeGoogleMapsEmbedUrl(route: CyclingRoute): string {
  const lms = route.landmarks;
  const start = lms[0]?.lngLat ?? route.coordinates[0] ?? [144.9631, -37.8136];
  const saddr = `${start[1].toFixed(5)},${start[0].toFixed(5)}`;
  const stops =
    lms.length > 1
      ? lms.slice(1).map((lm) => `${lm.lngLat[1].toFixed(5)},${lm.lngLat[0].toFixed(5)}`)
      : [
          `${route.coordinates[route.coordinates.length - 1][1].toFixed(5)},${route.coordinates[route.coordinates.length - 1][0].toFixed(5)}`,
        ];
  const daddr = stops.join('+to:');
  return `https://maps.google.com/maps?saddr=${encodeURIComponent(saddr)}&daddr=${daddr}&dirflg=b&output=embed`;
}

function checkWebGLAvailable(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true;
  try {
    const testCanvas = document.createElement('canvas');
    const gl =
      testCanvas.getContext('webgl2') ||
      testCanvas.getContext('webgl') ||
      testCanvas.getContext('experimental-webgl');
    return Boolean(gl);
  } catch {
    return false;
  }
}

export function interpolateLngLat(
  coords: [number, number][],
  ratio: number
): [number, number] {
  if (coords.length === 0) return [144.9631, -37.8136];
  if (coords.length === 1 || ratio <= 0) return coords[0];
  if (ratio >= 1) return coords[coords.length - 1];

  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    const d = Math.hypot(dx, dy);
    segs.push(d);
    total += d;
  }
  if (total === 0) return coords[0];

  let target = ratio * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i]) {
      const t = segs[i] === 0 ? 0 : target / segs[i];
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
      ];
    }
    target -= segs[i];
  }
  return coords[coords.length - 1];
}

export function getNearestLandmark(route: CyclingRoute, ratio: number): RouteLandmark {
  let best = route.landmarks[0];
  let bestDist = Infinity;
  for (const lm of route.landmarks) {
    const d = Math.abs(lm.ratio - ratio);
    if (d < bestDist) {
      bestDist = d;
      best = lm;
    }
  }
  return best;
}

export default function MapLibreStage({
  cityConfig,
  filteredRoutes,
  activeRoute,
  scrubRatio,
  pillExpanded,
  isPlaying,
  userLocation,
  pickLocationMode,
  windOverlay,
  windSummary,
  windLabel,
  pitStops,
  activePitKinds,
  loadingPitStops,
  editWaypointsMode,
  rerouting,
  kmFormat,
  onSelectRoute,
  onSelectLandmark,
  onTogglePillExpanded,
  onTogglePlay,
  onMapPickLocation,
  onCancelPickLocation,
  onRequestLiveGps,
  onToggleWindOverlay,
  onTogglePitKind,
  onPitStopClick,
  onToggleEditWaypoints,
  onWaypointDragged,
  onMapInsertStop,
}: MapLibreStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const riderMarkerRef = useRef<maplibregl.Marker | null>(null);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const landmarkMarkersRef = useRef<maplibregl.Marker[]>([]);
  const pitStopMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Stable callback refs prevent MapLibre marker/camera rebuild thrashing during 60 FPS scrubbing
  const onSelectRouteRef = useRef(onSelectRoute);
  const onSelectLandmarkRef = useRef(onSelectLandmark);
  const onMapPickLocationRef = useRef(onMapPickLocation);
  const pickLocationModeRef = useRef(pickLocationMode);
  const editWaypointsModeRef = useRef(editWaypointsMode);
  const onWaypointDraggedRef = useRef(onWaypointDragged);
  const onMapInsertStopRef = useRef(onMapInsertStop);
  const onPitStopClickRef = useRef(onPitStopClick);
  onSelectRouteRef.current = onSelectRoute;
  onSelectLandmarkRef.current = onSelectLandmark;
  onMapPickLocationRef.current = onMapPickLocation;
  pickLocationModeRef.current = pickLocationMode;
  editWaypointsModeRef.current = editWaypointsMode;
  onWaypointDraggedRef.current = onWaypointDragged;
  onMapInsertStopRef.current = onMapInsertStop;
  onPitStopClickRef.current = onPitStopClick;

  const [mapReady, setMapReady] = useState(false);
  const [useSvgFallback, setUseSvgFallback] = useState(false);
  const [mapMode, setMapMode] = useState<'clean' | 'bike' | 'gmaps'>('clean');
  const [zoomFit, setZoomFit] = useState(true);
  const [pinScreenPct, setPinScreenPct] = useState<{ x: number; y: number }>({ x: 50, y: 55 });

  const activeLandmark = getNearestLandmark(activeRoute, scrubRatio);
  const activeLandmarkIdx = Math.max(
    0,
    activeRoute.landmarks.findIndex((lm) => lm.label === activeLandmark.label)
  );

  const stepLandmark = (delta: number) => {
    const total = activeRoute.landmarks.length;
    if (total === 0) return;
    const nextIdx = (activeLandmarkIdx + delta + total) % total;
    const nextLm = activeRoute.landmarks[nextIdx];
    onSelectLandmarkRef.current(nextLm.ratio, false, nextLm);
    onTogglePillExpanded(true);
  };

  // Compute SVG fallback projection bounds (used while WebGL boots or if WebGL is unavailable)
  const fallbackProjection = useMemo(() => {
    let minLng = cityConfig.overviewBounds[0][0];
    let maxLng = cityConfig.overviewBounds[1][0];
    let minLat = cityConfig.overviewBounds[0][1];
    let maxLat = cityConfig.overviewBounds[1][1];

    if (zoomFit && activeRoute.coordinates.length > 0) {
      const lngs = activeRoute.coordinates.map((c) => c[0]);
      const lats = activeRoute.coordinates.map((c) => c[1]);
      const padLng = Math.max(0.018, (Math.max(...lngs) - Math.min(...lngs)) * 0.26);
      const padLat = Math.max(0.014, (Math.max(...lats) - Math.min(...lats)) * 0.26);
      minLng = Math.min(...lngs) - padLng;
      maxLng = Math.max(...lngs) + padLng;
      minLat = Math.min(...lats) - padLat;
      maxLat = Math.max(...lats) + padLat;
    }

    const project = ([lng, lat]: [number, number]) => {
      const x = ((lng - minLng) / Math.max(0.001, maxLng - minLng)) * 600;
      const y = ((maxLat - lat) / Math.max(0.001, maxLat - minLat)) * 400;
      return [x, y] as const;
    };

    return { project };
  }, [activeRoute, cityConfig.overviewBounds, zoomFit]);

  const syncPinPosition = useCallback(() => {
    const minX = pillExpanded ? 26 : 24;
    const maxX = pillExpanded ? 66 : 64;
    const minY = pillExpanded ? 48 : 22;

    if (useSvgFallback || !mapRef.current || !containerRef.current) {
      const [sx, sy] = fallbackProjection.project(activeLandmark.lngLat);
      setPinScreenPct({
        x: Math.max(minX, Math.min(maxX, (sx / 600) * 100)),
        y: Math.max(minY, Math.min(86, (sy / 400) * 100)),
      });
      return;
    }

    const map = mapRef.current;
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const projected = map.project(activeLandmark.lngLat);
    const rawX = (projected.x / rect.width) * 100;
    const rawY = (projected.y / rect.height) * 100;
    setPinScreenPct({
      x: Math.max(minX, Math.min(maxX, rawX)),
      y: Math.max(minY, Math.min(86, rawY)),
    });
  }, [activeLandmark, fallbackProjection, pillExpanded, useSvgFallback]);

  const fitMapCamera = useCallback(
    (route: CyclingRoute, fitRouteBounds: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      if (!fitRouteBounds) {
        map.fitBounds(cityConfig.overviewBounds, { padding: 36, duration: 550 });
        return;
      }
      const bounds = new maplibregl.LngLatBounds(route.coordinates[0], route.coordinates[0]);
      for (const coord of route.coordinates) {
        bounds.extend(coord);
      }
      map.fitBounds(bounds, { padding: 62, maxZoom: 14.4, duration: 550 });
    },
    [cityConfig.overviewBounds]
  );

  // Initialize MapLibre GL map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    if (!checkWebGLAvailable()) {
      setUseSvgFallback(true);
      return;
    }

    let map: maplibregl.Map;
    try {
      // Point MapLibre GL v6 explicitly at its self-hosted worker bundle in public/maplibre/
      maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MELBOURNE_BASEMAP_STYLE,
        center: cityConfig.center,
        zoom: 12.2,
        attributionControl: false,
      });
    } catch {
      setUseSvgFallback(true);
      return;
    }

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    const riderEl = document.createElement('div');
    riderEl.className =
      'w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white text-sm select-none pointer-events-none';
    riderEl.style.backgroundColor = '#0f766e';
    riderEl.textContent = '🚴';

    const riderMarker = new maplibregl.Marker({ element: riderEl })
      .setLngLat(activeRoute.coordinates[0])
      .addTo(map);
    riderMarkerRef.current = riderMarker;

    const initRouteLayers = () => {
      if (map.getSource('melb-active-route')) return;

      map.addSource('melb-inactive-routes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('melb-active-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('melb-wind-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'melb-inactive-layer',
        type: 'line',
        source: 'melb-inactive-routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          'line-opacity': 0.45,
        },
      });

      map.addLayer({
        id: 'melb-active-halo',
        type: 'line',
        source: 'melb-active-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 13,
          'line-opacity': 0.26,
        },
      });

      map.addLayer({
        id: 'melb-active-core',
        type: 'line',
        source: 'melb-active-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 5.5,
          'line-opacity': 0.98,
        },
      });

      map.addLayer({
        id: 'melb-wind-layer',
        type: 'line',
        source: 'melb-wind-route',
        layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 6.5,
          'line-opacity': 0.96,
        },
      });

      map.on('click', 'melb-inactive-layer', (ev) => {
        if (pickLocationModeRef.current || editWaypointsModeRef.current) return;
        const clickedId = ev.features?.[0]?.properties?.id;
        if (typeof clickedId === 'string') {
          onSelectRouteRef.current(clickedId);
        }
      });

      map.on('click', (ev) => {
        if (pickLocationModeRef.current) {
          onMapPickLocationRef.current([ev.lngLat.lng, ev.lngLat.lat]);
        } else if (editWaypointsModeRef.current) {
          onMapInsertStopRef.current([ev.lngLat.lng, ev.lngLat.lat]);
        }
      });

      map.on('mouseenter', 'melb-inactive-layer', () => {
        if (!pickLocationModeRef.current && !editWaypointsModeRef.current) {
          map.getCanvas().style.cursor = 'pointer';
        }
      });
      map.on('mouseleave', 'melb-inactive-layer', () => {
        map.getCanvas().style.cursor =
          pickLocationModeRef.current || editWaypointsModeRef.current ? 'crosshair' : '';
      });

      map.resize();
      setMapReady(true);
    };

    map.on('load', initRouteLayers);
    map.on('styledata', initRouteLayers);

    const ro = new ResizeObserver(() => {
      map.resize();
    });
    ro.observe(containerRef.current);

    mapRef.current = map;

    return () => {
      ro.disconnect();
      riderMarker.remove();
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      for (const m of pitStopMarkersRef.current) {
        m.remove();
      }
      pitStopMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep map move/zoom listeners synchronized with active landmark popover
  useEffect(() => {
    syncPinPosition();
    const map = mapRef.current;
    if (!map) return;
    map.on('move', syncPinPosition);
    map.on('resize', syncPinPosition);
    return () => {
      map.off('move', syncPinPosition);
      map.off('resize', syncPinPosition);
    };
  }, [syncPinPosition]);

  // Update GeoJSON polylines ONLY when route selection or filter changes (zero scrub thrash!)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const inactiveSrc = map.getSource('melb-inactive-routes') as maplibregl.GeoJSONSource | undefined;
    const activeSrc = map.getSource('melb-active-route') as maplibregl.GeoJSONSource | undefined;

    if (inactiveSrc) {
      inactiveSrc.setData({
        type: 'FeatureCollection',
        features: filteredRoutes
          .filter((r) => r.id !== activeRoute.id)
          .map((r) => ({
            type: 'Feature' as const,
            properties: { id: r.id, color: r.ribbonHex },
            geometry: { type: 'LineString' as const, coordinates: r.coordinates },
          })),
      });
    }

    if (activeSrc) {
      activeSrc.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { id: activeRoute.id, color: activeRoute.ribbonHex },
            geometry: { type: 'LineString', coordinates: activeRoute.coordinates },
          },
        ],
      });
      map.setPaintProperty(
        'melb-active-core',
        'line-dasharray',
        activeRoute.isGravel ? [1.4, 1.8] : [1, 0]
      );
    }

    if (!editWaypointsModeRef.current) {
      setZoomFit(true);
      fitMapCamera(activeRoute, true);
    }
  }, [activeRoute, filteredRoutes, fitMapCamera, mapReady]);

  // Build clickable or draggable landmark pins (toggling Edit Stops upgrades pins without moving camera)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const oldMarker of landmarkMarkersRef.current) {
      oldMarker.remove();
    }
    landmarkMarkersRef.current = activeRoute.landmarks.map((lm, idx) => {
      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = editWaypointsMode
        ? 'w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 text-xs cursor-grab active:cursor-grabbing ring-2 ring-amber-400/80 transition-transform hover:scale-110'
        : 'w-7 h-7 rounded-full flex items-center justify-center shadow-md border-2 text-xs cursor-pointer transition-transform hover:scale-110';
      pinBtn.style.backgroundColor = '#ffffff';
      pinBtn.style.borderColor = editWaypointsMode ? '#d97706' : activeRoute.ribbonHex;
      pinBtn.textContent = lm.icon;
      pinBtn.title = editWaypointsMode ? `Drag to reroute: ${lm.label}` : lm.label;
      pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!editWaypointsModeRef.current) {
          onSelectLandmarkRef.current(lm.ratio, true, lm);
        }
      });

      const marker = new maplibregl.Marker({
        element: pinBtn,
        draggable: editWaypointsMode,
      })
        .setLngLat(lm.lngLat)
        .addTo(map);

      if (editWaypointsMode) {
        marker.on('dragend', () => {
          const ll = marker.getLngLat();
          onWaypointDraggedRef.current(idx, [ll.lng, ll.lat]);
        });
      }
      return marker;
    });
  }, [activeRoute, editWaypointsMode, mapReady]);

  // Live Headwind / Crosswind / Tailwind Shading Overlay
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const windSrc = map.getSource('melb-wind-route') as maplibregl.GeoJSONSource | undefined;
    if (windSrc) {
      windSrc.setData({
        type: 'FeatureCollection',
        features: windSummary?.features ?? [],
      });
    }

    if (map.getLayer('melb-wind-layer') && map.getLayer('melb-active-core')) {
      map.setLayoutProperty('melb-wind-layer', 'visibility', windOverlay ? 'visible' : 'none');
      map.setPaintProperty('melb-active-core', 'line-opacity', windOverlay ? 0.14 : 0.98);
    }
  }, [mapReady, windOverlay, windSummary]);

  // Toggleable Cyclist Pit-Stop Markers (Cafes, Water, Toilets, Repair)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    for (const oldMarker of pitStopMarkersRef.current) {
      oldMarker.remove();
    }
    pitStopMarkersRef.current = pitStops.map((poi) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'w-6 h-6 rounded-full flex items-center justify-center shadow-md border text-[11px] cursor-pointer transition-transform hover:scale-125';
      btn.style.backgroundColor = '#ffffff';
      btn.style.borderColor = PIT_STOP_BORDER[poi.kind];
      btn.textContent = poi.icon;
      btn.title = editWaypointsMode
        ? `${poi.name} — click to add as a stop`
        : poi.name;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onPitStopClickRef.current(poi);
      });
      return new maplibregl.Marker({ element: btn }).setLngLat(poi.lngLat).addTo(map);
    });
  }, [editWaypointsMode, mapReady, pitStops]);

  // Switch between Clean Voyager, CyclOSM Bike Lanes, and Free Embedded Google Maps
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (mapMode !== 'gmaps') {
      map.resize();
    }
    if (map.getLayer('melb-cyclosm-layer') && map.getLayer('melb-voyager-layer')) {
      map.setLayoutProperty(
        'melb-cyclosm-layer',
        'visibility',
        mapMode === 'bike' ? 'visible' : 'none'
      );
      map.setLayoutProperty(
        'melb-voyager-layer',
        'visibility',
        mapMode === 'clean' ? 'visible' : 'none'
      );
    }
  }, [mapReady, mapMode]);

  // Render pulsing blue "You Are Here" GPS marker when user selects their location
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }

    if (!userMarkerRef.current) {
      const dotEl = document.createElement('div');
      dotEl.className = 'spinmap-gps-dot pointer-events-none';
      dotEl.title = 'Your selected starting location';
      userMarkerRef.current = new maplibregl.Marker({ element: dotEl })
        .setLngLat(userLocation)
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat(userLocation);
    }
  }, [mapReady, userLocation]);

  const prevCityIdRef = useRef<string>(cityConfig.id);

  // Smoothly fly camera to a newly searched global city immediately while its route loads
  useEffect(() => {
    if (prevCityIdRef.current === cityConfig.id) return;
    prevCityIdRef.current = cityConfig.id;
    const map = mapRef.current;
    if (map && mapReady) {
      map.flyTo({ center: cityConfig.center, zoom: 12.2, duration: 750 });
    }
  }, [cityConfig.center, cityConfig.id, mapReady]);

  // Ensure Pick-on-Map or Edit-Stops mode switches out of Google Maps iframe and shows crosshair cursor
  useEffect(() => {
    if ((pickLocationMode || editWaypointsMode) && mapMode === 'gmaps') {
      setMapMode('clean');
    }
    const map = mapRef.current;
    if (map && mapReady) {
      map.getCanvas().style.cursor = pickLocationMode || editWaypointsMode ? 'crosshair' : '';
    }
  }, [editWaypointsMode, mapMode, mapReady, pickLocationMode]);

  // Move live cyclist puck smoothly along GPS polyline at 60 FPS without disturbing camera zoom
  useEffect(() => {
    if (riderMarkerRef.current) {
      const pos = interpolateLngLat(activeRoute.coordinates, scrubRatio);
      riderMarkerRef.current.setLngLat(pos);
    }
    syncPinPosition();
  }, [activeRoute, scrubRatio, syncPinPosition]);

  // Sync popover screen coordinates via CSSOM (strictly CSP-nonce compliant)
  useEffect(() => {
    const pop = popoverRef.current;
    if (!pop) return;
    pop.style.left = `${pinScreenPct.x}%`;
    pop.style.top = `${pinScreenPct.y}%`;
  }, [pinScreenPct]);

  const atLandmarkKm = kmFormat(activeRoute.distanceKm * activeLandmark.ratio);
  const riderLngLat = interpolateLngLat(activeRoute.coordinates, scrubRatio);
  const [svgRiderX, svgRiderY] = fallbackProjection.project(riderLngLat);

  return (
    <div className="md:col-span-6 relative rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] overflow-hidden flex flex-col justify-between min-h-[430px] shadow-sm">
      <div
        className="relative w-full flex-1 h-[395px] md:h-auto min-h-[395px] bg-[#eef4f7]"
        onClick={() => {
          if (pillExpanded) onTogglePillExpanded(false);
        }}
      >
        {/* Primary Interactive MapLibre GL Stage */}
        {!useSvgFallback && (
          <div
            ref={containerRef}
            id="melbvelo-maplibre-canvas"
            className="absolute inset-0 w-full h-full"
          />
        )}

        {/* Instant Cartographic SVG Backdrop (shown while WebGL boots or if WebGL is unavailable) */}
        {(useSvgFallback || !mapReady) && (
          <svg
            id="melbvelo-svg-map-fallback"
            viewBox="0 0 600 400"
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 w-full h-full block"
            aria-label={`${cityConfig.regionLabel} cycling route map`}
          >
            <rect width="600" height="400" fill="#eef4f7" />
            <polygon
              points={cityConfig.svgWaterPolygon
                .map((pt) => fallbackProjection.project([pt[0], pt[1]]).join(','))
                .join(' ')}
              fill="#cbe4f5"
              opacity="0.75"
            />
            {filteredRoutes
              .filter((r) => r.id !== activeRoute.id)
              .map((r) => {
                const pts = r.coordinates
                  .map((c) => fallbackProjection.project(c).join(','))
                  .join(' ');
                return (
                  <polyline
                    key={r.id}
                    points={pts}
                    fill="none"
                    stroke={r.ribbonHex}
                    strokeWidth="3.5"
                    strokeOpacity="0.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRouteRef.current(r.id);
                    }}
                  />
                );
              })}
            <polyline
              points={activeRoute.coordinates
                .map((c) => fallbackProjection.project(c).join(','))
                .join(' ')}
              fill="none"
              stroke={activeRoute.ribbonHex}
              strokeWidth="12"
              strokeOpacity="0.24"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {windOverlay && windSummary && windSummary.features.length > 0 ? (
              windSummary.features.map((feat, i) => (
                <polyline
                  key={`${feat.properties.kind}-${i}`}
                  points={feat.geometry.coordinates
                    .map((c) => fallbackProjection.project(c).join(','))
                    .join(' ')}
                  fill="none"
                  stroke={feat.properties.color}
                  strokeWidth="5.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))
            ) : (
              <polyline
                points={activeRoute.coordinates
                  .map((c) => fallbackProjection.project(c).join(','))
                  .join(' ')}
                fill="none"
                stroke={activeRoute.ribbonHex}
                strokeWidth="5"
                strokeDasharray={activeRoute.isGravel ? '8 7' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {activeRoute.landmarks.map((lm) => {
              const [lx, ly] = fallbackProjection.project(lm.lngLat);
              return (
                <g
                  key={lm.label}
                  transform={`translate(${lx.toFixed(1)}, ${ly.toFixed(1)})`}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectLandmarkRef.current(lm.ratio, true, lm);
                  }}
                >
                  <circle r="11" fill="#ffffff" stroke={activeRoute.ribbonHex} strokeWidth="2.2" />
                  <text y="4" textAnchor="middle" fontSize="11">
                    {lm.icon}
                  </text>
                </g>
              );
            })}
            <g transform={`translate(${svgRiderX.toFixed(1)}, ${svgRiderY.toFixed(1)})`}>
              <circle r="13" fill="#0f766e" stroke="#ffffff" strokeWidth="2.5" />
              <text y="4" textAnchor="middle" fontSize="12">
                🚴
              </text>
            </g>
          </svg>
        )}

        {/* Free Embedded Google Maps Cycling View ($0, zero API key required) */}
        {mapMode === 'gmaps' && (
          <iframe
            id="melbvelo-google-maps-iframe"
            title={`Google Maps cycling view — ${activeRoute.name}`}
            src={buildFreeGoogleMapsEmbedUrl(activeRoute)}
            className="absolute inset-0 w-full h-full z-10 border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        )}

        {/* Top Map Controls & 3-Way Map Switcher */}
        <div className="absolute top-3 start-3 end-3 z-20 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="flex flex-wrap items-center gap-1.5">
            {mapMode !== 'gmaps' && (
              <button
                id="btn-preview-ride"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePlay();
                }}
                className="pointer-events-auto inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--accent-main)] text-[var(--accent-fg)] text-xs font-semibold shadow-md hover:opacity-90 cursor-pointer transition-opacity"
              >
                {isPlaying ? '⏸ Pause' : '▶ Preview Ride'}
              </button>
            )}

            <div className="pointer-events-auto inline-flex items-center p-0.5 rounded-full bg-[var(--bg-card)]/95 border border-[var(--border-card)] shadow-md">
              <button
                id="btn-map-mode-clean"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMapMode('clean');
                }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                  mapMode === 'clean'
                    ? 'bg-slate-900 text-white'
                    : 'text-[var(--fg-main)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                🗺️ Route Map
              </button>
              {!useSvgFallback && (
                <button
                  id="btn-toggle-bike-network"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMapMode('bike');
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                    mapMode === 'bike'
                      ? 'bg-slate-900 text-white'
                      : 'text-[var(--fg-main)] hover:bg-[var(--bg-subtle)]'
                  }`}
                >
                  🚲 Bike Lanes
                </button>
              )}
              <button
                id="btn-map-mode-gmaps"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMapMode('gmaps');
                }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                  mapMode === 'gmaps'
                    ? 'bg-[#1a73e8] text-white'
                    : 'text-[var(--fg-main)] hover:bg-[var(--bg-subtle)]'
                }`}
                title="Free embedded Google Maps cycling view ($0, no API key required)"
              >
                📍 Google Maps
              </button>
            </div>
          </div>

          {mapMode !== 'gmaps' && !pickLocationMode && (
            <div className="pointer-events-auto flex items-center gap-1.5">
              <button
                id="btn-toggle-wind-overlay"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWindOverlay();
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold shadow-md cursor-pointer transition-colors border ${
                  windOverlay
                    ? 'bg-emerald-600 text-white border-emerald-500'
                    : 'bg-[var(--bg-card)]/95 text-[var(--fg-main)] border-[var(--border-card)] hover:bg-[var(--bg-subtle)]'
                }`}
                title={`Color-grade route by live ${windLabel} (green tailwind, blue crosswind, amber headwind)`}
              >
                <span>🍃</span>
                <span>Wind</span>
              </button>

              <button
                id="btn-toggle-edit-waypoints"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleEditWaypoints();
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold shadow-md cursor-pointer transition-colors border ${
                  editWaypointsMode
                    ? 'bg-amber-600 text-white border-amber-500'
                    : 'bg-[var(--bg-card)]/95 text-[var(--fg-main)] border-[var(--border-card)] hover:bg-[var(--bg-subtle)]'
                }`}
                title="Drag landmark pins or click the map to add custom stops"
              >
                <span>✏️</span>
                <span>{editWaypointsMode ? 'Editing' : 'Edit Stops'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Pick-on-Map Instruction Banner */}
        {pickLocationMode && (
          <div
            id="pick-location-banner"
            className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3.5 py-2 rounded-full bg-blue-600 text-white text-xs font-semibold shadow-xl whitespace-nowrap"
          >
            <span>📌 Click anywhere on the map to start your route there</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCancelPickLocation();
              }}
              className="px-2 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-white cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Drag-to-Reroute / Add Stop Instruction Banner */}
        {editWaypointsMode && !pickLocationMode && mapMode !== 'gmaps' && (
          <div
            id="edit-waypoints-banner"
            className="absolute bottom-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3.5 py-2 rounded-full bg-amber-600 text-white text-xs font-semibold shadow-xl whitespace-nowrap"
          >
            <span>
              {rerouting
                ? '🧭 Recalculating real bikeways…'
                : '✏️ Drag any pin or click the map to add a stop'}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleEditWaypoints();
              }}
              className="px-2 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-white cursor-pointer"
            >
              Done
            </button>
          </div>
        )}

        {/* Live Headwind / Tailwind Shading Legend */}
        {windOverlay && windSummary && !pickLocationMode && !editWaypointsMode && mapMode !== 'gmaps' && (
          <div
            id="wind-overlay-legend"
            className="absolute bottom-10 start-3 z-20 inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/90 text-white text-xs shadow-lg backdrop-blur-xs"
          >
            <span className="font-mono tabular-nums text-emerald-400">
              ● {windSummary.tailwindPct}% Tail
            </span>
            <span className="font-mono tabular-nums text-sky-400">
              ● {windSummary.crosswindPct}% Cross
            </span>
            <span className="font-mono tabular-nums text-amber-400">
              ● {windSummary.headwindPct}% Head
            </span>
            <span className="text-slate-300 hidden sm:inline">· {windSummary.finishLabel}</span>
          </div>
        )}

        {/* Progressive-Disclosure 2B Minimal Pill -> Click to Expand Street-Level Photo Card with Prev/Next Stops */}
        {mapMode !== 'gmaps' && (
        <>
        {!editWaypointsMode && (
        <div
          ref={popoverRef}
          id="map-pin-popover"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[calc(100%+14px)] z-20 pointer-events-auto transition-all duration-150"
        >
          {pillExpanded ? (
            <div
              id="expanded-pin-card"
              onClick={(e) => e.stopPropagation()}
              className="w-60 rounded-xl overflow-hidden bg-[var(--bg-card)] border-2 border-[var(--accent-main)] shadow-xl"
            >
              <div className="relative h-28 w-full bg-[var(--bg-subtle)]">
                <img
                  src={activeLandmark.photoUrl}
                  alt={activeLandmark.label}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1.5 start-2 px-1.5 py-0.5 rounded text-xs font-mono tabular-nums font-medium bg-slate-900/80 text-white">
                  {atLandmarkKm} · Stop {activeLandmarkIdx + 1}/{activeRoute.landmarks.length}
                </span>
                <button
                  type="button"
                  onClick={() => onTogglePillExpanded(false)}
                  className="absolute top-1.5 end-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-900/80 text-white cursor-pointer hover:bg-slate-900"
                >
                  ▴ Less
                </button>
              </div>
              <div className="p-2.5 space-y-1.5">
                <div className="text-xs font-semibold text-[var(--fg-main)] truncate">
                  {activeLandmark.icon} {activeLandmark.label}
                </div>
                <div className="text-xs text-[var(--fg-muted)] leading-snug">{activeLandmark.note}</div>
                {activeRoute.landmarks.length > 1 && (
                  <div className="pt-1 flex items-center justify-between gap-2 border-t border-[var(--border-card)]">
                    <button
                      type="button"
                      onClick={() => stepLandmark(-1)}
                      className="px-2 py-0.5 rounded-md text-xs font-medium bg-[var(--bg-subtle)] text-[var(--fg-main)] hover:opacity-85 cursor-pointer"
                    >
                      ‹ Prev Stop
                    </button>
                    <button
                      type="button"
                      onClick={() => stepLandmark(1)}
                      className="px-2 py-0.5 rounded-md text-xs font-medium bg-[var(--bg-subtle)] text-[var(--fg-main)] hover:opacity-85 cursor-pointer"
                    >
                      Next Stop ›
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <button
              id="minimal-pin-pill"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePillExpanded(true);
              }}
              className="inline-flex items-center gap-1.5 max-w-[260px] ps-3 pe-2 py-1 rounded-full bg-[var(--bg-card)] border border-[var(--accent-main)] shadow-md text-xs font-medium text-[var(--fg-main)] hover:bg-[var(--bg-subtle)] transition-all cursor-pointer"
              title="Click to view street-level spot photo"
            >
              <span className="truncate">
                {activeLandmark.icon} {activeLandmark.label}
              </span>
              <span className="text-[var(--fg-muted)] font-mono tabular-nums shrink-0">
                · {atLandmarkKm}
              </span>
              <span className="ms-0.5 px-1.5 py-0.5 rounded-full bg-[var(--accent-main)] text-[var(--accent-fg)] text-xs font-semibold shrink-0">
                📷
              </span>
            </button>
          )}
        </div>
        )}

        {/* Intuitive Map Controls: Live GPS, Zoom In, Zoom Out, Fit Active Route, Overview */}
        <div className="absolute bottom-3 end-3 z-10 flex flex-col rounded-lg overflow-hidden shadow-md bg-[var(--bg-card)] border border-[var(--border-card)]">
          <button
            id="btn-map-my-location"
            type="button"
            title="Use my current location & design a route"
            onClick={(e) => {
              e.stopPropagation();
              onRequestLiveGps();
            }}
            className="w-8 h-8 text-sm font-bold flex items-center justify-center border-b border-[var(--border-card)] text-blue-600 dark:text-blue-400 hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            ◎
          </button>
          <button
            id="btn-zoom-in"
            type="button"
            title="Zoom in"
            onClick={(e) => {
              e.stopPropagation();
              mapRef.current?.zoomIn({ duration: 240 });
            }}
            className="w-8 h-8 text-sm font-bold flex items-center justify-center border-b border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            +
          </button>
          <button
            id="btn-zoom-out"
            type="button"
            title="Zoom out"
            onClick={(e) => {
              e.stopPropagation();
              mapRef.current?.zoomOut({ duration: 240 });
            }}
            className="w-8 h-8 text-sm font-bold flex items-center justify-center border-b border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            −
          </button>
          <button
            id="btn-zoom-route"
            type="button"
            title="Center on active route"
            onClick={(e) => {
              e.stopPropagation();
              setZoomFit(true);
              fitMapCamera(activeRoute, true);
            }}
            className="w-8 h-8 text-xs font-bold flex items-center justify-center border-b border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            ⌖
          </button>
          <button
            id="btn-zoom-melbourne"
            type="button"
            title={`Show all ${cityConfig.regionLabel} routes`}
            onClick={(e) => {
              e.stopPropagation();
              setZoomFit(false);
              fitMapCamera(activeRoute, false);
            }}
            className="w-8 h-8 text-xs flex items-center justify-center text-[var(--fg-main)] hover:bg-[var(--bg-subtle)] cursor-pointer"
          >
            🌏
          </button>
        </div>
        </>
        )}
      </div>

      {/* Map Legend & Toggleable Cyclist Pit-Stops Footer */}
      <div className="px-3 py-2 border-t border-[var(--border-card)] bg-[var(--bg-card)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--fg-muted)]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-[var(--fg-muted)] me-0.5">Pit-stops:</span>
          {PIT_STOP_TOGGLES.map((item) => {
            const active = activePitKinds.includes(item.kind);
            const count = active ? pitStops.filter((p) => p.kind === item.kind).length : 0;
            return (
              <button
                key={item.kind}
                id={`btn-pitstop-${item.kind}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePitKind(item.kind);
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors border ${
                  active
                    ? 'bg-[var(--accent-main)] text-[var(--accent-fg)] border-[var(--accent-main)]'
                    : 'bg-[var(--bg-page)] text-[var(--fg-main)] border-[var(--border-card)] hover:bg-[var(--bg-subtle)]'
                }`}
                title={`Show nearby ${item.label.toLowerCase()} along this route`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                {active && !loadingPitStops && count > 0 && (
                  <span className="font-mono tabular-nums opacity-90">{count}</span>
                )}
              </button>
            );
          })}
          {loadingPitStops && (
            <span className="text-[11px] text-[var(--fg-muted)]">loading…</span>
          )}
        </div>
        <span className="font-medium text-[var(--fg-main)]">{activeRoute.flatLabel}</span>
      </div>
    </div>
  );
}
