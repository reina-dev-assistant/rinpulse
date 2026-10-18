// Writes the watch data stored in joyofit.db into Apple Health, from native code only, so it works from the background session with no JS
// running. Each sync exports its window; the backfill walks the whole table. Port of HealthConnectExporter.kt: both read the stored rows,
// plan samples with HealthKitPlan and hand them to a `HealthWriter` (HealthKitWriter.swift is the HealthKit one) with a stable sync id and a
// version equal to the export time, which makes the write a replace: exporting a window twice leaves one sample per minute / reading / night.
//
// Types the user has not granted are skipped. The ExerciseSession part writes the completed rows of the `workouts` table; the iOS module has
// no workout sync yet, so the table stays empty and no workout is written until that protocol layer is ported.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// The watch that recorded the data, for the sample's HKDevice (the Android `Device`).
public struct HealthDevice: Equatable, Sendable {
    public let manufacturer: String
    public let model: String?
    public let name: String?

    public init(manufacturer: String, model: String?, name: String?) {
        self.manufacturer = manufacturer
        self.model = model
        self.name = name
    }
}

/// One group of samples for the writer.
public enum HealthBatch: Sendable {
    case steps([HealthKitPlan.Interval])
    case distance([HealthKitPlan.Interval])
    case calories([HealthKitPlan.Interval])
    case heartRate([HealthKitPlan.Point])
    case spo2([HealthKitPlan.Point])
    case restingHeartRate([RestingReading])
    /// HealthKit has no sleep session to replace as a whole: the writer first deletes this app's sleep samples in [`replaceFromSec`,
    /// `replaceToSec`), then saves the stages of every session.
    case sleep([HealthKitPlan.SleepPlan], replaceFromSec: Int64, replaceToSec: Int64)
    case workouts([WorkoutPlan])

    public struct RestingReading: Sendable, Equatable {
        public let id: String
        public let point: HealthKitPlan.Point
    }
}

public protocol HealthWriter: AnyObject, Sendable {
    /// `available`, `update-required` or `unavailable`, the values of `HealthConnectAvailability`.
    var availability: String { get }
    /// The types this app may write.
    func authorized() async throws -> Set<HealthRecordType>
    /// Shows the permission sheet for the types not decided yet.
    func requestAuthorization() async throws
    /// Saves the batch; the sample count written. `version` is the export time and goes into HKMetadataKeySyncVersion.
    func write(_ batch: HealthBatch, device: HealthDevice, version: Int64) async throws -> Int
    /// Opens the app where permissions and data are managed.
    func openSettings() async
}

/// Health export switch and the last export's outcome; UserDefaults, readable without JS.
public final class HealthExportSettings: @unchecked Sendable {
    private static let suiteName = "joyofit_health_kit"
    private let defaults: UserDefaults

    private enum Key {
        static let enabled = "enabled"
        static let lastExport = "last_export_sec"
        static let lastError = "last_error"
        static let workouts = "exported_workouts"
        static let counts = "last_counts"
        static let sleepRules = "sleep_rules_version"
    }

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: HealthExportSettings.suiteName) ?? .standard
    }

    public var enabled: Bool {
        get { defaults.bool(forKey: Key.enabled) }
        set { defaults.set(newValue, forKey: Key.enabled) }
    }

    /// Unix seconds of the last export that finished without an error, 0 if none.
    public var lastExportSec: Int64 {
        get { Int64(defaults.double(forKey: Key.lastExport)) }
        set { defaults.set(Double(newValue), forKey: Key.lastExport) }
    }

    public var lastError: String? {
        get { defaults.string(forKey: Key.lastError) }
        set { if let newValue { defaults.set(newValue, forKey: Key.lastError) } else { defaults.removeObject(forKey: Key.lastError) } }
    }

    /// Signatures of every workout already written.
    public var exportedWorkouts: Set<String> {
        get { Set(defaults.stringArray(forKey: Key.workouts) ?? []) }
        set { defaults.set(Array(newValue).sorted(), forKey: Key.workouts) }
    }

    /// `SleepCleaning.rulesVersion` of the rules the Health sleep samples were last rewritten under, 0 before the first export. Lower than the
    /// current version, the next sleep export rewrites the whole history once.
    public var sleepRulesVersion: Int {
        get { defaults.integer(forKey: Key.sleepRules) }
        set { defaults.set(newValue, forKey: Key.sleepRules) }
    }

    public var lastCounts: String? {
        get { defaults.string(forKey: Key.counts) }
        set { if let newValue { defaults.set(newValue, forKey: Key.counts) } else { defaults.removeObject(forKey: Key.counts) } }
    }
}

public final class HealthExporter: @unchecked Sendable {
    /// A sync window reaches this far back for sleep, so a night that straddles it is written whole.
    static let sleepLookbackSec: Int64 = 36 * 3600

    private let syncStore: SyncStore
    private let writer: HealthWriter
    public let settings: HealthExportSettings
    private let events: WearEvents
    private let timeZone: TimeZone
    private let now: @Sendable () -> Date
    private let mutex = AsyncLock()
    private let flagLock = NSLock()
    private var _exporting = false

    public var exporting: Bool { flagLock.locked { _exporting } }

    public init(
        syncStore: SyncStore, writer: HealthWriter, settings: HealthExportSettings, events: WearEvents,
        timeZone: TimeZone = .current, now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.syncStore = syncStore
        self.writer = writer
        self.settings = settings
        self.events = events
        self.timeZone = timeZone
        self.now = now
    }

    private func log(_ message: String) { events.info("HealthKit: \(message)") }
    private func logError(_ message: String) { events.error("HealthKit: \(message)") }

    // MARK: availability and permissions

    /// `HealthConnectStatus` in HuaweiWear.types.ts.
    public func status() async -> [String: Any] {
        let granted = (try? await writer.authorized()) ?? []
        return [
            "availability": writer.availability,
            "enabled": settings.enabled,
            "granted": HealthRecordType.allCases.filter { granted.contains($0) }.map(\.rawValue),
            "missing": HealthRecordType.allCases.filter { !granted.contains($0) }.map(\.rawValue),
            "exporting": exporting,
            "lastExportSec": settings.lastExportSec > 0 ? settings.lastExportSec : NSNull(),
            "lastError": settings.lastError ?? NSNull(),
            "lastCounts": settings.lastCounts ?? NSNull(),
        ]
    }

    /// Shows the permission sheet for every type not decided yet, then reports the status. A type the user denied is not asked again by
    /// iOS: `openSettings` is where it is changed.
    public func requestPermissions() async throws -> [String: Any] {
        guard writer.availability == "available" else {
            throw WearError(.unsupported, "Apple Health is not available on this device (\(writer.availability))")
        }
        do {
            try await writer.requestAuthorization()
        } catch let e as WearError {
            throw e
        } catch {
            throw WearError(.unsupported, "Apple Health permission request failed: \(error)", underlying: error)
        }
        return await status()
    }

    public func openSettings() async { await writer.openSettings() }

    /// Switches the export on or off. Switching on needs Apple Health and at least one granted write permission, then runs the backfill once;
    /// switching off only stops later exports (samples already written stay in Apple Health; the user removes them there).
    public func setEnabled(_ enabled: Bool) async throws {
        if !enabled {
            settings.enabled = false
            return
        }
        guard writer.availability == "available" else {
            throw WearError(.unsupported, "Apple Health is not available on this device (\(writer.availability))")
        }
        let granted = (try? await writer.authorized()) ?? []
        if granted.isEmpty { throw WearError(.unsupported, "Grant Apple Health write permission first") }
        settings.enabled = true
        _ = try await backfill()
    }

    // MARK: triggers

    /// After every stored sync: export that sync's window (fire and forget; failures are logged).
    public func onSyncComplete(_ summary: SyncSummary) {
        guard settings.enabled else { return }
        Task { [self] in
            do {
                try await mutex.withLock {
                    _ = try await run("sync window") { granted, version, device in
                        try await exportWindow(granted: granted, version: version, device: device, fromSec: summary.from)
                    }
                }
            } catch {
                fail(error)
            }
        }
    }

    /// Writes everything stored so far.
    public func backfill() async throws -> HealthExportCounts {
        do {
            return try await mutex.withLock {
                settings.exportedWorkouts = []
                return try await run("backfill") { granted, version, device in
                    try await exportAll(granted: granted, version: version, device: device)
                }
            }
        } catch let e as WearError {
            fail(e)
            if e.code == .unsupported { throw e }
            throw WearError(.storage, "Apple Health export failed: \(e.message)", underlying: e)
        } catch {
            fail(error)
            throw WearError(.storage, "Apple Health export failed: \(error)", underlying: error)
        }
    }

    private func fail(_ error: Error) {
        let message = (error as? WearError)?.message ?? "\(error)"
        settings.lastError = message
        logError("export failed: \(message)")
    }

    private func run(
        _ label: String,
        _ body: (Set<HealthRecordType>, Int64, HealthDevice) async throws -> HealthExportCounts
    ) async throws -> HealthExportCounts {
        guard writer.availability == "available" else {
            throw WearError(.unsupported, "Apple Health is not available on this device (\(writer.availability))")
        }
        let granted = try await writer.authorized()
        let missing = HealthRecordType.allCases.filter { !granted.contains($0) }
        if missing.count == HealthRecordType.allCases.count {
            settings.lastError = "Apple Health write permission is not granted"
            throw WearError(.unsupported, "no Apple Health write permission is granted")
        }
        if !missing.isEmpty { log("skipping types without permission: \(missing.map(\.rawValue).joined(separator: ", "))") }
        flagLock.locked { _exporting = true }
        defer { flagLock.locked { _exporting = false } }
        log("\(label): start")
        let device = try deviceInfo()
        let counts = try await body(granted, Int64(now().timeIntervalSince1970 * 1000), device)
        settings.lastExportSec = Int64(now().timeIntervalSince1970)
        settings.lastError = nil
        settings.lastCounts = counts.description
        log("\(label): wrote \(counts.description)")
        return counts
    }

    // MARK: export bodies

    private func deviceInfo() throws -> HealthDevice {
        let (name, productModel): (String?, String?) = try syncStore.read { db in
            try db.query("SELECT name, product_model FROM device ORDER BY is_primary DESC, last_sync DESC LIMIT 1") { ($0.text(0), $0.text(1)) }.first ?? (nil, nil)
        }
        let manufacturer = (name?.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("honor") == true) ? "Honor" : "Huawei"
        // "Watch GT 4" without the brand, which is the manufacturer field.
        let catalog = WatchModels.match(name).model?.name
        var catalogModel: String?
        if let catalog, let space = catalog.firstIndex(of: " ") { catalogModel = String(catalog[catalog.index(after: space)...]) }
        return HealthDevice(manufacturer: manufacturer, model: productModel ?? catalogModel, name: name)
    }

    private func exportWindow(granted: Set<HealthRecordType>, version: Int64, device: HealthDevice, fromSec: Int64) async throws -> HealthExportCounts {
        var counts = HealthExportCounts()
        try await exportSamples(granted, version, device, writeFrom: fromSec, writeTo: Int64.max, &counts)
        try await exportSleep(granted, version, device, fromSec: fromSec - HealthExporter.sleepLookbackSec, &counts)
        try await exportWorkouts(granted, version, device, &counts)
        return counts
    }

    private func exportAll(granted: Set<HealthRecordType>, version: Int64, device: HealthDevice) async throws -> HealthExportCounts {
        var counts = HealthExportCounts()
        let bounds: (Int64, Int64)? = try syncStore.read { db in
            try db.query("SELECT MIN(timestamp), MAX(timestamp) FROM step_samples WHERE imported = 0") { s in s.isNull(0) ? nil : (s.int64(0), s.int64(1)) }.first ?? nil
        }
        if let bounds {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = timeZone
            var start = dayStart(bounds.0, calendar)
            while start <= bounds.1 {
                let next = nextDayStart(start, calendar)
                try await exportSamples(granted, version, device, writeFrom: start, writeTo: next, &counts)
                start = next
            }
        }
        try await exportSleep(granted, version, device, fromSec: 0, &counts)
        try await exportWorkouts(granted, version, device, &counts)
        return counts
    }

    private func loadSamples(fromSec: Int64, toSec: Int64) throws -> [StepSample] {
        try syncStore.read { db in
            try db.query(
                """
                SELECT timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate
                FROM step_samples WHERE imported = 0 AND timestamp >= ? AND timestamp < ? ORDER BY timestamp
                """,
                [.int(fromSec), .int(toSec)]
            ) { s in
                StepSample(
                    timestamp: s.int64(0), steps: s.int(1), calories: s.int(2), distance: s.int(3),
                    heartRate: s.optionalInt(4), spo2: s.optionalInt(5), restingHeartRate: s.optionalInt(6)
                )
            }
        }
    }

    /// Samples in [writeFrom, writeTo).
    private func exportSamples(
        _ granted: Set<HealthRecordType>, _ version: Int64, _ device: HealthDevice, writeFrom: Int64, writeTo: Int64, _ counts: inout HealthExportCounts
    ) async throws {
        let inWindow = try loadSamples(fromSec: writeFrom, toSec: writeTo)
        if inWindow.isEmpty { return }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let dayOf: (Int64) -> String = { sec in
            let c = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: Double(sec)))
            return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
        }

        if granted.contains(.steps) {
            counts.steps += try await writer.write(.steps(HealthKitPlan.steps(inWindow, fromSec: writeFrom)), device: device, version: version)
        }
        if granted.contains(.distance) {
            counts.distance += try await writer.write(.distance(HealthKitPlan.distance(inWindow, fromSec: writeFrom)), device: device, version: version)
        }
        if granted.contains(.activeCaloriesBurned) {
            counts.calories += try await writer.write(.calories(HealthKitPlan.calories(inWindow, fromSec: writeFrom)), device: device, version: version)
        }
        if granted.contains(.heartRate) {
            counts.heartRate += try await writer.write(.heartRate(HealthKitPlan.heartRate(inWindow, fromSec: writeFrom)), device: device, version: version)
        }
        if granted.contains(.oxygenSaturation) {
            counts.spo2 += try await writer.write(.spo2(HealthKitPlan.spo2(inWindow, fromSec: writeFrom)), device: device, version: version)
        }
        if granted.contains(.restingHeartRate) {
            let readings = HealthKitPlan.restingHeartRate(inWindow, fromSec: writeFrom, dayOf: dayOf).map { HealthBatch.RestingReading(id: $0.0, point: $0.1) }
            counts.restingHeartRate += try await writer.write(.restingHeartRate(readings), device: device, version: version)
        }
    }

    private func exportSleep(
        _ granted: Set<HealthRecordType>, _ version: Int64, _ device: HealthDevice, fromSec: Int64, _ counts: inout HealthExportCounts
    ) async throws {
        guard granted.contains(.sleepSession) else { return }
        // After a change of the sleep rules the whole history is planned and replaced once, so no session of the old rules stays next to the
        // corrected ones.
        let fromSec = HealthKitPlan.sleepExportFrom(windowFromSec: fromSec, storedRulesVersion: settings.sleepRulesVersion)
        // Read a day before the window so a night that began before it is seen whole.
        let (stored, segments): (Int, [SleepSegment]) = try syncStore.read { db in
            let stored = try db.query("SELECT COUNT(*) FROM sleep_segments WHERE imported = 0 AND end >= ?", [.int(fromSec - 24 * 3600)]) { $0.int(0) }.first ?? 0
            return (stored, try SleepStore.load(db, endFromSec: fromSec - 24 * 3600, importedOnly: true))
        }
        // Stored rows that the cleaning drops entirely still clear the range: an earlier version may have exported them as a session.
        if stored > 0 {
            let sessions = HealthKitPlan.sleepSessions(segments, fromSec: fromSec)
            let range = HealthKitPlan.sleepReplaceRange(sessions: sessions, fromSec: fromSec)
            counts.sleep += try await writer.write(.sleep(sessions, replaceFromSec: range.fromSec, replaceToSec: range.toSec), device: device, version: version)
        }
        settings.sleepRulesVersion = SleepCleaning.rulesVersion
    }

    /// Completed workouts not written yet (or changed since: the signature covers the end, energy, distance and the number of stored heart-rate
    /// and route points), keyed by the workout's start time. Skipped when the table does not exist. Without write permission for heart rate
    /// the workout goes without its readings.
    private func exportWorkouts(_ granted: Set<HealthRecordType>, _ version: Int64, _ device: HealthDevice, _ counts: inout HealthExportCounts) async throws {
        guard granted.contains(.exerciseSession) else { return }
        let written = settings.exportedWorkouts
        let pending = try loadWorkouts().filter { !written.contains($0.row.signature) }
        if pending.isEmpty { return }
        let plans = try pending.map { entry -> WorkoutPlan in
            let plan = HealthKitPlan.workoutPlan(entry.row, points: try loadWorkoutPoints(workoutId: entry.id))
            return granted.contains(.heartRate) ? plan : plan.withoutHeartRate()
        }
        counts.workouts += try await writer.write(.workouts(plans), device: device, version: version)
        settings.exportedWorkouts = written.union(pending.map(\.row.signature))
    }

    private func loadWorkouts() throws -> [(row: WorkoutRow, id: Int64)] {
        try syncStore.read { db in
            guard try db.tableExists("workouts") else { return [] }
            return try db.query(
                """
                SELECT w.start, w.end, w.duration, w.sport_type, w.sport_name, w.distance, w.calories, w.avg_hr, w.max_hr, w.id,
                  (SELECT COUNT(*) FROM workout_points p WHERE p.workout_id = w.id AND p.hr IS NOT NULL),
                  (SELECT COUNT(*) FROM workout_points p WHERE p.workout_id = w.id AND p.lat IS NOT NULL AND p.lon IS NOT NULL)
                FROM workouts w WHERE w.imported = 0 AND w.complete = 1 ORDER BY w.start
                """
            ) { s -> (row: WorkoutRow, id: Int64)? in
                let start = s.int64(0)
                let end = (!s.isNull(1) && s.int64(1) > start) ? s.int64(1) : start + Int64(s.optionalInt(2) ?? 0)
                if end <= start { return nil }
                let row = WorkoutRow(
                    start: start, end: end, sportType: s.optionalInt(3) ?? 255, name: s.text(4), distance: s.optionalInt(5),
                    calories: s.optionalInt(6), avgHr: s.optionalInt(7), maxHr: s.optionalInt(8), hrPoints: s.int(10), routePoints: s.int(11)
                )
                return (row, s.int64(9))
            }.compactMap { $0 }
        }
    }

    private func loadWorkoutPoints(workoutId: Int64) throws -> [WorkoutPoint] {
        try syncStore.read { db in
            try db.query("SELECT ts, lat, lon, alt, hr FROM workout_points WHERE workout_id = ? ORDER BY ts", [.int(workoutId)]) { s in
                WorkoutPoint(
                    ts: s.int64(0), lat: s.isNull(1) ? nil : s.double(1), lon: s.isNull(2) ? nil : s.double(2), alt: s.isNull(3) ? nil : s.double(3),
                    hr: s.optionalInt(4)
                )
            }
        }
    }

    private func dayStart(_ sec: Int64, _ calendar: Calendar) -> Int64 {
        Int64(calendar.startOfDay(for: Date(timeIntervalSince1970: Double(sec))).timeIntervalSince1970)
    }

    private func nextDayStart(_ startSec: Int64, _ calendar: Calendar) -> Int64 {
        let start = Date(timeIntervalSince1970: Double(startSec))
        let next = calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400)
        return Int64(calendar.startOfDay(for: next).timeIntervalSince1970)
    }
}

#endif
