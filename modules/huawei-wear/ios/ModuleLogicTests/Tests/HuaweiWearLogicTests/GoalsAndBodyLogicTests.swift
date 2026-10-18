import XCTest
@testable import HuaweiWearLogic

/// Activity-ring goals, body metrics and the sliced history pull, against the DataSync rig (a fake connected watch).
final class ActivityGoalsTests: XCTestCase {
    private var settings: WearSettings!
    private var defaults: UserDefaults!
    private let nowMs: Int64 = 1_760_400_000_000

    override func setUp() {
        settings = WearSettings(defaults: ephemeralDefaults())
        defaults = ephemeralDefaults()
    }

    private func make(_ rig: DataSyncRig) -> ActivityGoals {
        let goals = ActivityGoals(defaults: defaults, service: rig.service, events: rig.events, settings: settings, nowMs: { [nowMs] in nowMs })
        rig.service.register(goals)
        return goals
    }

    private func profile(goal: Int) -> UserProfileData { UserProfileData(heightCm: 170, weightKg: 65, birthYear: 1990, sex: "male", dailyStepGoal: goal) }

    func testTheStatusHasTheTypeScriptFieldsAndDefaults() {
        let rig = DataSyncRig(connected: false)
        let goals = make(rig)
        let status = goals.status()
        XCTAssertEqual(
            Set(status.keys),
            ["steps", "calories", "exerciseMinutes", "standHours", "remindStand", "remindProgress", "remindGoalReached", "configSupported", "lastSentAt"]
        )
        XCTAssertEqual(status["steps"] as? Int, 10_000)
        XCTAssertEqual(status["calories"] as? Int, 300)
        XCTAssertEqual(status["exerciseMinutes"] as? Int, 30)
        XCTAssertEqual(status["standHours"] as? Int, 12)
        XCTAssertEqual(status["remindStand"] as? Bool, true)
        XCTAssertTrue(status["configSupported"] is NSNull)
        XCTAssertTrue(status["lastSentAt"] is NSNull)
    }

    func testUntilTheUserSavesTheStepsGoalIsTheProfilesDailyGoal() async throws {
        let rig = DataSyncRig(connected: false)
        let goals = make(rig)
        settings.profile = profile(goal: 7_500)
        XCTAssertEqual(goals.status()["steps"] as? Int, 7_500)
        _ = try await goals.set(ActivityGoalsData(steps: 9_000))
        settings.profile = profile(goal: 7_500)
        XCTAssertEqual(goals.status()["steps"] as? Int, 9_000)
    }

    func testConfigSupportedFollowsExpandCapability83() {
        XCTAssertEqual(make(DataSyncRig(bits: [83])).status()["configSupported"] as? Bool, true)
        XCTAssertEqual(make(DataSyncRig(bits: [84])).status()["configSupported"] as? Bool, false)
    }

    func testSavingSendsEightConfigsToTheWatchInOrder() async throws {
        let rig = DataSyncRig()
        let goals = make(rig)
        let sent = try await goals.set(ActivityGoalsData(steps: 8000, calories: 450, exerciseMinutes: 45, standHours: 10, remindStand: false))
        XCTAssertTrue(sent)
        let configs = rig.watch.sent.filter { $0.service == 0x37 && $0.command == 0x01 }
        XCTAssertEqual(configs.count, 8)
        var ids = [Int]()
        var data = [Bytes]()
        for c in configs {
            XCTAssertEqual(try c.tlv.string(0x01), "hw.sport.config")
            XCTAssertEqual(try c.tlv.string(0x02), "in.huawei.motion")
            let entry = try c.tlv.object(0x83).objects(0x84)[0]
            ids.append(Int(try entry.int(0x05)))
            XCTAssertEqual(try entry.byte(0x06), 1)
            XCTAssertEqual(try entry.long(0x08), nowMs)
            data.append(try entry.bytes(0x07))
        }
        XCTAssertEqual(ids, [900200006, 900200007, 900200008, 900200009, 900200002, 900200004, 900200010, 900200011])
        let now = Int(nowMs / 1000)
        XCTAssertEqual(data[0], ActivityGoalsCodec.single(nowSec: now, goal: 8000))
        XCTAssertEqual(data[1], ActivityGoalsCodec.single(nowSec: now, goal: 450_000))
        XCTAssertEqual(data[2], ActivityGoalsCodec.single(nowSec: now, goal: 45))
        XCTAssertEqual(data[3], ActivityGoalsCodec.single(nowSec: now, goal: 10))
        XCTAssertEqual(data[4], ActivityGoalsCodec.bundle(nowSec: now, steps: 8000, exerciseMinutes: 45, standHours: 10))
        XCTAssertEqual(data[5], ActivityGoalsCodec.single(nowSec: now, goal: 0))
        XCTAssertEqual(data[6], ActivityGoalsCodec.single(nowSec: now, goal: 1))
        XCTAssertEqual(goals.status()["lastSentAt"] as? Int64, nowMs)
        XCTAssertEqual(goals.status()["steps"] as? Int, 8000)
        XCTAssertTrue(rig.events.contains("Goals: saved steps=8000 kcal=450"))
    }

    func testSavingWithoutAWatchStoresAndReportsNotSent() async throws {
        let rig = DataSyncRig(connected: false)
        let goals = make(rig)
        let sent = try await goals.set(ActivityGoalsData(steps: 12_000))
        XCTAssertFalse(sent)
        XCTAssertTrue(rig.watch.sent.isEmpty)
        XCTAssertEqual(goals.status()["steps"] as? Int, 12_000)
        XCTAssertTrue(goals.status()["lastSentAt"] is NSNull)
    }

    func testAWatchWithoutTheConfigBitGetsNothingAndSendingStopsAtTheFirstRefusal() async throws {
        let rig = DataSyncRig(bits: [84])
        let goals = make(rig)
        let sent = try await goals.set(ActivityGoalsData())
        XCTAssertFalse(sent)
        XCTAssertTrue(rig.watch.sent.isEmpty)
        XCTAssertEqual(rig.events.logs.filter { $0.message.contains("needs ExpandCapability 83: NOT set") }.count, 1)
        XCTAssertTrue(goals.status()["lastSentAt"] is NSNull)
    }

    func testInvalidGoalsAreRejectedAndNotStored() async {
        let rig = DataSyncRig()
        let goals = make(rig)
        do {
            _ = try await goals.set(ActivityGoalsData(steps: 10))
            XCTFail("expected ERR_INVALID_ARGUMENT")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .invalidArgument)
            XCTAssertEqual(e.message, "Steps goal must be 1000 to 100000")
        } catch { XCTFail("\(error)") }
        XCTAssertTrue(rig.watch.sent.isEmpty)
        XCTAssertEqual(goals.status()["steps"] as? Int, 10_000)
    }

    func testOnConnectNothingIsSentUntilTheUserSavedGoals() async throws {
        let rig = DataSyncRig()
        let goals = make(rig)
        try await goals.onConnected()
        XCTAssertTrue(rig.watch.sent.isEmpty)
        XCTAssertTrue(rig.events.contains("Goals: not sent on connect, no goals saved in JoyoFit yet"))

        _ = try await goals.set(ActivityGoalsData(steps: 8000))
        let afterSave = rig.watch.sent.count
        XCTAssertEqual(afterSave, 8)
        try await goals.onConnected()
        XCTAssertEqual(rig.watch.sent.count, 16)
        XCTAssertTrue(rig.events.contains("Goals: sending to the watch (connected)"))
    }

    func testTheServiceSendsOnEveryNewConnection() async throws {
        let rig = DataSyncRig()
        let goals = make(rig)
        _ = try await goals.set(ActivityGoalsData(steps: 8000))
        XCTAssertEqual(rig.watch.sent.count, 8)
        await rig.attach()
        await eventually { rig.watch.sent.count == 16 }
    }

    func testAGoalTheWatchChangesIsStoredWhicheverSideNamesIt() async throws {
        let rig = DataSyncRig()
        let goals = make(rig)
        await rig.attach()
        let now = Int(nowMs / 1000)
        func frame(src: String, wear: String, id: Int, goal: Int) -> Bytes {
            var entry = HuaweiTLV()
            entry.put(0x05, int: Int32(id))
            entry.put(0x06, byte: 1)
            entry.put(0x07, bytes: ActivityGoalsCodec.single(nowSec: now, goal: goal))
            var list = HuaweiTLV()
            list.put(0x84, tlv: entry)
            var t = HuaweiTLV()
            t.put(0x01, string: src)
            t.put(0x02, string: wear)
            t.put(0x83, tlv: list)
            return DataSyncRig.frame(0x01, t)
        }
        // GB's side: the watch's own package is in.huawei.motion.
        rig.session.onData(frame(src: "in.huawei.motion", wear: "hw.sport.config", id: ActivityGoalsCodec.steps, goal: 12_345))
        await eventually { goals.status()["steps"] as? Int == 12_345 }
        // Huawei Health's side, calories come as kcal x 1000, reminders as 0 / 1.
        rig.session.onData(frame(src: "hw.sport.config", wear: "in.huawei.motion", id: ActivityGoalsCodec.calories, goal: 520_000))
        await eventually { goals.status()["calories"] as? Int == 520 }
        rig.session.onData(frame(src: "in.huawei.motion", wear: "hw.sport.config", id: ActivityGoalsCodec.reminderProgress, goal: 0))
        await eventually { goals.status()["remindProgress"] as? Bool == false }
        rig.session.onData(frame(src: "in.huawei.motion", wear: "hw.sport.config", id: ActivityGoalsCodec.exercise, goal: 40))
        rig.session.onData(frame(src: "in.huawei.motion", wear: "hw.sport.config", id: ActivityGoalsCodec.stand, goal: 8))
        await eventually { goals.status()["exerciseMinutes"] as? Int == 40 && goals.status()["standHours"] as? Int == 8 }
        XCTAssertTrue(rig.events.contains("Goals: the watch changed config 900200006 to 12345; stored"))
        // The watch's own change is not "saved by the user": nothing is pushed on connect.
        try await goals.onConnected()
        XCTAssertTrue(rig.watch.sent.isEmpty)
        // An id this feature does not own, or data without a goal, changes nothing.
        rig.session.onData(frame(src: "in.huawei.motion", wear: "hw.sport.config", id: 12345, goal: 3))
        await sleepMs(50)
        XCTAssertEqual(goals.status()["steps"] as? Int, 12_345)
    }

    func testTheJsObjectIsParsedWithDefaultsForMissingFields() throws {
        let full = try ActivityGoalsData.parse([
            "steps": 8000, "calories": 450.0, "exerciseMinutes": 45, "standHours": 10, "remindStand": false, "remindProgress": true, "remindGoalReached": false,
        ])
        XCTAssertEqual(full, ActivityGoalsData(steps: 8000, calories: 450, exerciseMinutes: 45, standHours: 10, remindStand: false, remindProgress: true, remindGoalReached: false))
        XCTAssertEqual(try ActivityGoalsData.parse([:]), ActivityGoalsData())
        XCTAssertThrowsError(try ActivityGoalsData.parse(["steps": "many"])) { XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument) }
        XCTAssertThrowsError(try ActivityGoalsData.parse(["remindStand": 1.5 as Any, "steps": 5000, "standHours": "x"]))
    }
}

final class BodyMetricsTests: XCTestCase {
    private var settings: WearSettings!
    private var store: SyncStore!
    private let nowMs: Int64 = 1_760_400_000_000
    private final class Clock: @unchecked Sendable {
        private let lock = NSLock()
        private var value: Int64 = 0
        func tick(from base: Int64) -> Int64 { lock.locked { value += 1; return base + (value - 1) } }
    }
    private var clock: Clock!

    override func setUp() {
        settings = WearSettings(defaults: ephemeralDefaults())
        store = SyncStore(url: temporaryDatabaseURL())
        clock = Clock()
    }

    private func make(_ rig: DataSyncRig) -> BodyMetrics {
        let body = BodyMetrics(store: store, service: rig.service, events: rig.events, settings: settings, nowMs: { [nowMs] in nowMs })
        rig.service.register(body)
        return body
    }

    private func dictionaries(_ rig: DataSyncRig) throws -> [DictQuery] {
        try rig.watch.sent.filter { $0.service == 0x37 && $0.command == 0x04 }.map { try DataSyncWire.parseDictionary($0.tlv) }
    }

    func testNothingStoredIsAllNull() {
        let body = make(DataSyncRig(connected: false))
        let js = body.load().toJS()
        XCTAssertEqual(Set(js.keys), ["weightKg", "weightTs", "bodyFatPct", "bodyFatTs", "restingKcal", "systolic", "diastolic", "bpTs"])
        XCTAssertTrue(js.values.allSatisfy { $0 is NSNull })
    }

    func testSavingOverwritesOnlyTheFieldsSet() async throws {
        let rig = DataSyncRig(connected: false)
        let body = BodyMetrics(store: store, service: rig.service, events: rig.events, settings: settings, nowMs: { [clock, nowMs] in clock!.tick(from: nowMs) })
        var after = try await body.set(BodyMetricsData(weightKg: 70.5, weightTsMs: 1_760_000_000_000, bodyFatPct: 22.5, restingKcal: 1650))
        XCTAssertEqual(after, BodyMetricsData(weightKg: 70.5, weightTsMs: 1_760_000_000_000, bodyFatPct: 22.5, restingKcal: 1650))
        after = try await body.set(BodyMetricsData(weightKg: 69.8, systolic: 120, diastolic: 80, bpTsMs: 5))
        XCTAssertEqual(
            after,
            BodyMetricsData(weightKg: 69.8, weightTsMs: 1_760_000_000_000, bodyFatPct: 22.5, restingKcal: 1650, systolic: 120, diastolic: 80, bpTsMs: 5)
        )
        XCTAssertEqual(body.load(), after)
        // Another instance on the same database sees it (the background wake reads what JS stored).
        XCTAssertEqual(make(DataSyncRig(connected: false)).load(), after)
        let updated = try store.read { db in try db.query("SELECT DISTINCT updated_at FROM body_metrics") { $0.int64(0) } }
        XCTAssertEqual(updated.count, 2)
        XCTAssertEqual(Set(updated), [nowMs, nowMs + 1])
    }

    func testTheWeightRowFallsBackToTheProfileWeightWithNow() async throws {
        let body = make(DataSyncRig(connected: false))
        XCTAssertNil(body.weightRowOrNil())
        settings.profile = UserProfileData(heightCm: 170, weightKg: 65.5, birthYear: 1990, sex: "male", dailyStepGoal: 8000)
        let fallback = try XCTUnwrap(body.weightRowOrNil())
        XCTAssertEqual(fallback.startMs, nowMs)
        XCTAssertEqual(fallback.values.map(\.key), [2004])
        XCTAssertEqual(fallback.values[0].value, BodyMetricsCodec.doubleLe(65.5))
        _ = try await body.set(BodyMetricsData(weightKg: 70.5, weightTsMs: 1_760_000_000_000, bodyFatPct: 20, restingKcal: 1650))
        let row = try XCTUnwrap(body.weightRowOrNil())
        XCTAssertEqual(row.startMs, 1_760_000_000_000)
        XCTAssertEqual(row.endMs, 1_760_000_000_000)
        XCTAssertEqual(row.modifyMs, nowMs)
        XCTAssertEqual(row.values.map(\.key), [2004, 2001, 2024])
        XCTAssertEqual(row.values[2].value, BodyMetricsCodec.doubleLe(1650))
    }

    func testAChangedRestingValueAndWeightArePushedToAConnectedWatch() async throws {
        let rig = DataSyncRig(bits: [83, 84, 173])
        let body = make(rig)
        _ = try await body.set(BodyMetricsData(weightKg: 70.5, bodyFatPct: 22.5, restingKcal: 1650))
        let dicts = try dictionaries(rig)
        XCTAssertEqual(dicts.map(\.dictId), [500_018, 10_006])
        XCTAssertEqual(dicts[0].srcPkg, "hw.unitedevice.weightMgr")
        XCTAssertEqual(dicts[0].wearPkg, "hw.sport.dietcal")
        XCTAssertEqual(dicts[0].rows[0].values[0].key, 500_018_055)
        XCTAssertEqual(dicts[0].rows[0].values[0].value, [0, 0, 0x06, 0x72])
        XCTAssertEqual(dicts[0].rows[0].endMs, nowMs)
        XCTAssertEqual(dicts[0].rows[0].modifyMs, nowMs)
        let start = Int64(Calendar.current.startOfDay(for: Date(timeIntervalSince1970: Double(nowMs) / 1000)).timeIntervalSince1970 * 1000)
        XCTAssertEqual(dicts[0].rows[0].startMs, start)
        XCTAssertEqual(dicts[1].rows[0].values.map(\.key), [2004, 2001, 2024])
        XCTAssertEqual(dicts[1].rows[0].values[0].value, BodyMetricsCodec.doubleLe(70.5))

        // The same values again, or only a blood pressure: nothing goes out.
        _ = try await body.set(BodyMetricsData(weightKg: 70.5, bodyFatPct: 22.5, restingKcal: 1650))
        _ = try await body.set(BodyMetricsData(systolic: 118, diastolic: 78))
        XCTAssertEqual(try dictionaries(rig).count, 2)
        // A new body fat alone pushes the weight row again.
        _ = try await body.set(BodyMetricsData(bodyFatPct: 21))
        XCTAssertEqual(try dictionaries(rig).map(\.dictId), [500_018, 10_006, 10_006])
    }

    func testNothingIsPushedWithoutAWatchOrWithoutTheDictionaryBit() async throws {
        let none = DataSyncRig(connected: false)
        _ = try await make(none).set(BodyMetricsData(weightKg: 70, restingKcal: 1500))
        XCTAssertTrue(none.watch.sent.isEmpty)
        let noBit = DataSyncRig(bits: [83, 84])
        _ = try await make(noBit).set(BodyMetricsData(weightKg: 71, restingKcal: 1600))
        XCTAssertTrue(noBit.watch.sent.isEmpty)
        XCTAssertTrue(noBit.events.contains("needs ExpandCapability 173: NOT set"))
    }

    func testTheWatchsRestingMetabolismRequestIsAnsweredWithItsWindow() async throws {
        let rig = DataSyncRig(bits: [173])
        let body = make(rig)
        _ = try await body.save(BodyMetricsData(restingKcal: 1800))
        await rig.attach()
        var t = HuaweiTLV()
        t.put(0x01, string: "hw.sport.dietcal")
        t.put(0x02, string: "hw.unitedevice.weightMgr")
        t.put(0x03, int: 500_018)
        t.put(0x06, long: 1_760_000_000_000)
        t.put(0x07, long: 1_760_086_400_000)
        rig.session.onData(DataSyncRig.frame(0x04, t))
        // The first dictionary is the one sent on connect; the second answers the watch's request.
        await eventually { rig.watch.sent.count == 2 }
        let query = try XCTUnwrap(try dictionaries(rig).last)
        XCTAssertEqual(query.dictId, 500_018)
        XCTAssertEqual(query.srcPkg, "hw.unitedevice.weightMgr")
        XCTAssertEqual(query.wearPkg, "hw.sport.dietcal")
        XCTAssertEqual(query.rows[0].startMs, 1_760_000_000_000)
        XCTAssertEqual(query.rows[0].endMs, 1_760_086_400_000)
        XCTAssertEqual(query.rows[0].values[0].value, [0, 0, 0x07, 0x08])
    }

    func testARestingRequestWithoutAKnownValueSendsNothing() async throws {
        let rig = DataSyncRig(bits: [173])
        _ = make(rig)
        await rig.attach()
        var t = HuaweiTLV()
        t.put(0x01, string: "hw.sport.dietcal")
        t.put(0x02, string: "hw.unitedevice.weightMgr")
        t.put(0x03, int: 500_018)
        rig.session.onData(DataSyncRig.frame(0x04, t))
        await eventually { rig.events.contains("Body: resting metabolism not sent (watch request): no value known") }
        XCTAssertTrue(rig.watch.sent.isEmpty)
    }

    func testTheHealthGlanceEventIsAnsweredWithTheJson() async throws {
        let rig = DataSyncRig(bits: [84])
        let body = make(rig)
        settings.profile = UserProfileData(heightCm: 175, weightKg: 65, birthYear: 1990, sex: "male", dailyStepGoal: 8000)
        _ = try await body.save(BodyMetricsData(weightKg: 70.5, weightTsMs: 1_760_400_000_000, bodyFatPct: 22.5, bodyFatTsMs: 1_760_400_000_000))
        await rig.attach()
        rig.session.onData(DataSyncRig.eventFrame(src: "hw.watch.health.healthcheck", wear: "hw.unitedevice.healthGlanceMgr", id: 80_030_006, data: nil))
        await eventually { !rig.watch.sent.isEmpty }
        let sent = try XCTUnwrap(rig.watch.sent.first)
        XCTAssertEqual(sent.command, 0x02)
        XCTAssertEqual(try sent.tlv.string(0x01), "hw.unitedevice.healthGlanceMgr")
        XCTAssertEqual(try sent.tlv.string(0x02), "hw.watch.health.healthcheck")
        XCTAssertEqual(try sent.tlv.int(0x03), 80_030_006)
        XCTAssertEqual(
            String(decoding: try sent.tlv.bytes(0x05), as: UTF8.self),
            "{\"bodyMassIndex\":23.0,\"fatPercentageTimestamp\":1760400000000,\"fatPercentage\":22.5,\"height\":175,\"weight\":70.5,\"weightTimestamp\":1760400000000}"
        )
    }

    func testOnConnectTheKnownRestingValueIsSentOnce() async throws {
        let rig = DataSyncRig(bits: [173])
        let body = make(rig)
        try await body.onConnected()
        XCTAssertTrue(rig.watch.sent.isEmpty)
        _ = try await body.save(BodyMetricsData(restingKcal: 1650))
        try await body.onConnected()
        XCTAssertEqual(try dictionaries(rig).map(\.dictId), [500_018])
    }

    func testTheJsUpdateIsParsedAndMistypedFieldsAreRejected() throws {
        let update = try BodyMetricsData.parse([
            "weightKg": 70.5, "weightTs": 1_760_400_000_000.0, "bodyFatPct": 22, "restingKcal": 1650, "systolic": 120, "diastolic": 80, "bpTs": 5,
        ])
        XCTAssertEqual(update, BodyMetricsData(weightKg: 70.5, weightTsMs: 1_760_400_000_000, bodyFatPct: 22, restingKcal: 1650, systolic: 120, diastolic: 80, bpTsMs: 5))
        XCTAssertEqual(try BodyMetricsData.parse([:]), BodyMetricsData())
        XCTAssertEqual(try BodyMetricsData.parse(["weightKg": NSNull()]), BodyMetricsData())
        XCTAssertThrowsError(try BodyMetricsData.parse(["weightKg": "heavy"])) { XCTAssertEqual(($0 as? WearError)?.code, .invalidArgument) }
    }
}

final class DietWiringTests: XCTestCase {
    private let nowSec: Int64 = 1_760_450_000

    private func make(_ rig: DataSyncRig, settings: WearSettings) -> (DietSync, ActivityGoals, BodyMetrics) {
        let store = SyncStore(url: temporaryDatabaseURL())
        let goals = ActivityGoals(defaults: ephemeralDefaults(), service: rig.service, events: rig.events, settings: settings)
        let body = BodyMetrics(store: store, service: rig.service, events: rig.events, settings: settings, nowMs: { 1_760_450_000_000 })
        let diet = DietSync.wired(
            store: store, events: rig.events, settings: settings, defaults: ephemeralDefaults(),
            now: { Date(timeIntervalSince1970: 1_760_450_000) }, goals: goals, body: body
        )
        rig.service.register(diet)
        return (diet, goals, body)
    }

    private func bitmapRig() -> DataSyncRig {
        let rig = DataSyncRig(bits: [83, 84, 173])
        var bitmap = Bytes(repeating: 0, count: 32)
        for bit in [83, 84, 85, 173, 215] { bitmap[bit / 8] |= UInt8(1 << (bit % 8)) }
        rig.caps.expandCapabilities = bitmap
        return rig
    }

    func testTheWatchsWeightRequestIsAnsweredByBodyMetrics() async throws {
        let rig = bitmapRig()
        let (_, _, body) = make(rig, settings: WearSettings(defaults: ephemeralDefaults()))
        _ = try body.save(BodyMetricsData(weightKg: 70.5, weightTsMs: 1_760_000_000_000))
        await rig.attach()
        var json = HuaweiTLV()
        json.put(0x01, string: "hw.sport.dietcal")
        json.put(0x02, string: "hw.unitedevice.weightMgr")
        json.put(0x03, int: 80_030_003)
        json.put(0x04, byte: 0)
        json.put(0x05, bytes: Array("{\"event\":5}".utf8))
        rig.session.onData(DataSyncRig.frame(0x02, json))
        await eventually { rig.watch.sent.contains { $0.command == 0x04 } }
        let dict = try DataSyncWire.parseDictionary(try XCTUnwrap(rig.watch.sent.first { $0.command == 0x04 }).tlv)
        XCTAssertEqual(dict.dictId, 10_006)
        XCTAssertEqual(dict.rows[0].values[0].key, 2004)
        XCTAssertEqual(dict.rows[0].values[0].value, BodyMetricsCodec.doubleLe(70.5))
        XCTAssertEqual(dict.rows[0].startMs, 1_760_000_000_000)
    }

    func testTheRingsCaloriesGoalIsTheDietConfigsActivityCalGoal() async throws {
        let rig = bitmapRig()
        let (diet, goals, _) = make(rig, settings: WearSettings(defaults: ephemeralDefaults()))
        _ = try await goals.set(ActivityGoalsData(calories: 420))
        rig.watch.responder = { _ in [] }
        let before = rig.watch.sent.count
        _ = try await diet.setDay(date: "2025-10-14", meals: [], goals: DietGoals(dailyKcal: 2000))
        let configs = rig.watch.sent.dropFirst(before).filter { $0.command == 0x01 }
        let diets = try configs.compactMap { c -> String? in
            let entry = try c.tlv.object(0x83).objects(0x84)[0]
            return try entry.int(0x05) == 900_300_023 ? String(decoding: try entry.bytes(0x07), as: UTF8.self) : nil
        }
        XCTAssertEqual(diets.count, 1)
        XCTAssertTrue(diets[0].contains("\"activityCalGoal\":420"), diets[0])
    }
}

final class SyncSlicesTests: XCTestCase {
    func testAShortWindowIsOneSlice() {
        let slices = syncSlices(fromSec: 900_000, nowSec: 1_000_000)
        XCTAssertEqual(slices.count, 1)
        XCTAssertEqual(slices[0].from, 900_000)
        XCTAssertEqual(slices[0].to, 1_000_000)
    }

    func testALongHistoryIsOneHeadSliceThenFortnights() {
        let now: Int64 = 100_000_000
        let slices = syncSlices(fromSec: 0, nowSec: now)
        XCTAssertEqual(slices.first?.from, 0)
        XCTAssertEqual(slices.first?.to, now - syncHeadSec)
        XCTAssertEqual(slices.last?.to, now)
        for i in 1..<slices.count { XCTAssertEqual(slices[i - 1].to, slices[i].from) }
        XCTAssertTrue(slices.dropFirst().allSatisfy { $0.to - $0.from <= syncSliceSec })
        XCTAssertEqual(slices.count, 1 + 3 + 1)
    }

    func testTheFirstSyncIsFullHistoryAndAFortnightIsTwoSlices() {
        let now: Int64 = 50_000_000
        XCTAssertEqual(syncSlices(fromSec: syncWindowStart(lastSyncSec: nil), nowSec: now).count, 1 + 3 + 1)
        XCTAssertEqual(syncSlices(fromSec: now - syncSliceSec - 10, nowSec: now).count, 2)
    }
}

final class FullHistoryTests: XCTestCase {
    func testAFullHistoryWorkoutWindowStartsAt2000AndTheIncrementalOneIsUnchanged() throws {
        let store = WorkoutStore(SyncStore(url: temporaryDatabaseURL()), address: "AA:AA:AA:AA:AA:01")
        XCTAssertEqual(try store.syncStart(fullHistory: true), 946_684_800)
        XCTAssertEqual(try store.syncStart(), Int(WorkoutStore.defaultStartSec))
        _ = try store.save(WorkoutRecord(
            number: 5, start: 1_760_000_000, end: 1_760_003_600, sportType: 1, sportName: "Running", duration: 3600, distance: 5000, calories: 321, steps: 100,
            avgHr: 135, maxHr: nil, summaryJson: "{}", points: [], complete: true
        ))
        XCTAssertEqual(try store.syncStart(), 1_760_003_601)
        XCTAssertEqual(try store.syncStart(fullHistory: true), 946_684_800)
    }

    func testSyncFullHistoryNeedsAConnectedWatch() async {
        let link = WearLink(
            events: RecordingEvents(), settings: WearSettings(defaults: ephemeralDefaults()), syncStore: SyncStore(url: temporaryDatabaseURL()),
            deviceStore: DeviceStore(secrets: MemorySecretStore()), gate: AlwaysReadyGate(), phoneModel: "x", transportFactory: { r, d in FakeTransport(.hangConnect, request: r, delegate: d) }
        )
        do {
            _ = try await link.syncActivity(fullHistory: true)
            XCTFail("expected ERR_NOT_CONNECTED")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .notConnected)
        } catch { XCTFail("\(error)") }
    }
}

final class GoalsRuntimeTests: XCTestCase {
    func testSavingGoalsAlsoMovesTheProfilesDailyStepGoal() async throws {
        let settings = WearSettings(defaults: ephemeralDefaults())
        settings.profile = UserProfileData(heightCm: 170, weightKg: 65, birthYear: 1990, sex: "male", dailyStepGoal: 7_500)
        let runtime = WearRuntime(
            settings: settings, syncStore: SyncStore(url: temporaryDatabaseURL()), deviceStore: DeviceStore(secrets: MemorySecretStore()),
            gate: AlwaysReadyGate(), environment: .init(app: "app 1 (1)", phone: "Apple test"), phoneModel: "test",
            transportFactory: { request, delegate in FakeTransport(.hangConnect, request: request, delegate: delegate) },
            goalsDefaults: ephemeralDefaults()
        )
        let sent = try await runtime.setActivityGoals(ActivityGoalsData(steps: 9_000))
        XCTAssertFalse(sent)
        XCTAssertEqual(settings.profile?.dailyStepGoal, 9_000)
        XCTAssertEqual(runtime.activityGoals.status()["steps"] as? Int, 9_000)
        XCTAssertEqual(runtime.bodyMetrics.load(), BodyMetricsData())

        // Invalid goals touch nothing, not even the profile.
        do {
            _ = try await runtime.setActivityGoals(ActivityGoalsData(steps: 5))
            XCTFail("expected ERR_INVALID_ARGUMENT")
        } catch let e as WearError { XCTAssertEqual(e.code, .invalidArgument) }
        XCTAssertEqual(settings.profile?.dailyStepGoal, 9_000)
    }
}
