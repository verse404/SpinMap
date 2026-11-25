'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CityConfig } from '@/lib/cities';
import type { CyclingRoute } from '@/lib/routes-data';

interface RouteDesignerPanelProps {
  cityConfig: CityConfig;
  csrfToken: string;
  kmFormat: (km: number) => string;
  pickLocationMode: boolean;
  externalPickRequest: { coords: [number, number]; nonce: number; label?: string } | null;
  liveGpsTriggerNonce: number;
  designedSummary: { rationale: string; routeName: string; gmapsUrl: string } | null;
  onTogglePickLocationMode: () => void;
  onUserLocationChange: (coords: [number, number] | null) => void;
  onRouteDesigned: (payload: {
    route: CyclingRoute;
    rationale: string;
    startSuburbLabel: string;
    startCoords: [number, number];
  }) => void;
  onPreviewDesignedRoute: () => void;
}

const TERRAIN_OPTIONS = [
  { id: 'flat', icon: '🥞', label: 'Super Flat' },
  { id: 'balanced', icon: '🌿', label: 'Mix' },
  { id: 'hilly', icon: '⛰️', label: 'Hills' },
] as const;

const DISTANCE_KM_OPTIONS = [12, 22, 35, 50] as const;

const SHAPE_OPTIONS = [
  { id: 'loop', icon: '🔄', label: 'Loop Home' },
  { id: 'oneway', icon: '🚆', label: 'One-Way + Train' },
] as const;

export default function RouteDesignerPanel({
  cityConfig,
  csrfToken,
  kmFormat,
  pickLocationMode,
  externalPickRequest,
  liveGpsTriggerNonce,
  designedSummary,
  onTogglePickLocationMode,
  onUserLocationChange,
  onRouteDesigned,
  onPreviewDesignedRoute,
}: RouteDesignerPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [activeCsrf, setActiveCsrf] = useState<string>(csrfToken);
  const [address, setAddress] = useState<string>('');
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationSource, setLocationSource] = useState<'gps' | 'map' | null>(null);
  const [promptText, setPromptText] = useState<string>('');
  const [terrain, setTerrain] = useState<'flat' | 'balanced' | 'hilly'>('flat');
  const [targetKm, setTargetKm] = useState<number>(22);
  const [shape, setShape] = useState<'loop' | 'oneway'>('loop');
  const [mustHaves, setMustHaves] = useState<string[]>(['carFree', 'cafe']);
  const [variationIndex, setVariationIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [locating, setLocating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const lastPickNonceRef = useRef<number>(0);
  const lastGpsNonceRef = useRef<number>(0);

  const mustHaveOptions = [
    { id: 'carFree', icon: '🌳', label: 'Car-Free Trails' },
    { id: 'cafe', icon: '☕', label: 'Coffee Stop' },
    { id: 'water', icon: '🌊', label: 'Bay / River Views' },
    { id: 'tramFree', icon: '🚲', label: cityConfig.avoidChipLabel },
  ] as const;

  const toggleMustHave = (id: string) => {
    setVariationIndex(0);
    setMustHaves((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const requestRouteFromServer = useCallback(
    async (
      nextVariation: number,
      overrideCoords?: { lat: number; lng: number } | null,
      overrideAddress?: string
    ) => {
      const coordsToSend = overrideCoords !== undefined ? overrideCoords : selectedCoords;
      const addressToSend = (overrideAddress ?? address).trim();

      if (!coordsToSend && addressToSend.length < 2) {
        setErrorMsg(
          `Enter a ${cityConfig.name} address, tap "📍 My Location", or click "📌 Pick on Map" to choose where to ride from.`
        );
        setShowAdvanced(true);
        return;
      }

      setErrorMsg(null);
      setIsLoading(true);

      const postOnce = async (tokenToUse: string) => {
        return fetch('/api/v1/design-route', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': tokenToUse,
          },
          body: JSON.stringify({
            city: cityConfig.id,
            address: addressToSend || 'My Current Location',
            startCoords: coordsToSend ?? undefined,
            promptText,
            targetKm,
            terrain,
            shape,
            mustHaves,
            variationIndex: nextVariation,
          }),
        });
      };

      try {
        let response = await postOnce(activeCsrf);
        if (response.status === 403) {
          const refreshRes = await fetch('/api/v1/csrf');
          if (refreshRes.ok) {
            const refreshed = (await refreshRes.json()) as { csrfToken?: string };
            if (typeof refreshed.csrfToken === 'string') {
              setActiveCsrf(refreshed.csrfToken);
              response = await postOnce(refreshed.csrfToken);
            }
          }
        }

        const data = (await response.json()) as {
          route?: CyclingRoute;
          rationale?: string;
          startSuburbLabel?: string;
          startCoords?: [number, number];
          error?: string;
        };

        if (!response.ok || !data.route) {
          setErrorMsg(
            typeof data.error === 'string'
              ? data.error
              : `Could not design a route for that starting point. Try picking a spot on the map or entering a ${cityConfig.name} suburb.`
          );
          return;
        }

        const resolvedLabel = String(data.startSuburbLabel || cityConfig.name);
        const resolvedCoords: [number, number] =
          Array.isArray(data.startCoords) && data.startCoords.length === 2
            ? data.startCoords
            : coordsToSend
              ? [coordsToSend.lng, coordsToSend.lat]
              : cityConfig.center;

        if (coordsToSend) {
          setAddress(resolvedLabel);
          onUserLocationChange(resolvedCoords);
        }

        setVariationIndex(nextVariation);
        setShowAdvanced(false);
        onRouteDesigned({
          route: data.route,
          rationale: String(data.rationale || ''),
          startSuburbLabel: resolvedLabel,
          startCoords: resolvedCoords,
        });
      } catch {
        setErrorMsg('Network error while designing your route. Please check your connection and try again.');
      } finally {
        setIsLoading(false);
      }
    },
    [
      activeCsrf,
      address,
      cityConfig.center,
      cityConfig.id,
      cityConfig.name,
      mustHaves,
      onRouteDesigned,
      onUserLocationChange,
      promptText,
      selectedCoords,
      shape,
      targetKm,
      terrain,
    ]
  );

  const handleUseMyLocationAndDesign = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setErrorMsg(
        'Browser GPS is unavailable here — click "📌 Pick on Map" to tap your starting spot directly!'
      );
      return;
    }
    setLocating(true);
    setErrorMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setSelectedCoords(coords);
        setLocationSource('gps');
        setAddress('My Current Location');
        setVariationIndex(0);
        onUserLocationChange([coords.lng, coords.lat]);
        void requestRouteFromServer(0, coords, 'My Current Location');
      },
      () => {
        setLocating(false);
        setErrorMsg(
          'Location access was blocked or timed out — tap "📌 Pick on Map" to click your exact starting point, or type a suburb.'
        );
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
    );
  }, [onUserLocationChange, requestRouteFromServer]);

  // Trigger automatic route design whenever the user clicks a spot on the map or jumps to a global city
  useEffect(() => {
    if (!externalPickRequest || externalPickRequest.nonce === lastPickNonceRef.current) return;
    lastPickNonceRef.current = externalPickRequest.nonce;
    const [lng, lat] = externalPickRequest.coords;
    const coords = { lat, lng };
    const startLabel = externalPickRequest.label || 'Pinned Map Location';
    setSelectedCoords(coords);
    setLocationSource('map');
    setAddress(startLabel);
    setVariationIndex(0);
    onUserLocationChange([lng, lat]);
    void requestRouteFromServer(0, coords, startLabel);
  }, [externalPickRequest, onUserLocationChange, requestRouteFromServer]);

  // Trigger live GPS + auto-design when user taps the ◎ GPS button on the MapLibre control stack
  useEffect(() => {
    if (!liveGpsTriggerNonce || liveGpsTriggerNonce === lastGpsNonceRef.current) return;
    lastGpsNonceRef.current = liveGpsTriggerNonce;
    handleUseMyLocationAndDesign();
  }, [handleUseMyLocationAndDesign, liveGpsTriggerNonce]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await requestRouteFromServer(0);
  };

  return (
    <section
      id="custom-route-designer"
      aria-label={`Custom ${cityConfig.name} route designer`}
      className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] shadow-sm overflow-hidden select-text"
    >
      <form onSubmit={handleSubmit} className="p-3 sm:px-4 space-y-2.5">
        {/* Compact Hero Row: Current Location Controls + Address + Preferences + Primary CTA */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center">
          <div className="lg:col-span-5 flex flex-wrap sm:flex-nowrap items-center gap-1.5">
            <button
              id="btn-use-my-location"
              type="button"
              onClick={handleUseMyLocationAndDesign}
              disabled={locating || isLoading}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-xs disabled:opacity-60 whitespace-nowrap ${
                locationSource === 'gps' && selectedCoords
                  ? 'bg-blue-600 text-white'
                  : 'bg-blue-600/10 text-blue-700 dark:text-blue-300 border border-blue-500/30 hover:bg-blue-600/15'
              }`}
              title="Detect your live GPS location and immediately design a cycling route from where you are"
            >
              <span>📍</span>
              <span>{locating ? 'Locating…' : 'My Location'}</span>
            </button>

            <button
              id="btn-pick-on-map"
              type="button"
              onClick={onTogglePickLocationMode}
              disabled={isLoading}
              className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-medium cursor-pointer transition-all whitespace-nowrap ${
                pickLocationMode
                  ? 'bg-blue-600 text-white shadow-sm'
                  : locationSource === 'map' && selectedCoords
                    ? 'bg-[var(--bg-subtle)] text-[var(--fg-main)] border border-blue-500'
                    : 'bg-[var(--bg-subtle)] text-[var(--fg-main)] border border-[var(--border-card)] hover:border-[var(--accent-main)]'
              }`}
              title="Click directly on the map to select your starting location"
            >
              <span>📌</span>
              <span>{pickLocationMode ? 'Picking…' : 'Pick on Map'}</span>
            </button>

            <div className="relative flex-1 min-w-[160px] flex items-center">
              <label htmlFor="input-start-address" className="sr-only">
                Your starting address or suburb
              </label>
              <input
                id="input-start-address"
                name="address"
                type="text"
                maxLength={140}
                autoComplete="street-address"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setSelectedCoords(null);
                  setLocationSource(null);
                  onUserLocationChange(null);
                  setVariationIndex(0);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder={cityConfig.addressPlaceholder}
                className="w-full ps-3 pe-7 py-2 rounded-xl text-xs sm:text-sm bg-[var(--bg-page)] border border-[var(--border-card)] text-[var(--fg-main)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:border-[var(--accent-main)]"
              />
              {selectedCoords && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCoords(null);
                    setLocationSource(null);
                    setAddress('');
                    onUserLocationChange(null);
                  }}
                  className="absolute end-2 text-xs text-[var(--fg-muted)] hover:text-[var(--fg-main)] cursor-pointer"
                  title="Clear selected GPS pin"
                  aria-label="Clear selected location"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-4">
            <label htmlFor="input-ride-preferences" className="sr-only">
              Route requirements and preferences
            </label>
            <input
              id="input-ride-preferences"
              name="promptText"
              type="text"
              maxLength={280}
              value={promptText}
              onChange={(e) => {
                setPromptText(e.target.value);
                setVariationIndex(0);
              }}
              placeholder={cityConfig.preferencesPlaceholder}
              className="w-full px-3 py-2 rounded-xl text-xs sm:text-sm bg-[var(--bg-page)] border border-[var(--border-card)] text-[var(--fg-main)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:border-[var(--accent-main)]"
            />
          </div>

          <div className="lg:col-span-3 flex items-center justify-end gap-2">
            <button
              id="btn-toggle-designer"
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="px-3 py-2 rounded-xl text-xs font-medium bg-[var(--bg-subtle)] text-[var(--fg-main)] hover:opacity-90 cursor-pointer transition-opacity whitespace-nowrap"
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? '▴ Less' : '⚙️ Tune'}
            </button>

            <button
              id="btn-design-route"
              type="submit"
              disabled={isLoading || locating}
              className="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[var(--accent-main)] text-[var(--accent-fg)] shadow-sm hover:opacity-95 active:scale-98 disabled:opacity-60 cursor-pointer transition-all whitespace-nowrap"
            >
              <span>{isLoading ? '🧭' : '✨'}</span>
              <span>{isLoading ? 'Designing...' : 'Design Route'}</span>
            </button>
          </div>
        </div>

        {/* Single-Line Quick Tuning Strip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            {TERRAIN_OPTIONS.map((opt) => {
              const active = terrain === opt.id;
              return (
                <button
                  key={opt.id}
                  id={`pref-terrain-${opt.id}`}
                  type="button"
                  onClick={() => {
                    setTerrain(opt.id);
                    setVariationIndex(0);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium cursor-pointer transition-all ${
                    active
                      ? 'bg-[var(--accent-main)] text-[var(--accent-fg)]'
                      : 'bg-[var(--bg-subtle)] text-[var(--fg-main)] hover:opacity-90'
                  }`}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <span className="hidden sm:inline text-[var(--border-card)]">|</span>

          <div className="flex flex-wrap items-center gap-1">
            {DISTANCE_KM_OPTIONS.map((km) => {
              const active = targetKm === km;
              return (
                <button
                  key={km}
                  id={`pref-dist-${km}`}
                  type="button"
                  onClick={() => {
                    setTargetKm(km);
                    setVariationIndex(0);
                  }}
                  className={`px-2 py-1 rounded-full font-mono tabular-nums font-medium cursor-pointer transition-all ${
                    active
                      ? 'bg-[var(--accent-main)] text-[var(--accent-fg)]'
                      : 'bg-[var(--bg-subtle)] text-[var(--fg-main)] hover:opacity-90'
                  }`}
                >
                  {kmFormat(km)}
                </button>
              );
            })}
          </div>

          <span className="hidden sm:inline text-[var(--border-card)]">|</span>

          <div className="flex flex-wrap items-center gap-1">
            {SHAPE_OPTIONS.map((opt) => {
              const active = shape === opt.id;
              return (
                <button
                  key={opt.id}
                  id={`pref-shape-${opt.id}`}
                  type="button"
                  onClick={() => {
                    setShape(opt.id);
                    setVariationIndex(0);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium cursor-pointer transition-all ${
                    active
                      ? 'bg-[var(--accent-main)] text-[var(--accent-fg)]'
                      : 'bg-[var(--bg-subtle)] text-[var(--fg-main)] hover:opacity-90'
                  }`}
                >
                  <span>{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Expandable Suburb Quick-Starts & Must-Have Filters Drawer */}
        {showAdvanced && (
          <div className="pt-2.5 border-t border-[var(--border-card)] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--fg-muted)] font-medium">Suburbs:</span>
              {cityConfig.sampleSuburbs.map((suburb) => (
                <button
                  key={suburb}
                  type="button"
                  onClick={() => {
                    setAddress(suburb);
                    setSelectedCoords(null);
                    setLocationSource(null);
                    onUserLocationChange(null);
                    setVariationIndex(0);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  className={`px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                    !selectedCoords && address.toLowerCase() === suburb.toLowerCase()
                      ? 'bg-[var(--accent-main)] text-[var(--accent-fg)] font-medium'
                      : 'bg-[var(--bg-page)] border border-[var(--border-card)] text-[var(--fg-main)] hover:bg-[var(--bg-subtle)]'
                  }`}
                >
                  {suburb}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--fg-muted)] font-medium">Must-haves:</span>
              {mustHaveOptions.map((opt) => {
                const active = mustHaves.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    id={`pref-must-${opt.id}`}
                    type="button"
                    onClick={() => toggleMustHave(opt.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium cursor-pointer transition-all ${
                      active
                        ? 'bg-[var(--bg-subtle)] text-[var(--fg-main)] border border-[var(--accent-main)]'
                        : 'bg-[var(--bg-page)] text-[var(--fg-muted)] border border-[var(--border-card)] hover:text-[var(--fg-main)]'
                    }`}
                  >
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {errorMsg && (
          <div
            id="designer-error-banner"
            role="alert"
            className="px-3.5 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-700 dark:text-red-300"
          >
            {errorMsg}
          </div>
        )}
      </form>

      {/* Tailored Route Ready Summary Bar */}
      {designedSummary && (
        <div
          id="designed-route-banner"
          className="px-4 py-2 bg-[var(--bg-subtle)] border-t border-[var(--border-card)] flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="px-2 py-0.5 rounded-full bg-[var(--accent-main)] text-[var(--accent-fg)] font-semibold shrink-0">
              {locationSource === 'gps'
                ? `📍 GPS Option #${variationIndex + 1}`
                : locationSource === 'map'
                  ? `📌 Map Pin #${variationIndex + 1}`
                  : `✨ Option #${variationIndex + 1}`}
            </span>
            <span className="font-semibold text-[var(--fg-main)]">{designedSummary.routeName}</span>
            <span className="text-[var(--fg-muted)] hidden md:inline">· {designedSummary.rationale}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              id="btn-try-another-route"
              type="button"
              disabled={isLoading}
              onClick={() => void requestRouteFromServer(variationIndex + 1)}
              className="px-3 py-1 rounded-full bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--fg-main)] font-medium cursor-pointer hover:border-[var(--accent-main)] disabled:opacity-60"
              title="Generate an alternative scenic route from this exact starting location"
            >
              🔀 Another Route
            </button>
            <button
              type="button"
              onClick={onPreviewDesignedRoute}
              className="px-3 py-1 rounded-full bg-[var(--bg-card)] border border-[var(--accent-main)] text-[var(--fg-main)] font-medium cursor-pointer hover:bg-[var(--bg-page)]"
            >
              ▶ Preview
            </button>
            <a
              href={designedSummary.gmapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 rounded-full bg-[#1a73e8] text-white font-semibold cursor-pointer hover:opacity-95"
            >
              🧭 Google Maps ↗
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
