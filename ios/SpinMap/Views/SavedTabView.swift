import SwiftUI

struct SavedTabView: View {
    @Environment(SpinMapStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                if store.allSavedRoutes.isEmpty {
                    ContentUnavailableView(
                        "No Saved Rides Yet",
                        systemImage: "heart.slash",
                        description: Text("Tap ♡ Save on any curated or custom cycling route in Explore to bookmark it offline here.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    Section("Bookmarked Rides (\(store.allSavedRoutes.count))") {
                        ForEach(store.allSavedRoutes) { route in
                            let mins = CyclingMath.estimateRideMinutes(route: route, bikeType: store.bikeType)
                            Button {
                                if store.routesBundle.sydney.contains(where: { $0.id == route.id }) {
                                    store.switchCity(.sydney, autoDesignIfGlobal: false)
                                } else if store.routesBundle.melbourne.contains(where: { $0.id == route.id }) {
                                    store.switchCity(.melbourne, autoDesignIfGlobal: false)
                                }
                                store.selectRoute(route)
                                store.selectedTab = 0
                            } label: {
                                HStack(spacing: 12) {
                                    Image(route.photoName)
                                        .resizable()
                                        .scaledToFill()
                                        .frame(width: 66, height: 54)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))

                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(route.name)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)
                                        Text(route.subtitle)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                        Text("\(CyclingMath.formatDuration(mins)) · \(String(format: "%.1f km", route.distanceKm)) · +\(route.elevationM) m")
                                            .font(.caption2.monospacedDigit().weight(.medium))
                                            .foregroundStyle(Color("AccentColor"))
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    store.savedIds.remove(route.id)
                                } label: {
                                    Label("Remove", systemImage: "trash")
                                }
                            }
                        }
                    }
                }

                Section("Bike Pace Preference") {
                    Picker("Default Bike", selection: Binding(
                        get: { store.bikeType },
                        set: { store.bikeType = $0 }
                    )) {
                        ForEach(BikeType.allCases) { bike in
                            Text("\(bike.icon) \(bike.label) (~\(Int(bike.speedKmh)) km/h)").tag(bike)
                        }
                    }
                }

                Section("About & Map Attribution") {
                    LabeledContent("Version", value: "1.0.0")
                    LabeledContent("Maps & POIs", value: "Apple MapKit")
                    LabeledContent("Bike Routing", value: "OpenStreetMap contributors")
                    LabeledContent("Weather & DEM", value: "Open-Meteo")
                    Text("SpinMap stores saved routes and bike preferences locally on your iPhone. No account or tracking is used.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Saved Rides")
        }
    }
}
