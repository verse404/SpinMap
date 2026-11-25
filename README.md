# SpinMap

**Visual-first cycling route explorer** for **Web** (`Next.js 15` + `MapLibre GL`) and **iOS** (`SwiftUI` + `Apple MapKit`).

Discover curated Melbourne and Sydney bikeway loops, design custom routes starting from your live GPS location or anywhere on Earth, preview live headwind/tailwind shading, locate nearby cyclist pit-stops, and export turn-by-turn navigation to Apple Maps, Google Maps, or GPX.

## Repository Structure

- [`web/`](web/) — Next.js 15 + React 19 + Tailwind CSS v4 + MapLibre GL web app (`Melbourne /`, `Sydney /sydney`, and global city explorer).
- [`ios/`](ios/) — Native SwiftUI + Apple MapKit iOS 17+ Xcode project (`SpinMap.xcodeproj`) with offline-bundled routes, 1024×1024 App Store icon, `PrivacyInfo.xcprivacy`, XCTest unit tests, and App Store Connect submission guide.

## Key Features

- **Curated Melbourne & Sydney Routes**: 14 real OpenStreetMap cycleway-routed rides with DEM elevation profiles, surface breakdowns, and street-level photography.
- **Current Location & Anywhere-on-Earth Route Designer**: 1-tap GPS (`My Location`), `Pick on Map`, or `Any City` worldwide search with terrain, distance, loop/one-way, and alternative route variations.
- **Live Headwind / Tailwind Shading & Route Reversal**: Segment-level wind color-grading (emerald tailwind, sky crosswind, amber headwind) plus 1-tap route direction reversal.
- **Bike Type & Pace Selector**: Dynamically adjusts ride duration and surfaces route suitability tips for Cruiser, E-Bike, Road, and Gravel bikes.
- **Cyclist Pit-Stop Pins & Live Stop Editing**: Toggle nearby cafes, drinking water, toilets, and bike repair shops, and reshape routes live by adding or moving stops.
- **Best Window to Ride & Sunset Countdown**: 10-hour comfort bar chart comparing estimated ride time against local sunset to alert when bike lights are needed.
- **Offline Bookmarks, Shareable Links & GPX Export**: Persistent local bookmarks, direct shareable links, and XML-safe GPX 1.1 downloads / iOS `ShareLink`.

## Quick Start

### Deploy Web App to Render (1-Click Free Blueprint)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/verse404/SpinMap)

Uses [`render.yaml`](render.yaml) (`rootDir: web`, Node 20, auto-generated `SPINMAP_INTERNAL_SECRET`, health check on `/`, and auto-deploy on push to `main`).

### Run Web App Locally (`web/`)

Requires Node.js 20+:

```bash
cd web
npm install
npm test
npm run dev
```

Open `http://127.0.0.1:3000` (Melbourne) or `http://127.0.0.1:3000/sydney` (Sydney).

### iOS App (`ios/`)

Requires macOS with Xcode 15 or Xcode 16+:

```bash
open ios/SpinMap.xcodeproj
```

Select your Apple Developer Team under **Signing & Capabilities**, set your own unique Bundle Identifier, then press **`⌘R`** to run in the Simulator or **`⌘U`** to run unit tests. See [`ios/APP_STORE_GUIDE.md`](ios/APP_STORE_GUIDE.md) for TestFlight and App Store Connect submission steps.

## Data & Map Attributions

- Map data & bicycle routing: [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [CyclOSM](https://www.cyclosm.org/), Esri World Topo, and Apple MapKit (iOS).
- Weather forecasts, wind vectors, sunrise/sunset & DEM elevation: [Open-Meteo](https://open-meteo.com/).
