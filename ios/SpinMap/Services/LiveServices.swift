import CoreLocation
import Foundation
import MapKit

enum LiveServices {
    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 8
        cfg.timeoutIntervalForResource = 12
        cfg.httpAdditionalHeaders = [
            "User-Agent": "SpinMap-iOS/1.0 (Visual Cycling Route Explorer)",
            "Accept-Language": "en",
        ]
        return URLSession(configuration: cfg)
    }()

    // MARK: - Live Weather, Wind Direction, Sunset Countdown & Best Ride Window

    private struct OpenMeteoResponse: Decodable {
        struct Current: Decodable {
            let time: String?
            let temperature_2m: Double?
            let wind_speed_10m: Double?
            let wind_direction_10m: Double?
        }
        struct Hourly: Decodable {
            let time: [String]?
            let temperature_2m: [Double]?
            let wind_speed_10m: [Double]?
            let precipitation_probability: [Double]?
        }
        struct Daily: Decodable {
            let sunset: [String]?
        }
        let current: Current?
        let hourly: Hourly?
        let daily: Daily?
    }

    static func fetchWeather(for coord: CLLocationCoordinate2D, cityFallback: CityConfig) async -> LiveWeatherState {
        let lat = String(format: "%.4f", coord.latitude)
        let lon = String(format: "%.4f", coord.longitude)
        let urlStr = "https://api.open-meteo.com/v1/forecast?latitude=\(lat)&longitude=\(lon)&current=temperature_2m,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,wind_speed_10m,precipitation_probability&daily=sunset&forecast_days=2&timezone=auto"
        guard let url = URL(string: urlStr) else {
            return .fallback(for: cityFallback)
        }

        do {
            let (data, response) = try await session.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                return .fallback(for: cityFallback)
            }
            let decoded = try JSONDecoder().decode(OpenMeteoResponse.self, from: data)
            let tempC = Int((decoded.current?.temperature_2m ?? 22).rounded())
            let windKmh = Int((decoded.current?.wind_speed_10m ?? 15).rounded())
            let windDeg = Int((decoded.current?.wind_direction_10m ?? 205).rounded())
            let dir = compassArrow(windDeg)

            let currentHourPrefix = String((decoded.current?.time ?? "").prefix(13))
            let times = decoded.hourly?.time ?? []
            let temps = decoded.hourly?.temperature_2m ?? []
            let winds = decoded.hourly?.wind_speed_10m ?? []
            let precips = decoded.hourly?.precipitation_probability ?? []

            let startIdx = max(0, times.firstIndex(where: { String($0.prefix(13)) >= currentHourPrefix }) ?? 0)
            var slots: [HourlyRideSlot] = []
            for i in startIdx..<min(times.count, startIdx + 10) {
                let tC = Int((i < temps.count ? temps[i] : Double(tempC)).rounded())
                let wK = Int((i < winds.count ? winds[i] : Double(windKmh)).rounded())
                let pP = Int((i < precips.count ? precips[i] : 10).rounded())
                let tempPenalty = abs(Double(tC - 20)) * 2.2
                let windPenalty = max(0, Double(wK - 10)) * 1.8
                let rainPenalty = Double(pP) * 0.9
                let score = max(5, min(100, Int((100 - tempPenalty - windPenalty - rainPenalty).rounded())))
                slots.append(HourlyRideSlot(
                    isoTime: times[i],
                    hourLabel: formatHourShort(times[i]),
                    tempC: tC,
                    windKmh: wK,
                    precipProb: pP,
                    score: score
                ))
            }

            let bestSlot = slots.max(by: { $0.score < $1.score })
            let bestWindow = bestSlot.map {
                "\($0.hourLabel) (\($0.tempC)°C · \($0.windKmh) km/h · \($0.precipProb)% rain)"
            } ?? "Great conditions now"

            let sunsetRaw = decoded.daily?.sunset?.first ?? ""
            var sunsetLabel = formatClockTime(sunsetRaw)
            if sunsetLabel.isEmpty { sunsetLabel = "7:45 pm" }
            var minsToSunset: Int?
            if let nowM = parseLocalMinutes(decoded.current?.time ?? ""),
               let sunM = parseLocalMinutes(sunsetRaw) {
                if sunM > nowM {
                    minsToSunset = sunM - nowM
                } else {
                    minsToSunset = -1
                    sunsetLabel = "\(sunsetLabel) (past sunset)"
                }
            }

            return LiveWeatherState(
                tempC: tempC,
                windKmh: windKmh,
                windDeg: windDeg,
                windLabel: "\(dir.label) Breeze \(dir.arrow)",
                sunsetLabel: sunsetLabel,
                minutesToSunset: minsToSunset,
                bestWindowLabel: bestWindow,
                hourly: slots
            )
        } catch {
            return .fallback(for: cityFallback)
        }
    }

    private static func compassArrow(_ deg: Int) -> (label: String, arrow: String) {
        let dirs: [(String, String)] = [
            ("N", "↓"), ("NE", "↙"), ("E", "←"), ("SE", "↖"),
            ("S", "↑"), ("SW", "↗"), ("W", "→"), ("NW", "↘"),
        ]
        let idx = Int((Double(((deg % 360) + 360) % 360) / 45.0).rounded()) % 8
        return dirs[idx]
    }

    private static func formatHourShort(_ isoLocal: String) -> String {
        guard let tRange = isoLocal.range(of: "T") else { return String(isoLocal.suffix(5)) }
        let afterT = isoLocal[tRange.upperBound...]
        let hourStr = String(afterT.prefix(2))
        guard let h = Int(hourStr) else { return hourStr }
        if h == 0 { return "12am" }
        if h < 12 { return "\(h)am" }
        if h == 12 { return "12pm" }
        return "\(h - 12)pm"
    }

    private static func formatClockTime(_ isoLocal: String) -> String {
        guard let tRange = isoLocal.range(of: "T") else { return "" }
        let parts = isoLocal[tRange.upperBound...].split(separator: ":")
        guard parts.count >= 2, let h = Int(parts[0]) else { return "" }
        let m = String(parts[1].prefix(2))
        let suffix = h >= 12 ? "pm" : "am"
        let h12 = (h % 12 == 0) ? 12 : (h % 12)
        return "\(h12):\(m) \(suffix)"
    }

    private static func parseLocalMinutes(_ isoLocal: String) -> Int? {
        let clean = isoLocal.replacingOccurrences(of: "T", with: " ")
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        guard let date = formatter.date(from: String(clean.prefix(16))) else { return nil }
        return Int(date.timeIntervalSince1970 / 60.0)
    }

    // MARK: - Native Apple MapKit Pit-Stop Search (Zero Rate Limits, Worldwide)

    @MainActor
    static func fetchPitStops(for route: CyclingRoute, kinds: Set<PitStopKind>) async -> [PitStopPOI] {
        guard !kinds.isEmpty else { return [] }
        let region = route.region
        let cLat = region.center.latitude
        let cLon = region.center.longitude
        let dLat = region.span.latitudeDelta
        let dLon = region.span.longitudeDelta

        var results: [PitStopPOI] = []
        await withTaskGroup(of: [PitStopPOI].self) { group in
            for kind in kinds {
                group.addTask {
                    let req = MKLocalSearch.Request()
                    req.naturalLanguageQuery = kind.searchQuery
                    req.region = MKCoordinateRegion(
                        center: CLLocationCoordinate2D(latitude: cLat, longitude: cLon),
                        span: MKCoordinateSpan(latitudeDelta: dLat, longitudeDelta: dLon)
                    )
                    req.resultTypes = .pointOfInterest
                    let search = MKLocalSearch(request: req)
                    do {
                        let resp = try await search.start()
                        return resp.mapItems.prefix(6).enumerated().map { idx, item in
                            let coord = item.placemark.coordinate
                            let fallbackName: String
                            switch kind {
                            case .cafe: fallbackName = "Cycling Cafe"
                            case .water: fallbackName = "Drinking Water"
                            case .toilet: fallbackName = "Public Restroom"
                            case .repair: fallbackName = "Bike Shop & Repair"
                            }
                            return PitStopPOI(
                                id: "\(kind.rawValue)-\(idx)-\(String(format: "%.4f", coord.latitude))",
                                kind: kind,
                                name: item.name ?? fallbackName,
                                latitude: coord.latitude,
                                longitude: coord.longitude
                            )
                        }
                    } catch {
                        return []
                    }
                }
            }
            for await chunk in group {
                results.append(contentsOf: chunk)
            }
        }
        return results
    }

    // MARK: - Native Global City Geocoding (Instant Presets + Apple MapKit Worldwide)

    @MainActor
    static func searchGlobalCity(query: String) async -> CityConfig? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return nil }

        let lower = trimmed.lowercased()
        if let preset = CityConfig.quickGlobalCities.first(where: { $0.name.lowercased() == lower || $0.id == lower }) {
            return preset
        }

        let req = MKLocalSearch.Request()
        req.naturalLanguageQuery = trimmed
        req.resultTypes = .address
        let search = MKLocalSearch(request: req)
        guard let response = try? await search.start(),
              let first = response.mapItems.first
        else {
            return nil
        }

        let coord = first.placemark.coordinate
        let cityName = first.placemark.locality ?? first.name ?? trimmed
        let slug = cityName
            .lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))

        return CityConfig(
            id: slug.isEmpty ? "custom-city" : slug,
            name: cityName,
            regionLabel: cityName,
            latitude: coord.latitude,
            longitude: coord.longitude,
            spanDelta: 0.16,
            defaultWindLabel: "Local Breeze ↗",
            windShelterTip: "Park & river paths sheltered",
            sampleSuburbs: [cityName],
            avoidChipLabel: "Quiet Bikeways",
            isBuiltIn: false
        )
    }

    @MainActor
    static func geocodeAddress(_ address: String, near city: CityConfig) async -> (CLLocationCoordinate2D, String)? {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return nil }

        let req = MKLocalSearch.Request()
        req.naturalLanguageQuery = "\(trimmed), \(city.name)"
        req.region = city.overviewRegion
        let search = MKLocalSearch(request: req)
        if let resp = try? await search.start(), let first = resp.mapItems.first {
            let label = first.placemark.subLocality ?? first.placemark.locality ?? trimmed
            return (first.placemark.coordinate, label)
        }
        return nil
    }

    static func reverseGeocodeNeighborhood(_ coord: CLLocationCoordinate2D) async -> String {
        let geocoder = CLGeocoder()
        let loc = CLLocation(latitude: coord.latitude, longitude: coord.longitude)
        if let placemark = try? await geocoder.reverseGeocodeLocation(loc).first {
            // Privacy-first: suburb/neighbourhood only (never street house number)
            if let sub = placemark.subLocality, !sub.isEmpty { return sub }
            if let city = placemark.locality, !city.isEmpty { return city }
        }
        return "Your Start Point"
    }

    // MARK: - Live OSM Bikeway Routing & Open-Meteo Elevation

    private struct OSRMResponse: Decodable {
        struct RouteObj: Decodable {
            struct Geometry: Decodable {
                let coordinates: [[Double]]
            }
            let distance: Double
            let duration: Double
            let geometry: Geometry
        }
        let routes: [RouteObj]?
    }

    private struct ElevationResponse: Decodable {
        let elevation: [Double]?
    }

    private static func fetchBikeGeometry(_ waypoints: [CLLocationCoordinate2D]) async -> (coords: [[Double]], distanceKm: Double, durationMin: Int) {
        let coordStr = waypoints.map { String(format: "%.5f,%.5f", $0.longitude, $0.latitude) }.joined(separator: ";")
        let urlStr = "https://routing.openstreetmap.de/routed-bike/route/v1/driving/\(coordStr)?overview=full&geometries=geojson"

        if let url = URL(string: urlStr),
           let (data, resp) = try? await session.data(from: url),
           (resp as? HTTPURLResponse)?.statusCode == 200,
           let parsed = try? JSONDecoder().decode(OSRMResponse.self, from: data),
           let first = parsed.routes?.first,
           first.geometry.coordinates.count >= 2 {
            let raw = first.geometry.coordinates
            let step = max(1, raw.count / 120)
            var sampled: [[Double]] = []
            for idx in stride(from: 0, to: raw.count, by: step) {
                sampled.append(raw[idx])
            }
            if let last = raw.last, sampled.last != last {
                sampled.append(last)
            }
            let distKm = max(1.0, (first.distance / 100.0).rounded() / 10.0)
            let durMin = max(15, Int((first.duration / 60.0).rounded()))
            return (sampled, distKm, durMin)
        }

        // Offline graceful fallback straight connector
        let fallbackCoords = waypoints.map { [$0.longitude, $0.latitude] }
        var totalKm = 0.0
        for i in 0..<max(0, waypoints.count - 1) {
            totalKm += CyclingMath.haversineKm(waypoints[i], waypoints[i + 1])
        }
        let dist = max(2.0, (totalKm * 1.18 * 10.0).rounded() / 10.0)
        return (fallbackCoords, dist, max(15, Int((dist / 17.5) * 60.0)))
    }

    private static func fetchElevationProfile(_ coords: [[Double]], terrainHint: DesignTerrain) async -> (profile: [Double], gainM: Int) {
        guard !coords.isEmpty else { return ([12, 14, 15, 13, 12], 18) }
        let sampleCount = min(14, coords.count)
        var sampled: [[Double]] = []
        for i in 0..<sampleCount {
            let idx = Int((Double(i) / Double(max(1, sampleCount - 1))) * Double(coords.count - 1))
            sampled.append(coords[idx])
        }
        let lats = sampled.map { String(format: "%.4f", $0[1]) }.joined(separator: ",")
        let lons = sampled.map { String(format: "%.4f", $0[0]) }.joined(separator: ",")
        let urlStr = "https://api.open-meteo.com/v1/elevation?latitude=\(lats)&longitude=\(lons)"

        if let url = URL(string: urlStr),
           let (data, resp) = try? await session.data(from: url),
           (resp as? HTTPURLResponse)?.statusCode == 200,
           let parsed = try? JSONDecoder().decode(ElevationResponse.self, from: data),
           let elev = parsed.elevation,
           elev.count >= 2 {
            var gain = 0.0
            for i in 1..<elev.count {
                let diff = elev[i] - elev[i - 1]
                if diff > 1.5 { gain += diff }
            }
            return (elev.map { $0.rounded() }, max(10, Int(gain.rounded())))
        }

        switch terrainHint {
        case .flat: return ([10, 12, 13, 11, 14, 12, 10], 22)
        case .balanced: return ([15, 28, 42, 35, 50, 32, 18], 95)
        case .hilly: return ([20, 65, 118, 165, 140, 88, 28], 245)
        }
    }

    // MARK: - Design Custom Route (Melbourne, Sydney, or Anywhere on Earth)

    static func designCustomRoute(
        startCoord: CLLocationCoordinate2D,
        startLabel: String,
        targetKm: Double,
        terrain: DesignTerrain,
        shape: DesignShape,
        mustHaves: Set<String>,
        variationIndex: Int,
        anchorsBundle: AnchorsBundle
    ) async -> (route: CyclingRoute, rationale: String) {
        let regionKind = detectRegion(startCoord)
        let chosenAnchors: [ScenicAnchor]
        if regionKind == "global" {
            chosenAnchors = buildGlobalAnchors(start: startCoord, targetKm: targetKm, shape: shape, terrain: terrain, variationIndex: variationIndex)
        } else {
            let pool = regionKind == "sydney" ? anchorsBundle.sydney : anchorsBundle.melbourne
            chosenAnchors = pickCuratedAnchors(
                pool: pool,
                start: startCoord,
                targetKm: targetKm,
                terrain: terrain,
                shape: shape,
                mustHaves: mustHaves,
                variationIndex: variationIndex
            )
        }

        var waypoints: [CLLocationCoordinate2D] = [startCoord] + chosenAnchors.map(\.coordinate)
        if shape == .loop {
            waypoints.append(startCoord)
        }

        var geom = await fetchBikeGeometry(waypoints)
        // Coastal guard: rotate heading if global points landed in water
        if regionKind == "global" && geom.coords.count <= waypoints.count {
            let rotated = buildGlobalAnchors(
                start: startCoord,
                targetKm: targetKm,
                shape: shape,
                terrain: terrain,
                variationIndex: variationIndex + 2
            )
            var altWps = [startCoord] + rotated.map(\.coordinate)
            if shape == .loop { altWps.append(startCoord) }
            geom = await fetchBikeGeometry(altWps)
        }

        let elev = await fetchElevationProfile(geom.coords, terrainHint: terrain)
        let isFlat = elev.gainM <= 65 || (Double(elev.gainM) / max(1.0, geom.distanceKm)) < 3.2
        let anyGravel = chosenAnchors.contains(where: \.isGravel)
        let allCarFree = chosenAnchors.allSatisfy(\.carFree)
        let fallbackPhoto = regionKind == "sydney" ? "sydney-harbour" : "albert"

        let landmarks = buildLandmarks(
            startCoord: startCoord,
            startLabel: startLabel,
            anchors: chosenAnchors,
            shape: shape,
            coords: geom.coords,
            fallbackPhoto: fallbackPhoto
        )

        let gmapsUrl = buildGoogleMapsURL(from: waypoints)
        let shortPrimary = chosenAnchors.first?.name
            .components(separatedBy: " & ").first?
            .components(separatedBy: " (").first?
            .split(separator: " ")
            .prefix(3)
            .joined(separator: " ") ?? "Scenic"

        let routeTitle = shape == .loop
            ? "\(startLabel) → \(shortPrimary) Loop"
            : "\(startLabel) → \(chosenAnchors.last?.name ?? "Scenic Ride")"

        let anchorNames = chosenAnchors.map(\.name).joined(separator: " & ")
        let rationale = "Starting near \(startLabel) · via \(anchorNames) · +\(elev.gainM) m climb"

        let hlSlice = Array(landmarks.prefix(3))
        let highlights: [RouteHighlight] = hlSlice.enumerated().map { idx, lm in
            RouteHighlight(
                icon: lm.icon,
                title: String(lm.label.prefix(24)),
                sub: idx == 0 ? "Custom start" : "Stop \(idx)",
                landmarkIndex: idx
            )
        }

        let route = CyclingRoute(
            id: "custom-designed-route",
            name: routeTitle,
            shortName: "✨ Your Custom Ride",
            subtitle: "\(startLabel) → \(chosenAnchors.map(\.name).joined(separator: " → "))\(shape == .loop ? " → Return" : "")",
            vibe: chosenAnchors.first?.hasWater == true ? "coastal" : (isFlat ? "city" : "river"),
            isFlat: isFlat,
            flatLabel: isFlat ? "🥞 Custom Flat (+\(elev.gainM) m)" : "Custom (+\(elev.gainM) m)",
            effort: geom.durationMin < 65 ? "short" : (geom.durationMin <= 125 ? "medium" : "long"),
            durationLabel: CyclingMath.formatDuration(geom.durationMin),
            distanceKm: geom.distanceKm,
            elevationM: elev.gainM,
            carFree: allCarFree,
            isGravel: anyGravel,
            comfortBadge: isFlat ? "🥞 Custom Flat Ride" : (allCarFree ? "🌳 Trail-Focused" : "✨ Tailored Route"),
            tramBadge: regionKind == "melbourne" ? "🚋 Low-Tram Bikeways" : "🚲 Bikeway-Focused",
            ribbonHex: "#0f766e",
            photoName: chosenAnchors.first?.photoName ?? fallbackPhoto,
            gmapsUrl: gmapsUrl,
            surfaces: anyGravel
                ? [
                    RouteSurfaceSegment(label: "Sealed bikeways", pct: 65, color: "#0f766e"),
                    RouteSurfaceSegment(label: "Fine gravel trail", pct: 35, color: "#d97706"),
                ]
                : [
                    RouteSurfaceSegment(label: "Bike paths & greenways", pct: 84, color: "#0f766e"),
                    RouteSurfaceSegment(label: "Quiet connector streets", pct: 16, color: "#0284c7"),
                ],
            highlights: highlights,
            coordinates: geom.coords,
            elevProfile: elev.profile,
            landmarks: landmarks
        )

        return (route, rationale)
    }

    // MARK: - Live Recalculate Route From Edited Waypoints

    static func rerouteFromWaypoints(routeName: String, landmarks: [RouteLandmark]) async -> CyclingRoute {
        let clamped = Array(landmarks.prefix(8))
        let rawCoords = clamped.map(\.coordinate)
        let geom = await fetchBikeGeometry(rawCoords)
        let elev = await fetchElevationProfile(geom.coords, terrainHint: .balanced)
        let isFlat = elev.gainM <= 65 || (Double(elev.gainM) / max(1.0, geom.distanceKm)) < 3.2

        let updatedLandmarks = mapLandmarksOntoPolyline(clamped, coords: geom.coords)
        let hlPick = Array(updatedLandmarks.prefix(3))
        let highlights = hlPick.enumerated().map { idx, lm in
            RouteHighlight(
                icon: lm.icon,
                title: String(lm.label.prefix(22)),
                sub: idx == 0 ? "Start" : "Stop \(idx)",
                landmarkIndex: idx
            )
        }

        return CyclingRoute(
            id: "custom-designed-route",
            name: routeName.contains("(Edited)") ? routeName : "\(routeName) (Edited)",
            shortName: "✏️ Edited Ride",
            subtitle: clamped.map(\.label).joined(separator: " → "),
            vibe: isFlat ? "city" : "river",
            isFlat: isFlat,
            flatLabel: isFlat ? "🥞 Custom Flat (+\(elev.gainM) m)" : "Edited (+\(elev.gainM) m)",
            effort: geom.durationMin < 65 ? "short" : (geom.durationMin <= 125 ? "medium" : "long"),
            durationLabel: CyclingMath.formatDuration(geom.durationMin),
            distanceKm: geom.distanceKm,
            elevationM: elev.gainM,
            carFree: false,
            isGravel: false,
            comfortBadge: "✏️ Custom Edited Route",
            tramBadge: "🚲 Live Recalculated",
            ribbonHex: "#0f766e",
            photoName: clamped.first?.photoName ?? "greenway",
            gmapsUrl: buildGoogleMapsURL(from: rawCoords),
            surfaces: [
                RouteSurfaceSegment(label: "Bikeways & trails", pct: 80, color: "#0f766e"),
                RouteSurfaceSegment(label: "Connector streets", pct: 20, color: "#0284c7"),
            ],
            highlights: highlights,
            coordinates: geom.coords,
            elevProfile: elev.profile,
            landmarks: updatedLandmarks
        )
    }

    // MARK: - Internal Routing Helpers

    private static func detectRegion(_ coord: CLLocationCoordinate2D) -> String {
        if coord.longitude >= 144.3 && coord.longitude <= 145.75 && coord.latitude >= -38.55 && coord.latitude <= -37.4 {
            return "melbourne"
        }
        if coord.longitude >= 150.55 && coord.longitude <= 151.45 && coord.latitude >= -34.25 && coord.latitude <= -33.4 {
            return "sydney"
        }
        return "global"
    }

    private static func buildGlobalAnchors(
        start: CLLocationCoordinate2D,
        targetKm: Double,
        shape: DesignShape,
        terrain: DesignTerrain,
        variationIndex: Int
    ) -> [ScenicAnchor] {
        let heading = Double((35 + max(0, variationIndex) * 72) % 360)
        let dir1 = CyclingMath.compassDirectionName(heading)
        let dir2 = CyclingMath.compassDirectionName(heading + 68)
        let terr = terrain == .hilly ? "hilly" : "flat"

        if shape == .oneway {
            let legKm = max(2.5, targetKm / 1.38)
            let mid = CyclingMath.destinationCoordinate(from: start, bearingDeg: heading - 14, distanceKm: legKm * 0.52)
            let dest = CyclingMath.destinationCoordinate(from: start, bearingDeg: heading, distanceKm: legKm)
            return [
                ScenicAnchor(id: "g-mid-\(variationIndex)", name: "\(dir1) Bikeway Stop", icon: "☕", lngLat: [mid.longitude, mid.latitude], terrain: terr, carFree: true, hasCafe: true, hasWater: false, tramSafe: true, hasTrain: false, isGravel: false, photoName: "greenway", note: "Mid-ride cycling stop"),
                ScenicAnchor(id: "g-end-\(variationIndex)", name: "\(dir1) Finish Point", icon: "🚆", lngLat: [dest.longitude, dest.latitude], terrain: terr, carFree: true, hasCafe: true, hasWater: false, tramSafe: true, hasTrain: true, isGravel: false, photoName: "yarra", note: "One-way cycling destination"),
            ]
        }

        let radiusKm = max(1.8, targetKm / 4.25)
        let ptA = CyclingMath.destinationCoordinate(from: start, bearingDeg: heading, distanceKm: radiusKm)
        let ptB = CyclingMath.destinationCoordinate(from: start, bearingDeg: heading + 68, distanceKm: radiusKm)
        return [
            ScenicAnchor(id: "g-a-\(variationIndex)", name: "\(dir1) Scenic Bikeway", icon: "☕", lngLat: [ptA.longitude, ptA.latitude], terrain: terr, carFree: true, hasCafe: true, hasWater: false, tramSafe: true, hasTrain: false, isGravel: false, photoName: "greenway", note: "Outbound cycling leg"),
            ScenicAnchor(id: "g-b-\(variationIndex)", name: "\(dir2) Return Trail", icon: "🌿", lngLat: [ptB.longitude, ptB.latitude], terrain: terr, carFree: true, hasCafe: true, hasWater: false, tramSafe: true, hasTrain: false, isGravel: false, photoName: "yarra", note: "Return cycling loop"),
        ]
    }

    private static func pickCuratedAnchors(
        pool: [ScenicAnchor],
        start: CLLocationCoordinate2D,
        targetKm: Double,
        terrain: DesignTerrain,
        shape: DesignShape,
        mustHaves: Set<String>,
        variationIndex: Int
    ) -> [ScenicAnchor] {
        guard !pool.isEmpty else {
            return buildGlobalAnchors(start: start, targetKm: targetKm, shape: shape, terrain: terrain, variationIndex: variationIndex)
        }
        let idealDist = shape == .loop ? max(2.2, targetKm / 3.2) : max(3.5, targetKm / 1.45)

        let scored = pool.map { anchor -> (ScenicAnchor, Double) in
            let d = CyclingMath.haversineKm(start, anchor.coordinate)
            var score = 100.0 - abs(d - idealDist) * 7.5
            if d < 1.2 { score -= 35 }
            if terrain == .flat {
                if anchor.terrain == "flat" { score += 26 }
                else if anchor.terrain == "hilly" { score -= 45 }
            } else if terrain == .hilly {
                if anchor.terrain == "hilly" { score += 35 }
            }
            if mustHaves.contains("carFree") && anchor.carFree { score += 16 }
            if mustHaves.contains("cafe") && anchor.hasCafe { score += 14 }
            if mustHaves.contains("water") && anchor.hasWater { score += 14 }
            if shape == .oneway && anchor.hasTrain { score += 18 }
            return (anchor, score)
        }.sorted(by: { $0.1 > $1.1 })

        let primaryIdx = max(0, variationIndex) % min(6, scored.count)
        let first = scored[primaryIdx].0

        let second = scored.first(where: { cand in
            cand.0.id != first.id && CyclingMath.haversineKm(first.coordinate, cand.0.coordinate) >= 2.0
        })?.0

        if let second {
            return [first, second]
        }
        return [first]
    }

    private static func buildLandmarks(
        startCoord: CLLocationCoordinate2D,
        startLabel: String,
        anchors: [ScenicAnchor],
        shape: DesignShape,
        coords: [[Double]],
        fallbackPhoto: String
    ) -> [RouteLandmark] {
        var raw: [RouteLandmark] = [
            RouteLandmark(
                ratio: 0,
                icon: "🏠",
                label: "Start: \(startLabel)",
                photoName: anchors.first?.photoName ?? fallbackPhoto,
                note: "Your starting point",
                lngLat: [startCoord.longitude, startCoord.latitude]
            )
        ]
        for anchor in anchors {
            raw.append(RouteLandmark(
                ratio: 0.5,
                icon: anchor.icon,
                label: anchor.name,
                photoName: anchor.photoName,
                note: anchor.note,
                lngLat: anchor.lngLat
            ))
        }
        if shape == .loop {
            raw.append(RouteLandmark(
                ratio: 1.0,
                icon: "🏁",
                label: "Finish back at \(startLabel)",
                photoName: anchors.last?.photoName ?? fallbackPhoto,
                note: "Completes your cycling loop",
                lngLat: [startCoord.longitude, startCoord.latitude]
            ))
        }
        return mapLandmarksOntoPolyline(raw, coords: coords)
    }

    private static func mapLandmarksOntoPolyline(_ raw: [RouteLandmark], coords: [[Double]]) -> [RouteLandmark] {
        guard coords.count >= 2 else { return raw }
        var cumArc: [Double] = [0]
        for i in 1..<coords.count {
            let d = hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1])
            cumArc.append(cumArc[i - 1] + d)
        }
        let totalArc = max(1e-9, cumArc.last ?? 1.0)
        var minSearch = 0

        return raw.enumerated().map { idx, lm in
            if idx == 0 {
                minSearch = 1
                return RouteLandmark(ratio: 0, icon: lm.icon, label: lm.label, photoName: lm.photoName, note: lm.note, lngLat: coords[0])
            }
            if idx == raw.count - 1 {
                return RouteLandmark(ratio: 1, icon: lm.icon, label: lm.label, photoName: lm.photoName, note: lm.note, lngLat: coords[coords.count - 1])
            }
            let maxSearch = max(minSearch, coords.count - 2)
            var bestIdx = minSearch
            var bestDist = Double.infinity
            for k in minSearch...maxSearch {
                let d = CyclingMath.haversineKm(
                    CLLocationCoordinate2D(latitude: coords[k][1], longitude: coords[k][0]),
                    lm.coordinate
                )
                if d < bestDist {
                    bestDist = d
                    bestIdx = k
                }
            }
            minSearch = min(maxSearch, bestIdx + 1)
            let ratio = max(0.05, min(0.95, ((cumArc[bestIdx] / totalArc) * 1000.0).rounded() / 1000.0))
            return RouteLandmark(ratio: ratio, icon: lm.icon, label: lm.label, photoName: lm.photoName, note: lm.note, lngLat: coords[bestIdx])
        }
    }

    private static func buildGoogleMapsURL(from waypoints: [CLLocationCoordinate2D]) -> String {
        guard let first = waypoints.first, let last = waypoints.last else {
            return "https://www.google.com/maps"
        }
        let origin = String(format: "%.5f,%.5f", first.latitude, first.longitude)
        let dest = String(format: "%.5f,%.5f", last.latitude, last.longitude)
        let mids = waypoints.dropFirst().dropLast()
            .map { String(format: "%.5f,%.5f", $0.latitude, $0.longitude) }
            .joined(separator: "|")
        let encMids = mids.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let wpClause = encMids.isEmpty ? "" : "&waypoints=\(encMids)"
        return "https://www.google.com/maps/dir/?api=1&origin=\(origin)&destination=\(dest)\(wpClause)&travelmode=bicycling"
    }
}
