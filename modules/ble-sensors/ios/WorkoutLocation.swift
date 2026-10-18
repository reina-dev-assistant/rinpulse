// CoreLocation side of a phone-recorded workout: the permission flow and best-accuracy fixes (about 1 Hz while moving), delivered through `onFix`.
// CLLocationManager is created and driven on the main thread (its delegate callbacks then arrive there too).
#if canImport(CoreLocation)
@preconcurrency import CoreLocation
import Foundation

struct LocationFix: Sendable {
    let ts: Int64
    let lat: Double
    let lon: Double
    let alt: Double?
    let accuracy: Double?
    let speed: Double?
    let bearing: Double?

    var payload: [String: Any?] {
        ["ts": ts, "lat": lat, "lon": lon, "alt": alt, "accuracy": accuracy, "speed": speed, "bearing": bearing]
    }

    /// CoreLocation marks a value it does not have with a negative number (speed, course, accuracy).
    init(_ location: CLLocation) {
        ts = Int64(location.timestamp.timeIntervalSince1970 * 1000)
        lat = location.coordinate.latitude
        lon = location.coordinate.longitude
        alt = location.verticalAccuracy >= 0 ? location.altitude : nil
        accuracy = location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
        speed = location.speed >= 0 ? location.speed : nil
        bearing = location.course >= 0 ? location.course : nil
    }
}

final class WorkoutLocation: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
    static let shared = WorkoutLocation()

    /// How long `requestPermission` waits for the user to answer the system prompt.
    static let promptTimeoutMs = 120_000

    private let lock = NSLock()
    private var _manager: CLLocationManager?
    private var handler: (@Sendable (LocationFix) -> Void)?
    private var waiters: [CheckedContinuation<String, Never>] = []

    private override init() { super.init() }

    private func manager() -> CLLocationManager {
        if let existing = lock.withLock({ _manager }) { return existing }
        let make = { () -> CLLocationManager in
            let manager = CLLocationManager()
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = kCLDistanceFilterNone
            manager.activityType = .fitness
            manager.pausesLocationUpdatesAutomatically = false
            manager.delegate = self
            return manager
        }
        let created = Thread.isMainThread ? make() : DispatchQueue.main.sync(execute: make)
        return lock.withLock {
            if let existing = _manager { return existing }
            _manager = created
            return created
        }
    }

    private static func map(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: return "granted"
        case .notDetermined: return "undetermined"
        default: return "denied"
        }
    }

    func permission() -> String { WorkoutLocation.map(manager().authorizationStatus) }

    func requestPermission() async -> String {
        let manager = manager()
        let current = WorkoutLocation.map(manager.authorizationStatus)
        if current != "undetermined" { return current }
        return await withCheckedContinuation { (continuation: CheckedContinuation<String, Never>) in
            lock.withLock { waiters.append(continuation) }
            DispatchQueue.main.async { manager.requestWhenInUseAuthorization() }
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(WorkoutLocation.promptTimeoutMs) * 1_000_000)
                self?.resolve()
            }
        }
    }

    private func resolve() {
        let status = permission()
        let pending: [CheckedContinuation<String, Never>] = lock.withLock {
            let w = waiters
            waiters = []
            return w
        }
        for waiter in pending { waiter.resume(returning: status) }
    }

    /// Whether the app declared the `location` background mode; setting allowsBackgroundLocationUpdates without it raises an exception.
    private static var declaresBackgroundLocation: Bool {
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String]
        return modes?.contains("location") ?? false
    }

    /// Starts fixes. Returns false when location is not granted.
    func start(_ onFix: @escaping @Sendable (LocationFix) -> Void) -> Bool {
        guard permission() == "granted" else { return false }
        lock.withLock { handler = onFix }
        let manager = manager()
        DispatchQueue.main.async {
            if WorkoutLocation.declaresBackgroundLocation {
                manager.allowsBackgroundLocationUpdates = true
                manager.showsBackgroundLocationIndicator = true
            } else {
                NSLog("BleSensors: UIBackgroundModes lacks 'location', GPS stops when the app is suspended")
            }
            manager.startUpdatingLocation()
        }
        return true
    }

    func stop() {
        lock.withLock { handler = nil }
        guard let manager = lock.withLock({ _manager }) else { return }
        DispatchQueue.main.async {
            manager.stopUpdatingLocation()
            if WorkoutLocation.declaresBackgroundLocation {
                manager.showsBackgroundLocationIndicator = false
                manager.allowsBackgroundLocationUpdates = false
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus != .notDetermined { resolve() }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let onFix = lock.withLock({ handler }) else { return }
        for location in locations { onFix(LocationFix(location)) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        NSLog("BleSensors: location error \(error.localizedDescription)")
    }
}
#endif
