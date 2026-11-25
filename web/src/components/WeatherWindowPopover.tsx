'use client';

import React from 'react';

export interface HourlySlot {
  isoTime: string;
  hourLabel: string;
  tempC: number;
  windKmh: number;
  precipProb: number;
  score: number;
}

export interface LiveWeatherState {
  tempC: number;
  windKmh: number;
  windDeg: number;
  windLabel: string;
  sunsetLabel: string;
  minutesToSunset: number | null;
  bestWindowLabel: string;
  hourly: HourlySlot[];
}

interface WeatherWindowPopoverProps {
  locationName: string;
  weather: LiveWeatherState;
  estimatedRideMinutes: number;
  onClose: () => void;
}

function formatCountdown(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export default function WeatherWindowPopover({
  locationName,
  weather,
  estimatedRideMinutes,
  onClose,
}: WeatherWindowPopoverProps) {
  const needsLights =
    weather.minutesToSunset !== null &&
    (weather.minutesToSunset < 0 || estimatedRideMinutes + 20 >= weather.minutesToSunset);

  let bestScore = -1;
  for (const s of weather.hourly) {
    if (s.score > bestScore) bestScore = s.score;
  }

  return (
    <div
      id="weather-window-popover"
      role="dialog"
      aria-label="Best time to ride today"
      className="absolute end-0 top-full mt-2 w-[320px] sm:w-[370px] z-40 rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] shadow-xl p-3.5 space-y-3 text-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-[var(--fg-main)]">
            🌤️ Best Window to Ride · {locationName}
          </div>
          <div className="text-[var(--fg-muted)] mt-0.5">
            Peak slot: <span className="font-medium text-[var(--fg-main)]">{weather.bestWindowLabel}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] text-[var(--fg-muted)] hover:text-[var(--fg-main)] cursor-pointer"
          aria-label="Close weather forecast"
        >
          ✕
        </button>
      </div>

      {/* Sunset Countdown & Bike Lights Readiness Check */}
      <div
        className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 ${
          needsLights
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
        }`}
      >
        <div>
          <div className="font-semibold">
            {needsLights ? '🔦 Bring front & rear bike lights' : '☀️ Finishes in comfortable daylight'}
          </div>
          <div className="opacity-90">
            Sunset {weather.sunsetLabel}
            {weather.minutesToSunset !== null && weather.minutesToSunset > 0
              ? ` (in ${formatCountdown(weather.minutesToSunset)})`
              : ''}
          </div>
        </div>
        <span className="font-mono tabular-nums font-semibold shrink-0">
          ~{estimatedRideMinutes}m ride
        </span>
      </div>

      {/* Hourly Comfort Bar Strip */}
      {weather.hourly.length > 0 ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[var(--fg-muted)]">
            <span>Next {weather.hourly.length} hours (temp · wind · rain)</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">★ Best</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {weather.hourly.slice(0, 10).map((slot) => {
              const isBest = slot.score === bestScore;
              return (
                <div
                  key={slot.isoTime}
                  className={`p-1.5 rounded-xl border text-center space-y-1 ${
                    isBest
                      ? 'bg-[var(--bg-subtle)] border-[var(--accent-main)]'
                      : 'bg-[var(--bg-page)] border-[var(--border-card)]'
                  }`}
                >
                  <div className="font-medium text-[var(--fg-main)] leading-none">
                    {isBest ? '★ ' : ''}
                    {slot.hourLabel}
                  </div>
                  <div className="h-7 flex items-end justify-center">
                    <div
                      ref={(node) => {
                        if (node) {
                          node.style.height = `${Math.max(24, slot.score)}%`;
                        }
                      }}
                      className={`w-3 rounded-t-sm transition-all ${
                        isBest
                          ? 'bg-[var(--accent-main)]'
                          : slot.precipProb >= 45 || slot.windKmh >= 28
                            ? 'bg-amber-500/80'
                            : 'bg-sky-500/70'
                      }`}
                    />
                  </div>
                  <div className="font-mono tabular-nums text-[var(--fg-main)] leading-none">
                    {slot.tempC}°
                  </div>
                  <div className="font-mono tabular-nums text-[var(--fg-muted)] leading-none">
                    {slot.windKmh}k · {slot.precipProb}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-[var(--fg-muted)]">
          Live hourly breakdown unavailable right now — current conditions: {weather.tempC}°C ·{' '}
          {weather.windKmh} km/h {weather.windLabel}.
        </div>
      )}
    </div>
  );
}
