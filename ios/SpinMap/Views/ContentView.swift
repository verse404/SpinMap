import SwiftUI

struct ContentView: View {
    @Environment(SpinMapStore.self) private var store

    var body: some View {
        @Bindable var bindableStore = store

        ZStack(alignment: .bottom) {
            TabView(selection: $bindableStore.selectedTab) {
                ExploreTabView()
                    .tabItem {
                        Label("Explore", systemImage: "map.fill")
                    }
                    .tag(0)

                RouteDesignerTabView()
                    .tabItem {
                        Label("Design", systemImage: "wand.and.stars")
                    }
                    .tag(1)

                SavedTabView()
                    .tabItem {
                        Label("Saved", systemImage: store.savedIds.isEmpty ? "heart" : "heart.fill")
                    }
                    .badge(store.savedIds.count)
                    .tag(2)
            }

            if let toast = store.toastMessage {
                Text(toast)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.black.opacity(0.86), in: Capsule())
                    .shadow(color: .black.opacity(0.22), radius: 10, y: 4)
                    .padding(.bottom, 64)
                    .padding(.horizontal, 16)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(50)
            }
        }
        .animation(.spring(duration: 0.28), value: store.toastMessage)
        .sheet(isPresented: $bindableStore.showWeatherSheet) {
            WeatherWindowSheet()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $bindableStore.showCitySearchSheet) {
            CitySearchSheet()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $bindableStore.showEditStopsSheet) {
            EditStopsSheet()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}
