import SwiftUI

// MARK: - 1. Best Window to Ride & Sunset Countdown Sheet

struct WeatherWindowSheet: View {
    @Environment(SpinMapStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private func formatCountdown(_ mins: Int) -> String {
        let h = mins / 60
        let m = mins % 60
        return h <= 0 ? "\(m)m" : "\(h)h \(m)m"
    }

    var body: some View {
        let w = store.weather
        let estMins = store.estimatedMinutes
        let needsLights = w.minutesToSunset.map { $0 < 0 || (estMins + 20) >= $0 } ?? false
        let bestScore = w.hourly.map(\.score).max() ?? -1

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Current Conditions Summary
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("🌤️ \(w.tempC)°C · \(w.windKmh) km/h \(w.windLabel)")
                                .font(.title3.weight(.bold))
                            Text("Peak ride slot: \(w.bestWindowLabel)")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }

                    // Sunset Countdown & Bike Lights Check
                    HStack(spacing: 12) {
                        Text(needsLights ? "🔦" : "☀️")
                            .font(.title2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(needsLights ? "Bring front & rear bike lights" : "Finishes in comfortable daylight")
                                .font(.subheadline.weight(.semibold))
                            if let mins = w.minutesToSunset, mins > 0 {
                                Text("Sunset \(w.sunsetLabel) (in \(formatCountdown(mins)))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("Sunset \(w.sunsetLabel)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Text("~\(estMins)m")
                            .font(.subheadline.monospacedDigit().weight(.bold))
                    }
                    .padding(14)
                    .background(
                        (needsLights ? Color.orange : Color.green).opacity(0.14),
                        in: RoundedRectangle(cornerRadius: 14)
                    )

                    // Live Wind Route Verdict
                    if store.activeRoute != nil {
                        HStack {
                            Text(store.windSummary.finishLabel)
                                .font(.footnote.weight(.semibold))
                            Spacer()
                            Text("\(store.windSummary.tailwindPct)% Tail · \(store.windSummary.headwindPct)% Head")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        .padding(12)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                    }

                    // 10-Hour Comfort Bar Chart
                    if !w.hourly.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Text("Next \(w.hourly.count) Hours")
                                    .font(.subheadline.weight(.semibold))
                                Spacer()
                                Text("★ Best Window")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Color("AccentColor"))
                            }

                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 8) {
                                ForEach(w.hourly.prefix(10)) { slot in
                                    let isBest = slot.score == bestScore
                                    VStack(spacing: 5) {
                                        Text("\(isBest ? "★" : "")\(slot.hourLabel)")
                                            .font(.caption2.weight(.semibold))
                                            .lineLimit(1)
                                        ZStack(alignment: .bottom) {
                                            Capsule()
                                                .fill(Color(.tertiarySystemFill))
                                                .frame(width: 12, height: 34)
                                            Capsule()
                                                .fill(
                                                    isBest
                                                        ? Color("AccentColor")
                                                        : (slot.precipProb >= 45 || slot.windKmh >= 28 ? Color.orange : Color.blue.opacity(0.75))
                                                )
                                                .frame(width: 12, height: max(8, 34 * CGFloat(slot.score) / 100.0))
                                        }
                                        Text("\(slot.tempC)°")
                                            .font(.caption.monospacedDigit().weight(.semibold))
                                        Text("\(slot.windKmh)k·\(slot.precipProb)%")
                                            .font(.system(size: 9).monospacedDigit())
                                            .foregroundStyle(.secondary)
                                    }
                                    .padding(.vertical, 8)
                                    .frame(maxWidth: .infinity)
                                    .background(
                                        isBest ? Color("AccentColor").opacity(0.12) : Color(.secondarySystemBackground),
                                        in: RoundedRectangle(cornerRadius: 12)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(isBest ? Color("AccentColor") : .clear, lineWidth: 1.5)
                                    )
                                }
                            }
                        }
                    }
                }
                .padding(16)
            }
            .navigationTitle("Ride Weather · \(store.activeCity.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

// MARK: - 2. Global City Explorer Sheet

struct CitySearchSheet: View {
    @Environment(SpinMapStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var query: String = ""
    @State private var isSearching: Bool = false
    @State private var errorMsg: String?

    var body: some View {
        NavigationStack {
            List {
                Section("Search Any City Worldwide") {
                    HStack {
                        TextField("e.g. Kyoto, Vancouver, Paris…", text: $query)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.search)
                            .onSubmit { runSearch() }
                        if isSearching {
                            ProgressView()
                        } else {
                            Button("Go") { runSearch() }
                                .buttonStyle(.borderedProminent)
                                .disabled(query.trimmingCharacters(in: .whitespaces).count < 2)
                        }
                    }
                    if let errorMsg {
                        Text(errorMsg)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section("Curated Flagship Cities") {
                    ForEach([CityConfig.melbourne, CityConfig.sydney]) { city in
                        cityRow(city, badge: "7 Curated Routes")
                    }
                }

                Section("Popular Global Cycling Cities") {
                    ForEach(CityConfig.quickGlobalCities.filter { !$0.isBuiltIn }) { city in
                        cityRow(city, badge: "Auto Bikeway Loop")
                    }
                }
            }
            .navigationTitle("Explore City")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private func cityRow(_ city: CityConfig, badge: String) -> some View {
        Button {
            store.switchCity(city, autoDesignIfGlobal: !city.isBuiltIn)
            dismiss()
        } label: {
            HStack {
                Text(city.isBuiltIn ? "📍" : "🌍")
                VStack(alignment: .leading, spacing: 2) {
                    Text(city.name)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(city.regionLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(badge)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Color("AccentColor"))
                if store.activeCity.id == city.id {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Color("AccentColor"))
                }
            }
        }
    }

    private func runSearch() {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return }
        isSearching = true
        errorMsg = nil
        Task {
            let resolved = await LiveServices.searchGlobalCity(query: trimmed)
            isSearching = false
            if let resolved {
                store.switchCity(resolved, autoDesignIfGlobal: !resolved.isBuiltIn)
                dismiss()
            } else {
                errorMsg = "Could not find \"\(trimmed)\". Try a major city name."
            }
        }
    }
}

// MARK: - 3. Reorder & Delete Route Waypoints Sheet

struct EditStopsSheet: View {
    @Environment(SpinMapStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var draftLandmarks: [RouteLandmark] = []

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(draftLandmarks) { lm in
                        HStack(spacing: 10) {
                            Text(lm.icon)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(lm.label)
                                    .font(.subheadline.weight(.medium))
                                Text(lm.note)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                    .onMove { from, to in
                        draftLandmarks.move(fromOffsets: from, toOffset: to)
                    }
                    .onDelete { offsets in
                        if draftLandmarks.count - offsets.count >= 2 {
                            draftLandmarks.remove(atOffsets: offsets)
                        }
                    }
                } header: {
                    Text("Waypoints (\(draftLandmarks.count)/8)")
                } footer: {
                    Text("Drag handles to reorder stops or swipe left to remove. Tap the map in Edit mode to add new stops.")
                }
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Edit Route Stops")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Recalculate") {
                        let baseName = store.activeRoute?.name ?? "Custom Route"
                        dismiss()
                        Task {
                            await store.applyEditedWaypoints(draftLandmarks, baseName: baseName)
                        }
                    }
                    .fontWeight(.semibold)
                    .disabled(draftLandmarks.count < 2)
                }
            }
            .onAppear {
                draftLandmarks = store.activeRoute?.landmarks ?? []
            }
        }
    }
}
