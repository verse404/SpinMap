import CoreLocation
import Foundation
import MapKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Core Route Models

struct RouteLandmark: Codable, Identifiable, Hashable, Sendable {
    let ratio: Double
    let icon: String
    let label: String
    let photoName: String
    let note: String
    /// Stored as [longitude, latitude] to match GeoJSON / RoutesBundle.json
    let lngLat: [Double]

    var id: String { "\(label)-\(String(format: "%.3f", ratio))" }

    var coordinate: CLLocationCoordinate2D {
        guard lngLat.count >= 2 else { return CLLocationCoordinate2D(latitude: -37.8136, longitude: 144.9631) }
        return CLLocationCoordinate2D(latitude: lngLat[1], longitude: lngLat[0])
    }

    enum CodingKeys: String, CodingKey {
        case ratio, icon, label, photoName, note, lngLat
    }
}

struct RouteSurfaceSegment: Codable, Identifiable, Hashable, Sendable {
    let label: String
    let pct: Int
    let color: String

    var id: String { "\(label)-\(pct)" }
}

struct RouteHighlight: Codable, Identifiable, Hashable, Sendable {
    let icon: String
    let title: String
    let sub: String
    let landmarkIndex: Int

    var id: String { "\(title)-\(landmarkIndex)" }
}

struct CyclingRoute: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let shortName: String
    let subtitle: String
    let vibe: String
    let isFlat: Bool
    let flatLabel: String
    let effort: String
    let durationLabel: String
    let distanceKm: Double
    let elevationM: Int
    let carFree: Bool
    let isGravel: Bool
    let comfortBadge: String
    let tramBadge: String
    let ribbonHex: String
    let photoName: String
    let gmapsUrl: String
    let surfaces: [RouteSurfaceSegment]
    let highlights: [RouteHighlight]
    /// Array of [longitude, latitude] pairs from real OSM routed-bike geometry
    let coordinates: [[Double]]
    let elevProfile: [Double]
    let landmarks: [RouteLandmark]

    var clCoordinates: [CLLocationCoordinate2D] {
        coordinates.compactMap { pair in
            guard pair.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
        }
    }

    var region: MKCoordinateRegion {
        let pts = clCoordinates
        guard let first = pts.first else {
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: -37.845, longitude: 144.968),
                span: MKCoordinateSpan(latitudeDelta: 0.12, longitudeDelta: 0.12)
            )
        }
        var minLat = first.latitude
        var maxLat = first.latitude
        var minLon = first.longitude
        var maxLon = first.longitude
        for p in pts {
            minLat = min(minLat, p.latitude)
            maxLat = max(maxLat, p.latitude)
            minLon = min(minLon, p.longitude)
            maxLon = max(maxLon, p.longitude)
        }
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2.0,
            longitude: (minLon + maxLon) / 2.0
        )
        let latDelta = max(0.015, (maxLat - minLat) * 1.42)
        let lonDelta = max(0.015, (maxLon - minLon) * 1.42)
        return MKCoordinateRegion(
            center: center,
            span: MKCoordinateSpan(latitudeDelta: latDelta, longitudeDelta: lonDelta)
        )
    }

    var appleMapsURL: URL? {
        guard let origin = clCoordinates.first, let dest = clCoordinates.last else { return nil }
        let saddr = String(format: "%.5f,%.5f", origin.latitude, origin.longitude)
        let daddr = String(format: "%.5f,%.5f", dest.latitude, dest.longitude)
        // dirflg=c opens Apple Maps in cycling directions mode where supported
        return URL(string: "https://maps.apple.com/?saddr=\(saddr)&daddr=\(daddr)&dirflg=c")
    }

    var googleMapsAppURL: URL? {
        guard let origin = clCoordinates.first, let dest = clCoordinates.last else { return nil }
        let saddr = String(format: "%.5f,%.5f", origin.latitude, origin.longitude)
        let daddr = String(format: "%.5f,%.5f", dest.latitude, dest.longitude)
        return URL(string: "comgooglemaps://?saddr=\(saddr)&daddr=\(daddr)&directionsmode=bicycling")
    }

    var googleMapsWebURL: URL? {
        URL(string: gmapsUrl)
    }
}

struct RoutesBundle: Codable, Sendable {
    let melbourne: [CyclingRoute]
    let sydney: [CyclingRoute]
}

// MARK: - Scenic Anchors for Offline-Assisted Custom Route Design

struct ScenicAnchor: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let icon: String
    let lngLat: [Double]
    let terrain: String
    let carFree: Bool
    let hasCafe: Bool
    let hasWater: Bool
    let tramSafe: Bool
    let hasTrain: Bool
    let isGravel: Bool
    let photoName: String
    let note: String

    var coordinate: CLLocationCoordinate2D {
        guard lngLat.count >= 2 else { return CLLocationCoordinate2D(latitude: -37.8136, longitude: 144.9631) }
        return CLLocationCoordinate2D(latitude: lngLat[1], longitude: lngLat[0])
    }
}

struct AnchorsBundle: Codable, Sendable {
    let melbourne: [ScenicAnchor]
    let sydney: [ScenicAnchor]
}

// MARK: - City Configuration

struct CityConfig: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let regionLabel: String
    let latitude: Double
    let longitude: Double
    let spanDelta: Double
    let defaultWindLabel: String
    let windShelterTip: String
    let sampleSuburbs: [String]
    let avoidChipLabel: String
    let isBuiltIn: Bool

    var center: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var overviewRegion: MKCoordinateRegion {
        MKCoordinateRegion(
            center: center,
            span: MKCoordinateSpan(latitudeDelta: spanDelta, longitudeDelta: spanDelta)
        )
    }

    static let melbourne = CityConfig(
        id: "melbourne",
        name: "Melbourne",
        regionLabel: "Greater Melbourne",
        latitude: -37.845,
        longitude: 144.968,
        spanDelta: 0.24,
        defaultWindLabel: "Bay Breeze ↗",
        windShelterTip: "Creek trails sheltered",
        sampleSuburbs: ["Melbourne CBD", "St Kilda", "Fitzroy", "Hawthorn", "Box Hill", "Footscray"],
        avoidChipLabel: "Avoid Trams",
        isBuiltIn: true
    )

    static let sydney = CityConfig(
        id: "sydney",
        name: "Sydney",
        regionLabel: "Greater Sydney",
        latitude: -33.868,
        longitude: 151.195,
        spanDelta: 0.26,
        defaultWindLabel: "Harbour Breeze ↗",
        windShelterTip: "Park & lagoon paths sheltered",
        sampleSuburbs: ["Sydney CBD", "Surry Hills", "Bondi", "Marrickville", "Balmain", "Manly"],
        avoidChipLabel: "Quiet Bikeways",
        isBuiltIn: true
    )

    static let quickGlobalCities: [CityConfig] = [
        .melbourne,
        .sydney,
        CityConfig(
            id: "brisbane",
            name: "Brisbane",
            regionLabel: "Greater Brisbane",
            latitude: -27.4698,
            longitude: 153.0251,
            spanDelta: 0.16,
            defaultWindLabel: "River Breeze ↗",
            windShelterTip: "Riverwalk paths sheltered",
            sampleSuburbs: ["Brisbane CBD", "South Bank", "New Farm"],
            avoidChipLabel: "Quiet Bikeways",
            isBuiltIn: false
        ),
        CityConfig(
            id: "gold-coast",
            name: "Gold Coast",
            regionLabel: "Gold Coast",
            latitude: -28.0167,
            longitude: 153.4000,
            spanDelta: 0.16,
            defaultWindLabel: "Ocean Breeze ↗",
            windShelterTip: "Broadwater paths sheltered",
            sampleSuburbs: ["Surfers Paradise", "Burleigh Heads"],
            avoidChipLabel: "Quiet Bikeways",
            isBuiltIn: false
        ),
        CityConfig(
            id: "tokyo",
            name: "Tokyo",
            regionLabel: "Greater Tokyo",
            latitude: 35.6812,
            longitude: 139.7671,
            spanDelta: 0.16,
            defaultWindLabel: "Bay Breeze ↗",
            windShelterTip: "Riverside paths sheltered",
            sampleSuburbs: ["Imperial Palace", "Shibuya", "Arakawa"],
            avoidChipLabel: "Quiet Streets",
            isBuiltIn: false
        ),
        CityConfig(
            id: "amsterdam",
            name: "Amsterdam",
            regionLabel: "Greater Amsterdam",
            latitude: 52.3676,
            longitude: 4.9041,
            spanDelta: 0.14,
            defaultWindLabel: "North Sea Breeze ↗",
            windShelterTip: "Canal paths sheltered",
            sampleSuburbs: ["Centrum", "Vondelpark", "Amstel"],
            avoidChipLabel: "Bike Boulevards",
            isBuiltIn: false
        ),
        CityConfig(
            id: "san-francisco",
            name: "San Francisco",
            regionLabel: "San Francisco Bay",
            latitude: 37.7749,
            longitude: -122.4194,
            spanDelta: 0.14,
            defaultWindLabel: "Bay Breeze ↗",
            windShelterTip: "Golden Gate Park sheltered",
            sampleSuburbs: ["Embarcadero", "Golden Gate Park", "Presidio"],
            avoidChipLabel: "Slow Streets",
            isBuiltIn: false
        ),
        CityConfig(
            id: "london",
            name: "London",
            regionLabel: "Greater London",
            latitude: 51.5072,
            longitude: -0.1276,
            spanDelta: 0.16,
            defaultWindLabel: "Thames Breeze ↗",
            windShelterTip: "Regent's Canal sheltered",
            sampleSuburbs: ["Hyde Park", "South Bank", "Richmond Park"],
            avoidChipLabel: "Cycleways",
            isBuiltIn: false
        ),
    ]
}

// MARK: - Filters, Bike Types, Pit Stops, Wind & Weather

enum RideVibeFilter: String, CaseIterable, Identifiable {
    case all, flat, coastal, river, hills, city

    var id: String { rawValue }
    var icon: String {
        switch self {
        case .all: return "✨"
        case .flat: return "🥞"
        case .coastal: return "🌊"
        case .river: return "🌿"
        case .hills: return "⛰️"
        case .city: return "☕"
        }
    }
    var label: String {
        switch self {
        case .all: return "All Rides"
        case .flat: return "Super Flat"
        case .coastal: return "Coastal"
        case .river: return "River & Gums"
        case .hills: return "Hills"
        case .city: return "Leafy City"
        }
    }
}

enum EffortFilter: String, CaseIterable, Identifiable {
    case any, short, medium, long

    var id: String { rawValue }
    var label: String {
        switch self {
        case .any: return "Any Time"
        case .short: return "⚡ < 1 hr"
        case .medium: return "🌤️ 1–2 hrs"
        case .long: return "🏆 2+ hrs"
        }
    }
}

enum BikeType: String, CaseIterable, Codable, Identifiable, Sendable {
    case cruiser, ebike, road, gravel

    var id: String { rawValue }
    var icon: String {
        switch self {
        case .cruiser: return "🚲"
        case .ebike: return "⚡"
        case .road: return "🚴"
        case .gravel: return "🌲"
        }
    }
    var label: String {
        switch self {
        case .cruiser: return "Cruiser"
        case .ebike: return "E-Bike"
        case .road: return "Road"
        case .gravel: return "Gravel"
        }
    }
    var speedKmh: Double {
        switch self {
        case .cruiser: return 16
        case .ebike: return 23
        case .road: return 26
        case .gravel: return 21
        }
    }
}

struct BikeSuitabilityNote: Sendable {
    let isWarning: Bool
    let label: String
}

enum PitStopKind: String, CaseIterable, Identifiable, Hashable, Sendable {
    case cafe, water, toilet, repair

    var id: String { rawValue }
    var icon: String {
        switch self {
        case .cafe: return "☕"
        case .water: return "🚰"
        case .toilet: return "🚻"
        case .repair: return "🔧"
        }
    }
    var label: String {
        switch self {
        case .cafe: return "Cafes"
        case .water: return "Water"
        case .toilet: return "Toilets"
        case .repair: return "Repair"
        }
    }
    var searchQuery: String {
        switch self {
        case .cafe: return "coffee cafe"
        case .water: return "drinking water fountain park"
        case .toilet: return "public restroom toilet"
        case .repair: return "bicycle shop"
        }
    }
    var tintColor: Color {
        switch self {
        case .cafe: return Color(hex: "#b45309")
        case .water: return Color(hex: "#0284c7")
        case .toilet: return Color(hex: "#64748b")
        case .repair: return Color(hex: "#7c3aed")
        }
    }
}

struct PitStopPOI: Identifiable, Hashable, Sendable {
    let id: String
    let kind: PitStopKind
    let name: String
    let latitude: Double
    let longitude: Double

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

enum WindKind: String, Sendable {
    case tailwind, crosswind, headwind

    var color: Color {
        switch self {
        case .tailwind: return Color(hex: "#10b981")
        case .crosswind: return Color(hex: "#3b82f6")
        case .headwind: return Color(hex: "#f59e0b")
        }
    }
}

struct WindSegment: Identifiable, Sendable {
    let id: Int
    let kind: WindKind
    let coordinates: [CLLocationCoordinate2D]
}

struct RouteWindSummary: Sendable {
    let tailwindPct: Int
    let crosswindPct: Int
    let headwindPct: Int
    let finishKind: WindKind
    let finishLabel: String
    let segments: [WindSegment]
}

struct HourlyRideSlot: Identifiable, Sendable {
    let isoTime: String
    let hourLabel: String
    let tempC: Int
    let windKmh: Int
    let precipProb: Int
    let score: Int

    var id: String { isoTime }
}

struct LiveWeatherState: Sendable {
    let tempC: Int
    let windKmh: Int
    let windDeg: Int
    let windLabel: String
    let sunsetLabel: String
    let minutesToSunset: Int?
    let bestWindowLabel: String
    let hourly: [HourlyRideSlot]

    static func fallback(for city: CityConfig) -> LiveWeatherState {
        LiveWeatherState(
            tempC: 22,
            windKmh: 15,
            windDeg: 205,
            windLabel: city.defaultWindLabel,
            sunsetLabel: "7:45 pm",
            minutesToSunset: 240,
            bestWindowLabel: "Light breeze & mild skies",
            hourly: []
        )
    }
}

enum MapStyleChoice: String, CaseIterable, Identifiable {
    case standard, hybrid, imagery

    var id: String { rawValue }
    var label: String {
        switch self {
        case .standard: return "Map"
        case .hybrid: return "Hybrid"
        case .imagery: return "Satellite"
        }
    }
    var mapStyle: MapStyle {
        switch self {
        case .standard: return .standard(elevation: .realistic)
        case .hybrid: return .hybrid(elevation: .realistic)
        case .imagery: return .imagery(elevation: .realistic)
        }
    }
}

enum DesignTerrain: String, CaseIterable, Identifiable {
    case flat, balanced, hilly
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .flat: return "🥞"
        case .balanced: return "🌿"
        case .hilly: return "⛰️"
        }
    }
    var label: String {
        switch self {
        case .flat: return "Super Flat"
        case .balanced: return "Mix"
        case .hilly: return "Hills"
        }
    }
}

enum DesignShape: String, CaseIterable, Identifiable {
    case loop, oneway
    var id: String { rawValue }
    var icon: String { self == .loop ? "🔄" : "🚆" }
    var label: String { self == .loop ? "Loop Home" : "One-Way + Train" }
}

// MARK: - Transferable GPX Document for Native iOS ShareLink

struct GPXShareDocument: Transferable {
    let fileName: String
    let xmlString: String

    static var gpxUTType: UTType {
        UTType(filenameExtension: "gpx") ?? .xml
    }

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: gpxUTType) { doc in
            Data(doc.xmlString.utf8)
        }
        .suggestedFileName { $0.fileName }
    }
}

// MARK: - Hex Color Extension

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&int)
        let r, g, b: Double
        if cleaned.count == 6 {
            r = Double((int >> 16) & 0xFF) / 255.0
            g = Double((int >> 8) & 0xFF) / 255.0
            b = Double(int & 0xFF) / 255.0
        } else {
            r = 0.06; g = 0.46; b = 0.43
        }
        self.init(red: r, green: g, blue: b)
    }
}
