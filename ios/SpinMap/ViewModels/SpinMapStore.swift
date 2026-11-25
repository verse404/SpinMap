import CoreLocation
import Foundation
import MapKit
import SwiftUI
import UIKit

@Observable
@MainActor
final class SpinMapStore {
    // MARK: - Bundled Data
    let routesBundle: RoutesBundle
    let anchorsBundle: AnchorsBundle
    let locationService = LocationService()

    // MARK: - Navigation & City State
    var selectedTab: Int = 0
    var activeCity: CityConfig = .melbourne
    var cameraPosition: MapCameraPosition = .region(CityConfig.melbourne.overviewRegion)
    var mapStyleChoice: MapStyleChoice = .standard

    // MARK: - Filtering, Selection & Bike Pace
    var vibeFilter: RideVibeFilter = .all
    var effortFilter: EffortFilter = .any
    var bikeType: BikeType = .cruiser {
        didSet { persistPrefs() }
    }
    var savedIds: Set<String> = [] {
        didSet { persistPrefs() }
    }
    var reversedIds: Set<String> = []
    var customRoutesByCity: [String: CyclingRoute] = [:] {
        didSet { persistPrefs() }
    }
    var customRationaleByCity: [String: String] = [:]
    var selectedRouteId: String = "albert-park-lake"

    // MARK: - Interactive Playback, Wind & Pit-Stops
    var scrubRatio: Double = 0.34
    var isPlaying: Bool = false
    var windOverlayEnabled: Bool = false
    var weather: LiveWeatherState = .fallback(for: .melbourne)
    var activePitKinds: Set<PitStopKind> = []
    var pitStops: [PitStopPOI] = []
    var isLoadingPitStops: Bool = false

    // MARK: - GPS, Pick-on-Map & Edit Stops Modes
    var userStartCoord: CLLocationCoordinate2D?
    var pickLocationMode: Bool = false
    var editStopsMode: Bool = false
    var isDesigningRoute: Bool = false
    var isRerouting: Bool = false
    var toastMessage: String?

    // MARK: - Designer Form Inputs
    var designAddress: String = ""
    var designTerrain: DesignTerrain = .flat
    var designTargetKm: Double = 22
    var designShape: DesignShape = .loop
    var designMustHaves: Set<String> = ["carFree", "cafe"]
    var designVariationIndex: Int = 0

    // MARK: - Sheet Presentations
    var showWeatherSheet: Bool = false
    var showCitySearchSheet: Bool = false
    var showEditStopsSheet: Bool = false

    private var playTask: Task<Void, Never>?
    private var toastTask: Task<Void, Never>?
    private var pitStopTask: Task<Void, Never>?

    private enum PrefKeys {
        static let savedIds = "spinmap_saved_ids_v1"
        static let bikeType = "spinmap_bike_type_v1"
        static let customRoutes = "spinmap_custom_routes_v1"
    }

    init() {
        self.routesBundle = BundleDataLoader.loadRoutes()
        self.anchorsBundle = BundleDataLoader.loadAnchors()
        hydratePrefs()

        if let first = routesBundle.melbourne.first {
            self.selectedRouteId = first.id
            self.cameraPosition = .region(first.region)
        }
        Task {
            await refreshWeather()
        }
    }

    // MARK: - Derived Properties

    var curatedCityRoutes: [CyclingRoute] {
        switch activeCity.id {
        case "melbourne": return routesBundle.melbourne
        case "sydney": return routesBundle.sydney
        default: return []
        }
    }

    var allCityRoutes: [CyclingRoute] {
        var list = curatedCityRoutes
        if let custom = customRoutesByCity[activeCity.id] {
            list.insert(custom, at: 0)
        }
        return list
    }

    var filteredRoutes: [CyclingRoute] {
        allCityRoutes.filter { route in
            if vibeFilter == .flat && !route.isFlat { return false }
            if vibeFilter != .all && vibeFilter != .flat && route.vibe != vibeFilter.rawValue { return false }
            if effortFilter != .any && route.effort != effortFilter.rawValue { return false }
            return true
        }
    }

    var baseActiveRoute: CyclingRoute? {
        filteredRoutes.first(where: { $0.id == selectedRouteId })
            ?? filteredRoutes.first
            ?? allCityRoutes.first
            ?? routesBundle.melbourne.first
    }

    var isActiveRouteReversed: Bool {
        guard let base = baseActiveRoute else { return false }
        return reversedIds.contains(base.id)
    }

    var activeRoute: CyclingRoute? {
        guard let base = baseActiveRoute else { return nil }
        return isActiveRouteReversed ? CyclingMath.reverseRoute(base) : base
    }

    var activeLandmark: RouteLandmark? {
        guard let route = activeRoute else { return nil }
        return CyclingMath.nearestLandmark(in: route, ratio: scrubRatio)
    }

    var riderCoordinate: CLLocationCoordinate2D {
        guard let route = activeRoute else { return activeCity.center }
        return CyclingMath.interpolateCoordinate(along: route.clCoordinates, ratio: scrubRatio)
    }

    var estimatedMinutes: Int {
        guard let route = activeRoute else { return 45 }
        return CyclingMath.estimateRideMinutes(route: route, bikeType: bikeType)
    }

    var formattedDynamicDuration: String {
        CyclingMath.formatDuration(estimatedMinutes)
    }

    var bikeSuitability: BikeSuitabilityNote {
        guard let route = activeRoute else {
            return BikeSuitabilityNote(isWarning: false, label: "\(bikeType.icon) Ready")
        }
        return CyclingMath.bikeSuitabilityNote(route: route, bikeType: bikeType)
    }

    var windSummary: RouteWindSummary {
        guard let route = activeRoute else {
            return CyclingMath.analyzeRouteWind(coordinates: [], windFromDeg: weather.windDeg, windKmh: weather.windKmh)
        }
        return CyclingMath.analyzeRouteWind(
            coordinates: route.clCoordinates,
            windFromDeg: weather.windDeg,
            windKmh: weather.windKmh
        )
    }

    var allSavedRoutes: [CyclingRoute] {
        var combined: [CyclingRoute] = []
        combined.append(contentsOf: routesBundle.melbourne)
        combined.append(contentsOf: routesBundle.sydney)
        for (_, r) in customRoutesByCity {
            if !combined.contains(where: { $0.id == r.id }) {
                combined.append(r)
            }
        }
        return combined.filter { savedIds.contains($0.id) }
    }

    // MARK: - Persistence (Non-Sensitive UI Prefs Only)

    private func hydratePrefs() {
        let defaults = UserDefaults.standard
        if let arr = defaults.stringArray(forKey: PrefKeys.savedIds) {
            savedIds = Set(arr)
        }
        if let rawBike = defaults.string(forKey: PrefKeys.bikeType),
           let parsed = BikeType(rawValue: rawBike) {
            bikeType = parsed
        }
        if let data = defaults.data(forKey: PrefKeys.customRoutes),
           let decoded = try? JSONDecoder().decode([String: CyclingRoute].self, from: data) {
            customRoutesByCity = decoded
        }
    }

    private func persistPrefs() {
        let defaults = UserDefaults.standard
        defaults.set(Array(savedIds), forKey: PrefKeys.savedIds)
        defaults.set(bikeType.rawValue, forKey: PrefKeys.bikeType)
        if let encoded = try? JSONEncoder().encode(customRoutesByCity) {
            defaults.set(encoded, forKey: PrefKeys.customRoutes)
        }
    }

    // MARK: - Route Selection, Playback & Deep Links

    func selectRoute(_ route: CyclingRoute, focusCamera: Bool = true) {
        stopPlayback()
        selectedRouteId = route.id
        scrubRatio = 0.34
        if focusCamera {
            withAnimation(.easeInOut(duration: 0.55)) {
                cameraPosition = .region(route.region)
            }
        }
        refreshPitStops()
    }

    func switchCity(_ city: CityConfig, autoDesignIfGlobal: Bool = true) {
        stopPlayback()
        pickLocationMode = false
        editStopsMode = false
        activeCity = city
        vibeFilter = .all
        effortFilter = .any

        if let first = allCityRoutes.first {
            selectedRouteId = first.id
            withAnimation(.easeInOut(duration: 0.65)) {
                cameraPosition = .region(first.region)
            }
        } else {
            withAnimation(.easeInOut(duration: 0.65)) {
                cameraPosition = .region(city.overviewRegion)
            }
        }

        Task {
            await refreshWeather(at: city.center)
            if !city.isBuiltIn && autoDesignIfGlobal {
                await designRouteFromCoordinate(city.center, labelOverride: city.name)
            }
        }
    }

    func handleIncomingURL(_ url: URL) {
        var slug: String?
        if url.scheme == "spinmap", url.host == "route" {
            slug = url.pathComponents.dropFirst().first
        } else if let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            slug = comps.queryItems?.first(where: { $0.name == "route" })?.value
        }
        guard let slug else { return }
        if let match = routesBundle.melbourne.first(where: { $0.id == slug }) {
            switchCity(.melbourne, autoDesignIfGlobal: false)
            selectRoute(match)
        } else if let match = routesBundle.sydney.first(where: { $0.id == slug }) {
            switchCity(.sydney, autoDesignIfGlobal: false)
            selectRoute(match)
        }
    }

    func togglePlay() {
        if isPlaying {
            stopPlayback()
            return
        }
        if scrubRatio >= 0.98 { scrubRatio = 0 }
        isPlaying = true
        playTask?.cancel()
        playTask = Task { [weak self] in
            while let self, !Task.isCancelled, self.isPlaying {
                try? await Task.sleep(for: .milliseconds(48))
                if Task.isCancelled || !self.isPlaying { break }
                if self.scrubRatio >= 0.985 {
                    self.scrubRatio = 1.0
                    self.isPlaying = false
                    break
                }
                self.scrubRatio = min(1.0, self.scrubRatio + 0.014)
            }
        }
    }

    func stopPlayback() {
        isPlaying = false
        playTask?.cancel()
        playTask = nil
    }

    func toggleReverseActiveRoute() {
        guard let base = baseActiveRoute else { return }
        stopPlayback()
        scrubRatio = 0
        if reversedIds.contains(base.id) {
            reversedIds.remove(base.id)
        } else {
            reversedIds.insert(base.id)
        }
        showToast("🔄 Direction reversed — \(windSummary.finishLabel)")
    }

    func toggleSaveActiveRoute() {
        guard let route = activeRoute else { return }
        if savedIds.contains(route.id) {
            savedIds.remove(route.id)
            showToast("Removed from Saved Rides")
        } else {
            savedIds.insert(route.id)
            showToast("Saved \"\(route.shortName)\"")
        }
    }

    func toggleWindOverlay() {
        windOverlayEnabled.toggle()
        showToast(windOverlayEnabled ? "🍃 Wind shading on — \(windSummary.finishLabel)" : "Wind overlay hidden")
    }

    func togglePitStopKind(_ kind: PitStopKind) {
        if activePitKinds.contains(kind) {
            activePitKinds.remove(kind)
        } else {
            activePitKinds.insert(kind)
        }
        refreshPitStops()
    }

    func refreshPitStops() {
        pitStopTask?.cancel()
        guard !activePitKinds.isEmpty, let route = activeRoute else {
            pitStops = []
            isLoadingPitStops = false
            return
        }
        isLoadingPitStops = true
        let kinds = activePitKinds
        pitStopTask = Task {
            let found = await LiveServices.fetchPitStops(for: route, kinds: kinds)
            if !Task.isCancelled {
                pitStops = found
                isLoadingPitStops = false
            }
        }
    }

    func refreshWeather(at coord: CLLocationCoordinate2D? = nil) async {
        let target = coord ?? userStartCoord ?? activeCity.center
        weather = await LiveServices.fetchWeather(for: target, cityFallback: activeCity)
    }

    // MARK: - Live GPS, Pick-on-Map & Custom Route Design

    func locateAndDesignRoute() async {
        pickLocationMode = false
        editStopsMode = false
        isDesigningRoute = true
        defer { isDesigningRoute = false }

        do {
            let coord = try await locationService.requestCurrentLocation()
            userStartCoord = coord
            designVariationIndex = 0
            await designRouteFromCoordinate(coord, labelOverride: nil)
            selectedTab = 0
        } catch {
            showToast(error.localizedDescription)
        }
    }

    func designRouteFromAddressInput() async {
        let trimmed = designAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty, let coord = userStartCoord {
            await designRouteFromCoordinate(coord, labelOverride: nil)
            selectedTab = 0
            return
        }
        guard trimmed.count >= 2 else {
            showToast("Enter a suburb/address or tap My Location")
            return
        }
        isDesigningRoute = true
        defer { isDesigningRoute = false }

        if let (coord, label) = await LiveServices.geocodeAddress(trimmed, near: activeCity) {
            userStartCoord = coord
            designVariationIndex = 0
            await designRouteFromCoordinate(coord, labelOverride: label)
            selectedTab = 0
        } else {
            showToast("Could not locate \"\(trimmed)\" in \(activeCity.name)")
        }
    }

    func designAnotherVariation() async {
        guard let coord = userStartCoord ?? activeRoute?.clCoordinates.first else {
            await locateAndDesignRoute()
            return
        }
        designVariationIndex = (designVariationIndex + 1) % 6
        await designRouteFromCoordinate(coord, labelOverride: designAddress.isEmpty ? nil : designAddress)
    }

    func designRouteFromCoordinate(_ coord: CLLocationCoordinate2D, labelOverride: String?) async {
        isDesigningRoute = true
        defer { isDesigningRoute = false }

        userStartCoord = coord
        let label: String
        if let labelOverride, !labelOverride.isEmpty {
            label = labelOverride
        } else {
            label = await LiveServices.reverseGeocodeNeighborhood(coord)
        }
        designAddress = label

        let (route, rationale) = await LiveServices.designCustomRoute(
            startCoord: coord,
            startLabel: label,
            targetKm: designTargetKm,
            terrain: designTerrain,
            shape: designShape,
            mustHaves: designMustHaves,
            variationIndex: designVariationIndex,
            anchorsBundle: anchorsBundle
        )

        customRoutesByCity[activeCity.id] = route
        customRationaleByCity[activeCity.id] = rationale
        reversedIds.remove(route.id)
        vibeFilter = .all
        effortFilter = .any
        selectRoute(route, focusCamera: true)
        await refreshWeather(at: coord)
        showToast("✨ Designed \(String(format: "%.1f km", route.distanceKm)) ride from \(label)")
    }

    // MARK: - Edit Stops (Tap Map or Pit-Stop to Insert / Reorder / Delete -> Live Bikeway Reroute)

    func insertStopOnMap(coord: CLLocationCoordinate2D, label: String = "Added Map Stop", icon: String = "📌") async {
        guard let route = activeRoute else { return }
        if route.landmarks.count >= 8 {
            showToast("Maximum 8 stops reached — manage stops to remove one first")
            return
        }
        var updated = route.landmarks
        let idx = CyclingMath.insertWaypointIndex(landmarks: updated, newCoord: coord)
        updated.insert(
            RouteLandmark(
                ratio: 0.5,
                icon: icon,
                label: label,
                photoName: route.photoName,
                note: "Added directly on map",
                lngLat: [coord.longitude, coord.latitude]
            ),
            at: idx
        )
        await applyEditedWaypoints(updated, baseName: route.name)
    }

    func applyEditedWaypoints(_ landmarks: [RouteLandmark], baseName: String) async {
        guard landmarks.count >= 2 else {
            showToast("Keep at least 2 stops on your route")
            return
        }
        isRerouting = true
        defer { isRerouting = false }

        let updatedRoute = await LiveServices.rerouteFromWaypoints(routeName: baseName, landmarks: landmarks)
        customRoutesByCity[activeCity.id] = updatedRoute
        customRationaleByCity[activeCity.id] = "Edited with \(updatedRoute.landmarks.count) stops along live OSM bikeways"
        reversedIds.remove(updatedRoute.id)
        selectedRouteId = updatedRoute.id
        showToast("✏️ Rerouted: \(String(format: "%.1f km", updatedRoute.distanceKm)) · +\(updatedRoute.elevationM) m")
    }

    // MARK: - External Turn-by-Turn Navigation Handoff

    func openInAppleMaps() {
        guard let url = activeRoute?.appleMapsURL else { return }
        UIApplication.shared.open(url)
    }

    func openInGoogleMaps() {
        guard let route = activeRoute else { return }
        if let appURL = route.googleMapsAppURL, UIApplication.shared.canOpenURL(appURL) {
            UIApplication.shared.open(appURL)
        } else if let webURL = route.googleMapsWebURL {
            UIApplication.shared.open(webURL)
        }
    }

    func centerOnActiveRoute() {
        guard let route = activeRoute else { return }
        withAnimation(.easeInOut(duration: 0.5)) {
            cameraPosition = .region(route.region)
        }
    }

    func centerOnCityOverview() {
        withAnimation(.easeInOut(duration: 0.5)) {
            cameraPosition = .region(activeCity.overviewRegion)
        }
    }

    func showToast(_ message: String) {
        toastMessage = message
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.8))
            if !Task.isCancelled {
                self?.toastMessage = nil
            }
        }
    }
}
