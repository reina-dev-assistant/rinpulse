import XCTest
@testable import HuaweiWearLogic

final class FakeHealthWriter: HealthWriter, @unchecked Sendable {
    private let lock = NSLock()
    var availability = "available"
    var allowed: Set<HealthRecordType> = Set(HealthRecordType.allCases)
    private(set) var batches: [HealthBatch] = []
    private(set) var versions: [Int64] = []
    private(set) var devices: [HealthDevice] = []
    private(set) var authorizationRequests = 0
    private(set) var settingsOpened = 0
    var failWrites = false

    func authorized() async throws -> Set<HealthRecordType> { allowed }
    func requestAuthorization() async throws { lock.locked { authorizationRequests += 1 } }
    func openSettings() async { lock.locked { settingsOpened += 1 } }

    func write(_ batch: HealthBatch, device: HealthDevice, version: Int64) async throws -> Int {
        if failWrites { throw WearError(.storage, "the Health store refused") }
        lock.locked {
            batches.append(batch)
            versions.append(version)
            devices.append(device)
        }
        switch batch {
        case .steps(let v), .distance(let v), .calories(let v): return v.count
        case .heartRate(let v), .spo2(let v): return v.count
        case .restingHeartRate(let v): return v.count
        case .sleep(let sessions, _, _): return sessions.reduce(0) { $0 + $1.stages.count }
        case .workouts(let rows): return rows.count
        }
    }

    func steps() -> [HealthKitPlan.Interval] { batches.flatMap { if case .steps(let v) = $0 { return v } else { return [] } } }
    func workouts() -> [WorkoutPlan] { batches.flatMap { if case .workouts(let v) = $0 { return v } else { return [] } } }
    func sleeps() -> [(sessions: [HealthKitPlan.SleepPlan], from: Int64, to: Int64)] {
        batches.compactMap { if case .sleep(let s, let f, let t) = $0 { return (s, f, t) } else { return nil } }
    }
}

final class HealthExporterTests: XCTestCase {
    private var store: SyncStore!
    private var writer: FakeHealthWriter!
    private var settings: HealthExportSettings!
    private var events: RecordingEvents!
    private var exporter: HealthExporter!
    private let utc = TimeZone(secondsFromGMT: 0)!

    override func setUpWithError() throws {
        store = SyncStore(url: temporaryDatabaseURL())
        writer = FakeHealthWriter()
        settings = HealthExportSettings(defaults: ephemeralDefaults())
        events = RecordingEvents()
        exporter = HealthExporter(syncStore: store, writer: writer, settings: settings, events: events, timeZone: utc, now: { Date(timeIntervalSince1970: 2_000_000) })
        try store.upsertDevice(address: "A", name: "HUAWEI WATCH FIT 4 Pro-40A", productModel: "ALT-B19", softwareVersion: "1")
    }

    private func insertSamples(_ rows: [(Int64, Int, Int, Int, Int?, Int?, Int?)]) throws {
        try store.read { db in
            for r in rows {
                try db.run(
                    "INSERT INTO step_samples (timestamp, steps, calories, distance, heart_rate, spo2, resting_heart_rate) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [.int(r.0), .int(Int64(r.1)), .int(Int64(r.2)), .int(Int64(r.3)), .integer(r.4), .integer(r.5), .integer(r.6)]
                )
            }
        }
    }

    func testStatusBeforeAnyExport() async {
        let status = await exporter.status()
        XCTAssertEqual(status["availability"] as? String, "available")
        XCTAssertEqual(status["enabled"] as? Bool, false)
        XCTAssertEqual((status["granted"] as? [String])?.count, 8)
        XCTAssertEqual((status["missing"] as? [String])?.count, 0)
        XCTAssertEqual(status["exporting"] as? Bool, false)
        XCTAssertTrue(status["lastExportSec"] is NSNull)
        XCTAssertTrue(status["lastError"] is NSNull)
        XCTAssertTrue(status["lastCounts"] is NSNull)
        XCTAssertEqual(Set(status.keys), ["availability", "enabled", "granted", "missing", "exporting", "lastExportSec", "lastError", "lastCounts"])
    }

    func testStatusListsGrantedAndMissingInTheAndroidOrder() async {
        writer.allowed = [.steps, .sleepSession]
        let status = await exporter.status()
        XCTAssertEqual(status["granted"] as? [String], ["Steps", "SleepSession"])
        XCTAssertEqual(status["missing"] as? [String], ["HeartRate", "OxygenSaturation", "RestingHeartRate", "Distance", "ActiveCaloriesBurned", "ExerciseSession"])
    }

    func testBackfillWritesEverythingStoredDayByDayWithStableIdsAndOneVersion() async throws {
        let day: Int64 = 86_400
        try insertSamples([
            (day * 3 + 60, 5, 100, 4, 70, 98, 55),
            (day * 3 + 120, 0, 0, 0, 72, nil, nil),
            (day * 4 + 60, 7, 0, 6, nil, nil, 54),
        ])
        let counts = try await exporter.backfill()
        XCTAssertEqual(counts.steps, 2)
        XCTAssertEqual(counts.distance, 2)
        XCTAssertEqual(counts.calories, 1)
        XCTAssertEqual(counts.heartRate, 2)
        XCTAssertEqual(counts.spo2, 1)
        XCTAssertEqual(counts.restingHeartRate, 2, "one per day")
        XCTAssertEqual(writer.steps().map(\.id), ["joyofit:steps:\(day * 3 + 60)", "joyofit:steps:\(day * 4 + 60)"])
        XCTAssertEqual(Set(writer.versions), [2_000_000_000], "every write of one export carries the export time in ms as its version")
        XCTAssertEqual(writer.devices.first, HealthDevice(manufacturer: "Huawei", model: "ALT-B19", name: "HUAWEI WATCH FIT 4 Pro-40A"))
        XCTAssertEqual(settings.lastExportSec, 2_000_000)
        XCTAssertNil(settings.lastError)
        XCTAssertEqual(settings.lastCounts, counts.description)
        // Exporting again writes the same ids again (a replace on the HealthKit side, not a second sample).
        let again = try await exporter.backfill()
        XCTAssertEqual(again, counts)
        XCTAssertEqual(writer.steps().map(\.id), (writer.steps().prefix(2) + writer.steps().prefix(2)).map(\.id))
    }

    func testRestingHeartRateIdUsesTheLocalDayOfTheTimeZone() async throws {
        try insertSamples([(86_400 * 2 + 10, 0, 0, 0, nil, nil, 60)])
        let tokyo = HealthExporter(
            syncStore: store, writer: writer, settings: settings, events: events, timeZone: TimeZone(secondsFromGMT: 9 * 3600)!, now: { Date(timeIntervalSince1970: 2_000_000) }
        )
        _ = try await tokyo.backfill()
        let ids = writer.batches.compactMap { b -> [String]? in if case .restingHeartRate(let r) = b { return r.map(\.id) } else { return nil } }.flatMap { $0 }
        XCTAssertEqual(ids, ["joyofit:rhr:1970-01-03"])
    }

    func testTypesWithoutPermissionAreSkippedAndLogged() async throws {
        writer.allowed = [.steps]
        try insertSamples([(60, 5, 100, 4, 70, 98, 55)])
        let counts = try await exporter.backfill()
        XCTAssertEqual(counts.steps, 1)
        XCTAssertEqual(counts.distance + counts.heartRate + counts.spo2 + counts.calories + counts.restingHeartRate + counts.sleep, 0)
        XCTAssertEqual(writer.batches.count, 1)
        XCTAssertTrue(events.messages(.info).contains { $0.contains("skipping types without permission: HeartRate") })
    }

    func testNoPermissionAtAllIsUnsupportedAndRecorded() async throws {
        writer.allowed = []
        do {
            _ = try await exporter.backfill()
            XCTFail("expected ERR_UNSUPPORTED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
            XCTAssertEqual(e.message, "no Apple Health write permission is granted")
        }
        XCTAssertEqual(settings.lastError, "no Apple Health write permission is granted")
        XCTAssertTrue(writer.batches.isEmpty)
    }

    func testUnavailableHealthIsUnsupported() async {
        writer.availability = "unavailable"
        do {
            _ = try await exporter.requestPermissions()
            XCTFail("expected ERR_UNSUPPORTED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
        } catch { XCTFail("\(error)") }
        do {
            try await exporter.setEnabled(true)
            XCTFail("expected ERR_UNSUPPORTED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
        } catch { XCTFail("\(error)") }
        XCTAssertFalse(settings.enabled)
    }

    func testEnablingNeedsAWritePermissionThenBackfills() async throws {
        writer.allowed = []
        do {
            try await exporter.setEnabled(true)
            XCTFail("expected ERR_UNSUPPORTED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .unsupported)
            XCTAssertEqual(e.message, "Grant Apple Health write permission first")
        }
        XCTAssertFalse(settings.enabled)

        writer.allowed = [.steps]
        try insertSamples([(60, 5, 0, 0, nil, nil, nil)])
        try await exporter.setEnabled(true)
        XCTAssertTrue(settings.enabled)
        XCTAssertEqual(writer.steps().count, 1, "switching on writes everything stored")
        try await exporter.setEnabled(false)
        XCTAssertFalse(settings.enabled)
    }

    func testRequestPermissionsAsksOnceAndReturnsTheStatus() async throws {
        writer.allowed = [.steps]
        let status = try await exporter.requestPermissions()
        XCTAssertEqual(writer.authorizationRequests, 1)
        XCTAssertEqual(status["granted"] as? [String], ["Steps"])
        await exporter.openSettings()
        XCTAssertEqual(writer.settingsOpened, 1)
    }

    func testASyncCompleteExportsOnlyWhenSwitchedOn() async throws {
        try insertSamples([(1_000, 5, 0, 0, nil, nil, nil), (5_000, 7, 0, 0, nil, nil, nil)])
        let summary = SyncSummary(from: 4_000, to: 6_000, samples: 1, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0)
        exporter.onSyncComplete(summary)
        await sleepMs(100)
        XCTAssertTrue(writer.batches.isEmpty, "switched off: nothing is written")

        settings.enabled = true
        exporter.onSyncComplete(summary)
        await eventually("the window export") { !writer.steps().isEmpty }
        XCTAssertEqual(writer.steps().map(\.startSec), [5_000], "only the sync window, not earlier samples")
    }

    func testFailedExportIsRecordedAndLogged() async throws {
        writer.failWrites = true
        try insertSamples([(60, 5, 0, 0, nil, nil, nil)])
        do {
            _ = try await exporter.backfill()
            XCTFail("expected a storage error")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .storage)
            XCTAssertTrue(e.message.hasPrefix("Apple Health export failed:"))
        }
        XCTAssertEqual(settings.lastError, "the Health store refused")
        XCTAssertTrue(events.messages(.error).contains { $0.contains("HealthKit: export failed") })
        XCTAssertFalse(exporter.exporting)
    }

    private func insertSleep(_ rows: [(Int64, Int64, Int, String?)]) throws {
        try store.read { db in
            for (start, end, type, stage) in rows {
                try db.run("INSERT INTO sleep_segments (start, end, type, stage) VALUES (?, ?, ?, ?)", [.int(start), .int(end), .int(Int64(type)), .string(stage)])
            }
        }
    }

    private func insertWorkout(start: Int64, end: Int64) throws {
        try store.read { db in
            try db.run(
                """
                INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, distance, calories, duration, steps, summary_json, complete)
                VALUES (1, ?, ?, 1, 'Run', 0, 0, ?, 0, '{}', 1)
                """,
                [.int(start), .int(end), .int(end - start)]
            )
        }
    }

    private func syncSummary(from: Int64) -> SyncSummary {
        SyncSummary(from: from, to: from + 1_000, samples: 0, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0)
    }

    func testSleepIsWrittenAsSessionsAndEverySleepSampleOfOursFromTheStartIsReplaced() async throws {
        // The last span has no stage and is over 20 minutes: a nap, kept by the cleaning.
        try insertSleep([(1_000, 2_000, 6, "light"), (2_000, 2_600, 7, "deep"), (50_000, 51_300, 1, nil)])
        let counts = try await exporter.backfill()
        XCTAssertEqual(counts.sleep, 3)
        let sleep = writer.sleeps()
        XCTAssertEqual(sleep.count, 1)
        XCTAssertEqual(sleep[0].sessions.map(\.id), ["joyofit:sleep:1000", "joyofit:sleep:50000"])
        XCTAssertEqual(sleep[0].from, 0)
        XCTAssertEqual(sleep[0].to, HealthKitPlan.sleepReplaceEndSec, "open-ended: a stale session after the last planned one goes too")
        XCTAssertEqual(settings.sleepRulesVersion, SleepCleaning.rulesVersion)
    }

    func testASyncWindowReachesBackForTheNightThatStraddlesIt() async throws {
        try insertSleep([(1_000_000 - 5 * 3600, 1_000_000 - 3600, 6, "light")])
        settings.enabled = true
        settings.sleepRulesVersion = SleepCleaning.rulesVersion
        exporter.onSyncComplete(syncSummary(from: 1_000_000))
        await eventually("the sleep export") { !writer.sleeps().isEmpty }
        XCTAssertEqual(writer.sleeps().first?.sessions.count, 1, "36 h of sleep lookback plus the day before: the whole night is seen")
        XCTAssertEqual(writer.sleeps().first?.from, 1_000_000 - HealthExporter.sleepLookbackSec)
    }

    func testFragmentsThatWereExportedAsANapAreReplacedByNothing() async throws {
        // Three stress-check fragments of 1 to 3 minutes: written as a 7 minute "nap" by the earlier rules.
        try insertSleep([(1_000_000, 1_000_060, 6, nil), (1_000_300, 1_000_420, 6, nil), (1_001_000, 1_001_180, 6, nil)])
        settings.enabled = true
        exporter.onSyncComplete(syncSummary(from: 1_000_000))
        await eventually("the sleep export") { !writer.sleeps().isEmpty }
        let sleep = writer.sleeps()
        XCTAssertEqual(sleep.count, 1)
        XCTAssertEqual(sleep[0].sessions, [], "no session is planned any more")
        XCTAssertEqual(sleep[0].from, 0, "but the range is cleared, which removes the old nap")
        XCTAssertEqual(sleep[0].to, HealthKitPlan.sleepReplaceEndSec)
        await eventually("the rules version") { settings.sleepRulesVersion == SleepCleaning.rulesVersion }
    }

    func testTheWholeHistoryIsRewrittenOnceAfterTheRulesChangeAndAWindowAfterThat() async throws {
        let oldNight: Int64 = 100_000
        let recent: Int64 = 5_000_000
        try insertSleep([(oldNight, oldNight + 20_000, 6, "light"), (recent, recent + 20_000, 6, "light")])
        settings.enabled = true
        exporter.onSyncComplete(syncSummary(from: recent))
        await eventually("the repair export") { !writer.sleeps().isEmpty }
        XCTAssertEqual(writer.sleeps()[0].sessions.map(\.startSec), [oldNight, recent], "the first export after the update plans every stored night")
        XCTAssertEqual(writer.sleeps()[0].from, 0)
        await eventually("the rules version") { settings.sleepRulesVersion == SleepCleaning.rulesVersion }

        exporter.onSyncComplete(syncSummary(from: recent))
        await eventually("the second export") { writer.sleeps().count == 2 }
        XCTAssertEqual(writer.sleeps()[1].sessions.map(\.startSec), [recent], "later exports only cover their window")
        XCTAssertEqual(writer.sleeps()[1].from, recent - HealthExporter.sleepLookbackSec)
    }

    func testWithoutSleepPermissionTheRepairWaits() async throws {
        try insertSleep([(1_000, 2_000, 6, "light")])
        writer.allowed = [.steps]
        _ = try await exporter.backfill()
        XCTAssertTrue(writer.sleeps().isEmpty)
        XCTAssertEqual(settings.sleepRulesVersion, 0, "not marked: it runs when the permission is granted")
    }

    func testAWorkoutBetweenTwoStageLessRunsSplitsTheNightIntoTwoSessions() async throws {
        let before: (Int64, Int64) = (100_000, 100_000 + 5 * 3600 + 1_800)
        let after: (Int64, Int64) = (before.1 + 3_600, before.1 + 3_600 + 9_000)
        try insertSleep([(before.0, before.1, 6, nil), (after.0, after.1, 6, nil)])
        try insertWorkout(start: before.1 + 600, end: before.1 + 3_000)
        _ = try await exporter.backfill()
        XCTAssertEqual(writer.sleeps()[0].sessions.map { [$0.startSec, $0.endSec] }, [[before.0, before.1], [after.0, after.1]])
    }

    func testWorkoutsAreWrittenOnceAndAgainOnlyWhenChangedOrBackfilled() async throws {
        try store.read { db in
            try db.run(
                """
                INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, distance, calories, avg_hr, max_hr, duration, steps, summary_json, complete)
                VALUES (1, 1000, 1600, 1, 'Run', 5000, 300, 150, 170, 600, 0, '{}', 1)
                """
            )
            try db.run(
                """
                INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, distance, calories, duration, steps, summary_json, complete)
                VALUES (2, 5000, 5100, 1, 'Walk', 0, 0, 100, 0, '{}', 0)
                """
            )
        }
        _ = try await exporter.backfill()
        XCTAssertEqual(writer.workouts().map(\.start), [1_000], "unfinished workouts are not written")
        XCTAssertEqual(settings.exportedWorkouts, ["1000|1600|300|5000"])

        // A sync window export does not repeat a written workout...
        settings.enabled = true
        exporter.onSyncComplete(SyncSummary(from: 0, to: 10, samples: 0, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0))
        await sleepMs(150)
        XCTAssertEqual(writer.workouts().count, 1)

        // ...a backfill starts from scratch (idempotent on the HealthKit side by its sync id).
        _ = try await exporter.backfill()
        XCTAssertEqual(writer.workouts().count, 2)
    }

    private func insertWorkoutWithPoints(start: Int64 = 1_000, end: Int64 = 1_600) throws -> Int64 {
        try store.read { db in
            try db.run(
                """
                INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, distance, calories, avg_hr, max_hr, duration, steps, summary_json, complete)
                VALUES (1, ?, ?, 1, 'Running', 5000, 300, 150, 170, 600, 0, '{}', 1)
                """,
                [.int(start), .int(end)]
            )
            let id = try db.query("SELECT id FROM workouts WHERE start = ?", [.int(start)]) { $0.int64(0) }[0]
            let points: [(Int64, Double?, Double?, Double?, Int?)] = [
                (start + 10, nil, nil, 5, 120), (start + 20, nil, nil, nil, 0), (start + 30, nil, nil, nil, 130),
                (start + 12, -6.2, 106.8, 12, nil), (start + 25, -6.201, 106.801, nil, nil), (start + 9_999, -6.3, 106.9, nil, nil),
            ]
            for p in points {
                try db.run(
                    "INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr) VALUES (?, ?, ?, ?, ?, ?)",
                    [.int(id), .int(p.0), p.1.map { .double($0) } ?? .null, p.2.map { .double($0) } ?? .null, p.3.map { .double($0) } ?? .null, .integer(p.4)]
                )
            }
            return id
        }
    }

    func testAWorkoutIsWrittenWithItsHeartRateReadingsAndItsRoute() async throws {
        _ = try insertWorkoutWithPoints()

        let counts = try await exporter.backfill()

        XCTAssertEqual(counts.workouts, 1)
        let plan = try XCTUnwrap(writer.workouts().first)
        XCTAssertEqual(plan.id, "joyofit:workout:1000")
        XCTAssertEqual(plan.routeId, "joyofit:workout-route:1000")
        XCTAssertEqual(plan.kind, .running)
        XCTAssertEqual(plan.heartRate.map(\.timeSec), [1_010, 1_030], "the 0 is no reading")
        XCTAssertEqual(plan.heartRate.map(\.bpm), [120, 130])
        XCTAssertEqual(plan.route.map(\.timeSec), [1_012, 1_025], "a position 2.7 hours after the workout is garbage")
        XCTAssertEqual(plan.route.first?.altitude, 12)
        XCTAssertNil(plan.route.last?.altitude)
        XCTAssertEqual(settings.exportedWorkouts, ["1000|1600|300|5000|h3|r3"], "the signature counts the stored points that carry a heart rate and a position")
    }

    func testWithoutHeartRatePermissionTheWorkoutGoesWithoutReadingsButWithItsRoute() async throws {
        _ = try insertWorkoutWithPoints()
        writer.allowed.remove(.heartRate)

        _ = try await exporter.backfill()

        let plan = try XCTUnwrap(writer.workouts().first)
        XCTAssertTrue(plan.heartRate.isEmpty)
        XCTAssertEqual(plan.route.count, 2)
    }

    func testAWorkoutThatGainsARouteAfterItWasExportedIsExportedAgain() async throws {
        try store.read { db in
            try db.run(
                """
                INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, distance, calories, duration, steps, summary_json, complete)
                VALUES (1, 1000, 1600, 1, 'Running', 5000, 300, 600, 0, '{}', 1)
                """
            )
        }
        settings.enabled = true
        _ = try await exporter.backfill()
        XCTAssertEqual(writer.workouts().count, 1)
        XCTAssertTrue(try XCTUnwrap(writer.workouts().first).route.isEmpty)

        // The workout is downloaded again, now with its GPS file.
        try store.read { db in
            let id = try db.query("SELECT id FROM workouts") { $0.int64(0) }[0]
            for (i, lat) in [-6.2, -6.21].enumerated() {
                try db.run("INSERT INTO workout_points (workout_id, ts, lat, lon) VALUES (?, ?, ?, 106.8)", [.int(id), .int(1_100 + Int64(i)), .double(lat)])
            }
        }
        exporter.onSyncComplete(SyncSummary(from: 0, to: 10, samples: 0, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0))
        await eventually("the second write") { writer.workouts().count == 2 }
        XCTAssertEqual(writer.workouts().last?.route.count, 2)
    }

    func testWorkoutWithoutTheTableOrWithoutRowsWritesNothing() async throws {
        let counts = try await exporter.backfill()
        XCTAssertEqual(counts.workouts, 0)
        XCTAssertTrue(writer.workouts().isEmpty)
    }

    func testHonorWatchesAreManufacturedByHonor() async throws {
        try store.upsertDevice(address: "B", name: "HONOR Band 9-123", productModel: nil, softwareVersion: nil)
        // The primary watch describes the export, not the most recently synced one.
        try store.read { db in try db.run("UPDATE device SET last_sync = 5, is_primary = (address = 'B')") }
        try insertSamples([(60, 5, 0, 0, nil, nil, nil)])
        _ = try await exporter.backfill()
        XCTAssertEqual(writer.devices.first, HealthDevice(manufacturer: "Honor", model: "Band 9", name: "HONOR Band 9-123"))
    }
}
