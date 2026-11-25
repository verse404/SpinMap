import CoreLocation
import XCTest
@testable import SpinMap

final class SpinMapTests: XCTestCase {
    private func sampleRoute() -> CyclingRoute {
        CyclingRoute(
            id: "test-flat-loop",
            name: "Albert Park & Swans",
            shortName: "Albert Park",
            subtitle: "Start → Pier → Finish",
            vibe: "coastal",
            isFlat: true,
            flatLabel: "🥞 Flat",
            effort: "short",
            durationLabel: "0h 45m",
            distanceKm: 16.0,
            elevationM: 20,
            carFree: true,
            isGravel: false,
            comfortBadge: "🥞 Flat",
            tramBadge: "🚋 Zero Trams",
            ribbonHex: "#0ea5e9",
            photoName: "albert",
            gmapsUrl: "https://www.google.com/maps",
            surfaces: [RouteSurfaceSegment(label: "Sealed", pct: 100, color: "#0ea5e9")],
            highlights: [RouteHighlight(icon: "🦢", title: "Swans", sub: "Lake", landmarkIndex: 1)],
            coordinates: [
                [144.9600, -37.8400],
                [144.9600, -37.8500],
                [144.9700, -37.8500],
            ],
            elevProfile: [10, 15, 12],
            landmarks: [
                RouteLandmark(ratio: 0.0, icon: "🏠", label: "Start", photoName: "albert", note: "Start", lngLat: [144.9600, -37.8400]),
                RouteLandmark(ratio: 0.5, icon: "🦢", label: "Mid", photoName: "albert", note: "Mid", lngLat: [144.9600, -37.8500]),
                RouteLandmark(ratio: 1.0, icon: "🏁", label: "End", photoName: "albert", note: "End", lngLat: [144.9700, -37.8500]),
            ]
        )
    }

    func testBikePaceEstimationOrdersRoadFasterThanCruiser() {
        let route = sampleRoute()
        let cruiserMins = CyclingMath.estimateRideMinutes(route: route, bikeType: .cruiser)
        let ebikeMins = CyclingMath.estimateRideMinutes(route: route, bikeType: .ebike)
        let roadMins = CyclingMath.estimateRideMinutes(route: route, bikeType: .road)

        XCTAssertGreaterThan(cruiserMins, ebikeMins)
        XCTAssertGreaterThanOrEqual(ebikeMins, roadMins)
    }

    func testWindAnalysisDetectsSouthboundTailwindFromNorthWind() {
        let coords = [
            CLLocationCoordinate2D(latitude: -37.8400, longitude: 144.9600),
            CLLocationCoordinate2D(latitude: -37.8500, longitude: 144.9600),
            CLLocationCoordinate2D(latitude: -37.8600, longitude: 144.9600),
        ]
        // Meteorological 0° = wind blowing FROM North -> pushes southbound riders (tailwind!)
        let summary = CyclingMath.analyzeRouteWind(coordinates: coords, windFromDeg: 0, windKmh: 20)
        XCTAssertEqual(summary.tailwindPct, 100)
        XCTAssertEqual(summary.finishKind, .tailwind)
    }

    func testReverseRouteFlipsCoordinatesAndLandmarks() {
        let route = sampleRoute()
        let rev = CyclingMath.reverseRoute(route)
        XCTAssertEqual(rev.coordinates.first, route.coordinates.last)
        XCTAssertEqual(rev.landmarks.first?.label, "End")
        XCTAssertEqual(rev.landmarks.first?.ratio, 0.0)
        XCTAssertEqual(rev.landmarks.last?.label, "Start")
        XCTAssertEqual(rev.landmarks.last?.ratio, 1.0)
    }

    func testGPXEscapesXMLSpecialCharacters() {
        let route = sampleRoute()
        let doc = CyclingMath.generateGPX(for: route)
        XCTAssertTrue(doc.xmlString.contains("Albert Park &amp; Swans"))
        XCTAssertTrue(doc.xmlString.contains("<trkpt lat=\"-37.84000\" lon=\"144.96000\"></trkpt>"))
        XCTAssertEqual(doc.fileName, "test-flat-loop.gpx")
    }

    func testInsertWaypointPicksNearestLeg() {
        let route = sampleRoute()
        // Point close to leg 0->1 (southward along 144.9600)
        let idx = CyclingMath.insertWaypointIndex(
            landmarks: route.landmarks,
            newCoord: CLLocationCoordinate2D(latitude: -37.8450, longitude: 144.9605)
        )
        XCTAssertEqual(idx, 1)
    }
}
