import SwiftUI

@main
struct SpinMapApp: App {
    @State private var store = SpinMapStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(store)
                .tint(Color("AccentColor"))
                .onOpenURL { url in
                    store.handleIncomingURL(url)
                }
        }
    }
}
