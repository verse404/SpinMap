import SwiftUI

struct RouteDesignerTabView: View {
    @Environment(SpinMapStore.self) private var store

    private let distanceChoices: [Double] = [12, 22, 35, 50]
    private var mustHaveChoices: [(id: String, icon: String, label: String)] {
        [
            ("carFree", "🌳", "Car-Free Trails"),
            ("cafe", "☕", "Coffee Stop"),
            ("water", "🌊", "Bay / River Views"),
            ("tramFree", "🚲", store.activeCity.avoidChipLabel),
        ]
    }

    var body: some View {
        @Bindable var bindableStore = store

        NavigationStack {
            Form {
                // 1. Starting Location Section (Live GPS, Pick on Map, or Address)
                Section {
                    HStack(spacing: 10) {
                        Button {
                            Task { await store.locateAndDesignRoute() }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "location.fill")
                                Text(store.isDesigningRoute ? "Designing…" : "Use My Location")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .foregroundStyle(.white)
                            .background(Color.blue, in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                        .disabled(store.isDesigningRoute)

                        Button {
                            store.editStopsMode = false
                            store.pickLocationMode = true
                            store.selectedTab = 0
                            store.showToast("📌 Tap anywhere on the map to start your route")
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "mappin.and.ellipse")
                                Text("Pick on Map")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .foregroundStyle(.primary)
                            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14))

                    TextField(
                        "Start address or suburb in \(store.activeCity.name)",
                        text: $bindableStore.designAddress
                    )
                    .textInputAutocapitalization(.words)
                    .submitLabel(.go)
                    .onSubmit {
                        Task { await store.designRouteFromAddressInput() }
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(store.activeCity.sampleSuburbs, id: \.self) { suburb in
                                Button {
                                    store.designAddress = suburb
                                } label: {
                                    Text(suburb)
                                        .font(.caption.weight(.medium))
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 6)
                                        .background(
                                            store.designAddress.lowercased() == suburb.lowercased()
                                                ? Color("AccentColor").opacity(0.18)
                                                : Color(.tertiarySystemFill),
                                            in: Capsule()
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("Starting Point · \(store.activeCity.name)")
                } footer: {
                    Text("Your GPS location stays strictly on-device and is reverse-geocoded to suburb level only.")
                }

                // 2. Ride Preferences
                Section("Ride Style & Distance") {
                    Picker("Terrain", selection: $bindableStore.designTerrain) {
                        ForEach(DesignTerrain.allCases) { opt in
                            Text("\(opt.icon) \(opt.label)").tag(opt)
                        }
                    }
                    .pickerStyle(.segmented)

                    Picker("Shape", selection: $bindableStore.designShape) {
                        ForEach(DesignShape.allCases) { opt in
                            Text("\(opt.icon) \(opt.label)").tag(opt)
                        }
                    }
                    .pickerStyle(.segmented)

                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Target Distance")
                            Spacer()
                            Text("\(Int(store.designTargetKm)) km")
                                .font(.body.weight(.semibold).monospacedDigit())
                                .foregroundStyle(Color("AccentColor"))
                        }
                        HStack(spacing: 8) {
                            ForEach(distanceChoices, id: \.self) { km in
                                let active = Int(store.designTargetKm) == Int(km)
                                Button {
                                    store.designTargetKm = km
                                } label: {
                                    Text("\(Int(km)) km")
                                        .font(.caption.weight(.semibold).monospacedDigit())
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
                    }
                }

                // 3. Must-Have Features
                Section("Must-Haves") {
                    ForEach(mustHaveChoices, id: \.id) { opt in
                        Toggle(isOn: Binding(
                            get: { store.designMustHaves.contains(opt.id) },
                            set: { enabled in
                                if enabled { store.designMustHaves.insert(opt.id) }
                                else { store.designMustHaves.remove(opt.id) }
                            }
                        )) {
                            Text("\(opt.icon) \(opt.label)")
                        }
                    }
                }

                // 4. Primary Design Action + Variations + Edit Waypoints
                Section {
                    Button {
                        Task { await store.designRouteFromAddressInput() }
                    } label: {
                        HStack {
                            Spacer()
                            if store.isDesigningRoute {
                                ProgressView()
                                    .tint(.white)
                                Text("Routing Real Bikeways…")
                                    .fontWeight(.semibold)
                            } else {
                                Image(systemName: "sparkles")
                                Text("Design Cycling Route")
                                    .fontWeight(.semibold)
                            }
                            Spacer()
                        }
                        .foregroundStyle(.white)
                        .padding(.vertical, 6)
                    }
                    .listRowBackground(Color("AccentColor"))
                    .disabled(store.isDesigningRoute)

                    if let custom = store.customRoutesByCity[store.activeCity.id] {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(custom.name)
                                .font(.subheadline.weight(.semibold))
                            if let rationale = store.customRationaleByCity[store.activeCity.id] {
                                Text(rationale)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            HStack(spacing: 10) {
                                Button {
                                    Task { await store.designAnotherVariation() }
                                } label: {
                                    Label("Another Route", systemImage: "shuffle")
                                        .font(.caption.weight(.semibold))
                                }
                                .buttonStyle(.bordered)

                                Button {
                                    store.showEditStopsSheet = true
                                } label: {
                                    Label("Edit Stops", systemImage: "list.bullet")
                                        .font(.caption.weight(.semibold))
                                }
                                .buttonStyle(.bordered)
                            }
                            .padding(.top, 2)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle("Design Route")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        store.showCitySearchSheet = true
                    } label: {
                        Label(store.activeCity.name, systemImage: "globe")
                    }
                }
            }
        }
    }
}
