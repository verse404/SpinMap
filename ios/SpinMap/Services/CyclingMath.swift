import CoreLocation
import Foundation

enum CyclingMath {
    // MARK: - Bike Pace & Suitability

    static func estimateRideMinutes(route: CyclingRoute, bikeType: BikeType) -> Int {
        let climbFactor: Double
        switch bikeType {
        case .ebike: climbFactor = 0.015
        case .road: climbFactor = 0.035
        case .cruiser, .gravel: climbFactor = 0.05
        }
        let gravelFactor = (route.isGravel && bikeType == .road) ? 1.15 : 1.0
        let baseMins = (route.distanceKm / bikeType.speedKmh) * 60.0 * gravelFactor
        return max(15, Int((baseMins + Double(route.elevationM) * climbFactor).rounded()))
    }

    static func formatDuration(_ totalMinutes: Int) -> String {
        let h = totalMinutes / 60
        let roundedMins = Int((Double(totalMinutes % 60) / 5.0).rounded()) * 5
        let safeMins = roundedMins == 60 ? 55 : roundedMins
        if h == 0 {
            return "0h \(max(15, safeMins))m"
        }
        return String(format: "%dh %02dm", h, safeMins)
    }

    static func bikeSuitabilityNote(route: CyclingRoute, bikeType: BikeType) -> BikeSuitabilityNote {
        if route.isGravel && bikeType == .road {
            return BikeSuitabilityNote(isWarning: true, label: "⚠️ Gravel trail · 28mm+ tyres advised")
        }
        if route.elevationM >= 220 && bikeType == .cruiser {
            return BikeSuitabilityNote(isWarning: true, label: "⛰️ Steep climb for a cruiser bike")
        }
        if bikeType == .ebike && route.elevationM >= 180 {
            return BikeSuitabilityNote(isWarning: false, label: "⚡ E-Bike flattens these hills")
        }
        if route.isGravel && bikeType == .gravel {
            return BikeSuitabilityNote(isWarning: false, label: "🌲 Ideal gravel match")
        }
        if route.isFlat && bikeType == .cruiser {
            return BikeSuitabilityNote(isWarning: false, label: "🥞 Effortless cruiser ride")
        }
        return BikeSuitabilityNote(isWarning: false, label: "\(bikeType.icon) Great match")
    }

    // MARK: - Geometry, Interpolation & Distance

    static func haversineKm(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let r = 6371.0
        let dLat = (b.latitude - a.latitude) * .pi / 180.0
        let dLon = (b.longitude - a.longitude) * .pi / 180.0
        let lat1 = a.latitude * .pi / 180.0
        let lat2 = b.latitude * .pi / 180.0
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * r * atan2(sqrt(h), sqrt(max(0, 1 - h)))
    }

    static func destinationCoordinate(
        from start: CLLocationCoordinate2D,
        bearingDeg: Double,
        distanceKm: Double
    ) -> CLLocationCoordinate2D {
        let r = 6371.0
        let brng = bearingDeg * .pi / 180.0
        let lat1 = start.latitude * .pi / 180.0
        let lon1 = start.longitude * .pi / 180.0
        let angDist = distanceKm / r
        let lat2 = asin(sin(lat1) * cos(angDist) + cos(lat1) * sin(angDist) * cos(brng))
        let lon2 = lon1 + atan2(
            sin(brng) * sin(angDist) * cos(lat1),
            cos(angDist) - sin(lat1) * sin(lat2)
        )
        return CLLocationCoordinate2D(latitude: lat2 * 180.0 / .pi, longitude: lon2 * 180.0 / .pi)
    }

    static func interpolateCoordinate(along coords: [CLLocationCoordinate2D], ratio: Double) -> CLLocationCoordinate2D {
        guard let first = coords.first else {
            return CLLocationCoordinate2D(latitude: -37.8136, longitude: 144.9631)
        }
        if coords.count == 1 || ratio <= 0 { return first }
        if ratio >= 1 { return coords.last ?? first }

        var segs: [Double] = []
        segs.reserveCapacity(coords.count - 1)
        var total = 0.0
        for i in 0..<(coords.count - 1) {
            let d = hypot(
                coords[i + 1].longitude - coords[i].longitude,
                coords[i + 1].latitude - coords[i].latitude
            )
            segs.append(d)
            total += d
        }
        guard total > 0 else { return first }

        var target = ratio * total
        for i in 0..<segs.count {
            if target <= segs[i] {
                let t = segs[i] == 0 ? 0 : target / segs[i]
                return CLLocationCoordinate2D(
                    latitude: coords[i].latitude + (coords[i + 1].latitude - coords[i].latitude) * t,
                    longitude: coords[i].longitude + (coords[i + 1].longitude - coords[i].longitude) * t
                )
            }
            target -= segs[i]
        }
        return coords.last ?? first
    }

    static func nearestLandmark(in route: CyclingRoute, ratio: Double) -> RouteLandmark? {
        route.landmarks.min(by: { abs($0.ratio - ratio) < abs($1.ratio - ratio) })
    }

    static func elevationAt(profile: [Double], ratio: Double) -> Int {
        guard !profile.isEmpty else { return 0 }
        let clamped = max(0, min(1, ratio))
        let fIdx = clamped * Double(profile.count - 1)
        let i0 = Int(floor(fIdx))
        let i1 = min(profile.count - 1, Int(ceil(fIdx)))
        let val = profile[i0] + (profile[i1] - profile[i0]) * (fIdx - Double(i0))
        return Int(val.rounded())
    }

    static func insertWaypointIndex(landmarks: [RouteLandmark], newCoord: CLLocationCoordinate2D) -> Int {
        guard landmarks.count > 1 else { return landmarks.count }
        var bestIdx = landmarks.count - 1
        var bestAdded = Double.infinity
        for i in 0..<(landmarks.count - 1) {
            let a = landmarks[i].coordinate
            let b = landmarks[i + 1].coordinate
            let dAB = hypot(b.longitude - a.longitude, b.latitude - a.latitude)
            let dAP = hypot(newCoord.longitude - a.longitude, newCoord.latitude - a.latitude)
            let dPB = hypot(b.longitude - newCoord.longitude, b.latitude - newCoord.latitude)
            let added = dAP + dPB - dAB
            if added < bestAdded {
                bestAdded = added
                bestIdx = i + 1
            }
        }
        return bestIdx
    }

    // MARK: - Live Headwind / Crosswind / Tailwind Analysis

    private static func segmentBearingDeg(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let latAvg = ((a.latitude + b.latitude) / 2.0) * .pi / 180.0
        let dx = (b.longitude - a.longitude) * cos(latAvg)
        let dy = b.latitude - a.latitude
        let raw = atan2(dx, dy) * 180.0 / .pi
        return (raw + 360.0).truncatingRemainder(dividingBy: 360.0)
    }

    static func analyzeRouteWind(
        coordinates: [CLLocationCoordinate2D],
        windFromDeg: Int,
        windKmh: Int
    ) -> RouteWindSummary {
        guard coordinates.count >= 2 else {
            return RouteWindSummary(
                tailwindPct: 33,
                crosswindPct: 34,
                headwindPct: 33,
                finishKind: .crosswind,
                finishLabel: "Calm air",
                segments: []
            )
        }

        // Meteorological wind direction is where wind blows FROM; riders are pushed toward +180°
        let windToDeg = Double((windFromDeg + 180) % 360)
        let finishStartIdx = Int(Double(coordinates.count - 1) * 0.68)

        var tailLen = 0.0
        var crossLen = 0.0
        var headLen = 0.0
        var finishDotSum = 0.0
        var finishLen = 0.0

        var segments: [WindSegment] = []
        var currentKind: WindKind?
        var currentPts: [CLLocationCoordinate2D] = []

        for i in 0..<(coordinates.count - 1) {
            let a = coordinates[i]
            let b = coordinates[i + 1]
            let segLen = hypot(b.longitude - a.longitude, b.latitude - a.latitude)
            if segLen < 1e-7 { continue }

            let brg = segmentBearingDeg(a, b)
            let diffRad = (brg - windToDeg) * .pi / 180.0
            let alignment = cos(diffRad)

            let kind: WindKind
            if alignment >= 0.35 {
                kind = .tailwind
                tailLen += segLen
            } else if alignment <= -0.35 {
                kind = .headwind
                headLen += segLen
            } else {
                kind = .crosswind
                crossLen += segLen
            }

            if i >= finishStartIdx {
                finishDotSum += alignment * segLen
                finishLen += segLen
            }

            if kind == currentKind {
                currentPts.append(b)
            } else {
                if let prevKind = currentKind, currentPts.count >= 2 {
                    segments.append(WindSegment(id: segments.count, kind: prevKind, coordinates: currentPts))
                }
                currentKind = kind
                currentPts = [a, b]
            }
        }
        if let prevKind = currentKind, currentPts.count >= 2 {
            segments.append(WindSegment(id: segments.count, kind: prevKind, coordinates: currentPts))
        }

        let total = max(1e-9, tailLen + crossLen + headLen)
        let tailwindPct = Int(((tailLen / total) * 100.0).rounded())
        let headwindPct = Int(((headLen / total) * 100.0).rounded())
        let crosswindPct = max(0, 100 - tailwindPct - headwindPct)

        let finishAvg = finishLen > 0 ? finishDotSum / finishLen : 0
        let finishKind: WindKind = finishAvg >= 0.28 ? .tailwind : (finishAvg <= -0.28 ? .headwind : .crosswind)

        let finishLabel: String
        if windKmh < 10 {
            finishLabel = "Calm air across the route"
        } else {
            switch finishKind {
            case .tailwind: finishLabel = "🍃 Tailwind finish home"
            case .headwind: finishLabel = "💨 Headwind finish — try Reverse"
            case .crosswind: finishLabel = "🌬️ Crosswind finish"
            }
        }

        return RouteWindSummary(
            tailwindPct: tailwindPct,
            crosswindPct: crosswindPct,
            headwindPct: headwindPct,
            finishKind: finishKind,
            finishLabel: finishLabel,
            segments: segments
        )
    }

    // MARK: - Reverse Route

    static func reverseRoute(_ route: CyclingRoute) -> CyclingRoute {
        let revCoords = Array(route.coordinates.reversed())
        let revElev = Array(route.elevProfile.reversed())
        let revLandmarks: [RouteLandmark] = route.landmarks.reversed().map { lm in
            let flippedRatio = max(0, min(1, ((1.0 - lm.ratio) * 1000.0).rounded() / 1000.0))
            return RouteLandmark(
                ratio: flippedRatio,
                icon: lm.icon,
                label: lm.label,
                photoName: lm.photoName,
                note: lm.note,
                lngLat: lm.lngLat
            )
        }
        let revHighlights: [RouteHighlight] = route.highlights.reversed().map { hl in
            RouteHighlight(
                icon: hl.icon,
                title: hl.title,
                sub: hl.sub,
                landmarkIndex: max(0, revLandmarks.count - 1 - hl.landmarkIndex)
            )
        }

        let subParts = route.subtitle
            .components(separatedBy: "→")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let revSubtitle = subParts.count > 1
            ? subParts.reversed().joined(separator: " → ")
            : "\(route.subtitle) (Reversed)"

        let revGmaps: String
        if let first = revCoords.first, let last = revCoords.last, first.count >= 2, last.count >= 2 {
            let origin = String(format: "%.5f,%.5f", first[1], first[0])
            let dest = String(format: "%.5f,%.5f", last[1], last[0])
            let mids = revLandmarks
                .dropFirst()
                .dropLast()
                .compactMap { lm -> String? in
                    guard lm.lngLat.count >= 2 else { return nil }
                    return String(format: "%.5f,%.5f", lm.lngLat[1], lm.lngLat[0])
                }
                .joined(separator: "|")
            let encodedMids = mids.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
            let wpClause = encodedMids.isEmpty ? "" : "&waypoints=\(encodedMids)"
            revGmaps = "https://www.google.com/maps/dir/?api=1&origin=\(origin)&destination=\(dest)\(wpClause)&travelmode=bicycling"
        } else {
            revGmaps = route.gmapsUrl
        }

        return CyclingRoute(
            id: route.id,
            name: route.name,
            shortName: route.shortName,
            subtitle: revSubtitle,
            vibe: route.vibe,
            isFlat: route.isFlat,
            flatLabel: route.flatLabel,
            effort: route.effort,
            durationLabel: route.durationLabel,
            distanceKm: route.distanceKm,
            elevationM: route.elevationM,
            carFree: route.carFree,
            isGravel: route.isGravel,
            comfortBadge: route.comfortBadge,
            tramBadge: route.tramBadge,
            ribbonHex: route.ribbonHex,
            photoName: route.photoName,
            gmapsUrl: revGmaps,
            surfaces: route.surfaces,
            highlights: revHighlights,
            coordinates: revCoords,
            elevProfile: revElev,
            landmarks: revLandmarks
        )
    }

    // MARK: - GPX 1.1 Generation (XML-Safe)

    static func escapeXML(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

    static func generateGPX(for route: CyclingRoute, isReversed: Bool = false) -> GPXShareDocument {
        let trkpts = route.coordinates.compactMap { pair -> String? in
            guard pair.count >= 2 else { return nil }
            return String(format: "      <trkpt lat=\"%.5f\" lon=\"%.5f\"></trkpt>", pair[1], pair[0])
        }.joined(separator: "\n")

        let safeName = escapeXML(route.name)
        let safeDesc = escapeXML(route.subtitle)
        let xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="SpinMap iOS" xmlns="http://www.topografix.com/GPX/1/1">
          <metadata>
            <name>\(safeName)</name>
            <desc>\(safeDesc)</desc>
          </metadata>
          <trk>
            <name>\(safeName)</name>
            <trkseg>
        \(trkpts)
            </trkseg>
          </trk>
        </gpx>
        """

        let safeSlug = route.id.replacingOccurrences(of: "[^a-zA-Z0-9_-]", with: "-", options: .regularExpression)
        let fileName = isReversed ? "\(safeSlug)-reversed.gpx" : "\(safeSlug).gpx"
        return GPXShareDocument(fileName: fileName, xmlString: xml)
    }

    static func compassDirectionName(_ bearingDeg: Double) -> String {
        let dirs = ["North", "North-East", "East", "South-East", "South", "South-West", "West", "North-West"]
        let idx = Int(((bearingDeg.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 45.0).rounded()) % 8
        return dirs[idx]
    }
}
