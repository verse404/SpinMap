import MapKit
import SwiftUI

struct ExploreTabView: View {
    @Environment(SpinMapStore.self) private var store
    @State private var expandedMap: Bool = false

    var body: some View {
        GeometryReader { geo in
            let mapHeight = expandedMap ? geo.size.height * 0.72 : max(280, geo.size.height * 0.45)

            VStack(spacing: 0) {
                mapStage
                    .frame(height: mapHeight)
                    .animation(.spring(duration: 0.32), value: expandedMap)

                routeDeck
            }
            .background(Color(.systemGroupedBackground))
        }
    }

    // MARK: - Interactive Native Apple MapKit Stage

    private var mapStage: some View {
        @Bindable var bindableStore = store

        return ZStack {
            MapReader { proxy in
                Map(position: $bindableStore.cameraPosition) {
                    UserAnnotation()

                    // Dimmed inactive routes in the same city
                    ForEach(store.filteredRoutes.filter { $0.id != store.activeRoute?.id }) { route in
                        MapPolyline(coordinates: route.clCoordinates)
                            .stroke(Color(hex: route.ribbonHex).opacity(0.38), lineWidth: 3.5)
                    }

                    // Active route ribbon OR Live Headwind/Tailwind Shaded Polylines
                    if let active = store.activeRoute {
                        if store.windOverlayEnabled {
                            ForEach(store.windSummary.segments) { seg in
                                MapPolyline(coordinates: seg.coordinates)
                                    .stroke(
                                        seg.kind.color,
                                        style: StrokeStyle(lineWidth: 6.5, lineCap: .round, lineJoin: .round)
                                    )
                            }
                        } else {
                            MapPolyline(coordinates: active.clCoordinates)
                                .stroke(
                                    Color(hex: active.ribbonHex).opacity(0.24),
                                    style: StrokeStyle(lineWidth: 13, lineCap: .round, lineJoin: .round)
                                )
                            MapPolyline(coordinates: active.clCoordinates)
                                .stroke(
                                    Color(hex: active.ribbonHex),
                                    style: StrokeStyle(
                                        lineWidth: 5.5,
                                        lineCap: .round,
                                        lineJoin: .round,
                                        dash: active.isGravel ? [8, 6] : []
                                    )
                                )
                        }

                        // Landmark pins
                        ForEach(active.landmarks) { lm in
                            Annotation(lm.label, coordinate: lm.coordinate) {
                                Button {
                                    store.stopPlayback()
                                    store.scrubRatio = lm.ratio
                                } label: {
                                    Text(lm.icon)
                                        .font(.caption)
                                        .frame(width: 28, height: 28)
                                        .background(.white, in: Circle())
                                        .overlay(
                                            Circle().stroke(
                                                store.editStopsMode ? Color.orange : Color(hex: active.ribbonHex),
                                                lineWidth: 2.2
                                            )
                                        )
                                        .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
                                }
                                .buttonStyle(.plain)
                            }
                            .annotationTitles(.hidden)
                        }

                        // Live animated cyclist puck
                        Annotation("Rider", coordinate: store.riderCoordinate) {
                            Text("🚴")
                                .font(.caption)
                                .frame(width: 32, height: 32)
                                .background(Color("AccentColor"), in: Circle())
                                .overlay(Circle().stroke(.white, lineWidth: 2.5))
                                .shadow(color: .black.opacity(0.25), radius: 4, y: 2)
                        }
                        .annotationTitles(.hidden)
                    }

                    // Toggleable Cyclist Pit-Stop Pins
                    ForEach(store.pitStops) { poi in
                        Annotation(poi.name, coordinate: poi.coordinate) {
                            Button {
                                if store.editStopsMode {
                                    Task {
                                        await store.insertStopOnMap(
                                            coord: poi.coordinate,
                                            label: poi.name,
                                            icon: poi.kind.icon
                                        )
                                    }
                                } else {
                                    store.showToast("\(poi.kind.icon) \(poi.name) — tap ✏️ Edit to add stop")
                                }
                            } label: {
                                Text(poi.kind.icon)
                                    .font(.caption2)
                                    .frame(width: 24, height: 24)
                                    .background(.white, in: Circle())
                                    .overlay(Circle().stroke(poi.kind.tintColor, lineWidth: 1.5))
                                    .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
                            }
                            .buttonStyle(.plain)
                        }
                        .annotationTitles(.hidden)
                    }
                }
                .mapStyle(store.mapStyleChoice.mapStyle)
                .mapControls {
                    MapCompass()
                    MapScaleView()
                }
                .simultaneousGesture(
                    SpatialTapGesture()
                        .onEnded { value in
                            guard store.pickLocationMode || store.editStopsMode,
                                  let coord = proxy.convert(value.location, from: .local)
                            else { return }

                            if store.pickLocationMode {
                                store.pickLocationMode = false
                                Task {
                                    await store.designRouteFromCoordinate(coord, labelOverride: nil)
                                }
                            } else if store.editStopsMode {
                                Task {
                                    await store.insertStopOnMap(coord: coord)
                                }
                            }
                        }
                )
            }

            // Floating Top Bar: City Selector + Clickable Live Weather Pill
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    Button {
                        store.showCitySearchSheet = true
                    } label: {
                        HStack(spacing: 5) {
                            Text(store.activeCity.isBuiltIn ? "📍" : "🌍")
                            Text(store.activeCity.name)
                                .font(.footnote.weight(.semibold))
                            Image(systemName: "chevron.down")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(.ultraThinMaterial, in: Capsule())
                        .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    Button {
                        store.showWeatherSheet = true
                    } label: {
                        HStack(spacing: 4) {
                            Text("🌤️ \(store.weather.tempC)°C")
                            Text("·")
                                .foregroundStyle(.secondary)
                            Text("💨 \(store.weather.windKmh)k")
                        }
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .padding(.horizontal, 11)
                        .padding(.vertical, 7)
                        .background(.ultraThinMaterial, in: Capsule())
                        .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)

                Spacer()

                // Interactive Banner when Picking Start or Editing Stops
                if store.pickLocationMode {
                    HStack(spacing: 8) {
                        Text("📌 Tap anywhere on map to start ride")
                            .font(.caption.weight(.semibold))
                        Button("Cancel") { store.pickLocationMode = false }
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(.white.opacity(0.22), in: Capsule())
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.blue, in: Capsule())
                    .shadow(radius: 8)
                } else if store.editStopsMode {
                    HStack(spacing: 8) {
                        Text(store.isRerouting ? "🧭 Recalculating bikeways…" : "✏️ Tap map or pit-stop to add stop")
                            .font(.caption.weight(.semibold))
                        Button("List") { store.showEditStopsSheet = true }
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(.white.opacity(0.22), in: Capsule())
                        Button("Done") { store.editStopsMode = false }
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(.white.opacity(0.22), in: Capsule())
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.orange, in: Capsule())
                    .shadow(radius: 8)
                } else if store.windOverlayEnabled {
                    HStack(spacing: 8) {
                        Text("● \(store.windSummary.tailwindPct)% Tail")
                            .foregroundStyle(Color(hex: "#34d399"))
                        Text("● \(store.windSummary.crosswindPct)% Cross")
                            .foregroundStyle(Color(hex: "#60a5fa"))
                        Text("● \(store.windSummary.headwindPct)% Head")
                            .foregroundStyle(Color(hex: "#fbbf24"))
                    }
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.black.opacity(0.82), in: Capsule())
                }

                // Bottom Overlay Bar: Preview Ride + Pit-Stop Toggles + Map Size Toggle
                HStack(spacing: 8) {
                    Button {
                        store.togglePlay()
                    } label: {
                        Label(store.isPlaying ? "Pause" : "Preview", systemImage: store.isPlaying ? "pause.fill" : "play.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(Color("AccentColor"), in: Capsule())
                            .shadow(color: .black.opacity(0.18), radius: 5, y: 2)
                    }
                    .buttonStyle(.plain)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(PitStopKind.allCases) { kind in
                                let active = store.activePitKinds.contains(kind)
                                Button {
                                    store.togglePitStopKind(kind)
                                } label: {
                                    Text("\(kind.icon) \(kind.label)")
                                        .font(.caption2.weight(.semibold))
                                        .foregroundStyle(active ? .white : .primary)
                                        .padding(.horizontal, 9)
                                        .padding(.vertical, 6)
                                        .background(
                                            active ? AnyShapeStyle(kind.tintColor) : AnyShapeStyle(.ultraThinMaterial),
                                            in: Capsule()
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    Button {
                        expandedMap.toggle()
                    } label: {
                        Image(systemName: expandedMap ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                            .font(.caption.weight(.bold))
                            .frame(width: 30, height: 30)
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(expandedMap ? "Shrink map" : "Expand map")
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
            }

            // Right-Edge Vertical Map Action Stack
            VStack(spacing: 1) {
                mapIconButton(systemName: "location.fill", tint: .blue, label: "My location route") {
                    Task { await store.locateAndDesignRoute() }
                }
                Divider().frame(width: 24)
                mapIconButton(
                    systemName: "wind",
                    tint: store.windOverlayEnabled ? .green : .primary,
                    label: "Toggle wind shading"
                ) {
                    store.toggleWindOverlay()
                }
                Divider().frame(width: 24)
                mapIconButton(
                    systemName: "pencil.and.outline",
                    tint: store.editStopsMode ? .orange : .primary,
                    label: "Edit stops on map"
                ) {
                    store.pickLocationMode = false
                    store.editStopsMode.toggle()
                    if store.editStopsMode {
                        store.showToast("✏️ Tap map or pit-stop pins to add stops")
                    }
                }
                Divider().frame(width: 24)
                mapIconButton(systemName: "map", tint: .primary, label: "Switch map style") {
                    let all = MapStyleChoice.allCases
                    if let idx = all.firstIndex(of: store.mapStyleChoice) {
                        store.mapStyleChoice = all[(idx + 1) % all.count]
                        store.showToast("🗺️ Map view: \(store.mapStyleChoice.label)")
                    }
                }
                Divider().frame(width: 24)
                mapIconButton(systemName: "scope", tint: .primary, label: "Center on route") {
                    store.centerOnActiveRoute()
                }
            }
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.14), radius: 6, y: 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
            .padding(.trailing, 10)
            .padding(.vertical, 52)
        }
    }

    private func mapIconButton(systemName: String, tint: Color, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 36, height: 34)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: - Scrollable Route Details + Bike Pace + Scrubber + Curated Gallery

    private var routeDeck: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let route = store.activeRoute {
                    activeRouteCard(route)
                }

                // Filter Chips & Curated Route Gallery
                VStack(alignment: .leading, spacing: 10) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(RideVibeFilter.allCases) { vibe in
                                let active = store.vibeFilter == vibe
                                Button {
                                    store.vibeFilter = vibe
                                } label: {
                                    Text("\(vibe.icon) \(vibe.label)")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(active ? .white : .primary)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 7)
                                        .background(
                                            active ? Color("AccentColor") : Color(.secondarySystemGroupedBackground),
                                            in: Capsule()
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(store.filteredRoutes) { item in
                                routeGalleryCard(item)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .padding(.bottom, 16)
        }
    }

    private func activeRouteCard(_ route: CyclingRoute) -> some View {
        @Bindable var bindableStore = store
        let isSaved = store.savedIds.contains(route.id)
        let gpxDoc = CyclingMath.generateGPX(for: route, isReversed: store.isActiveRouteReversed)

        return VStack(alignment: .leading, spacing: 12) {
            // Scenic Hero Photo with Clean Badges
            ZStack(alignment: .bottomLeading) {
                Image(store.activeLandmark?.photoName ?? route.photoName)
                    .resizable()
                    .scaledToFill()
                    .frame(height: 155)
                    .clipped()

                LinearGradient(
                    colors: [.clear, .black.opacity(0.82)],
                    startPoint: .center,
                    endPoint: .bottom
                )

                VStack {
                    HStack {
                        Text(route.comfortBadge)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(.black.opacity(0.62), in: Capsule())

                        Spacer()

                        Text("\(store.formattedDynamicDuration) · \(String(format: "%.1f km", route.distanceKm))")
                            .font(.caption.weight(.bold).monospacedDigit())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(.black.opacity(0.72), in: Capsule())
                    }
                    Spacer()
                }
                .padding(10)

                VStack(alignment: .leading, spacing: 2) {
                    Text(route.name)
                        .font(.headline)
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    Text(route.subtitle)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.86))
                        .lineLimit(1)
                }
                .padding(12)
            }
            .clipShape(RoundedRectangle(cornerRadius: 16))

            // Primary Action Strip: Apple Maps, Google Maps, Reverse, Save, GPX Share
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    Button {
                        store.openInAppleMaps()
                    } label: {
                        Label("Apple Maps", systemImage: "map.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color("AccentColor"), in: Capsule())
                    }
                    .buttonStyle(.plain)

                    Button {
                        store.openInGoogleMaps()
                    } label: {
                        Label("Google Maps", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color(hex: "#1a73e8"), in: Capsule())
                    }
                    .buttonStyle(.plain)

                    Button {
                        store.toggleReverseActiveRoute()
                    } label: {
                        Text(store.isActiveRouteReversed ? "🔄 Reversed" : "🔄 Reverse")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(store.isActiveRouteReversed ? .white : .primary)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 8)
                            .background(
                                store.isActiveRouteReversed ? Color.green : Color(.tertiarySystemFill),
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)

                    Button {
                        store.toggleSaveActiveRoute()
                    } label: {
                        Text(isSaved ? "♥ Saved" : "♡ Save")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(isSaved ? .white : .primary)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 8)
                            .background(
                                isSaved ? Color("AccentColor") : Color(.tertiarySystemFill),
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)

                    ShareLink(
                        item: gpxDoc,
                        preview: SharePreview(route.name, image: Image(route.photoName))
                    ) {
                        Label("GPX", systemImage: "square.and.arrow.up")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 8)
                            .background(Color(.tertiarySystemFill), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }

            // Bike Type & Pace Selector + Live Suitability Pill
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    ForEach(BikeType.allCases) { bike in
                        let active = store.bikeType == bike
                        Button {
                            store.bikeType = bike
                        } label: {
                            Text("\(bike.icon) \(bike.label)")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(active ? .white : .primary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 7)
                                .background(
                                    active ? Color("AccentColor") : Color(.tertiarySystemFill),
                                    in: Capsule()
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }

                HStack {
                    Text(store.bikeSuitability.label)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(store.bikeSuitability.isWarning ? .orange : .secondary)
                    Spacer()
                    if store.weather.windKmh >= 10 {
                        Text(store.windSummary.finishLabel)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            // Interactive True-Scale Elevation Scrubber
            ElevationScrubberView(
                route: route,
                scrubRatio: $bindableStore.scrubRatio,
                onScrubBegan: { store.stopPlayback() }
            )

            // Surface Proportion Bar + Climb
            VStack(alignment: .leading, spacing: 5) {
                GeometryReader { barGeo in
                    HStack(spacing: 1) {
                        ForEach(route.surfaces) { seg in
                            Rectangle()
                                .fill(Color(hex: seg.color))
                                .frame(width: max(4, barGeo.size.width * CGFloat(seg.pct) / 100.0))
                        }
                    }
                }
                .frame(height: 8)
                .clipShape(Capsule())

                HStack {
                    Text(route.surfaces.map { "\($0.pct)% \($0.label)" }.joined(separator: " · "))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer()
                    Text("+\(route.elevationM) m climb")
                        .font(.caption2.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            // Clickable Stop Highlights
            if !route.highlights.isEmpty {
                HStack(spacing: 8) {
                    ForEach(route.highlights.prefix(3)) { hl in
                        Button {
                            store.stopPlayback()
                            let idx = max(0, min(hl.landmarkIndex, route.landmarks.count - 1))
                            if idx < route.landmarks.count {
                                store.scrubRatio = route.landmarks[idx].ratio
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(hl.icon) \(hl.title)")
                                    .font(.caption2.weight(.semibold))
                                    .lineLimit(1)
                                Text(hl.sub)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(8)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
    }

    private func routeGalleryCard(_ item: CyclingRoute) -> some View {
        let selected = item.id == store.activeRoute?.id
        let mins = CyclingMath.estimateRideMinutes(route: item, bikeType: store.bikeType)

        return Button {
            store.selectRoute(item)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                ZStack(alignment: .bottomLeading) {
                    Image(item.photoName)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 152, height: 84)
                        .clipped()

                    Text(item.isFlat ? "🥞 \(CyclingMath.formatDuration(mins))" : CyclingMath.formatDuration(mins))
                        .font(.caption2.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 6))
                        .padding(6)
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        Circle()
                            .fill(Color(hex: item.ribbonHex))
                            .frame(width: 8, height: 8)
                        Text(item.shortName)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                    }
                    Text(String(format: "%.1f km · +%d m", item.distanceKm, item.elevationM))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 8)
            }
            .frame(width: 152)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(selected ? Color("AccentColor") : Color.clear, lineWidth: 2)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}
