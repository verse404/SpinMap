import Foundation

enum BundleDataLoader {
    static func loadRoutes() -> RoutesBundle {
        guard let url = Bundle.main.url(forResource: "RoutesBundle", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(RoutesBundle.self, from: data)
        else {
            return RoutesBundle(melbourne: [], sydney: [])
        }
        return decoded
    }

    static func loadAnchors() -> AnchorsBundle {
        guard let url = Bundle.main.url(forResource: "AnchorsBundle", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(AnchorsBundle.self, from: data)
        else {
            return AnchorsBundle(melbourne: [], sydney: [])
        }
        return decoded
    }
}
