import XCTest
@testable import HuaweiProtocol

/// The sensor switch packets against the real Java (Fixtures/packetsHealthSensors.json), then the translated cases of Kotlin
/// HealthSensorsTest and HeartRateZonesCalcTest, and the connect/changes plans sent over a real session to a scripted watch.
final class HealthSensorsTests: XCTestCase {
    let g = try! Golden.load("packetsHealthSensors")

    private func assertMatchesJava(_ packet: HuaweiPacket, _ c: [String: Any]) throws {
        let name = c.str("name")
        XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
        XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
        XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
        XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)
        XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name)
        XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name)
    }

    func testSwitchAndAlertRequestsMatchJava() throws {
        let requests = g.list("requests")
        XCTAssertEqual(requests.count, 17)
        for c in requests {
            let on = c.bool("enabled")
            let threshold = UInt8(truncatingIfNeeded: c.int("threshold"))
            let packet: HuaweiPacket
            switch c.str("kind") {
            case "truSleep": packet = FitnessData.TruSleep.request(on)
            case "automaticHeartRate": packet = FitnessData.EnableAutomaticHeartrate.request(on)
            case "realtimeHeartRate": packet = FitnessData.EnableRealtimeHeartRate.request(on)
            case "automaticSpo2": packet = FitnessData.EnableAutomaticSpo.request(on)
            case "highAlert": packet = FitnessData.HighHeartRateAlert.request(enabled: on, threshold: threshold)
            case "lowAlert": packet = FitnessData.LowHeartRateAlert.request(enabled: on, threshold: threshold)
            case "notifyRest": packet = FitnessData.NotifyRestHeartRate.request()
            case "workoutNotify": packet = WorkoutNotifyHeartRate.request()
            default: XCTFail("unknown kind \(c.str("kind"))"); continue
            }
            try assertMatchesJava(packet, c)
        }
    }

    func testZoneConfigRequestsMatchJava() throws {
        let zones = g.list("zones")
        XCTAssertEqual(zones.count, 11)
        for c in zones {
            let mhr = (c["mhr"] as? [NSNumber])?.map(\.intValue)
            let hrr = (c["hrr"] as? [NSNumber])?.map(\.intValue)
            let packet =
                c.bool("extended")
                ? FitnessData.HeartRateZoneConfigPacket.requestExtended(
                    warningEnable: c.bool("warning"), warningHRLimit: c.int("limit"), mhr: mhr, calculationMethod: c.int("method"), hrr: hrr)
                : FitnessData.HeartRateZoneConfigPacket.requestSimple(warningEnable: c.bool("warning"), warningHRLimit: c.int("limit"), mhr: mhr)
            try assertMatchesJava(packet, c)
        }
    }

    // MARK: HealthSensorsTest: plan and gates

    private func supporting(_ pairs: (Int, Int)...) -> (Int, Int) -> Bool { { s, c in pairs.contains { $0.0 == s && $0.1 == c } } }

    private var fit4: (Int, Int) -> Bool {
        supporting((0x07, 0x13), (0x07, 0x16), (0x07, 0x17), (0x07, 0x1c), (0x07, 0x1d), (0x07, 0x21), (0x07, 0x22), (0x07, 0x23), (0x07, 0x24), (0x07, 0x25), (0x17, 0x17))
    }

    private func labels(_ supports: (Int, Int) -> Bool, _ config: HealthSensorConfig, _ previous: HealthSensorConfig?) -> [String] {
        HealthSensors.plan(supports: supports, config: config, previous: previous).map(\.label)
    }

    func testConnectPlanSendsEverythingSupportedButAlertsThatAreOff() {
        XCTAssertEqual(
            labels(fit4, HealthSensorConfig(), nil),
            ["NotifyHeartRate", "NotifyRestHeartRate", "TruSleep on", "AutomaticHeartRate on", "AutomaticSpo2 on"]
        )
    }

    func testConnectPlanIncludesAlertsThatAreOn() {
        let config = HealthSensorConfig(highHeartRateAlert: 140, lowHeartRateAlert: 50)
        XCTAssertEqual(Array(labels(fit4, config, nil).suffix(2)), ["HighHeartRateAlert 140 bpm", "LowHeartRateAlert 50 bpm"])
    }

    func testPlanFollowsTheSavedSwitches() {
        let off = HealthSensorConfig(automaticHeartRate: false, automaticSpo2: false, truSleep: false)
        XCTAssertEqual(labels(fit4, off, nil), ["NotifyHeartRate", "NotifyRestHeartRate", "TruSleep off", "AutomaticHeartRate off", "AutomaticSpo2 off"])
    }

    func testPlanSkipsWhatTheWatchDoesNotList() {
        XCTAssertEqual(labels(supporting((0x07, 0x17)), HealthSensorConfig(), nil), ["AutomaticHeartRate on"])
        XCTAssertEqual(labels(supporting(), HealthSensorConfig(), nil), [])
    }

    func testChangePlanSendsOnlyWhatChangedAndAlertOff() {
        let before = HealthSensorConfig(highHeartRateAlert: 140)
        var after = before
        after.automaticSpo2 = false
        after.highHeartRateAlert = 0
        XCTAssertEqual(labels(fit4, after, before), ["AutomaticSpo2 off", "HighHeartRateAlert off"])
        XCTAssertEqual(labels(fit4, before, before), [])
    }

    func testSupportGatesFollowGbHuaweiState() {
        let support = HealthSensorSupport.of(fit4)
        XCTAssertTrue(support.heartRate && support.realtimeHeartRate && support.spo2 && support.truSleep && support.highHeartRateAlert && support.lowHeartRateAlert)
        let none = HealthSensorSupport.of(supporting((0x07, 0x01)))
        XCTAssertFalse(none.heartRate)
        XCTAssertFalse(none.realtimeHeartRate)
        XCTAssertEqual(Set(support.toJS().keys), ["heartRate", "realtimeHeartRate", "spo2", "truSleep", "highHeartRateAlert", "lowHeartRateAlert"])
    }

    func testValidationOfAlertRanges() {
        XCTAssertNil(HealthSensorConfig().validationError())
        XCTAssertNil(HealthSensorConfig(highHeartRateAlert: 100, lowHeartRateAlert: 40).validationError())
        XCTAssertNil(HealthSensorConfig(highHeartRateAlert: 150, lowHeartRateAlert: 50).validationError())
        XCTAssertNotNil(HealthSensorConfig(highHeartRateAlert: 99).validationError())
        XCTAssertNotNil(HealthSensorConfig(highHeartRateAlert: 151).validationError())
        XCTAssertNotNil(HealthSensorConfig(lowHeartRateAlert: 39).validationError())
        XCTAssertNotNil(HealthSensorConfig(lowHeartRateAlert: 51).validationError())
    }

    // MARK: realtime packets

    private func tlv(_ build: (inout HuaweiTLV) -> Void) -> HuaweiTLV {
        var t = HuaweiTLV()
        build(&t)
        return (try? HuaweiTLV(parsing: t.serialize())) ?? t
    }

    func testRealtimeReadingIsTheFirstSingleByteValueInRange() {
        XCTAssertEqual(HealthSensors.decodeRealtime(tlv { $0.put(0x01, byte: 72) }), 72)
        let nested = tlv {
            var inner = HuaweiTLV()
            inner.put(0x01, bool: true)
            inner.put(0x02, byte: 255)
            inner.put(0x03, byte: 88)
            $0.put(0x81, tlv: inner)
        }
        XCTAssertEqual(HealthSensors.decodeRealtime(nested), 88)
    }

    func testRealtimePacketWithoutReadingDecodesToNil() {
        XCTAssertNil(HealthSensors.decodeRealtime(nil))
        XCTAssertNil(HealthSensors.decodeRealtime(tlv { $0.put(0x01, bool: true) }))
        XCTAssertNil(HealthSensors.decodeRealtime(tlv { $0.put(0x02, int: 0x1234) }))
    }

    func testNoticeTakesTheLastReadingInRange() {
        func report(_ bpms: [UInt8]) -> HuaweiTLV {
            tlv {
                var outer = HuaweiTLV()
                for b in bpms {
                    var inner = HuaweiTLV()
                    inner.put(0x03, byte: b)
                    outer.put(0x82, tlv: inner)
                }
                $0.put(0x81, tlv: outer)
            }
        }
        XCTAssertEqual(HealthSensors.decodeNotice(report([70, 72, 74])), 74)
        XCTAssertEqual(HealthSensors.decodeNotice(report([70, 10, 255])), 70)
        XCTAssertNil(HealthSensors.decodeNotice(report([10])))
        XCTAssertNil(HealthSensors.decodeNotice(tlv { $0.put(0x01, byte: 70) }))
    }

    // MARK: HeartRateZonesCalcTest

    private func z(_ c: HeartRateZonesCalc.Config, _ m: HeartRateZonesCalc.Method) -> [Int] {
        let zones = c.byMethod(m)!
        return [zones.zone1, zones.zone2, zones.zone3, zones.zone4, zones.zone5, zones.threshold]
    }

    private let track35 = HeartRateZonesCalc.deviceConfig(age: 35, track: true, simpleCommand: false, extended: false)

    private func posture(_ p: HeartRateZonesCalc.Posture) -> HeartRateZonesCalc.Config { track35.first { $0.posture == p }! }

    func testUprightZonesForAge35() {
        let c = posture(.upright)
        XCTAssertEqual(c.warningHRLimit, 185)
        XCTAssertTrue(c.warningEnable)
        XCTAssertEqual(z(c, .mhr), [93, 111, 130, 148, 167, 185])
        XCTAssertEqual(z(c, .hrr), [134, 153, 165, 170, 179, 185])
        XCTAssertEqual(z(c, .lthr), [111, 133, 148, 161, 169, 166])
    }

    func testOtherPosturesApplyTheirCorrection() {
        let sitting = posture(.sitting)
        XCTAssertEqual(z(sitting, .mhr), [90, 107, 125, 143, 161, 179])
        XCTAssertEqual(z(sitting, .hrr), [130, 148, 160, 165, 173, 179])
        XCTAssertNil(sitting.byMethod(.lthr))
        XCTAssertEqual(z(posture(.swimming), .mhr), [88, 105, 123, 140, 158, 175])
        XCTAssertEqual(z(posture(.swimming), .hrr), [128, 145, 157, 161, 169, 175])
        XCTAssertEqual(z(posture(.other), .mhr), [90, 108, 126, 144, 162, 180])
        XCTAssertEqual(z(posture(.other), .hrr), [131, 149, 161, 166, 174, 180])
        XCTAssertEqual(posture(.other).warningHRLimit, 185)
    }

    func testWithoutTrackOnlyUprightMhrAndExtendedHrr() {
        let simple = HeartRateZonesCalc.deviceConfig(age: 35, track: false, simpleCommand: true, extended: false)
        XCTAssertEqual(simple.map(\.posture), [.upright])
        XCTAssertEqual(simple[0].zones.map(\.method), [.mhr])
        let extended = HeartRateZonesCalc.deviceConfig(age: 35, track: false, simpleCommand: true, extended: true)
        XCTAssertEqual(extended[0].zones.map(\.method), [.mhr, .hrr])
        XCTAssertEqual(z(extended[0], .mhr), [93, 111, 130, 148, 167, 185])
        XCTAssertTrue(HeartRateZonesCalc.deviceConfig(age: 35, track: false, simpleCommand: false, extended: false).isEmpty)
    }

    func testTrackTlvForAge35() throws {
        let tlv = try XCTUnwrap(HeartRateZonesCalc.trackTlv(track35))
        let expected: [(Int, Int)] = [
            (0x02, 93), (0x03, 111), (0x04, 130), (0x05, 148), (0x06, 167), (0x07, 185), (0x08, 1), (0x09, 185), (0x0a, 0), (0x0b, 185),
            (0x0c, 60), (0x0d, 134), (0x0e, 153), (0x0f, 165), (0x10, 170), (0x11, 179),
            (0x3f, 166), (0x40, 169), (0x41, 161), (0x42, 148), (0x43, 133), (0x44, 111),
            (0x12, 1), (0x13, 0), (0x14, 185), (0x15, 90), (0x16, 107), (0x17, 125), (0x18, 143), (0x19, 161), (0x1a, 179),
            (0x1b, 60), (0x1c, 130), (0x1d, 148), (0x1e, 160), (0x1f, 165), (0x20, 173),
            (0x21, 1), (0x22, 0), (0x23, 185), (0x24, 88), (0x25, 105), (0x26, 123), (0x27, 140), (0x28, 158), (0x29, 175),
            (0x2a, 60), (0x2b, 128), (0x2c, 145), (0x2d, 157), (0x2e, 161), (0x2f, 169),
            (0x30, 1), (0x31, 0), (0x32, 185), (0x33, 90), (0x34, 108), (0x35, 126), (0x36, 144), (0x37, 162), (0x38, 180),
            (0x39, 60), (0x3a, 131), (0x3b, 149), (0x3c, 161), (0x3d, 166), (0x3e, 174),
        ]
        XCTAssertEqual(tlv.map { "\($0.tag):\($0.value)" }, expected.map { "\($0.0):\($0.1)" })
    }

    // MARK: user-configured zones (HeartRateZonesCalcTest.user*)

    private let userMax = HeartRateZonesCalc.UserZones(
        method: .mhr, maxHr: 190, restingHr: 55, zones: [95, 114, 133, 152, 171], warningEnabled: true, warningLimit: 190
    )
    private let userHrr = HeartRateZonesCalc.UserZones(
        method: .hrr, maxHr: 190, restingHr: 55, zones: [100, 120, 140, 160, 180], warningEnabled: false, warningLimit: 200
    )

    private func userTrack(_ user: HeartRateZonesCalc.UserZones) -> [HeartRateZonesCalc.Config] {
        HeartRateZonesCalc.deviceConfig(age: 35, track: true, simpleCommand: false, extended: false, user: user)
    }

    private func text(_ tlv: [(tag: Int, value: Int)]) -> [String] { tlv.map { "\($0.tag):\($0.value)" } }

    func testUserZonesForMethodMaxGiveTheExactTrackTlv() throws {
        let tlv = try XCTUnwrap(HeartRateZonesCalc.trackTlv(userTrack(userMax)))
        let expected: [(Int, Int)] = [
            (0x02, 95), (0x03, 114), (0x04, 133), (0x05, 152), (0x06, 171), (0x07, 190), (0x08, 1), (0x09, 190), (0x0a, 0), (0x0b, 190),
            (0x0c, 55), (0x0d, 135), (0x0e, 155), (0x0f, 168), (0x10, 174), (0x11, 183),
            (0x3f, 170), (0x40, 173), (0x41, 165), (0x42, 151), (0x43, 136), (0x44, 114),
            (0x12, 1), (0x13, 0), (0x14, 190), (0x15, 95), (0x16, 114), (0x17, 133), (0x18, 152), (0x19, 171), (0x1a, 190),
            (0x1b, 55), (0x1c, 135), (0x1d, 155), (0x1e, 168), (0x1f, 174), (0x20, 183),
            (0x21, 1), (0x22, 0), (0x23, 190), (0x24, 95), (0x25, 114), (0x26, 133), (0x27, 152), (0x28, 171), (0x29, 190),
            (0x2a, 55), (0x2b, 135), (0x2c, 155), (0x2d, 168), (0x2e, 174), (0x2f, 183),
            (0x30, 1), (0x31, 0), (0x32, 190), (0x33, 95), (0x34, 114), (0x35, 133), (0x36, 152), (0x37, 171), (0x38, 190),
            (0x39, 55), (0x3a, 135), (0x3b, 155), (0x3c, 168), (0x3d, 174), (0x3e, 183),
        ]
        XCTAssertEqual(text(tlv), expected.map { "\($0.0):\($0.1)" })
    }

    func testUserZonesForMethodHrrGiveTheExactTrackTlv() throws {
        let tlv = try XCTUnwrap(HeartRateZonesCalc.trackTlv(userTrack(userHrr)))
        let expected: [(Int, Int)] = [
            (0x02, 95), (0x03, 114), (0x04, 133), (0x05, 152), (0x06, 171), (0x07, 190), (0x08, 0), (0x09, 200), (0x0a, 1), (0x0b, 190),
            (0x0c, 55), (0x0d, 100), (0x0e, 120), (0x0f, 140), (0x10, 160), (0x11, 180),
            (0x3f, 170), (0x40, 173), (0x41, 165), (0x42, 151), (0x43, 136), (0x44, 114),
            (0x12, 0), (0x13, 1), (0x14, 200), (0x15, 95), (0x16, 114), (0x17, 133), (0x18, 152), (0x19, 171), (0x1a, 190),
            (0x1b, 55), (0x1c, 100), (0x1d, 120), (0x1e, 140), (0x1f, 160), (0x20, 180),
            (0x21, 0), (0x22, 1), (0x23, 200), (0x24, 95), (0x25, 114), (0x26, 133), (0x27, 152), (0x28, 171), (0x29, 190),
            (0x2a, 55), (0x2b, 100), (0x2c, 120), (0x2d, 140), (0x2e, 160), (0x2f, 180),
            (0x30, 0), (0x31, 1), (0x32, 200), (0x33, 95), (0x34, 114), (0x35, 133), (0x36, 152), (0x37, 171), (0x38, 190),
            (0x39, 55), (0x3a, 100), (0x3b, 120), (0x3c, 140), (0x3d, 160), (0x3e, 180),
        ]
        XCTAssertEqual(text(tlv), expected.map { "\($0.0):\($0.1)" })
    }

    func testAllFourPosturesCarryTheUserValuesWithoutCorrection() {
        let configs = userTrack(userMax)
        XCTAssertEqual(configs.map(\.posture), [.upright, .sitting, .swimming, .other])
        for config in configs {
            XCTAssertEqual(config.warningHRLimit, 190)
            XCTAssertTrue(config.warningEnable)
            XCTAssertEqual(config.currentMethod, .mhr)
            XCTAssertEqual(z(config, .mhr), [95, 114, 133, 152, 171, 190])
            XCTAssertTrue(config.zones.allSatisfy { $0.resting == 55 })
            XCTAssertTrue(config.isValid())
        }
        XCTAssertEqual(configs[0].zones.map(\.method), [.mhr, .hrr, .lthr])
        XCTAssertEqual(configs[1].zones.map(\.method), [.mhr, .hrr])
    }

    func testTheOtherMethodKeepsTheDefaultsForTheUsersMaxAndResting() {
        let upright = userTrack(userMax)[0]
        XCTAssertEqual(z(upright, .hrr), [135, 155, 168, 174, 183, 190])
        XCTAssertEqual(z(upright, .lthr), [114, 136, 151, 165, 173, 170])
        let hrr = userTrack(userHrr)[0]
        XCTAssertEqual(hrr.currentMethod, .hrr)
        XCTAssertFalse(hrr.warningEnable)
        XCTAssertEqual(hrr.warningHRLimit, 200)
        XCTAssertEqual(z(hrr, .mhr), [95, 114, 133, 152, 171, 190])
        XCTAssertEqual(z(hrr, .hrr), [100, 120, 140, 160, 180, 190])
        XCTAssertEqual(hrr.byMethod(.hrr)?.resting, 55)
    }

    func testSimpleRouteSendsTheUsersEffectiveZonesWhateverTheMethod() throws {
        for (user, expected) in [(userMax, [95, 114, 133, 152, 171, 190]), (userHrr, [100, 120, 140, 160, 180, 190])] {
            let simple = HeartRateZonesCalc.deviceConfig(age: 35, track: false, simpleCommand: true, extended: false, user: user)
            XCTAssertEqual(simple.map(\.posture), [.upright])
            XCTAssertEqual(simple[0].zones.map(\.method), [.mhr])
            XCTAssertEqual(simple[0].byMethod(.mhr)?.asArray(), expected)
            XCTAssertEqual(simple[0].warningEnable, user.warningEnabled)
            XCTAssertEqual(simple[0].warningHRLimit, user.warningLimit)
        }
    }

    func testExtendedRouteHasTheMhrAndHrrSetsAndTheUsersMethod() throws {
        let max = HeartRateZonesCalc.deviceConfig(age: 35, track: false, simpleCommand: true, extended: true, user: userMax)[0]
        XCTAssertEqual(max.currentMethod, .mhr)
        XCTAssertEqual(max.byMethod(.mhr)?.asArray(), [95, 114, 133, 152, 171, 190])
        XCTAssertEqual(max.byMethod(.hrr)?.asArray(), [135, 155, 168, 174, 183, 55])
        let hrr = HeartRateZonesCalc.deviceConfig(age: 35, track: false, simpleCommand: true, extended: true, user: userHrr)[0]
        XCTAssertEqual(hrr.currentMethod, .hrr)
        XCTAssertEqual(hrr.byMethod(.mhr)?.asArray(), [95, 114, 133, 152, 171, 190])
        XCTAssertEqual(hrr.byMethod(.hrr)?.asArray(), [100, 120, 140, 160, 180, 55])
        XCTAssertTrue(HeartRateZonesCalc.deviceConfig(age: 35, track: false, simpleCommand: false, extended: false, user: userMax).isEmpty)
    }

    func testWithoutUserZonesTheDefaultsAreUnchanged() throws {
        XCTAssertEqual(HeartRateZonesCalc.deviceConfig(age: 35, track: true, simpleCommand: false, extended: false, user: nil), track35)
        let simple = HeartRateZonesCalc.deviceConfig(age: 35, track: false, simpleCommand: true, extended: true, user: nil)
        XCTAssertEqual(simple, HeartRateZonesCalc.deviceConfig(age: 35, track: false, simpleCommand: true, extended: true))
        XCTAssertEqual(simple[0].warningHRLimit, 185)
    }

    func testUserZonesValidationRejectsValuesOutsideTheirRanges() {
        XCTAssertNil(userMax.validationError())
        XCTAssertNil(userHrr.validationError())
        func bad(_ change: (inout HeartRateZonesCalc.UserZones) -> Void, _ why: String, file: StaticString = #filePath, line: UInt = #line) {
            var copy = userMax
            change(&copy)
            XCTAssertNotNil(copy.validationError(), why, file: file, line: line)
        }
        bad({ $0.maxHr = 99 }, "max below 100")
        bad({ $0.maxHr = 220; $0.zones = [95, 114, 133, 152, 171] }, "max above 219")
        bad({ $0.restingHr = 29 }, "rest below 30")
        bad({ $0.restingHr = 111 }, "rest above 110")
        bad({ $0.maxHr = 100; $0.restingHr = 100; $0.zones = [40, 50, 60, 70, 80] }, "rest not below max")
        bad({ $0.zones = [95, 114, 133, 152] }, "four zones")
        bad({ $0.zones = [95, 114, 133, 152, 171, 180] }, "six zones")
        bad({ $0.zones = [95, 114, 114, 152, 171] }, "not strictly rising")
        bad({ $0.zones = [29, 114, 133, 152, 171] }, "first zone below 30")
        bad({ $0.zones = [95, 114, 133, 152, 190] }, "last zone not below max")
        bad({ $0.warningLimit = 99 }, "limit below 100")
        bad({ $0.warningLimit = 220 }, "limit above 219")
        bad({ $0.method = .lthr }, "method lthr")
    }

    func testZonesOutsideTheByteRangeAreRefusedLikeGb() {
        XCTAssertNil(HeartRateZonesCalc.trackTlv(HeartRateZonesCalc.deviceConfig(age: 0, track: true, simpleCommand: false, extended: false)))
    }

    func testAgeFromTheProfileOrTheDefault() {
        let profile = UserProfileData(heightCm: 175, weightKg: 70, birthYear: 1990, sex: "male", dailyStepGoal: 8000)
        let now = Date(timeIntervalSince1970: 1_800_000_000)  // 2027
        XCTAssertEqual(HeartRateZonesSync.age(profile: profile, now: now), 37)
        XCTAssertEqual(HeartRateZonesSync.age(profile: nil), 35)
    }

    // MARK: over a session

    private func caps(_ commands: [Int: Bytes], expand: [Int] = []) -> DeviceCaps {
        let caps = DeviceCaps()
        caps.supportedCommands = commands
        if !expand.isEmpty {
            var map = Bytes(repeating: 0, count: 32)
            for bit in expand { map[bit / 8] |= UInt8(1 << (bit % 8)) }
            caps.expandCapabilities = map
        }
        return caps
    }

    func testSendAcknowledgesEachRequestAndLogsOnesTheWatchIgnores() async throws {
        let h = SleepFilesHarness()
        h.watch.responder = { r in
            // The watch answers everything except 07/24 (SpO2).
            guard !(r.service == 0x07 && r.command == 0x24) else { return [] }
            return [SleepFilesFakeWatch.tlvFrame(service: r.service, command: r.command, HuaweiTLV())]
        }
        let plan = HealthSensors.plan(supports: fit4, config: HealthSensorConfig(), previous: nil)
        let acknowledged = try await HealthSensors.send(session: h.session, log: h.log.sink, plan: plan, timeoutMs: 100)
        XCTAssertEqual(plan.count, 5)
        XCTAssertEqual(acknowledged, 4)
        XCTAssertEqual(h.watch.requests.map { "\($0.service)/\($0.command)" }, ["23/23", "7/35", "7/22", "7/23", "7/36"])
        XCTAssertTrue(h.watch.requests.allSatisfy { $0.encrypted })
        XCTAssertTrue(h.log.contains("AutomaticHeartRate on: acknowledged"))
        XCTAssertTrue(h.log.containsError("AutomaticSpo2 on: sent, no reply"))
        // 07/17 carries the switch.
        let heartRate = try XCTUnwrap(h.watch.requests.first { $0.service == 0x07 && $0.command == 0x17 })
        XCTAssertEqual(try heartRate.tlv.bool(0x01), true)
    }

    func testALostLinkAbortsTheSend() async {
        let h = SleepFilesHarness()
        await h.session.close(WearError(.disconnected, "gone"))
        do {
            _ = try await HealthSensors.send(session: h.session, log: h.log.sink, plan: HealthSensors.plan(supports: fit4, config: HealthSensorConfig(), previous: nil))
            XCTFail("kept sending on a closed session")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .disconnected)
        } catch { XCTFail("\(error)") }
    }

    func testZonesGoOverFitnessDataForANonTrackWatch() async throws {
        let h = SleepFilesHarness()
        h.watch.responder = { r in [SleepFilesFakeWatch.tlvFrame(service: r.service, command: r.command, HuaweiTLV())] }
        let c = caps([0x07: [0x13, 0x21]])
        XCTAssertTrue(HeartRateZonesSync.capsLine(c).contains("branch=FitnessData 07/21"))
        let sentZones = try await HeartRateZonesSync.sendFitnessData(session: h.session, caps: c, log: h.log.sink, age: 35)
        XCTAssertTrue(sentZones)
        let sent = try XCTUnwrap(h.watch.requests.first)
        XCTAssertEqual(sent.command, 0x21)
        let sub = try sent.tlv.object(0x81)
        XCTAssertEqual(try sub.bool(0x08), true)
        XCTAssertEqual(try sub.byte(0x09), Int8(truncatingIfNeeded: 185))
        XCTAssertEqual(try sub.byte(0x07), Int8(truncatingIfNeeded: 185))
        XCTAssertEqual(try sub.byte(0x0c), 60)
        XCTAssertTrue(h.log.contains("HR zones: sent 07/21 for age 35, MHR 93/111/130/148/167 of 185 warning 185, HRR 134/153/165/170/179 resting 60"))
    }

    func testZonesUseTheSimpleCommandWithoutTheExtendedOne() async throws {
        let h = SleepFilesHarness()
        h.watch.responder = { r in [SleepFilesFakeWatch.tlvFrame(service: r.service, command: r.command, HuaweiTLV())] }
        let sentSimple = try await HeartRateZonesSync.sendFitnessData(session: h.session, caps: caps([0x07: [0x13]]), log: h.log.sink, age: 35)
        XCTAssertTrue(sentSimple)
        XCTAssertEqual(h.watch.requests.map(\.command), [0x13])
        XCTAssertFalse(try h.watch.requests[0].tlv.object(0x81).contains(0x0c), "no HRR in the simple command")
    }

    func testZonesAreNotSentToTrackWatchesOrWatchesWithoutTheCommand() async throws {
        let h = SleepFilesHarness()
        let track = try await HeartRateZonesSync.sendFitnessData(session: h.session, caps: caps([0x07: [0x13]], expand: [0x36]), log: h.log.sink, age: 35)
        let without = try await HeartRateZonesSync.sendFitnessData(session: h.session, caps: caps([0x07: [0x17]]), log: h.log.sink, age: 35)
        XCTAssertFalse(track)
        XCTAssertFalse(without)
        XCTAssertTrue(h.watch.requests.isEmpty)
        XCTAssertTrue(HeartRateZonesSync.capsLine(caps([:], expand: [0x36])).contains("zones not sent"))
        XCTAssertTrue(HeartRateZonesSync.capsLine(caps([:])).contains("branch=none"))
    }
}
