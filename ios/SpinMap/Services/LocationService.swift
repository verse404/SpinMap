import CoreLocation
import Foundation

@Observable
@MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var locationContinuation: CheckedContinuation<CLLocationCoordinate2D, Error>?

    var authorizationStatus: CLAuthorizationStatus
    var lastCoordinate: CLLocationCoordinate2D?

    enum LocationError: LocalizedError {
        case denied
        case unavailable

        var errorDescription: String? {
            switch self {
            case .denied:
                return "Location permission is turned off. Enable While Using in iOS Settings, or tap Pick on Map."
            case .unavailable:
                return "Could not determine your GPS position right now. Try tapping Pick on Map."
            }
        }
    }

    override init() {
        self.authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func requestCurrentLocation() async throws -> CLLocationCoordinate2D {
        let status = manager.authorizationStatus
        authorizationStatus = status

        if status == .denied || status == .restricted {
            throw LocationError.denied
        }

        if let existing = manager.location,
           abs(existing.timestamp.timeIntervalSinceNow) < 45 {
            lastCoordinate = existing.coordinate
            return existing.coordinate
        }

        return try await withCheckedThrowingContinuation { continuation in
            self.locationContinuation?.resume(throwing: LocationError.unavailable)
            self.locationContinuation = continuation
            if status == .notDetermined {
                manager.requestWhenInUseAuthorization()
            } else {
                manager.requestLocation()
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.authorizationStatus = status
            guard self.locationContinuation != nil else { return }
            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                manager.requestLocation()
            case .denied, .restricted:
                self.locationContinuation?.resume(throwing: LocationError.denied)
                self.locationContinuation = nil
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coord = locations.last?.coordinate else { return }
        Task { @MainActor in
            self.lastCoordinate = coord
            self.locationContinuation?.resume(returning: coord)
            self.locationContinuation = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.locationContinuation?.resume(throwing: LocationError.unavailable)
            self.locationContinuation = nil
        }
    }
}
