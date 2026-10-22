import XCTest
@testable import HuaweiProtocol

/// A scripted watch for the workout phase: the 0x17 workout commands, plus the 0x2C / 0x0A file download servers of `SleepFilesFakeWatch`
/// for the GPS file. Cases translate the Kotlin WorkoutSyncTest and add the retry / split / timeout paths WorkoutSync.kt has branches for.
final class WorkoutWatchScript {
    struct Workout {
        var number: Int16
        var start: Int32
        var end: Int32
        var totals: HuaweiTLV
        var data: [HuaweiTLV] = []
        var pace: [HuaweiTLV] = []
        var swim: [HuaweiTLV] = []
        var spo2: [HuaweiTLV] = []
        var sections: [HuaweiTLV] = []
        var trajectories: Int8?
    }

    var workouts: [Workout] = []
    /// Answers for successive 17/07 requests; when it runs out the full list is answered.
    var countOverrides: [HuaweiTLV] = []
    /// Number of 17/08 requests per workout that are answered with an error before the real totals.
    var totalsErrors: [Int16: Int] = [:]
    /// Data parts (workout, index) that always answer with an error.
    var brokenData: Set<String> = []
    /// Sections answered with the "normal" 0x0001E079 error.
    var normalSectionError = false
    /// Commands that get no answer at all.
    var silent: Set<UInt8> = []
    private(set) var countRequests: [(start: Int32, end: Int32)] = []
    private(set) var totalsRequests: [Int16: Int] = [:]
    /// What the 0x2C / 0x0A server answers to.
    var gps: [Int16: Bytes] = [:]
    var gpsServer: SleepFilesFakeWatch.NewSyncServer?
    var oldServer: SleepFilesFakeWatch.OldSyncServer?
    var capabilityFlags: Int8?

    static func tlv(_ build: (inout HuaweiTLV) -> Void) -> HuaweiTLV {
        var t = HuaweiTLV()
        build(&t)
        return t
    }

    static func box(_ build: (inout HuaweiTLV) -> Void) -> HuaweiTLV {
        let inner = tlv(build)
        return tlv { $0.put(0x81, tlv: inner) }
    }

    func countTlv(_ list: [Workout]) -> HuaweiTLV {
        WorkoutWatchScript.box { c in
            c.put(0x02, short: Int16(list.count))
            for w in list {
                var e = HuaweiTLV()
                e.put(0x06, short: w.number)
                e.put(0x07, short: Int16(w.data.count))
                e.put(0x08, short: Int16(w.pace.count))
                if !w.swim.isEmpty { e.put(0x09, short: Int16(w.swim.count)) }
                if !w.spo2.isEmpty { e.put(0x0c, short: Int16(w.spo2.count)) }
                if !w.sections.isEmpty { e.put(0x0d, short: Int16(w.sections.count)) }
                if let t = w.trajectories { e.put(0x0e, byte: UInt8(bitPattern: t)) }
                c.put(0x85, tlv: e)
            }
        }
    }

    func respond(_ r: SleepFilesFakeWatch.Request) -> [Bytes] {
        switch r.service {
        case 0x17:
            if silent.contains(r.command) { return [] }
            func answer(_ t: HuaweiTLV) -> [Bytes] { [SleepFilesFakeWatch.tlvFrame(service: 0x17, command: r.command, t)] }
            let c = (try? r.tlv.object(0x81)) ?? HuaweiTLV()
            switch r.command {
            case 0x07:
                countRequests.append((((try? c.int(0x03)) ?? 0), ((try? c.int(0x04)) ?? 0)))
                if !countOverrides.isEmpty { return answer(countOverrides.removeFirst()) }
                return answer(countTlv(workouts))
            case 0x08:
                guard let n = try? c.short(0x02), let w = workouts.first(where: { $0.number == n }) else { return [] }
                totalsRequests[n, default: 0] += 1
                if totalsRequests[n]! <= (totalsErrors[n] ?? 0) {
                    return answer(WorkoutWatchScript.tlv { $0.put(0x7f, int: 0x1E079) })
                }
                return answer(w.totals)
            case 0x0a, 0x0c, 0x0e:
                guard let n = try? c.short(0x02), let w = workouts.first(where: { $0.number == n }) else { return [] }
                let index = Int((try? c.short(r.command == 0x0a ? 0x03 : 0x08)) ?? 0)
                if r.command == 0x0a && brokenData.contains("\(n)/\(index)") {
                    return answer(WorkoutWatchScript.tlv { $0.put(0x7f, int: 5) })
                }
                let list = r.command == 0x0a ? w.data : (r.command == 0x0c ? w.pace : w.swim)
                return index < list.count ? answer(list[index]) : []
            case 0x14, 0x16:
                guard let n = try? r.tlv.short(0x01), let w = workouts.first(where: { $0.number == n }) else { return [] }
                let index = Int((try? r.tlv.short(0x02)) ?? 0)
                if r.command == 0x16 && normalSectionError { return answer(WorkoutWatchScript.tlv { $0.put(0x7f, int: 0x1E079) }) }
                let list = r.command == 0x14 ? w.spo2 : w.sections
                return index < list.count ? answer(list[index]) : []
            case 0x15:
                guard let flags = capabilityFlags else { return [] }
                return answer(WorkoutWatchScript.tlv { $0.put(0x01, byte: UInt8(bitPattern: flags)) })
            default:
                return []
            }
        case 0x2c: return gpsServer?.respond(r) ?? []
        case 0x0a: return oldServer?.respond(r) ?? []
        default: return []
        }
    }
}

final class MemorySink: WorkoutSink {
    /// A stored copy with **no GPS point** whose summary says the GPS was never attempted (`none`, the pre-GPS-build
    /// shape). It is only "done" while the watch does not claim a track.
    var storedComplete: Set<String> = []
    /// A stored copy that already attempted the GPS and did not get one: never asked again.
    var storedWithGpsFailure: Set<String> = []
    private(set) var saved: [WorkoutRecord] = []
    private(set) var askedHasGps: [Bool] = []
    var failSave = false

    func isComplete(start: Int64, end: Int64, watchHasGps: Bool) throws -> Bool {
        askedHasGps.append(watchHasGps)
        let key = "\(start)|\(end)"
        if storedWithGpsFailure.contains(key) { return true }
        if storedComplete.contains(key) { return !watchHasGps }
        return false
    }

    func save(_ record: WorkoutRecord) throws -> Bool {
        if failSave { throw WearError(.storage, "disk full") }
        saved.append(record)
        return true
    }
}

final class WorkoutSyncTests: XCTestCase {
    private let start: Int32 = 1_700_000_000
    private var end: Int32 { start + 600 }

    private struct Setup {
        let harness: SleepFilesHarness
        let script: WorkoutWatchScript
        let caps = DeviceCaps()
        func sync() -> WorkoutSync { WorkoutSync(session: harness.session, caps: caps, log: harness.log.sink) }
    }

    private func setup(gpsNewSync: Bool = true) -> Setup {
        let h = SleepFilesHarness()
        let script = WorkoutWatchScript()
        h.watch.responder = script.respond
        let s = Setup(harness: h, script: script)
        s.caps.gpsNewSync = gpsNewSync
        return s
    }

    /// A GPS file in GB's layout: 0x20 trim bytes, type 0x03 (altitude), start values, then 19-byte records.
    private func gpsFile() -> Bytes {
        var b = Bytes(repeating: 0, count: 0x20)
        b.append(0x03)
        func le<T: FixedWidthInteger>(_ v: T) { var x = v.littleEndian; withUnsafeBytes(of: &x) { b.append(contentsOf: $0) } }
        le(UInt32(start))
        le(Double(106.8).bitPattern) // longitude, degrees
        le(Double(-6.2).bitPattern) // latitude, degrees
        le(Double(10.0).bitPattern)
        while b.count < 70 { b.append(0) }
        for i in 0..<3 {
            le(Int16(1)) // time delta
            le(Int16(0))
            le(Float(0).bitPattern)
            le(Float(0).bitPattern)
            b += [0, 0, 0] // accuracy, velocity, pause
            le(Int16(12 + i)) // altitude
            le(Int16(0))
        }
        return b
    }

    private func totals(number: Int16 = 5, type: UInt8 = 1, start s: Int32? = nil, end e: Int32? = nil) -> HuaweiTLV {
        WorkoutWatchScript.box {
            $0.put(0x02, short: number)
            $0.put(0x03, byte: 1)
            $0.put(0x04, int: s ?? start)
            $0.put(0x05, int: e ?? end)
            $0.put(0x06, int: 321) // calories
            $0.put(0x07, int: 5000) // distance
            $0.put(0x08, int: 6100) // steps
            $0.put(0x09, int: 640) // total time
            $0.put(0x12, int: 600) // duration
            $0.put(0x14, byte: type)
        }
    }

    private func dataTlv(number: Int16 = 5, index: Int16 = 0, hr: Bytes = [120, 0, 150]) -> HuaweiTLV {
        var header = Bytes()
        header.appendBE(UInt16(bitPattern: number))
        header.appendBE(UInt16(bitPattern: index))
        header.appendBE(UInt32(start))
        header.append(5)
        header.appendBE(UInt16(hr.count))
        header.append(1)
        header.appendBE(UInt16(0x0001))
        return WorkoutWatchScript.box {
            $0.put(0x02, short: number)
            $0.put(0x03, short: index)
            $0.put(0x04, bytes: header)
            $0.put(0x05, bytes: hr)
        }
    }

    private func paceTlv(number: Int16 = 5, index: Int16 = 0, pace: Int32 = 330) -> HuaweiTLV {
        WorkoutWatchScript.box {
            $0.put(0x02, short: number)
            $0.put(0x08, short: index)
            var block = HuaweiTLV()
            block.put(0x04, short: 1)
            block.put(0x05, byte: 0)
            block.put(0x06, int: pace)
            $0.put(0x83, tlv: block)
        }
    }

    private func workout(trajectories: Int8?, gps: Bool = true) -> WorkoutWatchScript.Workout {
        WorkoutWatchScript.Workout(
            number: 5, start: start, end: end, totals: totals(), data: [dataTlv()], pace: [paceTlv()], trajectories: trajectories
        )
    }

    private func serveGps(_ s: Setup, _ content: Bytes?) {
        let files = content.map { [SleepFilesFakeWatch.NewSyncServer.File(name: "5_gps.bin", typeByte: 0x11, fileId: 9, content: $0)] } ?? []
        let server = SleepFilesFakeWatch.NewSyncServer(files: files, params: s.harness.session.params)
        server.maxBlockSize = 1000
        server.missingFileSize = 0
        s.script.gpsServer = server
    }

    private func summary(_ record: WorkoutRecord) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(record.summaryJson.utf8)) as? [String: Any])
    }

    // MARK: Kotlin WorkoutSyncTest

    func testSyncsWorkoutWithHeartRateSplitsAndGpsTrack() async throws {
        let s = setup()
        s.script.workouts = [workout(trajectories: 1)]
        serveGps(s, gpsFile())
        let sink = MemorySink()
        let sync = s.sync()

        try await sync.sync(startSec: Int(start) - 1000, endSec: Int(end) + 1000, sink: sink)

        XCTAssertEqual(sync.saved, 1)
        let record = try XCTUnwrap(sink.saved.first)
        XCTAssertEqual(sink.saved.count, 1)
        XCTAssertTrue(record.complete)
        XCTAssertEqual(record.number, 5)
        XCTAssertEqual(record.start, Int64(start))
        XCTAssertEqual(record.end, Int64(end))
        XCTAssertEqual(record.sportType, 1)
        XCTAssertEqual(record.sportName, "Running")
        XCTAssertEqual(record.duration, 600)
        XCTAssertEqual(record.distance, 5000)
        XCTAssertEqual(record.calories, 321)
        XCTAssertEqual(record.steps, 6100)
        // The heart-rate sample of 0 is not a reading.
        XCTAssertEqual(record.avgHr, 135)
        XCTAssertEqual(record.maxHr, 150)

        XCTAssertEqual(record.points.filter { $0.hr != nil }.map(\.ts), [Int64(start), Int64(start) + 10])
        // GB drops a final record that leaves no bytes after it, so three records give two points.
        let route = record.points.filter { $0.lat != nil }
        XCTAssertEqual(route.count, 2)
        XCTAssertEqual(try XCTUnwrap(route[0].lat), -6.2, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(route[0].lon), 106.8, accuracy: 0.001)

        let json = try summary(record)
        XCTAssertEqual(json["kind"] as? String, "RUNNING")
        XCTAssertEqual(json["gps"] as? String, "ok")
        let paceBlocks = try XCTUnwrap(json["paceBlocks"] as? [[String: Any]])
        XCTAssertEqual(paceBlocks[0]["pace"] as? Int, 330)
        XCTAssertEqual(json["paceAvgSecPerKm"] as? Int, 330)
        XCTAssertEqual(try XCTUnwrap(json["avgPaceSecPerKm"] as? Double), 1000.0 / (5000.0 / 600), accuracy: 0.001)
        XCTAssertEqual(json["missingData"] as? Bool, false)

        // The GPS file was fetched by name over service 2C, then completed.
        let initRequest = try XCTUnwrap(s.harness.watch.requests.first { $0.service == 0x2c && $0.command == 0x01 })
        XCTAssertEqual(try initRequest.tlv.string(0x01), "5_gps.bin")
        XCTAssertEqual(try initRequest.tlv.byte(0x02), 0x11)
        XCTAssertEqual(s.harness.watch.requests.last { $0.service == 0x2c }?.command, 0x06)
    }

    func testWatchReportingNoTrajectoryDataSkipsTheGpsDownload() async throws {
        let s = setup()
        s.script.workouts = [workout(trajectories: 0)]
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start) - 1000, endSec: Int(end) + 1000, sink: sink)

        let record = try XCTUnwrap(sink.saved.first)
        XCTAssertTrue(record.complete)
        XCTAssertEqual(s.harness.watch.requests.filter { $0.service == 0x2c }.count, 0)
        XCTAssertEqual(try summary(record)["gps"] as? String, "none")
        XCTAssertTrue(record.points.allSatisfy { $0.lat == nil })
    }

    func testEmptyGpsFileLeavesTheWorkoutWithoutRoute() async throws {
        let s = setup()
        s.script.workouts = [workout(trajectories: nil)]
        serveGps(s, nil)
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start) - 1000, endSec: Int(end) + 1000, sink: sink)

        let record = try XCTUnwrap(sink.saved.first)
        XCTAssertTrue(record.complete)
        // The watch answers the init with size 0xFFFFFFFF... here size 0: an empty file.
        XCTAssertEqual(try summary(record)["gps"] as? String, "empty")
    }

    func testAlreadyStoredWorkoutIsNotDownloadedAgain() async throws {
        let s = setup()
        s.script.workouts = [workout(trajectories: 1)]
        serveGps(s, gpsFile())
        let sink = MemorySink()
        sink.storedComplete = ["\(start)|\(end)"]

        try await s.sync().sync(startSec: Int(start) - 1000, endSec: Int(end) + 1000, sink: sink)

        XCTAssertTrue(sink.saved.isEmpty)
        XCTAssertEqual(s.harness.watch.requests.filter { $0.command == 0x0a && $0.service == 0x17 }.count, 0)
        XCTAssertNil(s.harness.watch.requests.first { $0.service == 0x2c })
    }

    func testCountWithoutContainerMeansNoWorkouts() async throws {
        let s = setup()
        s.script.countOverrides = [WorkoutWatchScript.tlv { $0.put(0x01, byte: 1) }]
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start), endSec: Int(end), sink: sink)

        XCTAssertTrue(sink.saved.isEmpty)
        XCTAssertTrue(s.harness.log.contains("nothing to sync"))
    }

    func testOldSyncDownloadsTheGpsFileFromTheWorkoutFileList() async throws {
        let gps = gpsFile()
        let s = setup(gpsNewSync: false)
        s.script.workouts = [workout(trajectories: nil)]
        let server = SleepFilesFakeWatch.OldSyncServer(files: ["5_gps.bin": gps], listing: ["5_pdr.bin", "5_gps.bin"], params: s.harness.session.params)
        server.burst = 60
        s.script.oldServer = server
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start) - 1000, endSec: Int(end) + 1000, sink: sink)

        let record = try XCTUnwrap(sink.saved.first)
        XCTAssertEqual(try summary(record)["gps"] as? String, "ok")
        XCTAssertEqual(record.points.filter { $0.lat != nil }.count, 2)
        let initRequest = try XCTUnwrap(s.harness.watch.requests.first { $0.service == 0x0a && $0.command == 0x01 })
        XCTAssertEqual(try initRequest.tlv.byte(0x02), 2)
        XCTAssertEqual(try initRequest.tlv.object(0x86).object(0x88).short(0x09), 5)
        let parameters = try XCTUnwrap(s.harness.watch.requests.first { $0.service == 0x0a && $0.command == 0x02 }).tlv
        XCTAssertEqual(try parameters.byte(0x06), 2)
        XCTAssertEqual(try parameters.byte(0x07), 3)
        XCTAssertEqual(try XCTUnwrap(s.harness.watch.requests.first { $0.service == 0x0a && $0.command == 0x03 }).tlv.string(0x01), "5_gps.bin")
    }

    // MARK: retries, splits, failures

    func testTotalsErrorIsRetriedThenAccepted() async throws {
        let s = setup()
        s.script.workouts = [workout(trajectories: 0)]
        s.script.totalsErrors[5] = 3
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start), endSec: Int(end), sink: sink)

        XCTAssertEqual(sink.saved.count, 1)
        XCTAssertEqual(s.harness.watch.requests.filter { $0.service == 0x17 && $0.command == 0x08 }.count, 4)
        XCTAssertTrue(s.harness.log.contains("retry 3/3"))
    }

    func testTotalsThatNeverWorkSkipTheWorkoutAndContinueWithTheNext() async throws {
        let s = setup()
        var second = workout(trajectories: 0)
        second.number = 7
        second.totals = totals(number: 7, type: 2, start: start + 5000, end: end + 5000)
        second.data = [dataTlv(number: 7)]
        second.pace = [paceTlv(number: 7)]
        s.script.workouts = [workout(trajectories: 0), second]
        s.script.totalsErrors[5] = 100
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start), endSec: Int(end) + 5000, sink: sink)

        XCTAssertEqual(sink.saved.map(\.number), [7])
        XCTAssertTrue(s.harness.log.contains("totals failed after 3 retries"))
    }

    func testDataThatKeepsFailingFlagsMissingDataButStoresTheWorkout() async throws {
        let s = setup()
        s.script.workouts = [workout(trajectories: 0)]
        s.script.brokenData = ["5/0"]
        let sink = MemorySink()
        let sync = s.sync()

        try await sync.sync(startSec: Int(start), endSec: Int(end), sink: sink)

        let record = try XCTUnwrap(sink.saved.first)
        XCTAssertTrue(record.complete)
        XCTAssertEqual(try summary(record)["missingData"] as? Bool, true)
        XCTAssertNil(record.avgHr)
        XCTAssertEqual(s.harness.watch.requests.filter { $0.service == 0x17 && $0.command == 0x0a }.count, 4)
    }

    func testSectionsWithTheNormalErrorAreIgnoredWithoutRetriesOrMissingData() async throws {
        let s = setup()
        var w = workout(trajectories: 0)
        w.sections = [WorkoutWatchScript.tlv { _ in }]
        s.script.workouts = [w]
        s.script.normalSectionError = true
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start), endSec: Int(end), sink: sink)

        let record = try XCTUnwrap(sink.saved.first)
        XCTAssertEqual(try summary(record)["missingData"] as? Bool, false)
        XCTAssertNil(try summary(record)["sections"])
        XCTAssertEqual(s.harness.watch.requests.filter { $0.service == 0x17 && $0.command == 0x16 }.count, 1)
    }

    func testAllPartsAreDownloadedAndStoredInTheSummary() async throws {
        let s = setup()
        var w = workout(trajectories: 0)
        w.swim = [WorkoutWatchScript.box {
            $0.put(0x02, short: 5)
            $0.put(0x08, short: 0)
            var b = HuaweiTLV()
            b.put(0x04, short: 50); b.put(0x05, byte: 0); b.put(0x06, int: 90); b.put(0x0a, byte: 3)
            $0.put(0x83, tlv: b)
        }]
        w.spo2 = [WorkoutWatchScript.tlv {
            $0.put(0x01, short: 5)
            $0.put(0x02, short: 0)
            var blocks = HuaweiTLV()
            var b = HuaweiTLV()
            b.put(0x05, byte: 60); b.put(0x06, byte: 97)
            blocks.put(0x84, tlv: b)
            $0.put(0x83, tlv: blocks)
        }]
        w.sections = [WorkoutWatchScript.tlv {
            $0.put(0x01, short: 5)
            $0.put(0x02, short: 0)
            var blocks = HuaweiTLV()
            var b = HuaweiTLV()
            b.put(0x05, byte: 1); b.put(0x09, byte: 140)
            blocks.put(0x84, tlv: b)
            $0.put(0x83, tlv: blocks)
        }]
        s.script.workouts = [w]
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start), endSec: Int(end), sink: sink)

        let json = try summary(try XCTUnwrap(sink.saved.first))
        XCTAssertEqual((json["swimSegments"] as? [[String: Any]])?.first?["swimType"] as? Int, 3)
        XCTAssertEqual((json["spo2"] as? [[String: Any]])?.first?["value"] as? Int, 97)
        XCTAssertEqual((json["sections"] as? [[String: Any]])?.first?["heartRate"] as? Int, 140)
        XCTAssertEqual(json["missingData"] as? Bool, false)
    }

    func testCountErrorAsksTwiceForEachHalfOfTheWindow() async throws {
        let s = setup()
        s.script.workouts = [workout(trajectories: 0)]
        s.script.countOverrides = [WorkoutWatchScript.tlv { $0.put(0x7f, int: 5) }]
        let sink = MemorySink()

        try await s.sync().sync(startSec: 1000, endSec: 2000, sink: sink)

        XCTAssertEqual(s.script.countRequests.map { [Int($0.start), Int($0.end)] }, [[1000, 2000], [1000, 1500], [1501, 2000]])
        XCTAssertEqual(sink.saved.count, 2, "both halves answer with the full list in this fake, and each workout is stored")
    }

    func testCountThatDoesNotMatchTheListGivesUpAfterFiveSplits() async throws {
        let s = setup()
        let list = [workout(trajectories: 0)]
        s.script.workouts = list
        // Always claims two workouts but lists one.
        s.script.countOverrides = Array(repeating: WorkoutWatchScript.box {
            $0.put(0x02, short: 2)
            var e = HuaweiTLV()
            e.put(0x06, short: 5); e.put(0x07, short: 0); e.put(0x08, short: 0)
            $0.put(0x85, tlv: e)
        }, count: 200)
        let sink = MemorySink()

        do {
            try await s.sync().sync(startSec: 0, endSec: 100_000, sink: sink)
            XCTFail("expected the split limit")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .protocolError)
            XCTAssertTrue(e.message.contains("too many times"))
        }
        XCTAssertTrue(sink.saved.isEmpty)
    }

    func testWorkoutsAreSyncedInWorkoutNumberOrder() async throws {
        let s = setup()
        var a = workout(trajectories: 0)
        a.number = 9
        a.totals = totals(number: 9, start: start + 9000, end: end + 9000)
        a.data = [dataTlv(number: 9)]
        a.pace = [paceTlv(number: 9)]
        var b = workout(trajectories: 0)
        b.number = 2
        b.totals = totals(number: 2, type: 3, start: start + 100, end: end + 100)
        b.data = [dataTlv(number: 2)]
        b.pace = [paceTlv(number: 2)]
        s.script.workouts = [a, b]
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start), endSec: Int(end) + 9000, sink: sink)

        XCTAssertEqual(sink.saved.map(\.number), [2, 9])
        XCTAssertEqual(sink.saved.map(\.sportName), ["Biking", "Running"])
    }

    func testTimeoutStoresTheWorkoutAsIncompleteAndAbortsTheSync() async throws {
        let s = setup()
        s.script.workouts = [workout(trajectories: 0)]
        s.script.silent = [0x0c]
        let sink = MemorySink()
        let sync = s.sync()
        sync.requestTimeoutMs = 150

        do {
            try await sync.sync(startSec: Int(start), endSec: Int(end), sink: sink)
            XCTFail("expected the timeout")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .timeout)
        }

        let record = try XCTUnwrap(sink.saved.first)
        XCTAssertFalse(record.complete)
        XCTAssertEqual(record.avgHr, 135, "the data downloaded before the timeout is kept")
        XCTAssertEqual(sync.saved, 1)
    }

    func testSinkFailureSurfaces() async throws {
        let s = setup()
        s.script.workouts = [workout(trajectories: 0)]
        let sink = MemorySink()
        sink.failSave = true

        do {
            try await s.sync().sync(startSec: Int(start), endSec: Int(end), sink: sink)
            XCTFail("expected the storage error")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .storage)
        }
    }

    func testServiceNotOfferedByTheWatchSkipsTheSync() async throws {
        let s = setup()
        s.caps.supportedCommands = [0x07: [0x01]]
        s.script.workouts = [workout(trajectories: 0)]
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start), endSec: Int(end), sink: sink)

        XCTAssertTrue(sink.saved.isEmpty)
        XCTAssertEqual(s.harness.watch.requests.count, 0)
        XCTAssertTrue(s.harness.log.contains("service 0x17 not offered"))
    }

    func testNewStepsCapabilityIsAskedAndPassedOnToTheDataRequest() async throws {
        let s = setup()
        s.caps.supportedCommands = [0x17: [0x07, 0x08, 0x0a, 0x15]]
        s.script.capabilityFlags = 2
        s.script.workouts = [workout(trajectories: 0)]
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start), endSec: Int(end), sink: sink)

        let dataRequest = try XCTUnwrap(s.harness.watch.requests.first { $0.service == 0x17 && $0.command == 0x0a })
        XCTAssertEqual(try dataRequest.tlv.object(0x81).byte(0x06), 1)
        XCTAssertEqual(try summary(try XCTUnwrap(sink.saved.first))["newSteps"] as? Bool, true)
    }

    func testNoCapabilityRequestWhenTheWatchDoesNotListIt() async throws {
        let s = setup()
        s.caps.supportedCommands = [0x17: [0x07, 0x08, 0x0a]]
        s.script.workouts = [workout(trajectories: 0)]
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start), endSec: Int(end), sink: sink)

        XCTAssertEqual(s.harness.watch.requests.filter { $0.command == 0x15 }.count, 0)
        let dataRequest = try XCTUnwrap(s.harness.watch.requests.first { $0.service == 0x17 && $0.command == 0x0a })
        XCTAssertFalse(try dataRequest.tlv.object(0x81).contains(0x06))
    }

    func testGpsFileThatCannotBeParsedIsFlaggedFailed() async throws {
        let s = setup()
        s.script.workouts = [workout(trajectories: nil)]
        serveGps(s, Bytes(repeating: 1, count: 10))
        let sink = MemorySink()

        try await s.sync().sync(startSec: Int(start), endSec: Int(end), sink: sink)

        let record = try XCTUnwrap(sink.saved.first)
        XCTAssertTrue(record.complete)
        XCTAssertEqual(try summary(record)["gps"] as? String, "failed")
    }
}
