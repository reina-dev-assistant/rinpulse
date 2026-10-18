// "Is there a network right now" for the satellite-data job (Kotlin `isOnline(context)`): the system path monitor on Apple platforms.
import Foundation
#if canImport(Network)
import Network
#endif

public enum AgpsReachability {
    #if canImport(Network)
    private final class Monitor: @unchecked Sendable {
        private let lock = NSLock()
        private var online = true
        private let monitor = NWPathMonitor()

        init() {
            monitor.pathUpdateHandler = { [weak self] path in
                guard let self else { return }
                self.lock.locked { self.online = path.status == .satisfied }
            }
            monitor.start(queue: DispatchQueue(label: "joyofit.agps.reachability", qos: .utility))
        }

        var isOnline: Bool { lock.locked { online } }
    }

    private static let shared = Monitor()

    /// True while the system reports a usable network path (and until the monitor's first report, which arrives within moments of the first use).
    public static let isOnline: @Sendable () -> Bool = { shared.isOnline }
    #else
    /// No reachability API here (Linux logic tests): never online, so nothing in the tests can reach the network.
    public static let isOnline: @Sendable () -> Bool = { false }
    #endif
}
