import XCTest
@testable import HuaweiWearLogic

/// A small ZIP writer for these tests: stored members, optionally WinZip AES-256 (AE-2). The archives the importer reads are checked against
/// zip4j's in the protocol package's tests (ZipArchiveTests); here the point is what the module layer does with them.
enum ImportTestZip {
    static func le16(_ v: Int) -> Bytes { [UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF)] }
    static func le32(_ v: UInt32) -> Bytes { le16(Int(v & 0xFFFF)) + le16(Int(v >> 16)) }

    static func build(_ files: [(String, String)], password: String? = nil) -> Bytes {
        var out = Bytes()
        var central = Bytes()
        for (index, file) in files.enumerated() {
            let plain = Bytes(file.1.utf8)
            let name = Bytes(file.0.utf8)
            var payload = plain
            var method = 0
            var extra = Bytes()
            var crc = CRC32.checksum(plain)
            if let password {
                let salt = (0..<16).map { UInt8($0 + index) }
                let derived = PBKDF2SHA1.derive(password: Bytes(password.utf8), salt: salt, iterations: 1000, length: 66)
                var ctr = try! ZipAESCTR(key: Array(derived[0..<32]))
                var cipher = plain
                ctr.apply(&cipher)
                payload = salt + Array(derived[64...]) + cipher + Array(HMACSHA1Stream.mac(key: Array(derived[32..<64]), message: cipher).prefix(10))
                extra = le16(0x9901) + le16(7) + le16(2) + [0x41, 0x45, 3] + le16(0)
                method = 99
                crc = 0
            }
            let flags = password == nil ? 0 : 1
            let offset = out.count
            out += le32(0x0403_4B50) + le16(20) + le16(flags) + le16(method) + le16(0) + le16(0x21) + le32(crc) + le32(UInt32(payload.count)) + le32(UInt32(plain.count))
            out += le16(name.count) + le16(0) + name + payload
            central += le32(0x0201_4B50) + le16(20) + le16(20) + le16(flags) + le16(method) + le16(0) + le16(0x21) + le32(crc) + le32(UInt32(payload.count))
            central += le32(UInt32(plain.count)) + le16(name.count) + le16(extra.count) + le16(0) + le16(0) + le16(0) + le32(0) + le32(UInt32(offset)) + name + extra
        }
        let directory = out.count
        out += central
        out += le32(0x0605_4B50) + le16(0) + le16(0) + le16(files.count) + le16(files.count) + le32(UInt32(central.count)) + le32(UInt32(directory)) + le16(0)
        return out
    }
}

final class HuaweiImportStoreTests: XCTestCase {
    private var store: SyncStore!
    private var imports: SqliteHuaweiImportStore!

    override func setUpWithError() throws {
        store = SyncStore(url: temporaryDatabaseURL())
        imports = SqliteHuaweiImportStore(store)
        try store.upsertDevice(address: "A", name: "HUAWEI WATCH FIT 4 Pro-40A", productModel: "ALT-B19", softwareVersion: "1")
    }

    private func minute(_ ts: Int64, steps: Int = 0, distance: Int = 0, hr: Int? = nil, spo2: Int? = nil, resting: Int? = nil) -> ImportedMinute {
        let m = ImportedMinute(ts)
        m.steps = steps
        m.distance = distance
        m.heartRate = hr
        m.spo2 = spo2
        m.restingHeartRate = resting
        return m
    }

    private struct Row: Equatable {
        var steps: Int
        var calories: Int
        var distance: Int
        var hr: Int?
        var spo2: Int?
        var resting: Int?
        var imported: Int
    }

    private func row(_ ts: Int64) throws -> Row? {
        try store.read { db in
            try db.query("SELECT steps, calories, distance, heart_rate, spo2, resting_heart_rate, imported FROM step_samples WHERE timestamp = ?", [.int(ts)]) {
                Row(steps: $0.int(0), calories: $0.int(1), distance: $0.int(2), hr: $0.optionalInt(3), spo2: $0.optionalInt(4), resting: $0.optionalInt(5), imported: $0.int(6))
            }.first
        }
    }

    private func watchSync(_ samples: [StepSample], sleep: [SleepSegment] = []) throws {
        _ = try store.save(
            address: "A", result: SyncResult(from: 0, to: 10_000, samples: samples, sleep: sleep, totalSteps: 0, totalCalories: 0, totalDistance: 0, sleepScores: []))
    }

    func testImportedMinutesAreMarkedAndWritingThemAgainChangesNothing() throws {
        XCTAssertEqual(try imports.writeMinutes([minute(600, steps: 12, distance: 9, hr: 80, spo2: 97, resting: 58), minute(660, hr: 70)]), 2)
        XCTAssertEqual(try row(600), Row(steps: 12, calories: 0, distance: 9, hr: 80, spo2: 97, resting: 58, imported: 1))
        XCTAssertEqual(try row(660), Row(steps: 0, calories: 0, distance: 0, hr: 70, spo2: nil, resting: nil, imported: 1))
        XCTAssertEqual(try imports.writeMinutes([minute(600, steps: 12, distance: 9, hr: 80, spo2: 97, resting: 58), minute(660, hr: 70)]), 0)
        XCTAssertEqual(try imports.writeMinutes([]), 0)
    }

    func testAnImportedMinuteIsFilledInButNeverOverwritten() throws {
        _ = try imports.writeMinutes([minute(600, hr: 70)])
        // Steps arrive later (the sport file): an imported minute with no steps takes them, once.
        XCTAssertEqual(try imports.writeMinutes([minute(600, steps: 20, distance: 15)]), 1)
        XCTAssertEqual(try row(600)?.steps, 20)
        XCTAssertEqual(try row(600)?.distance, 15)
        XCTAssertEqual(try row(600)?.hr, 70)
        XCTAssertEqual(try imports.writeMinutes([minute(600, steps: 30, distance: 99, hr: 99)]), 0)
        XCTAssertEqual(try row(600), Row(steps: 20, calories: 0, distance: 15, hr: 70, spo2: nil, resting: nil, imported: 1))
    }

    func testAWatchMinuteKeepsItsStepsAndOnlyGainsMissingReadings() throws {
        try watchSync([StepSample(timestamp: 600, steps: 5, calories: 2, distance: 3, heartRate: nil, spo2: nil, restingHeartRate: 55)])
        XCTAssertEqual(try imports.writeMinutes([minute(600, steps: 99, distance: 99, hr: 80, spo2: 97, resting: 40)]), 1)
        XCTAssertEqual(try row(600), Row(steps: 5, calories: 2, distance: 3, hr: 80, spo2: 97, resting: 55, imported: 0))
        XCTAssertEqual(try imports.writeMinutes([minute(600, steps: 99, hr: 10, spo2: 50)]), 0)
    }

    func testTheWatchSyncingAnImportedMinuteTakesItOverAndItTravelsLikeAWatchRow() throws {
        _ = try imports.writeMinutes([minute(600, steps: 12, hr: 80)])
        XCTAssertEqual(try row(600)?.imported, 1)
        try watchSync([StepSample(timestamp: 600, steps: 7, calories: 1, distance: 2, heartRate: nil, spo2: nil, restingHeartRate: nil)])
        XCTAssertEqual(try row(600), Row(steps: 7, calories: 1, distance: 2, hr: nil, spo2: nil, resting: nil, imported: 0))
    }

    func testSleepSegmentsOverlappingAWatchNightAreSkipped() throws {
        try watchSync([], sleep: [SleepSegment(start: 1000, end: 2000, type: 7, stage: "deep")])
        let added = try imports.writeSleep([
            ImportedSleep(start: 1500, end: 2500, type: 6, stage: "light"),  // overlaps the watch night
            ImportedSleep(start: 2000, end: 2600, type: 6, stage: "light"),  // touches its end only
            ImportedSleep(start: 5000, end: 5600, type: 0x5656, stage: "rem"),
            ImportedSleep(start: 5300, end: 5900, type: 6, stage: "light"),  // overlaps another imported segment: allowed
        ])
        XCTAssertEqual(added, 3)
        XCTAssertEqual(try imports.writeSleep([ImportedSleep(start: 5000, end: 5600, type: 0x5656, stage: "rem")]), 0)
        let rows: [[Int]] = try store.read { db in
            try db.query("SELECT start, end, type, imported FROM sleep_segments ORDER BY start, type") { [$0.int(0), $0.int(1), $0.int(2), $0.int(3)] }
        }
        XCTAssertEqual(rows, [[1000, 2000, 7, 0], [2000, 2600, 6, 1], [5000, 5600, 0x5656, 1], [5300, 5900, 6, 1]])
        let stages: [String?] = try store.read { db in try db.query("SELECT stage FROM sleep_segments WHERE imported = 1 ORDER BY start") { $0.text(0) } }
        XCTAssertEqual(stages, ["light", "rem", "light"])
    }

    func testAWatchSegmentWithTheSameStartAndTypeReplacesAnImportedOne() throws {
        _ = try imports.writeSleep([ImportedSleep(start: 1000, end: 2000, type: 7, stage: "deep")])
        try watchSync([], sleep: [SleepSegment(start: 1000, end: 2200, type: 7, stage: "deep")])
        let rows: [[Int]] = try store.read { db in try db.query("SELECT start, end, type, imported FROM sleep_segments") { [$0.int(0), $0.int(1), $0.int(2), $0.int(3)] } }
        XCTAssertEqual(rows, [[1000, 2200, 7, 0]])
    }

    func testStressGoesToTheEmotionCardOnce() throws {
        XCTAssertEqual(try imports.writeStress([ImportedStress(ts: 1000, score: 30), ImportedStress(ts: 1060, score: 45)]), 2)
        XCTAssertEqual(try imports.writeStress([ImportedStress(ts: 1000, score: 99)]), 0)
        let rows: [[String]] = try store.read { db in
            try db.query("SELECT type, ts, last_ts, value, values_json FROM health_metrics ORDER BY ts") { [$0.text(0)!, "\($0.int(1))", "\($0.int(2))", "\($0.double(3))", $0.text(4)!] }
        }
        XCTAssertEqual(rows, [["emotion", "1000", "1000", "30.0", "{\"score\":30,\"source\":\"huawei-export\"}"], ["emotion", "1060", "1060", "45.0", "{\"score\":45,\"source\":\"huawei-export\"}"]])
    }

    private func workout(start: Int64, points: [WorkoutPoint] = []) -> ImportedWorkout {
        ImportedWorkout(
            start: start, end: start + 600, sportType: 1, sportName: "Running", duration: 600, distance: 1500, calories: 90, steps: 1200, avgHr: 135, maxHr: 150,
            summaryJson: "{\"kind\":\"RUNNING\",\"source\":\"huawei-export\"}", points: points)
    }

    func testAWorkoutIsStoredOnceWithItsPointsAndSkippedWhenOneStartsWithinTwoMinutes() throws {
        let points = [
            WorkoutPoint(ts: 1_750_000_020, lat: -6.2, lon: 106.8, alt: nil, hr: nil),
            WorkoutPoint(ts: 1_750_000_025, lat: nil, lon: nil, alt: 12.5, hr: 130),
        ]
        XCTAssertEqual(try imports.writeWorkout(workout(start: 1_750_000_020, points: points)), WorkoutWrite(added: true, points: 2))
        XCTAssertEqual(try imports.writeWorkout(workout(start: 1_750_000_020, points: points)), WorkoutWrite(added: false, points: 0))
        XCTAssertEqual(try imports.writeWorkout(workout(start: 1_750_000_020 + 120)), WorkoutWrite(added: false, points: 0))
        XCTAssertEqual(try imports.writeWorkout(workout(start: 1_750_000_020 - 120)), WorkoutWrite(added: false, points: 0))
        XCTAssertEqual(try imports.writeWorkout(workout(start: 1_750_000_020 + 121)), WorkoutWrite(added: true, points: 0))

        let w: [[String]] = try store.read { db in
            try db.query("SELECT workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported FROM workouts ORDER BY start") { s in
                (0..<14).map { s.text($0) ?? "nil" }
            }
        }
        XCTAssertEqual(w.count, 2)
        XCTAssertEqual(w[0], ["0", "1750000020", "1750000620", "1", "Running", "600", "1500", "90", "135", "150", "1200", "{\"kind\":\"RUNNING\",\"source\":\"huawei-export\"}", "1", "1"])
        let stored: [[Double?]] = try store.read { db in
            try db.query("SELECT ts, lat, lon, alt, hr FROM workout_points WHERE workout_id = (SELECT id FROM workouts WHERE start = 1750000020) ORDER BY ts") { s in
                [Double(s.int64(0)), s.isNull(1) ? nil : s.double(1), s.isNull(2) ? nil : s.double(2), s.isNull(3) ? nil : s.double(3), s.isNull(4) ? nil : Double(s.int(4))]
            }
        }
        XCTAssertEqual(stored.count, 2)
        XCTAssertEqual(stored[0], [1_750_000_020, -6.2, 106.8, nil, nil])
        XCTAssertEqual(stored[1], [1_750_000_025, nil, nil, 12.5, 130])
    }

    func testImportedWorkoutsDoNotMoveTheWatchsWorkoutSyncWindow() throws {
        _ = try imports.writeWorkout(workout(start: 1_750_000_020))
        XCTAssertEqual(try WorkoutStore(store, address: "AA:AA:AA:AA:AA:01").syncStart(), Int(WorkoutStore.defaultStartSec))
        // The watch syncing the same workout takes it over; from then on it counts.
        let record = WorkoutRecord(
            number: 3, start: 1_750_000_020, end: 1_750_000_630, sportType: 1, sportName: "Running", duration: 610, distance: 1500, calories: 90, steps: 1, avgHr: nil, maxHr: nil,
            summaryJson: "{}", points: [], complete: true)
        _ = try WorkoutStore(store, address: "AA:AA:AA:AA:AA:01").save(record)  // false: the row was complete already; what matters is that it is the watch's now
        let imported: [Int] = try store.read { db in try db.query("SELECT imported FROM workouts") { $0.int(0) } }
        XCTAssertEqual(imported, [0])
        XCTAssertEqual(try WorkoutStore(store, address: "AA:AA:AA:AA:AA:01").syncStart(), 1_750_000_631)
    }

    func testImportedRowsStayOutOfTheAppleHealthExport() async throws {
        let writer = FakeHealthWriter()
        let exporter = HealthExporter(
            syncStore: store, writer: writer, settings: HealthExportSettings(defaults: ephemeralDefaults()), events: RecordingEvents(),
            timeZone: TimeZone(secondsFromGMT: 0)!, now: { Date(timeIntervalSince1970: 2_000_000_000) })
        try watchSync([StepSample(timestamp: 1_750_000_020, steps: 5, calories: 2, distance: 3, heartRate: 80, spo2: nil, restingHeartRate: nil)])
        _ = try imports.writeMinutes([minute(1_750_000_080, steps: 50, distance: 40, hr: 90)])
        _ = try imports.writeSleep([ImportedSleep(start: 1_750_100_000, end: 1_750_103_600, type: 7, stage: "deep")])
        _ = try imports.writeWorkout(workout(start: 1_750_200_000))
        _ = try await exporter.backfill()
        XCTAssertEqual(writer.steps().map(\.startSec), [1_750_000_020])
        XCTAssertEqual(writer.steps().map(\.value), [5])
        XCTAssertTrue(writer.sleeps().allSatisfy { $0.sessions.isEmpty })
        XCTAssertTrue(writer.workouts().isEmpty)
    }
}

final class HuaweiImportControllerTests: XCTestCase {
    private let t0: Int64 = 1_750_000_020_000
    private let healthFile = "Health detail data & description/Health detail data1.json"
    private let sportFile = "Sport per minute merged data & description/Sport per minute1.json"
    private let motionFile = "Motion path detail data & description/Motion path detail data1.json"
    private var store: SyncStore!
    private var controller: HuaweiImportController!
    private var paths = [String]()

    override func setUpWithError() throws {
        store = SyncStore(url: temporaryDatabaseURL())
        controller = HuaweiImportController(syncStore: store)
    }

    override func tearDown() {
        for p in paths { try? FileManager.default.removeItem(atPath: p) }
    }

    private func sample(_ key: String, _ start: Int64, _ value: String) -> String {
        "{\"key\":\"\(key)\",\"startTime\":\(start),\"endTime\":\(start),\"unit\":\"0\",\"value\":\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\"}"
    }

    private func healthRecord(_ samples: [String]) -> String { "{\"type\":7,\"startTime\":\(t0),\"endTime\":\(t0 + 60_000),\"samplePoints\":[\(samples.joined(separator: ","))]}" }

    /// A small export: a heart-rate minute with SpO2 and stress, a night of sleep, a minute of steps, one run.
    private func exportFiles(extraHealthRecords: [String] = []) -> [(String, String)] {
        let health = healthRecord([
            sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 5_000, "80"),
            sample("BLOOD_OXYGEN_SATURATION", t0 + 10_000, #"{"avgSaturation":97}"#),
            sample("DATA_POINT_REST_HEARTRATE", t0, "58"),
            sample("STRESS_DATA", t0, #"{"score":30}"#),
            sample("WEIGHT_BODYFAT_BROAD", t0, #"{"bodyWeight":70}"#),
        ])
        let sport = "{\"recordDay\":20250615,\"sportDataUserData\":[{\"startTime\":\(t0),\"endTime\":\(t0 + 60_000),\"sportType\":5,\"sportBasicInfos\":[{\"steps\":12,\"distance\":9,\"duration\":1}]}]}"
        let motion =
            "{\"abnormalTrack\":\"\",\"sportType\":4,\"startTime\":\(t0),\"endTime\":\(t0 + 600_000),\"totalSteps\":900,\"totalDistance\":1200,\"totalCalories\":80,"
            + "\"attribute\":\"HW_EXT_TRACK_DETAIL@is\\ntp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=\(t0 / 1000).0;\\ntp=h-r;k=\(t0 + 5_000);v=130;\\n\"}"
        let sleep = healthRecord([
            "{\"key\":\"PROFESSIONAL_SLEEP_DEEP\",\"startTime\":\(t0),\"endTime\":\(t0 + 1_800_000),\"value\":\"\"}"
        ])
        return [
            (healthFile, "[" + ([health, sleep] + extraHealthRecords).joined(separator: ",") + "]"), (sportFile, "[\(sport)]"), (motionFile, "[\(motion)]"),
            ("Health detail data & description/readme.txt", "ignored"),
        ]
    }

    private func write(_ zip: Bytes) throws -> String {
        let path = NSTemporaryDirectory() + "huawei-import-\(UUID().uuidString).zip"
        try Data(zip).write(to: URL(fileURLWithPath: path))
        paths.append(path)
        return path
    }

    private final class Events: @unchecked Sendable {
        private let lock = NSLock()
        private var _events = [[String: Any]]()
        var events: [[String: Any]] { lock.locked { _events } }
        func add(_ e: [String: Any]) { lock.locked { _events.append(e) } }
    }

    private func count(_ sql: String) throws -> Int { try store.read { db in try db.query(sql) { $0.int(0) }.first ?? 0 } }

    func testAnEncryptedExportBecomesRowsAndTheSummaryJsExpects() async throws {
        let path = try write(ImportTestZip.build(exportFiles(), password: "s3cret-Pass"))
        let events = Events()
        let summary = try await controller.run(uri: URL(fileURLWithPath: path).absoluteString, password: "s3cret-Pass") { events.add($0) }

        XCTAssertEqual(summary["filesRead"] as? Int, 3)
        XCTAssertEqual(summary["filesIgnored"] as? Int, 1)
        XCTAssertEqual(summary["filesFailed"] as? Int, 0)
        XCTAssertEqual(summary["heartRateReadings"] as? Int, 1)
        XCTAssertEqual(summary["restingHeartRateReadings"] as? Int, 1)
        XCTAssertEqual(summary["spo2Readings"] as? Int, 1)
        XCTAssertEqual(summary["stressReadings"] as? Int, 1)
        XCTAssertEqual(summary["unmappedSamples"] as? Int, 1)
        // The health file inserts the minute, the sport file fills its steps in: two rows changed.
        XCTAssertEqual(summary["minutesWritten"] as? Int, 2)
        XCTAssertEqual(summary["sleepSegmentsAdded"] as? Int, 1)
        XCTAssertEqual(summary["stressAdded"] as? Int, 1)
        XCTAssertEqual(summary["workoutsAdded"] as? Int, 1)
        XCTAssertEqual(summary["workoutPointsAdded"] as? Int, 2)
        XCTAssertEqual(summary["oldestSec"] as? Int64, 1_750_000_020)
        XCTAssertEqual(summary["newestSec"] as? Int64, 1_750_000_020 + 1800)
        XCTAssertEqual(summary["cancelled"] as? Bool, false)

        // One minute: the health file's readings and the sport file's steps merged by the database.
        let minute: [[Int?]] = try store.read { db in
            try db.query("SELECT timestamp, steps, distance, heart_rate, spo2, resting_heart_rate, imported FROM step_samples") {
                [Int($0.int64(0)), $0.int(1), $0.int(2), $0.optionalInt(3), $0.optionalInt(4), $0.optionalInt(5), $0.int(6)]
            }
        }
        XCTAssertEqual(minute, [[1_750_000_020, 12, 9, 80, 97, 58, 1]])
        XCTAssertEqual(try count("SELECT COUNT(*) FROM sleep_segments WHERE imported = 1 AND type = 7 AND stage = 'deep'"), 1)
        XCTAssertEqual(try count("SELECT COUNT(*) FROM health_metrics WHERE type = 'emotion'"), 1)
        XCTAssertEqual(try count("SELECT COUNT(*) FROM workouts WHERE imported = 1 AND complete = 1 AND distance = 1200 AND avg_hr = 130"), 1)

        // Progress: the JS event shape, ending with `done`.
        let last = try XCTUnwrap(events.events.last)
        XCTAssertEqual(last["phase"] as? String, "done")
        XCTAssertEqual(last["fraction"] as? Double, 1.0)
        XCTAssertEqual(last["fileCount"] as? Int, 3)
        XCTAssertTrue(last["fileName"] is NSNull)
        XCTAssertEqual((last["summary"] as? [String: Any])?["workoutsAdded"] as? Int, 1)
        XCTAssertEqual(Set(last.keys), ["phase", "fileName", "fileIndex", "fileCount", "fraction", "summary"])
        XCTAssertTrue(events.events.dropLast().allSatisfy { $0["phase"] as? String == "reading" })
    }

    func testImportingTheSameFileAgainAddsNothing() async throws {
        let path = try write(ImportTestZip.build(exportFiles()))
        _ = try await controller.run(uri: path, password: "") { _ in }
        let second = try await controller.run(uri: path, password: "") { _ in }
        XCTAssertEqual(second["minutesWritten"] as? Int, 0)
        XCTAssertEqual(second["sleepSegmentsAdded"] as? Int, 0)
        XCTAssertEqual(second["stressAdded"] as? Int, 0)
        XCTAssertEqual(second["workoutsFound"] as? Int, 1)
        XCTAssertEqual(second["workoutsAdded"] as? Int, 0)
        XCTAssertEqual(try count("SELECT COUNT(*) FROM workouts"), 1)
        XCTAssertEqual(try count("SELECT COUNT(*) FROM workout_points"), 2)
    }

    func testAWrongPasswordAndAFileThatIsNotAnExportRejectWithTheAndroidCodes() async throws {
        let encrypted = try write(ImportTestZip.build(exportFiles(), password: "right"))
        for password in ["wrong", ""] {
            do {
                _ = try await controller.run(uri: encrypted, password: password) { _ in }
                XCTFail("expected ERR_IMPORT_PASSWORD")
            } catch let e as WearError {
                XCTAssertEqual(e.code.rawValue, "ERR_IMPORT_PASSWORD")
            }
        }
        let notAnExport = try write(ImportTestZip.build([("somewhere/else.json", "[]")]))
        let notAZip = try write(Bytes("hello".utf8))
        for (uri, why) in [(notAnExport, "no data folders"), (notAZip, "not a zip"), (NSTemporaryDirectory() + "missing-\(UUID().uuidString).zip", "missing")] {
            do {
                _ = try await controller.run(uri: uri, password: "x") { _ in }
                XCTFail("expected ERR_IMPORT_FORMAT: \(why)")
            } catch let e as WearError {
                XCTAssertEqual(e.code.rawValue, "ERR_IMPORT_FORMAT", why)
            }
        }
        do {
            _ = try await controller.run(uri: "content://elsewhere/export.zip", password: "x") { _ in }
            XCTFail("expected ERR_IMPORT_FORMAT")
        } catch let e as WearError {
            XCTAssertEqual(e.code.rawValue, "ERR_IMPORT_FORMAT")
        }
        // A failed start frees the controller for the next one.
        let ok = try write(ImportTestZip.build(exportFiles()))
        let summary = try await controller.run(uri: ok, password: "") { _ in }
        XCTAssertEqual(summary["filesRead"] as? Int, 3)
    }

    func testASecondImportWhileOneRunsIsBusy() async throws {
        let path = try write(ImportTestZip.build(exportFiles()))
        let entered = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        final class Gate: @unchecked Sendable {
            private let lock = NSLock()
            private var taken = false
            func first() -> Bool { lock.locked { defer { taken = true }; return !taken } }
        }
        let gate = Gate()
        let running = Task { [controller] in
            try await controller!.run(uri: path, password: "") { _ in
                if gate.first() {
                    entered.signal()
                    release.wait()
                }
            }
        }
        XCTAssertEqual(entered.wait(timeout: .now() + 10), .success)
        do {
            _ = try await controller.run(uri: path, password: "") { _ in }
            XCTFail("expected ERR_BUSY")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .busy)
        }
        release.signal()
        let summary = try await running.value
        XCTAssertEqual(summary["filesRead"] as? Int, 3)
    }

    func testCancellingStopsBetweenRecordsAndKeepsWhatWasRead() async throws {
        let extra = (1..<5).map { i in healthRecord([sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + Int64(i) * 120_000, "7\(i)")]) }
        let path = try write(ImportTestZip.build(exportFiles(extraHealthRecords: extra)))
        let summary = try await controller.run(uri: path, password: "") { [controller] event in
            if event["phase"] as? String == "reading" { controller!.cancel() }
        }
        XCTAssertEqual(summary["cancelled"] as? Bool, true)
        // The health file stopped after its first record: its minute was flushed, the later files never ran.
        XCTAssertEqual(try count("SELECT COUNT(*) FROM step_samples"), 1)
        XCTAssertEqual(try count("SELECT COUNT(*) FROM workouts"), 0)
        // The next import starts clean and runs to the end.
        let again = try await controller.run(uri: path, password: "") { _ in }
        XCTAssertEqual(again["cancelled"] as? Bool, false)
        XCTAssertEqual(again["workoutsAdded"] as? Int, 1)
    }

    /// Writes the import's JS shapes for check-inert-shapes.mjs (next to INERT_SHAPES_OUT, as `<name>.huawei-import.json`) when it is set.
    func testDumpShapesForTheTypeScriptCheck() async throws {
        guard let out = ProcessInfo.processInfo.environment["INERT_SHAPES_OUT"] else { return }
        let path = try write(ImportTestZip.build(exportFiles()))
        let events = Events()
        let summary = try await controller.run(uri: path, password: "") { events.add($0) }
        var empty = HuaweiImportSummary()
        empty.cancelled = true
        let shapes: [String: Any] = [
            "HuaweiImportSummary": summary,
            "HuaweiImportSummary#empty": empty.toJS(),
            "HuaweiImportProgressEvent": events.events.first(where: { $0["phase"] as? String == "reading" }) ?? [:],
            "HuaweiImportProgressEvent#done": events.events.last ?? [:],
        ]
        XCTAssertNotNil(events.events.first(where: { $0["phase"] as? String == "reading" }))
        let url = URL(fileURLWithPath: out)
        let target = url.deletingLastPathComponent().appendingPathComponent(url.deletingPathExtension().lastPathComponent + ".huawei-import.json")
        try JSONSerialization.data(withJSONObject: shapes, options: [.sortedKeys]).write(to: target)
    }
}
