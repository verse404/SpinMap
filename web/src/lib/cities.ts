export type BuiltInCityId = 'melbourne' | 'sydney';
export type CityId = string;

export interface CityConfig {
  id: CityId;
  name: string;
  regionLabel: string;
  href: string;
  center: [number, number];
  overviewBounds: [[number, number], [number, number]];
  geoBounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  addressPlaceholder: string;
  preferencesPlaceholder: string;
  sampleSuburbs: readonly string[];
  avoidChipLabel: string;
  windShelterTip: string;
  defaultWindLabel: string;
  svgWaterPolygon: readonly [number, number][];
}

export const CITY_CONFIGS: Record<BuiltInCityId, CityConfig> = {
  melbourne: {
    id: 'melbourne',
    name: 'Melbourne',
    regionLabel: 'Greater Melbourne',
    href: '/',
    center: [144.968, -37.845],
    overviewBounds: [
      [144.86, -38.03],
      [145.36, -37.72],
    ],
    geoBounds: { minLng: 144.3, maxLng: 145.75, minLat: -38.55, maxLat: -37.4 },
    addressPlaceholder: '📍 Start address or suburb (e.g. Hawthorn)',
    preferencesPlaceholder: '💬 Preferences (e.g. "flat river loop, coffee stop, no trams")',
    sampleSuburbs: [
      'Melbourne CBD',
      'St Kilda',
      'Fitzroy',
      'Hawthorn',
      'Box Hill',
      'Footscray',
      'Ringwood',
      'Frankston',
    ],
    avoidChipLabel: 'Avoid Trams',
    windShelterTip: 'Creek trails sheltered',
    defaultWindLabel: 'Bay Breeze ↗',
    svgWaterPolygon: [
      [144.82, -37.86],
      [144.91, -37.86],
      [144.94, -37.842],
      [144.975, -37.865],
      [144.992, -37.925],
      [145.015, -37.975],
      [145.09, -38.02],
      [144.82, -38.02],
    ],
  },
  sydney: {
    id: 'sydney',
    name: 'Sydney',
    regionLabel: 'Greater Sydney',
    href: '/sydney',
    center: [151.195, -33.868],
    overviewBounds: [
      [151.04, -34.02],
      [151.33, -33.63],
    ],
    geoBounds: { minLng: 150.55, maxLng: 151.45, minLat: -34.25, maxLat: -33.4 },
    addressPlaceholder: '📍 Start address or suburb (e.g. Surry Hills or Manly)',
    preferencesPlaceholder: '💬 Preferences (e.g. "super flat bay loop, harbour cafe, car-free")',
    sampleSuburbs: [
      'Sydney CBD',
      'Surry Hills',
      'Bondi',
      'Marrickville',
      'Balmain',
      'Manly',
      'Olympic Park',
      'Parramatta',
    ],
    avoidChipLabel: 'Quiet Bikeways',
    windShelterTip: 'Park & lagoon paths sheltered',
    defaultWindLabel: 'Harbour Breeze ↗',
    svgWaterPolygon: [
      [151.28, -33.83],
      [151.23, -33.855],
      [151.2, -33.855],
      [151.16, -33.855],
      [151.12, -33.835],
      [151.2, -33.825],
      [151.28, -33.79],
      [151.35, -33.79],
      [151.35, -34.05],
      [151.16, -34.01],
      [151.16, -33.95],
      [151.25, -33.92],
      [151.28, -33.88],
    ],
  },
};

export const CITY_LIST: readonly CityConfig[] = [CITY_CONFIGS.melbourne, CITY_CONFIGS.sydney];

export function buildGlobalCityConfig(resolved: {
  id: string;
  name: string;
  regionLabel: string;
  center: [number, number];
  overviewBounds: [[number, number], [number, number]];
  geoBounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
}): CityConfig {
  return {
    id: resolved.id,
    name: resolved.name,
    regionLabel: resolved.regionLabel,
    href: '/',
    center: resolved.center,
    overviewBounds: resolved.overviewBounds,
    geoBounds: resolved.geoBounds,
    addressPlaceholder: `📍 Start spot in ${resolved.name} or tap Pick on Map`,
    preferencesPlaceholder: `💬 Preferences (e.g. "flat scenic loop, coffee stop, bike paths")`,
    sampleSuburbs: [resolved.name],
    avoidChipLabel: 'Quiet Bikeways',
    windShelterTip: 'Park & river paths sheltered',
    defaultWindLabel: 'Local Breeze ↗',
    svgWaterPolygon: [],
  };
}
