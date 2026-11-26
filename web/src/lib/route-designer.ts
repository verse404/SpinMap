import type { CyclingRoute, RouteLandmark } from '@/lib/routes-data';
import {
  SYDNEY_SCENIC_ANCHORS,
  SYDNEY_SUBURB_FALLBACKS,
} from '@/lib/sydney-anchors';
import { isWithinCityBounds, maskStreetNumber } from '@/lib/security';

export interface RouteDesignRequest {
  city?: 'melbourne' | 'sydney';
  address: string;
  startCoords?: { lat: number; lng: number };
  promptText: string;
  targetKm: number;
  terrain: 'flat' | 'balanced' | 'hilly';
  shape: 'loop' | 'oneway';
  mustHaves: string[];
  variationIndex?: number;
}

export interface RouteDesignResult {
  route: CyclingRoute;
  rationale: string;
  startSuburbLabel: string;
  startCoords: [number, number];
}

interface ScenicAnchor {
  id: string;
  name: string;
  icon: string;
  lngLat: [number, number];
  terrain: 'flat' | 'rolling' | 'hilly';
  carFree: boolean;
  hasCafe: boolean;
  hasWater: boolean;
  tramSafe: boolean;
  hasTrain: boolean;
  isGravel: boolean;
  photoUrl: string;
  note: string;
}

// 24 Authentic Greater Melbourne Cycling Gems for intelligent route composition
const SCENIC_ANCHORS: readonly ScenicAnchor[] = [
  {
    id: 'albert-swans',
    name: 'Albert Park Black Swan Lagoon',
    icon: '🦢',
    lngLat: [144.9718, -37.8465],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: false,
    isGravel: false,
    photoUrl: '/images/albert.jpg',
    note: 'Pancake-flat palm promenade with mirror CBD skyline reflections',
  },
  {
    id: 'port-melb-pier',
    name: 'Port Melbourne Lagoon & Foreshore',
    icon: '🌊',
    lngLat: [144.9435, -37.8432],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: false,
    isGravel: false,
    photoUrl: '/images/bay.jpg',
    note: 'Wide sea-level coastal shared path along Port Phillip Bay',
  },
  {
    id: 'stkilda-pier',
    name: 'St Kilda Pier & Foreshore Path',
    icon: '📸',
    lngLat: [144.9735, -37.8645],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: false,
    isGravel: false,
    photoUrl: '/images/bay.jpg',
    note: 'Car-free bayside boardwalk with penguin breakwater views',
  },
  {
    id: 'brighton-boxes',
    name: 'Brighton Bathing Boxes',
    icon: '📸',
    lngLat: [144.9869, -37.9182],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/bay.jpg',
    note: 'Iconic painted beach huts near Brighton Beach train station',
  },
  {
    id: 'half-moon-bay',
    name: 'Half Moon Bay Red Cliffs',
    icon: '☕',
    lngLat: [145.0098, -37.9698],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/cafe.jpg',
    note: 'Sheltered sandy cove & Sandringham train line access',
  },
  {
    id: 'mordialloc-creek',
    name: 'Mordialloc Creek & Beach',
    icon: '🚆',
    lngLat: [145.0865, -38.0068],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/bay.jpg',
    note: 'Flat coastal finish with direct Frankston line train home',
  },
  {
    id: 'williamstown-strand',
    name: 'Williamstown Strand & Gem Pier',
    icon: '🌊',
    lngLat: [144.9045, -37.8615],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/bay.jpg',
    note: 'Dead-flat western foreshore with panoramic CBD across the bay',
  },
  {
    id: 'maribyrnong-boathouse',
    name: 'Maribyrnong River Boathouse',
    icon: '☕',
    lngLat: [144.8965, -37.7775],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/cafe.jpg',
    note: 'Peaceful riverfront tea house along the car-free Maribyrnong Trail',
  },
  {
    id: 'docklands-promenade',
    name: 'Docklands Victoria Harbour',
    icon: '🌊',
    lngLat: [144.9428, -37.8182],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/albert.jpg',
    note: 'Smooth waterfront promenade linking Capital City & Moonee Ponds trails',
  },
  {
    id: 'royal-park-grasslands',
    name: 'Royal Park Native Grasslands',
    icon: '🌿',
    lngLat: [144.9515, -37.7848],
    terrain: 'rolling',
    carFree: true,
    hasCafe: false,
    hasWater: false,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/yarra.jpg',
    note: 'Car-free bushland loop with sweeping city skyline views',
  },
  {
    id: 'canning-greenway',
    name: 'Canning St Leafy Greenway (Carlton)',
    icon: '☕',
    lngLat: [144.9742, -37.7885],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: false,
    tramSafe: true,
    hasTrain: false,
    isGravel: false,
    photoUrl: '/images/greenway.jpg',
    note: 'Melbourne’s favourite plane-tree bike boulevard & terrace cafes',
  },
  {
    id: 'ceres-merri-creek',
    name: 'CERES Eco-Park & Merri Creek Trail',
    icon: '☕',
    lngLat: [144.9832, -37.7658],
    terrain: 'rolling',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/yarra.jpg',
    note: 'Organic garden cafe tucked along the car-free Merri Creek valley',
  },
  {
    id: 'abbotsford-convent',
    name: 'Abbotsford Convent & Dights Falls',
    icon: '☕',
    lngLat: [145.0048, -37.8018],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/cafe.jpg',
    note: 'Historic riverside bakery courtyard beside Yarra rapids',
  },
  {
    id: 'studley-boathouse',
    name: 'Studley Park Boathouse & Boulie Ridge',
    icon: '📸',
    lngLat: [145.0115, -37.7975],
    terrain: 'hilly',
    carFree: false,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: false,
    isGravel: false,
    photoUrl: '/images/boulie.jpg',
    note: 'Rolling bushland ridge road above misty Yarra bends',
  },
  {
    id: 'fairfield-boathouse',
    name: 'Fairfield Park Boathouse',
    icon: '☕',
    lngLat: [145.0155, -37.7875],
    terrain: 'rolling',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/cafe.jpg',
    note: 'Sunny timber deck over the Yarra along the Main Yarra Trail',
  },
  {
    id: 'heide-meadow',
    name: 'Heide Sculpture Park & Yarra Flats',
    icon: '🎨',
    lngLat: [145.0848, -37.7592],
    terrain: 'rolling',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: true,
    photoUrl: '/images/gravel.jpg',
    note: 'Sculpture lawns & fine gravel gumtree trails near Heidelberg',
  },
  {
    id: 'westerfolds-kangaroos',
    name: 'Westerfolds Kangaroo Parklands',
    icon: '🦘',
    lngLat: [145.1325, -37.7465],
    terrain: 'rolling',
    carFree: true,
    hasCafe: false,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: true,
    photoUrl: '/images/gravel.jpg',
    note: '100% car-free eucalyptus bushland with grazing kangaroos',
  },
  {
    id: 'herring-botanic',
    name: 'Botanic Gardens & Herring Island Trail',
    icon: '🌿',
    lngLat: [144.9945, -37.8305],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/yarra.jpg',
    note: 'Flat riverside shared path linking Southbank to Burnley',
  },
  {
    id: 'gardiners-kooyong',
    name: 'Gardiners Creek Trail (Kooyong / Glen Iris)',
    icon: '🌳',
    lngLat: [145.0495, -37.8525],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/yarra.jpg',
    note: 'Smooth creek-side parkland spine parallel to Glen Waverley train line',
  },
  {
    id: 'gardiners-boxhill',
    name: 'Gardiners Creek & Box Hill Bushland',
    icon: '🌿',
    lngLat: [145.1185, -37.8345],
    terrain: 'rolling',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/yarra.jpg',
    note: 'Leafy eastern creek corridor linking Deakin & Box Hill',
  },
  {
    id: 'djerring-caulfield',
    name: 'Djerring Skyrail Greenway (Caulfield–Carnegie)',
    icon: '🚆',
    lngLat: [145.0545, -37.8845],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: false,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/greenway.jpg',
    note: 'Rail-grade flat linear park path with zero road traffic',
  },
  {
    id: 'djerring-clayton',
    name: 'Djerring Trail Oakleigh–Clayton Spine',
    icon: '🌳',
    lngLat: [145.1125, -37.9165],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: false,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/greenway.jpg',
    note: 'Wide separated commuter & leisure path alongside Cranbourne/Pakenham stations',
  },
  {
    id: 'jells-park-lake',
    name: 'Jells Park Lake & Dandenong Creek Trail',
    icon: '🦢',
    lngLat: [145.1925, -37.8965],
    terrain: 'rolling',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: false,
    isGravel: true,
    photoUrl: '/images/gravel.jpg',
    note: 'Expansive lakeside cafe & car-free Dandenong Creek bushland paths',
  },
  {
    id: 'dandenongs-sassafras',
    name: 'Dandenongs 1-in-20 Mountain Ash Climb',
    icon: '⛰️',
    lngLat: [145.3445, -37.8625],
    terrain: 'hilly',
    carFree: false,
    hasCafe: true,
    hasWater: false,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/dandenongs.jpg',
    note: 'Iconic steady 4% climb through misty tree-fern gullies to Sassafras',
  },
  {
    id: 'altona-coastal',
    name: 'Altona Beach & Hobsons Bay Coastal Trail',
    icon: '🌊',
    lngLat: [144.8295, -37.8712],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/bay.jpg',
    note: 'Pancake-flat western coastal trail past Truganina wetlands & Altona Pier',
  },
  {
    id: 'frankston-foreshore',
    name: 'Frankston Pier & Bayside Boardwalk',
    icon: '🌊',
    lngLat: [145.1185, -38.1442],
    terrain: 'flat',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/bay.jpg',
    note: 'Southern bayside foreshore promenade with direct Frankston line train',
  },
  {
    id: 'ringwood-eastlink',
    name: 'Mullum Mullum & EastLink Creek Trail',
    icon: '🌳',
    lngLat: [145.2225, -37.8135],
    terrain: 'rolling',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: false,
    photoUrl: '/images/yarra.jpg',
    note: '100% separated bushland greenway connecting Ringwood to Yarra trails',
  },
  {
    id: 'lilydale-warburton',
    name: 'Lilydale to Warburton Rail Trail',
    icon: '🌿',
    lngLat: [145.3475, -37.7565],
    terrain: 'rolling',
    carFree: true,
    hasCafe: true,
    hasWater: false,
    tramSafe: true,
    hasTrain: true,
    isGravel: true,
    photoUrl: '/images/gravel.jpg',
    note: 'Scenic crushed-granite Yarra Valley rail trail starting at Lilydale Station',
  },
  {
    id: 'darebin-bundoora',
    name: 'Darebin Creek Parklands & Bundoora',
    icon: '🦘',
    lngLat: [145.0525, -37.7215],
    terrain: 'rolling',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: false,
    isGravel: true,
    photoUrl: '/images/gravel.jpg',
    note: 'Quiet northern creek corridor linking Alphington to Darebin wetlands',
  },
  {
    id: 'eltham-diamond-creek',
    name: 'Eltham Trestle & Diamond Creek Trail',
    icon: '🚆',
    lngLat: [145.1495, -37.7365],
    terrain: 'rolling',
    carFree: true,
    hasCafe: true,
    hasWater: true,
    tramSafe: true,
    hasTrain: true,
    isGravel: true,
    photoUrl: '/images/yarra.jpg',
    note: 'Heritage timber trestle bridge & gumtree trails on the Hurstbridge line',
  },
];

// Instant local Melbourne suburb dictionary fallback (59 Greater Melbourne suburbs & hubs)
const SUBURB_FALLBACKS: Record<string, { lngLat: [number, number]; label: string }> = {
  melbourne: { lngLat: [144.9631, -37.8136], label: 'Melbourne CBD' },
  cbd: { lngLat: [144.9631, -37.8136], label: 'Melbourne CBD' },
  'flinders street': { lngLat: [144.9671, -37.8183], label: 'Flinders St, Melbourne' },
  'southern cross': { lngLat: [144.9525, -37.8183], label: 'Southern Cross, Melbourne' },
  'melbourne central': { lngLat: [144.9628, -37.8102], label: 'Melbourne Central' },
  southbank: { lngLat: [144.9642, -37.8228], label: 'Southbank' },
  docklands: { lngLat: [144.9462, -37.8185], label: 'Docklands' },
  carlton: { lngLat: [144.9692, -37.7968], label: 'Carlton' },
  fitzroy: { lngLat: [144.9785, -37.7985], label: 'Fitzroy' },
  collingwood: { lngLat: [144.9885, -37.8015], label: 'Collingwood' },
  brunswick: { lngLat: [144.9615, -37.7665], label: 'Brunswick' },
  northcote: { lngLat: [144.9985, -37.7705], label: 'Northcote' },
  preston: { lngLat: [145.0045, -37.7415], label: 'Preston' },
  reservoir: { lngLat: [145.0065, -37.7165], label: 'Reservoir' },
  richmond: { lngLat: [144.9985, -37.8185], label: 'Richmond' },
  'south yarra': { lngLat: [144.9915, -37.8385], label: 'South Yarra' },
  toorak: { lngLat: [145.0145, -37.8415], label: 'Toorak' },
  prahran: { lngLat: [144.9935, -37.8515], label: 'Prahran' },
  malvern: { lngLat: [145.0345, -37.8585], label: 'Malvern' },
  'st kilda': { lngLat: [144.9801, -37.8689], label: 'St Kilda' },
  'port melbourne': { lngLat: [144.9422, -37.8398], label: 'Port Melbourne' },
  'south melbourne': { lngLat: [144.9595, -37.8325], label: 'South Melbourne' },
  'albert park': { lngLat: [144.9565, -37.8445], label: 'Albert Park' },
  brighton: { lngLat: [144.9965, -37.9085], label: 'Brighton' },
  bentleigh: { lngLat: [145.0365, -37.9185], label: 'Bentleigh' },
  sandringham: { lngLat: [145.0045, -37.9515], label: 'Sandringham' },
  cheltenham: { lngLat: [145.0545, -37.9675], label: 'Cheltenham' },
  mentone: { lngLat: [145.0645, -37.9815], label: 'Mentone' },
  mordialloc: { lngLat: [145.0865, -38.0068], label: 'Mordialloc' },
  frankston: { lngLat: [145.1225, -38.1415], label: 'Frankston' },
  kew: { lngLat: [145.0345, -37.8075], label: 'Kew' },
  hawthorn: { lngLat: [145.0337, -37.8245], label: 'Hawthorn' },
  camberwell: { lngLat: [145.0585, -37.8315], label: 'Camberwell' },
  balwyn: { lngLat: [145.0845, -37.8115], label: 'Balwyn' },
  'glen iris': { lngLat: [145.0585, -37.8585], label: 'Glen Iris' },
  'box hill': { lngLat: [145.1261, -37.8215], label: 'Box Hill' },
  ringwood: { lngLat: [145.2295, -37.8155], label: 'Ringwood' },
  lilydale: { lngLat: [145.3475, -37.7565], label: 'Lilydale' },
  ivanhoe: { lngLat: [145.0435, -37.7695], label: 'Ivanhoe' },
  heidelberg: { lngLat: [145.0645, -37.7575], label: 'Heidelberg' },
  eltham: { lngLat: [145.1495, -37.7165], label: 'Eltham' },
  doncaster: { lngLat: [145.1255, -37.7845], label: 'Doncaster' },
  caulfield: { lngLat: [145.0422, -37.8772], label: 'Caulfield' },
  carnegie: { lngLat: [145.0575, -37.8885], label: 'Carnegie' },
  oakleigh: { lngLat: [145.0885, -37.8995], label: 'Oakleigh' },
  clayton: { lngLat: [145.1205, -37.9245], label: 'Clayton' },
  'glen waverley': { lngLat: [145.1645, -37.8795], label: 'Glen Waverley' },
  footscray: { lngLat: [144.9005, -37.7995], label: 'Footscray' },
  seddon: { lngLat: [144.8925, -37.8065], label: 'Seddon' },
  yarraville: { lngLat: [144.8905, -37.8165], label: 'Yarraville' },
  newport: { lngLat: [144.8835, -37.8445], label: 'Newport' },
  williamstown: { lngLat: [144.8995, -37.8615], label: 'Williamstown' },
  altona: { lngLat: [144.8295, -37.8685], label: 'Altona' },
  werribee: { lngLat: [144.6615, -37.9015], label: 'Werribee' },
  'moonee ponds': { lngLat: [144.9195, -37.7655], label: 'Moonee Ponds' },
  maribyrnong: { lngLat: [144.8895, -37.7745], label: 'Maribyrnong' },
  essendon: { lngLat: [144.9155, -37.7525], label: 'Essendon' },
  coburg: { lngLat: [144.9665, -37.7425], label: 'Coburg' },
};

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDeg(from: [number, number], to: [number, number]): number {
  const dx = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
  const dy = to[1] - from[1];
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

async function geocodeCityAddress(
  city: 'melbourne' | 'sydney',
  address: string
): Promise<{ lngLat: [number, number]; label: string }> {
  const fallbacks = city === 'sydney' ? SYDNEY_SUBURB_FALLBACKS : SUBURB_FALLBACKS;
  const cityTitle = city === 'sydney' ? 'Sydney' : 'Melbourne';
  const stateName = city === 'sydney' ? 'New South Wales' : 'Victoria';
  const stateShort = city === 'sydney' ? 'nsw' : 'vic';
  const viewbox =
    city === 'sydney'
      ? '150.60,-33.42,151.40,-34.22'
      : '144.40,-37.45,145.65,-38.48';

  const lower = address.toLowerCase().trim();
  if (fallbacks[lower]) {
    return fallbacks[lower];
  }

  // Support "Near My Location (-33.8688, 151.2093)" or Melbourne GPS coordinates
  const coordMatch = address.match(/(-3\d\.\d+)\s*,\s*(1[45]\d\.\d+)/);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lng = Number(coordMatch[2]);
    if (isWithinCityBounds(city, lng, lat)) {
      let nearestLabel = 'Your Location';
      let nearestDist = Infinity;
      for (const entry of Object.values(fallbacks)) {
        const d = haversineKm([lng, lat], entry.lngLat);
        if (d < nearestDist) {
          nearestDist = d;
          nearestLabel = entry.label;
        }
      }
      return { lngLat: [lng, lat], label: `Near ${nearestLabel}` };
    }
  }

  try {
    const query =
      lower.includes(stateShort) || lower.includes('australia')
        ? address
        : `${address}, ${cityTitle}, ${stateName}, Australia`;
    const params = new URLSearchParams({
      format: 'jsonv2',
      limit: '5',
      countrycodes: 'au',
      viewbox,
      bounded: '1',
      q: query,
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'User-Agent': 'SpinMap/1.0 (Visual Cycling Route Explorer)' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const items = (await res.json()) as Array<{
        lat?: string;
        lon?: string;
        display_name?: string;
        importance?: number;
      }>;
      const valid = items
        .map((it) => ({
          lng: Number(it.lon),
          lat: Number(it.lat),
          name: String(it.display_name || ''),
          imp: Number(it.importance || 0),
        }))
        .filter((it) => isWithinCityBounds(city, it.lng, it.lat))
        .sort((a, b) => b.imp - a.imp);

      if (valid.length > 0) {
        const top = valid[0];
        const parts = top.name
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const cleanParts = maskStreetNumber(parts.slice(0, 2).join(', '));
        return {
          lngLat: [top.lng, top.lat],
          label: cleanParts || `${cityTitle} Start`,
        };
      }
    }
  } catch {
    // Fall through to partial suburb lookup
  }

  for (const [key, entry] of Object.entries(fallbacks)) {
    if (lower.includes(key)) {
      return entry;
    }
  }

  throw new Error(
    city === 'sydney'
      ? 'Could not locate that address inside Greater Sydney. Try adding the suburb name (e.g. "Bourke St, Surry Hills" or "Manly").'
      : 'Could not locate that address inside Greater Melbourne. Try adding the suburb name (e.g. "Chapel St, South Yarra" or "Box Hill").'
  );
}

function parsePromptOverrides(req: RouteDesignRequest): RouteDesignRequest {
  const txt = req.promptText.toLowerCase();
  let terrain = req.terrain;
  let shape = req.shape;
  let targetKm = req.targetKm;
  const mustSet = new Set(req.mustHaves);

  if (/\b(pancake|super flat|very flat|dead flat|flat|no hill|zero hill|easy)\b/.test(txt)) {
    terrain = 'flat';
  } else if (/\b(climb|hill|mountain|steep|workout|elevation)\b/.test(txt)) {
    terrain = 'hilly';
  }

  if (/\b(one[- ]?way|train|point to point)\b/.test(txt)) {
    shape = 'oneway';
  } else if (/\b(loop|round trip|return home|circle)\b/.test(txt)) {
    shape = 'loop';
  }

  if (/\b(coffee|cafe|latte|bakery|brunch|croissant)\b/.test(txt)) mustSet.add('cafe');
  if (/\b(beach|bay|coastal|ocean|sea|river|lake|water)\b/.test(txt)) mustSet.add('water');
  if (/\b(car[- ]?free|off[- ]?road|quiet|safe|family|protected|park)\b/.test(txt)) {
    mustSet.add('carFree');
  }
  if (/\b(no tram|avoid tram|tram[- ]?free|zero tram)\b/.test(txt)) mustSet.add('tramFree');

  const kmMatch = txt.match(/\b(\d{1,2})\s*km\b/);
  if (kmMatch) {
    const parsedKm = Number(kmMatch[1]);
    if (parsedKm >= 5 && parsedKm <= 80) {
      targetKm = parsedKm;
    }
  }

  return {
    ...req,
    terrain,
    shape,
    targetKm: Math.max(6, Math.min(75, targetKm)),
    mustHaves: Array.from(mustSet),
  };
}

function scoreAnchorPreference(anchor: ScenicAnchor, prefs: RouteDesignRequest): number {
  let score = 0;
  if (prefs.terrain === 'flat') {
    score += anchor.terrain === 'flat' ? 35 : anchor.terrain === 'rolling' ? 6 : -30;
  } else if (prefs.terrain === 'hilly') {
    score += anchor.terrain === 'hilly' ? 38 : anchor.terrain === 'rolling' ? 16 : -8;
  } else {
    score += anchor.terrain === 'rolling' ? 20 : 14;
  }

  if (prefs.mustHaves.includes('carFree') && anchor.carFree) score += 22;
  if (prefs.mustHaves.includes('cafe') && anchor.hasCafe) score += 20;
  if (prefs.mustHaves.includes('water') && anchor.hasWater) score += 20;
  if (prefs.mustHaves.includes('tramFree') && anchor.tramSafe) score += 14;
  return score;
}

function selectDistinctVariation(
  ranked: Array<{ pair: [ScenicAnchor, ScenicAnchor]; score: number }>,
  variationIndex: number
): [ScenicAnchor, ScenicAnchor] | null {
  if (ranked.length === 0) return null;
  ranked.sort((a, b) => b.score - a.score);
  const distinct: [ScenicAnchor, ScenicAnchor][] = [];
  const usedPrimary = new Set<string>();
  for (const item of ranked) {
    const key = `${item.pair[0].id}:${item.pair[1].id}`;
    // Ensure each variation changes at least one primary scenic anchor so routes feel truly distinct
    if (distinct.length === 0 || (!usedPrimary.has(item.pair[0].id) && !usedPrimary.has(key))) {
      distinct.push(item.pair);
      usedPrimary.add(item.pair[0].id);
      usedPrimary.add(key);
    }
    if (distinct.length >= 6) break;
  }
  return distinct[variationIndex % distinct.length] ?? ranked[0].pair;
}

function pickOptimalAnchors(
  city: 'melbourne' | 'sydney',
  start: [number, number],
  prefs: RouteDesignRequest
): ScenicAnchor[] {
  const pool = city === 'sydney' ? SYDNEY_SCENIC_ANCHORS : SCENIC_ANCHORS;
  let candidates = pool.filter(
    (a) => haversineKm(start, a.lngLat) >= 1.1 && haversineKm(start, a.lngLat) <= 38
  );
  // Outer-suburb fallback: always ensure >= 6 nearest anchors so no suburb returns empty
  if (candidates.length < 3) {
    candidates = [...pool]
      .sort((a, b) => haversineKm(start, a.lngLat) - haversineKm(start, b.lngLat))
      .slice(0, 6);
  }
  const varIdx = Math.max(0, prefs.variationIndex ?? 0);

  if (prefs.shape === 'oneway') {
    const idealDirectKm = prefs.targetKm / 1.32;
    const ranked: Array<{ pair: [ScenicAnchor, ScenicAnchor]; score: number }> = [];

    for (const dest of candidates) {
      const directDist = haversineKm(start, dest.lngLat);
      const distPenalty = Math.abs(directDist - idealDirectKm) * 5.2;
      const trainBonus = dest.hasTrain ? 26 : -10;

      for (const mid of candidates) {
        if (mid.id === dest.id) continue;
        const leg1 = haversineKm(start, mid.lngLat);
        const leg2 = haversineKm(mid.lngLat, dest.lngLat);
        const viaRaw = (leg1 + leg2) * 1.28;
        const totalPenalty = Math.abs(viaRaw - prefs.targetKm) * 4.5 + distPenalty * 0.4;
        const prefScore =
          scoreAnchorPreference(mid, prefs) + scoreAnchorPreference(dest, prefs) + trainBonus;
        ranked.push({ pair: [mid, dest], score: prefScore - totalPenalty });
      }
    }
    return selectDistinctVariation(ranked, varIdx) ?? candidates.slice(0, 2);
  }

  // Triangular Loop: Start -> Anchor A -> Anchor B -> Start (separated in bearing so outbound != inbound!)
  const ranked: Array<{ pair: [ScenicAnchor, ScenicAnchor]; score: number }> = [];

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      const d1 = haversineKm(start, a.lngLat);
      const d2 = haversineKm(a.lngLat, b.lngLat);
      const d3 = haversineKm(b.lngLat, start);
      const estLoopKm = (d1 + d2 + d3) * 1.3;

      const bA = bearingDeg(start, a.lngLat);
      const bB = bearingDeg(start, b.lngLat);
      const spread = angleDiff(bA, bB);
      const spreadBonus = spread >= 32 && spread <= 140 ? 24 : -18;

      const distPenalty = Math.abs(estLoopKm - prefs.targetKm) * 4.8;
      const prefScore = scoreAnchorPreference(a, prefs) + scoreAnchorPreference(b, prefs);
      ranked.push({ pair: [a, b], score: prefScore + spreadBonus - distPenalty });
    }
  }

  return selectDistinctVariation(ranked, varIdx) ?? candidates.slice(0, 2);
}

async function fetchBikeRouteGeometry(
  waypoints: [number, number][]
): Promise<{ coordinates: [number, number][]; distanceKm: number; durationMin: number }> {
  const coordParam = waypoints.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';');
  const endpoints = [
    `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coordParam}?overview=full&geometries=geojson`,
    `https://router.project-osrm.org/route/v1/bike/${coordParam}?overview=full&geometries=geojson`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SpinMap/1.0 (+https://github.com/verse404/SpinMap)' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          routes?: Array<{
            distance?: number;
            duration?: number;
            geometry?: { coordinates?: [number, number][] };
          }>;
        };
        const top = data.routes?.[0];
        const coords = top?.geometry?.coordinates;
        if (coords && coords.length >= 2) {
          // Downsample to <= 180 points for crisp, fast client rendering & GPX export
          const step = Math.max(1, Math.floor(coords.length / 180));
          const sampled = coords.filter((_, idx) => idx % step === 0 || idx === coords.length - 1);
          const distKm = Math.round(((top?.distance ?? 15000) / 1000) * 10) / 10;
          const durMin = Math.max(20, Math.round((distKm / 18.5) * 60));
          return { coordinates: sampled, distanceKm: distKm, durationMin: durMin };
        }
      }
    } catch {
      // Try next public cycling router endpoint
    }
  }

  let rawDist = 0;
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    rawDist += haversineKm(waypoints[i], waypoints[i + 1]);
  }
  const distanceKm = Math.round(rawDist * 1.25 * 10) / 10;
  return {
    coordinates: waypoints,
    distanceKm,
    durationMin: Math.max(20, Math.round((distanceKm / 18.5) * 60)),
  };
}

async function fetchElevationProfile(
  coords: [number, number][],
  fallbackTerrain: 'flat' | 'balanced' | 'hilly'
): Promise<{ elevProfile: number[]; elevationGainM: number }> {
  const sampleCount = 14;
  const sampled: [number, number][] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const idx = Math.min(coords.length - 1, Math.round((i / (sampleCount - 1)) * (coords.length - 1)));
    sampled.push(coords[idx]);
  }

  const summarizeElevation = (rawElev: number[]) => {
    const elev = rawElev.map((v) => Math.max(1, Math.round(Number(v) || 8)));
    let gain = 0;
    for (let i = 1; i < elev.length; i += 1) {
      if (elev[i] > elev[i - 1]) {
        gain += elev[i] - elev[i - 1];
      }
    }
    return { elevProfile: elev, elevationGainM: Math.max(12, Math.round(gain * 1.25)) };
  };

  // Primary DEM: Open-Meteo Elevation
  try {
    const lats = sampled.map((c) => c[1].toFixed(4)).join(',');
    const lngs = sampled.map((c) => c[0].toFixed(4)).join(',');
    const res = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`,
      {
        headers: { 'User-Agent': 'SpinMap/1.0 (+https://github.com/verse404/SpinMap)' },
        signal: AbortSignal.timeout(2800),
      }
    );
    if (res.ok) {
      const json = (await res.json()) as { elevation?: number[] };
      if (Array.isArray(json.elevation) && json.elevation.length === sampleCount) {
        return summarizeElevation(json.elevation);
      }
    }
  } catch {
    // Fall through to OpenTopoData SRTM90m
  }

  // Secondary DEM (cloud-IP resilient): OpenTopoData SRTM90m
  try {
    const locs = sampled.map((c) => `${c[1].toFixed(4)},${c[0].toFixed(4)}`).join('|');
    const res = await fetch(`https://api.opentopodata.org/v1/srtm90m?locations=${locs}`, {
      headers: { 'User-Agent': 'SpinMap/1.0 (+https://github.com/verse404/SpinMap)' },
      signal: AbortSignal.timeout(3800),
    });
    if (res.ok) {
      const json = (await res.json()) as { results?: Array<{ elevation?: number | null }> };
      const vals = (json.results ?? []).map((r) => (typeof r.elevation === 'number' ? r.elevation : 8));
      if (vals.length === sampleCount) {
        return summarizeElevation(vals);
      }
    }
  } catch {
    // Graceful synthetic fallback below
  }

  if (fallbackTerrain === 'flat') {
    return { elevProfile: [8, 9, 10, 11, 12, 11, 10, 9, 8, 9, 10, 8], elevationGainM: 28 };
  }
  if (fallbackTerrain === 'hilly') {
    return { elevProfile: [24, 48, 82, 128, 165, 195, 172, 134, 92, 58, 36, 26], elevationGainM: 245 };
  }
  return { elevProfile: [14, 22, 34, 46, 38, 52, 44, 31, 26, 20, 16, 14], elevationGainM: 95 };
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round((mins % 60) / 5) * 5;
  if (h === 0) return `0h ${Math.max(15, m)}m`;
  return `${h}h ${String(m === 60 ? 55 : m).padStart(2, '0')}m`;
}

function destinationPoint(
  start: [number, number],
  bearingDegrees: number,
  distanceKm: number
): [number, number] {
  const latRad = (start[1] * Math.PI) / 180;
  const brgRad = (bearingDegrees * Math.PI) / 180;
  const dLat = (distanceKm * Math.cos(brgRad)) / 111.32;
  const dLng = (distanceKm * Math.sin(brgRad)) / (111.32 * Math.max(0.2, Math.cos(latRad)));
  return [
    Math.max(-179.9, Math.min(179.9, start[0] + dLng)),
    Math.max(-84.9, Math.min(84.9, start[1] + dLat)),
  ];
}

function compassDirectionName(deg: number): string {
  const names = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

async function reverseGeocodeNeighborhood(
  lng: number,
  lat: number,
  detectedCity: 'melbourne' | 'sydney' | 'global'
): Promise<string> {
  // Privacy-first zoom=14 lookup returns suburb/neighbourhood only (never door/house numbers)
  try {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: lat.toFixed(5),
      lon: lng.toFixed(5),
      zoom: '14',
      addressdetails: '1',
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { 'User-Agent': 'SpinMap/1.0 (Visual Cycling Route Explorer)' },
      signal: AbortSignal.timeout(2800),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        address?: Record<string, string | undefined>;
        name?: string;
      };
      const addr = json.address;
      const locality =
        addr?.suburb ||
        addr?.neighbourhood ||
        addr?.quarter ||
        addr?.town ||
        addr?.city_district ||
        addr?.city ||
        json.name;
      if (locality) {
        return maskStreetNumber(locality);
      }
    }
  } catch {
    // Fall back to nearest suburb dictionary below
  }

  if (detectedCity === 'melbourne' || detectedCity === 'sydney') {
    const dict = detectedCity === 'sydney' ? SYDNEY_SUBURB_FALLBACKS : SUBURB_FALLBACKS;
    let nearestLabel = detectedCity === 'sydney' ? 'Sydney' : 'Melbourne';
    let nearestDist = Infinity;
    for (const entry of Object.values(dict)) {
      const d = haversineKm([lng, lat], entry.lngLat);
      if (d < nearestDist) {
        nearestDist = d;
        nearestLabel = entry.label;
      }
    }
    return `Near ${nearestLabel}`;
  }

  return 'Your Current Location';
}

function buildGlobalScenicAnchors(
  start: [number, number],
  prefs: RouteDesignRequest
): ScenicAnchor[] {
  const varIdx = Math.max(0, prefs.variationIndex ?? 0);
  const baseHeading = (35 + varIdx * 72) % 360;
  const dir1 = compassDirectionName(baseHeading);
  const dir2 = compassDirectionName((baseHeading + 68) % 360);

  if (prefs.shape === 'oneway') {
    const legKm = Math.max(2.5, prefs.targetKm / 1.38);
    const midPt = destinationPoint(start, (baseHeading - 14 + 360) % 360, legKm * 0.52);
    const destPt = destinationPoint(start, baseHeading, legKm);
    return [
      {
        id: `global-mid-${varIdx}`,
        name: `${dir1} Scenic Bikeway Midpoint`,
        icon: '☕',
        lngLat: midPt,
        terrain: prefs.terrain === 'hilly' ? 'hilly' : 'flat',
        carFree: true,
        hasCafe: true,
        hasWater: false,
        tramSafe: true,
        hasTrain: false,
        isGravel: false,
        photoUrl: '/images/greenway.jpg',
        note: `Mid-ride rest stop heading ${dir1.toLowerCase()} along local cycling roads`,
      },
      {
        id: `global-dest-${varIdx}`,
        name: `${dir1} Turnaround Point`,
        icon: '🚆',
        lngLat: destPt,
        terrain: prefs.terrain === 'hilly' ? 'hilly' : 'flat',
        carFree: true,
        hasCafe: true,
        hasWater: false,
        tramSafe: true,
        hasTrain: true,
        isGravel: false,
        photoUrl: '/images/yarra.jpg',
        note: `Destination point ~${Math.round(prefs.targetKm)} km along bike-friendly routes`,
      },
    ];
  }

  // Wide equilateral cycling loop from user's exact doorstep
  const radiusKm = Math.max(1.8, prefs.targetKm / 4.25);
  const ptA = destinationPoint(start, baseHeading, radiusKm);
  const ptB = destinationPoint(start, (baseHeading + 68) % 360, radiusKm);
  return [
    {
      id: `global-a-${varIdx}`,
      name: `${dir1} Bikeway Waypoint`,
      icon: '☕',
      lngLat: ptA,
      terrain: prefs.terrain === 'hilly' ? 'hilly' : 'flat',
      carFree: true,
      hasCafe: true,
      hasWater: false,
      tramSafe: true,
      hasTrain: false,
      isGravel: false,
      photoUrl: '/images/greenway.jpg',
      note: `Outbound leg exploring ${dir1.toLowerCase()} bike paths and quiet streets`,
    },
    {
      id: `global-b-${varIdx}`,
      name: `${dir2} Return Corridor`,
      icon: '🌿',
      lngLat: ptB,
      terrain: prefs.terrain === 'hilly' ? 'hilly' : 'flat',
      carFree: true,
      hasCafe: true,
      hasWater: false,
      tramSafe: true,
      hasTrain: false,
      isGravel: false,
      photoUrl: '/images/yarra.jpg',
      note: `Wide scenic return heading back via the ${dir2.toLowerCase()} side`,
    },
  ];
}

export async function designMelbourneRoute(rawReq: RouteDesignRequest): Promise<RouteDesignResult> {
  const reqCity: 'melbourne' | 'sydney' = rawReq.city === 'sydney' ? 'sydney' : 'melbourne';
  const prefs = parsePromptOverrides(rawReq);

  // Resolve start point: either direct live GPS / Pick-on-Map coordinates OR geocoded street/suburb
  let startGeo: { lngLat: [number, number]; label: string };
  let activeRegion: 'melbourne' | 'sydney' | 'global' = reqCity;

  if (rawReq.startCoords) {
    const { lng, lat } = rawReq.startCoords;
    if (isWithinCityBounds('melbourne', lng, lat)) {
      activeRegion = 'melbourne';
    } else if (isWithinCityBounds('sydney', lng, lat)) {
      activeRegion = 'sydney';
    } else {
      activeRegion = 'global';
    }
    const label = await reverseGeocodeNeighborhood(lng, lat, activeRegion);
    startGeo = { lngLat: [lng, lat], label };
  } else {
    startGeo = await geocodeCityAddress(reqCity, prefs.address);
    activeRegion = reqCity;
  }

  const cityLabel =
    activeRegion === 'sydney'
      ? 'Sydney'
      : activeRegion === 'melbourne'
        ? 'Melbourne'
        : startGeo.label;
  const fallbackPhoto =
    activeRegion === 'sydney' ? '/images/sydney-harbour.jpg' : '/images/albert.jpg';

  let chosenAnchors: ScenicAnchor[] =
    activeRegion === 'global'
      ? buildGlobalScenicAnchors(startGeo.lngLat, prefs)
      : pickOptimalAnchors(activeRegion, startGeo.lngLat, prefs);

  let waypoints: [number, number][] =
    prefs.shape === 'loop'
      ? [startGeo.lngLat, ...chosenAnchors.map((a) => a.lngLat), startGeo.lngLat]
      : [startGeo.lngLat, ...chosenAnchors.map((a) => a.lngLat)];

  let { coordinates, distanceKm, durationMin } = await fetchBikeRouteGeometry(waypoints);

  // Coastal guard for global GPS loops: if rotated heading hits ocean/unroutable area, rotate +90°
  if (activeRegion === 'global' && coordinates.length <= waypoints.length) {
    chosenAnchors = buildGlobalScenicAnchors(startGeo.lngLat, {
      ...prefs,
      variationIndex: (prefs.variationIndex ?? 0) + 2,
    });
    waypoints =
      prefs.shape === 'loop'
        ? [startGeo.lngLat, ...chosenAnchors.map((a) => a.lngLat), startGeo.lngLat]
        : [startGeo.lngLat, ...chosenAnchors.map((a) => a.lngLat)];
    ({ coordinates, distanceKm, durationMin } = await fetchBikeRouteGeometry(waypoints));
  }

  const { elevProfile, elevationGainM } = await fetchElevationProfile(coordinates, prefs.terrain);

  const isTrulyFlat = elevationGainM <= 65 || elevationGainM / Math.max(distanceKm, 1) < 3.2;
  const anyGravel = chosenAnchors.some((a) => a.isGravel);
  const allCarFree = chosenAnchors.every((a) => a.carFree);

  // Compute exact cumulative polyline arc-length ratios so cyclist puck aligns with landmark pins
  const cumArc: number[] = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    const dx = coordinates[i][0] - coordinates[i - 1][0];
    const dy = coordinates[i][1] - coordinates[i - 1][1];
    cumArc.push(cumArc[i - 1] + Math.hypot(dx, dy));
  }
  const totalArc = cumArc[cumArc.length - 1] || 1;

  const landmarks: RouteLandmark[] = [
    {
      ratio: 0,
      icon: '🏠',
      label: `Start: ${startGeo.label}`,
      photoUrl: chosenAnchors[0]?.photoUrl ?? fallbackPhoto,
      note: `Your custom ${cityLabel} starting point`,
      lngLat: coordinates[0] ?? startGeo.lngLat,
    },
  ];

  let minSearchIdx = 1;
  chosenAnchors.forEach((anchor, idx) => {
    const isFinalOneWay = prefs.shape === 'oneway' && idx === chosenAnchors.length - 1;
    if (isFinalOneWay) {
      landmarks.push({
        ratio: 1.0,
        icon: anchor.icon,
        label: anchor.name,
        photoUrl: anchor.photoUrl,
        note: anchor.note,
        lngLat: coordinates[coordinates.length - 1] ?? anchor.lngLat,
      });
      return;
    }

    const maxSearchIdx = Math.max(minSearchIdx, coordinates.length - 2);
    let bestIdx = minSearchIdx;
    let bestDist = Infinity;
    for (let k = minSearchIdx; k <= maxSearchIdx; k += 1) {
      const d = haversineKm(coordinates[k], anchor.lngLat);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = k;
      }
    }
    minSearchIdx = Math.min(maxSearchIdx, bestIdx + 1);
    const exactRatio = Math.max(0.06, Math.min(0.94, Math.round((cumArc[bestIdx] / totalArc) * 1000) / 1000));

    landmarks.push({
      ratio: exactRatio,
      icon: anchor.icon,
      label: anchor.name,
      photoUrl: anchor.photoUrl,
      note: anchor.note,
      lngLat: coordinates[bestIdx] ?? anchor.lngLat,
    });
  });

  if (prefs.shape === 'loop') {
    landmarks.push({
      ratio: 1.0,
      icon: '🏁',
      label: `Finish back at ${startGeo.label}`,
      photoUrl: chosenAnchors[chosenAnchors.length - 1]?.photoUrl ?? fallbackPhoto,
      note: `Completes your doorstep ${cityLabel} cycling loop`,
      lngLat: coordinates[coordinates.length - 1] ?? startGeo.lngLat,
    });
  }

  const originStr = `${startGeo.lngLat[1].toFixed(5)},${startGeo.lngLat[0].toFixed(5)}`;
  const destPt = waypoints[waypoints.length - 1];
  const destStr = `${destPt[1].toFixed(5)},${destPt[0].toFixed(5)}`;
  const midWaypointsStr = chosenAnchors
    .slice(0, prefs.shape === 'loop' ? chosenAnchors.length : Math.max(1, chosenAnchors.length - 1))
    .map((a) => `${a.lngLat[1].toFixed(5)},${a.lngLat[0].toFixed(5)}`)
    .join('|');

  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originStr}&destination=${destStr}&waypoints=${encodeURIComponent(midWaypointsStr)}&travelmode=bicycling`;

  const anchorNames = chosenAnchors.map((a) => a.name);
  const shortPrimary =
    chosenAnchors[0]?.name
      .split(' & ')[0]
      .split(' (')[0]
      .replace(/\s+(Waypoint|Loop|Black Swan Lagoon)$/i, '')
      .split(' ')
      .slice(0, 3)
      .join(' ')
      .trim() || 'Scenic';
  const routeTitle =
    prefs.shape === 'loop'
      ? `${startGeo.label} → ${shortPrimary} Loop`
      : `${startGeo.label} → ${chosenAnchors[chosenAnchors.length - 1]?.name ?? 'Scenic Ride'}`;

  const rationaleParts = [
    `Starting near ${startGeo.label}`,
    `routed via ${anchorNames.join(' & ')}`,
    isTrulyFlat ? `pancake-flat (+${elevationGainM} m climb)` : `+${elevationGainM} m total climb`,
    prefs.shape === 'oneway' ? 'finishing near train access' : 'looping right back to your start',
  ];

  const customRoute: CyclingRoute = {
    id: 'custom-designed-route',
    name: routeTitle,
    shortName: '✨ Your Custom Ride',
    subtitle: `${startGeo.label} → ${anchorNames.join(' → ')}${prefs.shape === 'loop' ? ' → Return' : ''}`,
    vibe: chosenAnchors[0]?.hasWater ? 'coastal' : isTrulyFlat ? 'city' : 'river',
    isFlat: isTrulyFlat,
    flatLabel: isTrulyFlat ? `🥞 Custom Flat (+${elevationGainM} m)` : `Custom (+${elevationGainM} m)`,
    effort: durationMin < 65 ? 'short' : durationMin <= 125 ? 'medium' : 'long',
    durationLabel: formatDuration(durationMin),
    distanceKm,
    elevationM: elevationGainM,
    carFree: allCarFree,
    isGravel: anyGravel,
    comfortBadge: isTrulyFlat ? '🥞 Custom Flat Ride' : allCarFree ? '🌳 Trail-Focused' : '✨ Tailored Route',
    tramBadge: activeRegion === 'melbourne' ? '🚋 Low-Tram Bikeways' : '🚲 Bikeway-Focused',
    ribbonHex: '#0f766e',
    photoUrl: chosenAnchors[0]?.photoUrl ?? fallbackPhoto,
    gmapsUrl,
    surfaces: anyGravel
      ? [
          { label: 'Sealed bikeway & trails', pct: 65, color: '#0f766e' },
          { label: 'Fine parkland gravel', pct: 35, color: '#d97706' },
        ]
      : [
          { label: 'Bike paths & greenways', pct: 84, color: '#0f766e' },
          { label: 'Quiet connector streets', pct: 16, color: '#0284c7' },
        ],
    highlights: [
      {
        icon: '🏠',
        title: startGeo.label,
        sub: prefs.shape === 'loop' ? 'Doorstep loop' : 'Custom start',
        landmarkIndex: 0,
      },
      {
        icon: chosenAnchors[0]?.icon ?? '☕',
        title: chosenAnchors[0]?.name.split(' ').slice(0, 2).join(' ') ?? 'Scenic Trail',
        sub: 'Waypoint 1',
        landmarkIndex: 1,
      },
      {
        icon: chosenAnchors[1]?.icon ?? '🚆',
        title: chosenAnchors[1]?.name.split(' ').slice(0, 2).join(' ') ?? 'Highlight 2',
        sub: prefs.shape === 'oneway' ? 'Train finish' : 'Waypoint 2',
        landmarkIndex: 2,
      },
    ],
    coordinates,
    elevProfile,
    landmarks,
  };

  return {
    route: customRoute,
    rationale: rationaleParts.join(' · '),
    startSuburbLabel: startGeo.label,
    startCoords: startGeo.lngLat,
  };
}

export async function rerouteFromWaypoints(
  routeName: string,
  waypoints: Array<{
    lngLat: [number, number];
    label: string;
    icon: string;
    photoUrl: string;
    note: string;
  }>
): Promise<CyclingRoute> {
  const rawPts = waypoints.map((w) => w.lngLat);
  const { coordinates, distanceKm, durationMin } = await fetchBikeRouteGeometry(rawPts);
  const { elevProfile, elevationGainM } = await fetchElevationProfile(coordinates, 'balanced');
  const isTrulyFlat = elevationGainM <= 65 || elevationGainM / Math.max(distanceKm, 1) < 3.2;

  const cumArc: number[] = [0];
  for (let i = 1; i < coordinates.length; i += 1) {
    const dx = coordinates[i][0] - coordinates[i - 1][0];
    const dy = coordinates[i][1] - coordinates[i - 1][1];
    cumArc.push(cumArc[i - 1] + Math.hypot(dx, dy));
  }
  const totalArc = cumArc[cumArc.length - 1] || 1;

  let minSearch = 0;
  const landmarks: RouteLandmark[] = waypoints.map((wp, idx) => {
    if (idx === 0) {
      minSearch = 1;
      return {
        ratio: 0,
        icon: wp.icon,
        label: wp.label,
        photoUrl: wp.photoUrl,
        note: wp.note,
        lngLat: coordinates[0] ?? wp.lngLat,
      };
    }
    if (idx === waypoints.length - 1) {
      return {
        ratio: 1,
        icon: wp.icon,
        label: wp.label,
        photoUrl: wp.photoUrl,
        note: wp.note,
        lngLat: coordinates[coordinates.length - 1] ?? wp.lngLat,
      };
    }
    const maxSearch = Math.max(minSearch, coordinates.length - 2);
    let bestIdx = minSearch;
    let bestDist = Infinity;
    for (let k = minSearch; k <= maxSearch; k += 1) {
      const d = haversineKm(coordinates[k], wp.lngLat);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = k;
      }
    }
    minSearch = Math.min(maxSearch, bestIdx + 1);
    const ratio = Math.max(0.05, Math.min(0.95, Math.round((cumArc[bestIdx] / totalArc) * 1000) / 1000));
    return {
      ratio,
      icon: wp.icon,
      label: wp.label,
      photoUrl: wp.photoUrl,
      note: wp.note,
      lngLat: coordinates[bestIdx] ?? wp.lngLat,
    };
  });

  const first = waypoints[0].lngLat;
  const last = waypoints[waypoints.length - 1].lngLat;
  const mids = waypoints
    .slice(1, -1)
    .map((w) => `${w.lngLat[1].toFixed(5)},${w.lngLat[0].toFixed(5)}`)
    .join('|');
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${first[1].toFixed(5)},${first[0].toFixed(5)}&destination=${last[1].toFixed(5)},${last[0].toFixed(5)}${mids ? `&waypoints=${encodeURIComponent(mids)}` : ''}&travelmode=bicycling`;

  const hlPick = landmarks.slice(0, 3);
  while (hlPick.length < 3 && landmarks.length > 0) {
    hlPick.push(landmarks[landmarks.length - 1]);
  }

  return {
    id: 'custom-designed-route',
    name: routeName.includes('(Edited)') ? routeName : `${routeName} (Edited)`,
    shortName: '✏️ Edited Ride',
    subtitle: waypoints.map((w) => w.label).join(' → '),
    vibe: isTrulyFlat ? 'city' : 'river',
    isFlat: isTrulyFlat,
    flatLabel: isTrulyFlat ? `🥞 Custom Flat (+${elevationGainM} m)` : `Edited (+${elevationGainM} m)`,
    effort: durationMin < 65 ? 'short' : durationMin <= 125 ? 'medium' : 'long',
    durationLabel: formatDuration(durationMin),
    distanceKm,
    elevationM: elevationGainM,
    carFree: false,
    isGravel: false,
    comfortBadge: '✏️ Custom Edited Route',
    tramBadge: '🚲 Live Recalculated',
    ribbonHex: '#0f766e',
    photoUrl: waypoints[0]?.photoUrl ?? '/images/greenway.jpg',
    gmapsUrl,
    surfaces: [
      { label: 'Bikeways & trails', pct: 80, color: '#0f766e' },
      { label: 'Connector streets', pct: 20, color: '#0284c7' },
    ],
    highlights: hlPick.map((lm, i) => ({
      icon: lm.icon,
      title: lm.label.slice(0, 22),
      sub: i === 0 ? 'Start' : i === hlPick.length - 1 ? 'Stop' : `Stop ${i + 1}`,
      landmarkIndex: Math.min(i, landmarks.length - 1),
    })),
    coordinates,
    elevProfile,
    landmarks,
  };
}
