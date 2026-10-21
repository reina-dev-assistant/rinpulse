// The watch-side settings that are plain protocol commands on iOS too: alarms, the health sensor switches, live heart rate, the one-minute
// HRV measurement and the automatic stress switch. Ports of the alarm part of PhoneFeatures.kt and of HealthSensors/LiveHeartRate/HrvSpot/
// StressSwitch, reaching the watch through the live `LinkHandle`. Registered as a `LinkObserver` for what has to follow the session.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class WatchSettingsFeatures: LinkObserver, @unchecked Sendable {
    private let handle: @Sendable () -> LinkHandle?
    private let settings: WearSettings
    private let events: WearEvents
    private let nowMs: @Sendable () -> Int64

    /// The live heart rate on Today and during a live workout; also what an HRV measurement pauses.
    public let liveHeartRate: LiveHeartRate
    /// The 1-minute HRV measurement.
    public let hrv: HrvSpot
    /// The automatic stress switch.
    public let stress: StressFeature
    /// Keeps the phone-language observer registered for the life of the object.
    private var localeObserver: NSObjectProtocol?

    public init(
        handle: @escaping @Sendable () -> LinkHandle?, settings: WearSettings, syncStore: SyncStore, events: WearEvents,
        nowMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.handle = handle
        self.settings = settings
        self.events = events
        self.nowMs = nowMs
        self.liveHeartRate = LiveHeartRate(handle: handle, settings: settings, events: events, nowMs: nowMs)
        self.hrv = HrvSpot(handle: handle, liveHeartRate: liveHeartRate, syncStore: syncStore, events: events)
        self.stress = StressFeature(handle: handle, settings: settings, hrv: hrv, events: events)
        observeLocaleChanges()
    }

    // MARK: LinkObserver

    public func linkConnected(_ handle: LinkHandle) async {
        // The stress switch waits for the watch's answer (up to 5 s); the live heart rate must not wait for it.
        Task { await self.stress.linkConnected(handle) }
        await liveHeartRate.linkConnected(handle)
    }

    public func linkDisconnected() { liveHeartRate.linkDisconnected() }

    // MARK: alarms

    private func alarmsJS(_ alarms: WatchAlarms) -> [String: Any] {
        let caps = handle()?.caps
        return alarms.toJS(supported: caps.map(AlarmSync.supported) ?? false, smartSupported: caps.map(AlarmSync.smartSupported) ?? false)
    }

    /// `getAlarms`: the alarms last read from or pushed to the watch; empty before the first exchange.
    public func cachedAlarms() -> [String: Any] { alarmsJS(WatchAlarms.fromJson(settings.alarmsJson)) }

    /// `refreshAlarms`: reads the watch's alarms and keeps them.
    public func refreshAlarms() async throws -> [String: Any] {
        guard let h = handle() else { throw WearError(.notConnected, "Not connected to a watch") }
        let alarms = try await AlarmSync.read(session: h.session, caps: h.caps, log: events.sink)
        settings.alarmsJson = alarms.toJson()
        return alarmsJS(alarms)
    }

    /// `setAlarms`: pushes `alarms` and returns what the watch holds afterwards (read back, so a missing acknowledgment is visible).
    public func setAlarms(_ alarms: WatchAlarms) async throws -> [String: Any] {
        try AlarmSync.validate(alarms)
        guard let h = handle() else { throw WearError(.notConnected, "Not connected to a watch") }
        try await AlarmSync.write(session: h.session, caps: h.caps, log: events.sink, alarms: alarms)
        return try await refreshAlarms()
    }

    // MARK: health sensors

    /// `getHealthSensors`: the stored switches and, while connected, which of them the watch supports (null when not connected).
    public func healthSensorsStatus() -> [String: Any] {
        let config = settings.healthSensors
        let supported: Any = handle().map { HealthSensorSupport.of($0.caps.supports).toJS() as Any } ?? NSNull()
        return [
            "automaticHeartRate": config.automaticHeartRate,
            "automaticSpo2": config.automaticSpo2,
            "truSleep": config.truSleep,
            "highHeartRateAlert": config.highHeartRateAlert,
            "lowHeartRateAlert": config.lowHeartRateAlert,
            "supported": supported,
        ]
    }

    /// `setHealthSensors`: stores the switches and, when the watch is connected, sends what changed; true when it was all acknowledged.
    public func setHealthSensors(_ config: HealthSensorConfig) async throws -> Bool {
        if let message = config.validationError() { throw WearError(.invalidArgument, message) }
        let previous = settings.healthSensors
        settings.healthSensors = config
        guard let h = handle() else { return false }
        let plan = HealthSensors.plan(supports: h.caps.supports, config: config, previous: previous)
        if plan.isEmpty { return true }
        let acknowledged = try await h.operationLock.withLock { try await HealthSensors.send(session: h.session, log: events.sink, plan: plan) }
        return acknowledged == plan.count
    }

    // MARK: language

    /// `setWatchLanguage`: the app language the watch follows (`id`, `en`), nil for the phone's. Stored, sent at every connect, and sent now when
    /// a watch is connected and the value changed; true when the connected watch took it.
    public func setWatchLanguage(_ language: String?) async throws -> Bool {
        let trimmed = language?.trimmingCharacters(in: .whitespaces)
        let value = trimmed?.isEmpty == false ? trimmed : nil
        if let value, !WatchLocale.isLanguageTag(value) { throw WearError(.invalidArgument, "'\(value)' is not a language tag") }
        if settings.watchLanguage == value { return false }
        settings.watchLanguage = value
        return await resendLanguage(reason: "the app language changed")
    }

    /// Sends the language to the connected watch; false when none is connected or the watch did not take it.
    @discardableResult
    public func resendLanguage(reason: String) async -> Bool {
        guard let h = handle() else { return false }
        do {
            return try await h.operationLock.withLock {
                try await LanguageSender.send(
                    session: h.session, caps: h.caps, log: events.sink, pinned: settings.watchLanguage, phone: LanguageSender.phoneLanguage()
                )
            }
        } catch {
            events.sink(LogEntry(.error, "LanguageSetting not sent (\(reason)): \(error)"))
            return false
        }
    }

    /// The phone's language changed while the app runs: a watch that follows the phone is told again, as Huawei Health does. A pinned app
    /// language does not move with the phone.
    private func observeLocaleChanges() {
        localeObserver = NotificationCenter.default.addObserver(forName: NSLocale.currentLocaleDidChangeNotification, object: nil, queue: nil) { [weak self] _ in
            guard let self, self.settings.watchLanguage == nil else { return }
            Task { await self.resendLanguage(reason: "the phone language changed") }
        }
    }
}

#endif
