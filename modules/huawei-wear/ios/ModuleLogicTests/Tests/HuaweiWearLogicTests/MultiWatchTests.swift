import XCTest
@testable import HuaweiWearLogic

/// docs/multi-watch.md on the real schema: two watches write into one database with the statements the stores use, and the triggers of migration 14
/// plus `WorkoutStore` decide which row is kept. The all-day outcomes mirror src/db/multiWatch.test.ts, migration 14 mirrors src/db/migrations.test.ts.
final class MultiWatchTests: XCTestCase {
    private let a = "AA:AA:AA:AA:AA:01"
    private let b = "BB:BB:BB:BB:BB:02"
    private let c = "CC:CC:CC:CC:CC:03"

    /// A database where `a` is the primary watch (the first `upsertDevice`), `b` and `c` are not.
    private func store() throws -> SyncStore {
        let store = SyncStore(url: temporaryDatabaseURL())
        for address in [a, b, c] { try store.upsertDevice(address: address, name: "W \(address)", productModel: nil, softwareVersion: nil) }
        return store
    }

    private func rows<T>(_ store: SyncStore, _ sql: String, _ map: @escaping (SQLiteStatement) -> T) throws -> [T] {
        try store.read { try $0.query(sql, [], map) }
    }

    private func exec(_ store: SyncStore, _ sql: String) throws {
        try store.read { try $0.exec(sql) }
    }

    private func result(samples: [StepSample] = [], sleep: [SleepSegment] = [], scores: [SleepScore] = [], to: Int64 = 10_000) -> SyncResult {
        SyncResult(from: 0, to: to, samples: samples, sleep: sleep, totalSteps: 0, totalCalories: 0, totalDistance: 0, sleepScores: scores)
    }

    private func sample(_ ts: Int64, steps: Int, hr: Int? = nil) -> StepSample {
        StepSample(timestamp: ts, steps: steps, calories: 0, distance: 0, heartRate: hr, spo2: nil, restingHeartRate: nil)
    }

    private func step(_ store: SyncStore, _ ts: Int64) throws -> (Int, String?)? {
        try rows(store, "SELECT steps, device FROM step_samples WHERE timestamp = \(ts)") { ($0.int(0), $0.text(1)) }.first
    }

    // MARK: devices

    func testTheFirstDeviceIsPrimaryTheNextOnesAreNot() throws {
        let store = try store()
        let flags = try rows(store, "SELECT address, is_primary, tracks_health, bg_sync, added_at FROM device ORDER BY address") {
            ($0.text(0)!, $0.int(1), $0.int(2), $0.int(3), $0.int64(4))
        }
        XCTAssertEqual(flags.map(\.0), [a, b, c])
        XCTAssertEqual(flags.map(\.1), [1, 0, 0])
        XCTAssertTrue(flags.allSatisfy { $0.2 == 1 && $0.3 == 0 })
        XCTAssertTrue(flags.allSatisfy { $0.4 > 1_700_000_000 })
    }

    func testReUpsertKeepsAliasPrimaryFlagsAddedAtAndLastSync() throws {
        let store = try store()
        try exec(store, "UPDATE device SET alias = 'Run watch', is_primary = 0, tracks_health = 0, bg_sync = 1, added_at = 42, last_sync = 777 WHERE address = '\(a)'")
        try exec(store, "UPDATE device SET is_primary = 1 WHERE address = '\(b)'")
        try store.upsertDevice(address: a, name: "Renamed", productModel: "Model", softwareVersion: "1.2")
        let row = try rows(store, "SELECT name, product_model, software_version, alias, is_primary, tracks_health, bg_sync, added_at, last_sync FROM device WHERE address = '\(a)'") {
            ($0.text(0), $0.text(1), $0.text(2), $0.text(3), $0.int(4), $0.int(5), $0.int(6), $0.int64(7), $0.int64(8))
        }.first!
        XCTAssertEqual(row.0, "Renamed")
        XCTAssertEqual(row.1, "Model")
        XCTAssertEqual(row.2, "1.2")
        XCTAssertEqual(row.3, "Run watch")
        XCTAssertEqual(row.4, 0)
        XCTAssertEqual(row.5, 0)
        XCTAssertEqual(row.6, 1)
        XCTAssertEqual(row.7, 42)
        XCTAssertEqual(row.8, 777)
    }

    func testAPhoneWhosePrimaryWasRemovedMakesTheNextNewWatchPrimary() throws {
        let store = SyncStore(url: temporaryDatabaseURL())
        XCTAssertEqual(try rows(store, "SELECT COUNT(*) FROM device") { $0.int(0) }, [0])
        try store.upsertDevice(address: a, name: "A", productModel: nil, softwareVersion: nil)
        try exec(store, "DELETE FROM device WHERE address = '\(a)'")
        try store.upsertDevice(address: b, name: "B", productModel: nil, softwareVersion: nil)
        XCTAssertEqual(try rows(store, "SELECT is_primary FROM device") { $0.int(0) }, [1])
    }

    // MARK: steps

    func testAnotherWatchNeverOverwritesThePrimaryAndFillsTheMinutesItHasNothingFor() throws {
        let store = try store()
        _ = try store.save(address: a, result: result(samples: [sample(1000, steps: 30, hr: 80)]))
        _ = try store.save(address: b, result: result(samples: [sample(1000, steps: 99, hr: 120), sample(1060, steps: 12)]))
        XCTAssertEqual(try step(store, 1000)?.0, 30)
        XCTAssertEqual(try step(store, 1000)?.1, a)
        XCTAssertEqual(try step(store, 1060)?.0, 12)
        XCTAssertEqual(try step(store, 1060)?.1, b)
    }

    func testThePrimaryTakesAMinuteOverWheneverItSyncs() throws {
        let store = try store()
        _ = try store.save(address: b, result: result(samples: [sample(1000, steps: 99)]))
        XCTAssertEqual(try step(store, 1000)?.1, b)
        _ = try store.save(address: a, result: result(samples: [sample(1000, steps: 30)]))
        XCTAssertEqual(try step(store, 1000)?.0, 30)
        XCTAssertEqual(try step(store, 1000)?.1, a)
    }

    func testAnEmptyMinuteDoesNotHideWhatTheOtherWatchRecordedInEitherOrder() throws {
        let store = try store()
        _ = try store.save(address: a, result: result(samples: [sample(1000, steps: 0)]))
        _ = try store.save(address: b, result: result(samples: [sample(1000, steps: 25, hr: 90)]))
        XCTAssertEqual(try step(store, 1000)?.0, 25)
        _ = try store.save(address: a, result: result(samples: [sample(1000, steps: 0)]))
        XCTAssertEqual(try step(store, 1000)?.1, b)
        _ = try store.save(address: a, result: result(samples: [sample(2000, steps: 8)]))
        _ = try store.save(address: b, result: result(samples: [sample(2000, steps: 0)]))
        XCTAssertEqual(try step(store, 2000)?.0, 8)
        XCTAssertEqual(try step(store, 2000)?.1, a)
    }

    func testTwoNonPrimaryWatchesTheFirstWriterKeepsTheMinuteAndAWatchRewritesItsOwn() throws {
        let store = try store()
        _ = try store.save(address: b, result: result(samples: [sample(1000, steps: 10)]))
        _ = try store.save(address: c, result: result(samples: [sample(1000, steps: 77)]))
        XCTAssertEqual(try step(store, 1000)?.1, b)
        _ = try store.save(address: b, result: result(samples: [sample(1000, steps: 11)]))
        XCTAssertEqual(try step(store, 1000)?.0, 11)
    }

    func testUnattributedRowsLoseToEveryWatch() throws {
        let store = try store()
        try exec(store, "INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (3000, 5, 0, 0, 1)")
        _ = try store.save(address: c, result: result(samples: [sample(3000, steps: 6)]))
        XCTAssertEqual(try step(store, 3000)?.0, 6)
        XCTAssertEqual(try step(store, 3000)?.1, c)
    }

    func testAChangedPrimaryChangesWhoWinsFromTheNextWrite() throws {
        let store = try store()
        _ = try store.save(address: a, result: result(samples: [sample(1000, steps: 30)]))
        try exec(store, "UPDATE device SET is_primary = (address = '\(b)')")
        _ = try store.save(address: b, result: result(samples: [sample(1000, steps: 28)]))
        XCTAssertEqual(try step(store, 1000)?.1, b)
        _ = try store.save(address: a, result: result(samples: [sample(1000, steps: 31)]))
        XCTAssertEqual(try step(store, 1000)?.0, 28)
    }

    /// docs/multi-watch.md, section 7: a day an older build let another watch overwrite (rows with no watch, zero) comes back when the
    /// owner's watch pulls its whole history; the band's own later sync cannot undo it once the owner's watch is primary. Mirrors
    /// `SwitchBackfillTest` and src/db/watchSwitch.test.ts.
    func testAFullPullOfTheOwnersWatchBringsBackDaysTheOtherWatchWroteOver() throws {
        let store = try store()
        try exec(store, "INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (1000, 0, 0, 0), (1060, 0, 0, 0), (1120, 0, 0, 0)")
        _ = try store.save(address: a, result: result(samples: [sample(1000, steps: 12, hr: 90), sample(1060, steps: 14, hr: 91)]))
        XCTAssertEqual(try rows(store, "SELECT SUM(steps) FROM step_samples") { $0.int(0) }, [26])
        try exec(store, "UPDATE device SET is_primary = (address = '\(a)')")
        _ = try store.save(address: b, result: result(samples: [sample(1000, steps: 30, hr: 100), sample(1060, steps: 0), sample(1120, steps: 20, hr: 95)]))
        XCTAssertEqual(try step(store, 1000)?.1, a)
        XCTAssertEqual(try step(store, 1060)?.1, a)
        XCTAssertEqual(try step(store, 1120)?.1, b, "a minute the owner's watch has no data for is the band's")
        XCTAssertEqual(try rows(store, "SELECT SUM(steps) FROM step_samples WHERE device = '\(a)'") { $0.int(0) }, [26])
    }

    // MARK: sleep

    private func sleepRows(_ store: SyncStore) throws -> [String] {
        try rows(store, "SELECT start, end, device FROM sleep_segments ORDER BY start") { "\($0.int64(0))-\($0.int64(1)) \($0.text(2) ?? "nil")" }
    }

    func testSleepAnotherWatchIsSkippedWherethePrimaryHasSleepAndKeptWhereItHasNot() throws {
        let store = try store()
        _ = try store.save(address: a, result: result(sleep: [SleepSegment(start: 1000, end: 5000, type: 2, stage: nil)]))
        _ = try store.save(address: b, result: result(sleep: [
            SleepSegment(start: 1100, end: 4900, type: 2, stage: nil), SleepSegment(start: 90_000, end: 93_000, type: 2, stage: nil),
        ]))
        XCTAssertEqual(try sleepRows(store), ["1000-5000 \(a)", "90000-93000 \(b)"])
    }

    func testThePrimarysSleepReplacesWhatAnotherWatchStoredForTheStretch() throws {
        let store = try store()
        _ = try store.save(address: b, result: result(sleep: [
            SleepSegment(start: 1100, end: 4900, type: 2, stage: nil), SleepSegment(start: 4900, end: 6000, type: 1, stage: nil),
            SleepSegment(start: 200_000, end: 203_000, type: 2, stage: nil),
        ]))
        _ = try store.save(address: a, result: result(sleep: [SleepSegment(start: 1000, end: 5500, type: 2, stage: nil)]))
        XCTAssertEqual(try sleepRows(store), ["1000-5500 \(a)", "200000-203000 \(b)"])
    }

    func testNonPrimarySleepFirstWatchKeepsTheStretchAndOwnSegmentsNeverRemoveEachOther() throws {
        let store = try store()
        _ = try store.save(address: b, result: result(sleep: [
            SleepSegment(start: 1000, end: 3000, type: 1, stage: nil), SleepSegment(start: 3000, end: 5000, type: 2, stage: nil),
        ]))
        _ = try store.save(address: c, result: result(sleep: [SleepSegment(start: 1500, end: 2500, type: 1, stage: nil)]))
        XCTAssertEqual(try sleepRows(store), ["1000-3000 \(b)", "3000-5000 \(b)"])
    }

    func testSleepScoresFollowTheSameRule() throws {
        let store = try store()
        _ = try store.save(address: b, result: result(scores: [SleepScore(start: 1000, end: 5000, score: 80, efficiency: nil)]))
        _ = try store.save(address: a, result: result(scores: [SleepScore(start: 1100, end: 5200, score: 70, efficiency: 90)]))
        XCTAssertEqual(try rows(store, "SELECT score, device FROM sleep_scores") { "\($0.int(0)) \($0.text(1) ?? "nil")" }, ["70 \(a)"])
        _ = try store.save(address: c, result: result(scores: [SleepScore(start: 1200, end: 5000, score: 90, efficiency: nil)]))
        XCTAssertEqual(try rows(store, "SELECT score, device FROM sleep_scores") { "\($0.int(0)) \($0.text(1) ?? "nil")" }, ["70 \(a)"])
    }

    func testAnAcceptedWriteMovesTheRowInTheUploadQueueARefusedOneDoesNot() throws {
        let store = try store()
        _ = try store.save(address: a, result: result(samples: [sample(1000, steps: 30)]))
        func rev() throws -> Int64 { try rows(store, "SELECT rev FROM step_samples WHERE timestamp = 1000") { $0.int64(0) }.first! }
        let before = try rev()
        _ = try store.save(address: b, result: result(samples: [sample(1000, steps: 99)]))
        XCTAssertEqual(try rev(), before)
        _ = try store.save(address: a, result: result(samples: [sample(1000, steps: 31)]))
        XCTAssertGreaterThan(try rev(), before)
    }

    // MARK: health metrics

    func testHealthMetricsPrimaryWinsFirstOfTheOthersWinsAndTheCursorIsPerWatch() throws {
        let store = try store()
        func metrics(_ address: String) -> HealthMetricsStore { HealthMetricsStore(store: store, address: { address }) }
        func row(_ type: String, _ ts: Int64, _ value: Double) -> DictionaryRow {
            DictionaryRow(type: type, timestamp: ts * 1000, lastTimestamp: ts * 1000, value: value, valuesJson: "[]")
        }
        try metrics(a).persist([row("spo2", 100, 97)])
        try metrics(b).persist([row("spo2", 100, 90), row("spo2", 200, 91)])
        try metrics(c).persist([row("spo2", 200, 92)])
        func value(_ ts: Int64) throws -> String {
            try rows(store, "SELECT value, device FROM health_metrics WHERE ts = \(ts)") { "\($0.double(0)) \($0.text(1) ?? "nil")" }.first!
        }
        XCTAssertEqual(try value(100), "97.0 \(a)")
        XCTAssertEqual(try value(200), "91.0 \(b)")
        try metrics(a).persist([row("spo2", 200, 95)])
        XCTAssertEqual(try value(200), "95.0 \(a)")
        // The newest stored timestamp is per watch: b's row at 200 was taken over by a, a never wrote 300.
        try metrics(b).persist([row("spo2", 300, 80)])
        XCTAssertEqual(metrics(b).lastFetchTimestamp("spo2"), 300_000)
        XCTAssertEqual(metrics(a).lastFetchTimestamp("spo2"), 200_000)
        XCTAssertEqual(metrics(c).lastFetchTimestamp("spo2"), 0)
    }

    // MARK: night and spot HRV (night HRV is not ported to iOS; the table is shared, so its rules are checked on the schema)

    func testNightHrvFollowsTheSleepRuleAndSpotMeasurementsAreAttributedToTheConnectedWatch() throws {
        let store = try store()
        func night(_ device: String, _ start: Int, _ end: Int) throws {
            try exec(store, "INSERT OR REPLACE INTO hrv_readings (start, end, source, rmssd, beats, device) VALUES (\(start), \(end), 'night', 40, 100, '\(device)')")
        }
        try night(b, 1000, 5000)
        try night(a, 1100, 5200)
        try night(c, 1200, 5000)
        XCTAssertEqual(try rows(store, "SELECT device FROM hrv_readings WHERE source = 'night'") { $0.text(0)! }, [a])

        let events = RecordingEvents()
        let live = LiveHeartRate(handle: { nil }, settings: WearSettings(defaults: ephemeralDefaults()), events: events)
        let hrv = HrvSpot(handle: { nil }, liveHeartRate: live, syncStore: store, events: events)
        let beats = (0..<60).map { RriBeat(rri: 800 + ($0 % 2) * 20, sqi: 100) }
        for address in [b, c] {
            XCTAssertNotNil(try hrv.record(HrvSpot.Collected(startMs: 1_700_000_000_000, endMs: 1_700_000_060_000, beats: beats, packets: 6, address: address)))
        }
        // Spot readings are always stored; the same start and end is one row, the latest measurement's watch.
        XCTAssertEqual(try rows(store, "SELECT device FROM hrv_readings WHERE source = 'spot'") { $0.text(0)! }, [c])
    }

    // MARK: workouts

    private func workout(start: Int64, end: Int64, gps: Bool = false, complete: Bool = true) -> WorkoutRecord {
        let points = gps ? [WorkoutPoint(ts: start, lat: 1.5, lon: 103.8, alt: nil, hr: nil), WorkoutPoint(ts: start + 60, lat: 1.51, lon: 103.81, alt: nil, hr: 120)] : [WorkoutPoint(ts: start, lat: nil, lon: nil, alt: nil, hr: 110)]
        return WorkoutRecord(
            number: 1, start: start, end: end, sportType: 1, sportName: "Running", duration: Int(end - start), distance: 5000, calories: 300, steps: 100, avgHr: 130, maxHr: nil,
            summaryJson: "{}", points: points, complete: complete
        )
    }

    private func workouts(_ store: SyncStore) throws -> [String] {
        try rows(store, "SELECT start, device FROM workouts ORDER BY start") { "\($0.int64(0)) \($0.text(1) ?? "nil")" }
    }

    private func shadows(_ store: SyncStore) throws -> [String] {
        try rows(store, "SELECT device, start, end, kept_start FROM workout_shadow ORDER BY device, start") { "\($0.text(0)!) \($0.int64(1))-\($0.int64(2)) kept \($0.int64(3))" }
    }

    func testTheDuplicateDecisionIsGpsThenPrimaryThenFirstStored() {
        XCTAssertTrue(WorkoutStore.incomingWins(incomingHasGps: true, storedHasGps: false, incomingIsPrimary: false, storedIsPrimary: true))
        XCTAssertFalse(WorkoutStore.incomingWins(incomingHasGps: false, storedHasGps: true, incomingIsPrimary: true, storedIsPrimary: false))
        XCTAssertTrue(WorkoutStore.incomingWins(incomingHasGps: false, storedHasGps: false, incomingIsPrimary: true, storedIsPrimary: false))
        XCTAssertTrue(WorkoutStore.incomingWins(incomingHasGps: true, storedHasGps: true, incomingIsPrimary: true, storedIsPrimary: false))
        XCTAssertFalse(WorkoutStore.incomingWins(incomingHasGps: false, storedHasGps: false, incomingIsPrimary: false, storedIsPrimary: true))
        XCTAssertFalse(WorkoutStore.incomingWins(incomingHasGps: false, storedHasGps: false, incomingIsPrimary: false, storedIsPrimary: false), "a tie keeps the one stored first")
        XCTAssertFalse(WorkoutStore.incomingWins(incomingHasGps: true, storedHasGps: true, incomingIsPrimary: false, storedIsPrimary: true))
    }

    func testTwoSessionsAreOneWhenTheyOverlapByHalfOfTheShorterOne() {
        XCTAssertTrue(WorkoutStore.isDuplicate(startA: 0, endA: 3600, startB: 60, endB: 3500))
        XCTAssertTrue(WorkoutStore.isDuplicate(startA: 0, endA: 3600, startB: 1800, endB: 7200), "exactly half of the shorter is enough (3600 vs 5400 long: 1800 of 3600)")
        XCTAssertFalse(WorkoutStore.isDuplicate(startA: 0, endA: 3600, startB: 1801, endB: 7200))
        XCTAssertFalse(WorkoutStore.isDuplicate(startA: 0, endA: 3600, startB: 3600, endB: 7200))
        // A short session inside a long one overlaps by all of the shorter one.
        XCTAssertTrue(WorkoutStore.isDuplicate(startA: 0, endA: 7200, startB: 600, endB: 1200))
    }

    func testAWorkoutOfOneWatchWithoutOverlapIsStoredNormally() throws {
        let store = try store()
        XCTAssertTrue(try WorkoutStore(store, address: a).save(workout(start: 1000, end: 4600)))
        XCTAssertTrue(try WorkoutStore(store, address: b).save(workout(start: 10_000, end: 13_600)))
        XCTAssertEqual(try workouts(store), ["1000 \(a)", "10000 \(b)"])
        XCTAssertEqual(try shadows(store), [])
    }

    func testTheCopyWithAGpsTrackWinsOverThePrimary() throws {
        let store = try store()
        XCTAssertTrue(try WorkoutStore(store, address: a).save(workout(start: 1000, end: 4600)))
        XCTAssertTrue(try WorkoutStore(store, address: b).save(workout(start: 1030, end: 4640, gps: true)))
        XCTAssertEqual(try workouts(store), ["1030 \(b)"])
        XCTAssertEqual(try shadows(store), ["\(a) 1000-4600 kept 1030"])
        XCTAssertEqual(try rows(store, "SELECT COUNT(*) FROM workout_points WHERE lat IS NOT NULL") { $0.int(0) }, [2])
        XCTAssertEqual(try rows(store, "SELECT COUNT(*) FROM workout_points") { $0.int(0) }, [2], "the loser's points are deleted with it")
    }

    func testAGpsCopyAlreadyStoredIsNotReplacedByThePrimary() throws {
        let store = try store()
        XCTAssertTrue(try WorkoutStore(store, address: b).save(workout(start: 1030, end: 4640, gps: true)))
        XCTAssertFalse(try WorkoutStore(store, address: a).save(workout(start: 1000, end: 4600)))
        XCTAssertEqual(try workouts(store), ["1030 \(b)"])
        XCTAssertEqual(try shadows(store), ["\(a) 1000-4600 kept 1030"])
    }

    func testWithoutGpsOnEitherSideThePrimaryWinsInEitherOrder() throws {
        let one = try store()
        XCTAssertTrue(try WorkoutStore(one, address: b).save(workout(start: 1000, end: 4600)))
        XCTAssertTrue(try WorkoutStore(one, address: a).save(workout(start: 1010, end: 4610)))
        XCTAssertEqual(try workouts(one), ["1010 \(a)"])
        XCTAssertEqual(try shadows(one), ["\(b) 1000-4600 kept 1010"])

        let two = try store()
        XCTAssertTrue(try WorkoutStore(two, address: a).save(workout(start: 1010, end: 4610)))
        XCTAssertFalse(try WorkoutStore(two, address: b).save(workout(start: 1000, end: 4600)))
        XCTAssertEqual(try workouts(two), ["1010 \(a)"])
        XCTAssertEqual(try shadows(two), ["\(b) 1000-4600 kept 1010"])
    }

    func testTwoNonPrimaryWatchesTheFirstStoredWins() throws {
        let store = try store()
        XCTAssertTrue(try WorkoutStore(store, address: b).save(workout(start: 1000, end: 4600)))
        XCTAssertFalse(try WorkoutStore(store, address: c).save(workout(start: 1005, end: 4605)))
        XCTAssertEqual(try workouts(store), ["1000 \(b)"])
        XCTAssertEqual(try shadows(store), ["\(c) 1005-4605 kept 1000"])
    }

    func testSameStartFromTwoWatchesIsOneRow() throws {
        let store = try store()
        XCTAssertTrue(try WorkoutStore(store, address: b).save(workout(start: 1000, end: 4600)))
        XCTAssertTrue(try WorkoutStore(store, address: a).save(workout(start: 1000, end: 4600)))
        XCTAssertEqual(try workouts(store), ["1000 \(a)"])
        XCTAssertEqual(try shadows(store), ["\(b) 1000-4600 kept 1000"])
    }

    func testImportedAndUnattributedWorkoutsAreNeverDuplicatesAndAWatchRewritesItsOwn() throws {
        let store = try store()
        try exec(store, "INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported) VALUES (1, 1000, 4600, 1, 'Run', 3600, 1, 1, 1, '{}', 1, 1)")
        XCTAssertTrue(try WorkoutStore(store, address: b).save(workout(start: 1020, end: 4620)))
        XCTAssertEqual(try workouts(store), ["1000 nil", "1020 \(b)"])
        XCTAssertFalse(try WorkoutStore(store, address: b).save(workout(start: 1020, end: 4620)), "own complete row is rewritten, not new")
        XCTAssertTrue(try WorkoutStore(store, address: b).save(workout(start: 5000, end: 6000, complete: false)))
        XCTAssertTrue(try WorkoutStore(store, address: b).save(workout(start: 5000, end: 6000)), "own incomplete row completes")
        XCTAssertEqual(try shadows(store), [])
    }

    func testTheShadowMakesTheLoserCompleteAndPerWatchWindowsDoNotMoveEachOther() throws {
        let store = try store()
        let wa = WorkoutStore(store, address: a)
        let wb = WorkoutStore(store, address: b)
        XCTAssertFalse(try wb.isComplete(start: 1000, end: 4600))
        XCTAssertTrue(try wa.save(workout(start: 1010, end: 4610)))
        XCTAssertFalse(try wb.save(workout(start: 1000, end: 4600)))
        // b's copy lost and is in the shadow: nothing left to download for b, and not for a's own either.
        XCTAssertTrue(try wb.isComplete(start: 1000, end: 4600))
        XCTAssertFalse(try wa.isComplete(start: 1000, end: 4600))
        // b's window starts after what b saw (its shadowed end), a's after its own newest.
        XCTAssertEqual(try wb.syncStart(), 4601)
        XCTAssertEqual(try wa.syncStart(), 4611)
        // a's newest workout does not move c's window; c has seen nothing.
        let wc = WorkoutStore(store, address: c)
        XCTAssertEqual(try wc.syncStart(), Int(WorkoutStore.defaultStartSec))
        // A later workout by a moves a, not b.
        XCTAssertTrue(try wa.save(workout(start: 100_000, end: 103_600)))
        XCTAssertEqual(try wa.syncStart(), 103_601)
        XCTAssertEqual(try wb.syncStart(), 4601)
    }

    func testTheOldestIncompleteWorkoutOfThisWatchOrUnattributedHoldsTheWindowBack() throws {
        let store = try store()
        let wa = WorkoutStore(store, address: a)
        let wb = WorkoutStore(store, address: b)
        XCTAssertTrue(try wa.save(workout(start: 1000, end: 2000, complete: false)))
        XCTAssertTrue(try wb.save(workout(start: 50_000, end: 51_000)))
        XCTAssertEqual(try wa.syncStart(), 1000)
        XCTAssertEqual(try wb.syncStart(), 51_001, "a's incomplete workout does not hold b back")
        try exec(store, "INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported) VALUES (9, 800, 900, 1, 'Run', 100, 1, 1, 1, '{}', 0, 0)")
        XCTAssertEqual(try wb.syncStart(), 800)
    }

    // MARK: tracks_health

    func testAWatchThatDoesNotTrackHealthStoresNothingButAdvancesLastSync() throws {
        let store = try store()
        XCTAssertNil(try store.untrackedSyncSummary(address: a, nowSec: 5_000), "a tracking watch runs the sync")
        XCTAssertNil(try store.lastSync(address: a))
        try exec(store, "UPDATE device SET tracks_health = 0 WHERE address = '\(b)'")
        let summary = try XCTUnwrap(try store.untrackedSyncSummary(address: b, nowSec: 5_000))
        XCTAssertEqual(summary, SyncSummary(from: 5_000, to: 5_000, samples: 0, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0))
        XCTAssertEqual(try store.lastSync(address: b), 5_000)
        XCTAssertNil(try store.lastSync(address: a), "only this watch's last sync moves")
        for table in ["step_samples", "sleep_segments", "sleep_scores", "workouts", "health_metrics", "hrv_readings"] {
            XCTAssertEqual(try rows(store, "SELECT COUNT(*) FROM \(table)") { $0.int(0) }, [0], table)
        }
        // The flag is read fresh: switching it back runs the next sync.
        try exec(store, "UPDATE device SET tracks_health = 1 WHERE address = '\(b)'")
        XCTAssertNil(try store.untrackedSyncSummary(address: b, nowSec: 6_000))
        XCTAssertEqual(try store.lastSync(address: b), 5_000)
        // A watch with no device row yet is tracked.
        XCTAssertTrue(try store.tracksHealth(address: "DD:DD:DD:DD:DD:04"))
    }

    // MARK: migration 14

    func testMigration14FromAVersion13DatabaseAttributesASingleWatchAndKeepsTheRevs() throws {
        let url = temporaryDatabaseURL()
        let all = try SyncStore.sharedMigrations()
        let old = SyncStore(url: url, migrations: Array(all.prefix(13)))
        try old.read { db in
            XCTAssertEqual(try db.userVersion, 13)
            try db.exec("INSERT INTO device (address, name, last_sync) VALUES ('AA:BB', 'Watch', 1700000500)")
            try db.exec("INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (1700000000, 10, 1, 8, 0), (1700000060, 12, 1, 9, 0), (1700000120, 5, 1, 4, 1)")
            try db.exec("INSERT INTO sleep_segments (start, end, type, stage, imported) VALUES (1700000000, 1700003600, 1, 'light', 0), (1700003600, 1700007200, 2, NULL, 1)")
            try db.exec("INSERT INTO sleep_scores (start, end, score) VALUES (1700000000, 1700007200, 80)")
            try db.exec(
                "INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, imported) VALUES (1, 1700000000, 1700000600, 1, 'Running', 600, 5000, 321, 100, '{}', 1, 0), (2, 1700100000, 1700100600, 1, 'Running', 600, 5000, 321, 100, '{}', 1, 1)"
            )
            try db.exec("INSERT INTO health_metrics (type, ts, last_ts, value, values_json) VALUES ('spo2', 1700000000, 1700000000, 97, '[]')")
            try db.exec("INSERT INTO hrv_readings (start, end, source, rmssd, beats) VALUES (1700000000, 1700000060, 'spot', 40, 60)")
        }
        func revs(_ store: SyncStore) throws -> [String] {
            let sql = "SELECT 's', timestamp, rev FROM step_samples UNION ALL SELECT 'g', start, rev FROM sleep_segments UNION ALL SELECT 'w', id, rev FROM workouts ORDER BY 1, 2"
            let tables = try rows(store, sql) { "\($0.text(0)!) \($0.int64(1)) \($0.int64(2))" }
            return tables + (try rows(store, "SELECT tbl, seq, uploaded FROM cloud_cursor ORDER BY tbl") { "\($0.text(0)!) \($0.int64(1)) \($0.int64(2))" })
        }
        let before = try revs(old)

        let migrated = SyncStore(url: url)
        XCTAssertEqual(try migrated.read { try $0.userVersion }, all.count)
        XCTAssertEqual(try rows(migrated, "SELECT timestamp, device FROM step_samples ORDER BY timestamp") { "\($0.int64(0)) \($0.text(1) ?? "nil")" },
                       ["1700000000 AA:BB", "1700000060 AA:BB", "1700000120 nil"])
        XCTAssertEqual(try rows(migrated, "SELECT start, device FROM sleep_segments ORDER BY start") { "\($0.int64(0)) \($0.text(1) ?? "nil")" }, ["1700000000 AA:BB", "1700003600 nil"])
        XCTAssertEqual(try rows(migrated, "SELECT device FROM sleep_scores") { $0.text(0) }, ["AA:BB"])
        XCTAssertEqual(try rows(migrated, "SELECT id, device FROM workouts ORDER BY id") { "\($0.int64(0)) \($0.text(1) ?? "nil")" }, ["1 AA:BB", "2 nil"])
        XCTAssertEqual(try rows(migrated, "SELECT device FROM health_metrics") { $0.text(0) }, ["AA:BB"])
        XCTAssertEqual(try rows(migrated, "SELECT device FROM hrv_readings") { $0.text(0) }, ["AA:BB"])
        XCTAssertEqual(try rows(migrated, "SELECT address, alias, is_primary, tracks_health, bg_sync, added_at FROM device") {
            "\($0.text(0)!) \($0.text(1) ?? "nil") \($0.int(2)) \($0.int(3)) \($0.int(4)) \($0.int64(5))"
        }, ["AA:BB nil 1 1 0 1700000500"])
        XCTAssertEqual(try revs(migrated), before, "the attribution does not push stored rows back into the cloud upload queue")

        // The rev triggers still work afterwards.
        try migrated.read { try $0.exec("UPDATE step_samples SET steps = 99 WHERE timestamp = 1700000000") }
        XCTAssertNotEqual(try revs(migrated), before)
    }

    // MARK: identity of two watches

    func testTwoWatchesIdentitiesAreIndependentAndForgetAndBindingLeaveTheOtherAlone() {
        let secrets = MemorySecretStore()
        let devices = DeviceStore(secrets: secrets)
        let addressA = "6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77"
        let addressB = "11111111-2222-3333-4444-555555555555"
        let a = devices.forDevice(addressA)
        a.ensureCreated()
        a.authKey = Bytes(repeating: 0xAA, count: 16)
        a.markBonded()
        let keyOfA = a.authKey
        let macOfA = a.macString
        let androidIdOfA = a.androidIdString

        // Binding B (identity, HiChain key, bonded flag) does not touch A.
        let b = devices.forDevice(addressB)
        XCTAssertTrue(b.isFirstConnection)
        b.ensureCreated()
        _ = b.createSecretKey()
        b.authKey = Bytes(repeating: 0xBB, count: 16)
        b.markBonded()
        XCTAssertEqual(devices.forDevice(addressA).authKey, keyOfA)
        XCTAssertEqual(devices.forDevice(addressA).macString, macOfA)
        XCTAssertEqual(devices.forDevice(addressA).androidIdString, androidIdOfA)
        XCTAssertFalse(devices.forDevice(addressA).isFirstConnection)

        // Different fake identities and keys.
        XCTAssertNotEqual(a.macString, b.macString)
        XCTAssertNotEqual(a.androidIdString, b.androidIdString)
        XCTAssertNotEqual(a.authKey, b.authKey)
        XCTAssertEqual(b.authKey, Bytes(repeating: 0xBB, count: 16))

        // Forgetting A leaves B's four items.
        devices.forget(addressA)
        XCTAssertNil(devices.forDevice(addressA).authKey)
        XCTAssertTrue(devices.forDevice(addressA).isFirstConnection)
        XCTAssertEqual(devices.forDevice(addressB).authKey, Bytes(repeating: 0xBB, count: 16))
        XCTAssertFalse(devices.forDevice(addressB).isFirstConnection)
        XCTAssertEqual(devices.forDevice(addressB).macString, b.macString)
        XCTAssertEqual(devices.forDevice(addressB).androidIdString, b.androidIdString)
        XCTAssertEqual(secrets.count, 4, "B keeps its key, bonded flag, fake mac and android id")
    }
}
