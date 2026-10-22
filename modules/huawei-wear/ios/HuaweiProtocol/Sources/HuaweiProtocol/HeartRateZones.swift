// Port of HeartRateZonesCalc.kt and HeartRateZonesSync.kt (GB HuaweiHeartRateZones, HuaweiHeartRateZonesSpec, HeartRateZones*, the TLV of
// HuaweiP2PTrackService.getHRZonesData and SendHeartRateZonesConfig). Without a zone configuration the watch's workout screen shows the heart
// rate but no zone, so JoyoFit sends GB's default zones for the profile age, or the zones the user configured in the app (`UserZones`, one set
// for all four postures, no posture correction).
import Foundation

public enum HeartRateZonesCalc {
    public static let maximumHeartRate = 220
    public static let defaultRestHeartRate = 60

    /// `huaweiType` is HuaweiHeartRateZonesSpec.HUAWEI_TYPE_*, `hrCorrection` its getHRCorrection.
    public enum Posture: CaseIterable, Sendable {
        case upright, sitting, swimming, other

        public var huaweiType: Int {
            switch self {
            case .upright: return 1
            case .sitting: return 2
            case .swimming: return 3
            case .other: return 4
            }
        }

        public var hrCorrection: Int {
            switch self {
            case .upright: return 0
            case .sitting: return 6
            case .swimming: return 10
            case .other: return 5
            }
        }
    }

    /// `huaweiCode` is HuaweiHeartRateZonesSpec.HUAWEI_CALCULATE_METHOD_*.
    public enum Method: Sendable {
        case mhr, hrr, lthr

        public var huaweiCode: Int {
            switch self {
            case .mhr: return 0
            case .hrr: return 1
            case .lthr: return 3
            }
        }
    }

    public struct Zones: Equatable, Sendable {
        public let method: Method
        public let threshold: Int
        public let resting: Int
        public let zone1: Int
        public let zone2: Int
        public let zone3: Int
        public let zone4: Int
        public let zone5: Int

        /// HeartRateZones.isValid.
        public func isValid() -> Bool {
            checkValue(threshold) && checkValue(resting) && checkValue(zone1) && checkValue(zone2) && checkValue(zone3) && checkValue(zone4)
                && checkValue(zone5) && zone1 <= zone2 && zone2 <= zone3 && zone3 <= zone4 && zone4 <= zone5
        }

        /// HeartRateZones.hasValidData.
        public func hasValidData() -> Bool {
            let valid = zone1 > 0 && zone2 > 0 && zone3 > 0 && zone4 > 0 && zone5 > 0 && threshold > 0
            return method == .hrr ? valid && resting > 0 : valid
        }

        /// `{zone1..zone5, threshold-or-resting}` as `FitnessData.HeartRateZoneConfigPacket` takes them.
        public func asArray() -> [Int] { [zone1, zone2, zone3, zone4, zone5, method == .hrr ? resting : threshold] }
    }

    public struct Config: Equatable, Sendable {
        public let posture: Posture
        public let warningEnable: Bool
        public let warningHRLimit: Int
        public let currentMethod: Method
        public let zones: [Zones]

        public func byMethod(_ method: Method) -> Zones? { zones.first { $0.method == method } }

        /// HeartRateZonesConfig.isValid.
        public func isValid() -> Bool { checkValue(warningHRLimit) && warningHRLimit > 0 && !zones.isEmpty && zones.allSatisfy { $0.isValid() } }
    }

    public static func checkValue(_ v: Int) -> Bool { v >= 0 && v < maximumHeartRate }

    /// The zones the user configured in the app (`HeartRateZonesConfig` in HuaweiWear.types.ts): `method` is `.mhr` (max) or `.hrr`.
    public struct UserZones: Equatable, Sendable {
        public static let maxHrRange = 100...219
        public static let restingHrRange = 30...110
        public static let warningLimitRange = 100...219
        public static let zoneCount = 5
        public static let minZone = 30

        public var method: Method
        public var maxHr: Int
        public var restingHr: Int
        /// The lowest bpm of zones 1 to 5.
        public var zones: [Int]
        public var warningEnabled: Bool
        public var warningLimit: Int

        public init(method: Method, maxHr: Int, restingHr: Int, zones: [Int], warningEnabled: Bool, warningLimit: Int) {
            self.method = method
            self.maxHr = maxHr
            self.restingHr = restingHr
            self.zones = zones
            self.warningEnabled = warningEnabled
            self.warningLimit = warningLimit
        }

        /// The message for the first value outside its range, nil when the configuration is usable.
        public func validationError() -> String? {
            if method != .mhr && method != .hrr { return "Heart-rate zone method must be max or hrr" }
            if !Self.maxHrRange.contains(maxHr) { return "Maximum heart rate must be \(Self.maxHrRange.lowerBound) to \(Self.maxHrRange.upperBound) bpm" }
            if !Self.restingHrRange.contains(restingHr) {
                return "Resting heart rate must be \(Self.restingHrRange.lowerBound) to \(Self.restingHrRange.upperBound) bpm"
            }
            if restingHr >= maxHr { return "Resting heart rate must be below the maximum heart rate" }
            if zones.count != Self.zoneCount { return "Heart-rate zones need \(Self.zoneCount) limits, got \(zones.count)" }
            if zones[0] < Self.minZone { return "The lowest zone limit must be at least \(Self.minZone) bpm" }
            if zip(zones, zones.dropFirst()).contains(where: { $0 >= $1 }) { return "The zone limits must rise strictly from zone 1 to zone 5" }
            if zones[Self.zoneCount - 1] >= maxHr { return "The highest zone limit must be below the maximum heart rate" }
            if !Self.warningLimitRange.contains(warningLimit) {
                return "Heart-rate limit must be \(Self.warningLimitRange.lowerBound) to \(Self.warningLimitRange.upperBound) bpm"
            }
            return nil
        }

        /// The zone limits as `z1/z2/z3/z4/z5` for the log.
        public var zonesText: String { zones.map(String.init).joined(separator: "/") }

        /// A one-line description for the log.
        public var logText: String {
            "method \(method == .hrr ? "hrr" : "max"), max \(maxHr), rest \(restingHr), zones \(zonesText), warning \(warningEnabled ? "on" : "off") \(warningLimit)"
        }
    }

    /// `Math.round(((float) (x * pct)) / 100.0f)`, the float arithmetic of HuaweiHeartRateZones.
    private static func pct(_ x: Int, _ pct: Int) -> Int { Int(PacketsJava.round(Float(x * pct) / 100.0)) }

    /// HuaweiHeartRateZones(method, HRThreshold) with the default resting rate: its constructor ends in `reset()`.
    public static func zones(_ method: Method, threshold: Int, resting: Int = defaultRestHeartRate) -> Zones {
        switch method {
        case .mhr:
            return Zones(
                method: method, threshold: threshold, resting: resting, zone1: pct(threshold, 50), zone2: pct(threshold, 60),
                zone3: pct(threshold, 70), zone4: pct(threshold, 80), zone5: pct(threshold, 90)
            )
        case .hrr:
            let calc = threshold - resting
            return Zones(
                method: method, threshold: threshold, resting: resting, zone1: pct(calc, 59) + resting, zone2: pct(calc, 74) + resting,
                zone3: pct(calc, 84) + resting, zone4: pct(calc, 88) + resting, zone5: pct(calc, 95) + resting
            )
        case .lthr:
            let lthr = Int(PacketsJava.round(Float(resting) + Float((threshold - resting) * 85) / 100.0))
            return Zones(
                method: method, threshold: lthr, resting: resting, zone1: pct(lthr, 67), zone2: pct(lthr, 80), zone3: pct(lthr, 89),
                zone4: pct(lthr, 97), zone5: pct(lthr, 102)
            )
        }
    }

    /// The methods GB builds per posture (getUprightZone/getSittingZone/...): upright also LTHR.
    private static func methods(for posture: Posture) -> [Method] { posture == .upright ? [.mhr, .hrr, .lthr] : [.mhr, .hrr] }

    /// All postures carry the user's values, no posture correction: the chosen method gets the user's zones, the other method (and LTHR)
    /// the defaults for the same maximum and resting heart rate.
    private static func config(_ posture: Posture, user: UserZones, methods: [Method]) -> Config {
        Config(
            posture: posture, warningEnable: user.warningEnabled, warningHRLimit: user.warningLimit, currentMethod: user.method,
            zones: methods.map { method in
                guard method == user.method else { return zones(method, threshold: user.maxHr, resting: user.restingHr) }
                return Zones(
                    method: method, threshold: user.maxHr, resting: user.restingHr, zone1: user.zones[0], zone2: user.zones[1],
                    zone3: user.zones[2], zone4: user.zones[3], zone5: user.zones[4]
                )
            }
        )
    }

    private static func config(_ posture: Posture, age: Int, methods: [Method]) -> Config {
        let threshold = (maximumHeartRate - age) - posture.hrCorrection
        return Config(
            posture: posture, warningEnable: true, warningHRLimit: maximumHeartRate - age, currentMethod: .mhr,
            zones: methods.map { zones($0, threshold: threshold) }
        )
    }

    /// HuaweiHeartRateZonesSpec.getDeviceConfig for `age`: with Track all four postures; without Track but with the zone command only
    /// upright (MHR, plus HRR when `extended`); otherwise nothing. With `user`, `age` is not used: every posture carries the user's values, and
    /// the simple 07/13 packet, which only has an MHR set, gets the user's effective zones there whatever the method.
    public static func deviceConfig(age: Int, track: Bool, simpleCommand: Bool, extended: Bool, user: UserZones? = nil) -> [Config] {
        if let user, user.zones.count == UserZones.zoneCount {
            if !track && simpleCommand {
                if extended { return [config(.upright, user: user, methods: [.mhr, .hrr])] }
                let effective = Zones(
                    method: .mhr, threshold: user.maxHr, resting: user.restingHr, zone1: user.zones[0], zone2: user.zones[1],
                    zone3: user.zones[2], zone4: user.zones[3], zone5: user.zones[4]
                )
                return [Config(posture: .upright, warningEnable: user.warningEnabled, warningHRLimit: user.warningLimit, currentMethod: .mhr, zones: [effective])]
            }
            if !track { return [] }
            return Posture.allCases.map { config($0, user: user, methods: methods(for: $0)) }
        }
        if !track && simpleCommand { return [config(.upright, age: age, methods: extended ? [.mhr, .hrr] : [.mhr])] }
        if !track { return [] }
        return Posture.allCases.map { config($0, age: age, methods: methods(for: $0)) }
    }

    /// HuaweiP2PTrackService.getHRZonesData as (tag, single byte value) pairs in GB's order, or nil when GB would refuse to send (an invalid
    /// config, e.g. an age that puts a value outside 0..219).
    public static func trackTlv(_ configs: [Config]) -> [(tag: Int, value: Int)]? {
        func cfg(_ p: Posture) -> Config? { configs.first { $0.posture == p } }
        guard let upright = cfg(.upright), let sitting = cfg(.sitting), let swimming = cfg(.swimming), let other = cfg(.other) else { return nil }
        guard upright.isValid(), sitting.isValid(), swimming.isValid(), other.isValid() else { return nil }
        guard let uMhr = upright.byMethod(.mhr), let uHrr = upright.byMethod(.hrr), let uLthr = upright.byMethod(.lthr),
            let sMhr = sitting.byMethod(.mhr), let sHrr = sitting.byMethod(.hrr), let wMhr = swimming.byMethod(.mhr),
            let wHrr = swimming.byMethod(.hrr), let oMhr = other.byMethod(.mhr), let oHrr = other.byMethod(.hrr)
        else { return nil }

        var out: [(tag: Int, value: Int)] = []
        func put(_ tag: Int, _ v: Int) { out.append((tag, v & 0xFF)) }
        func flag(_ c: Config) -> Int { c.warningEnable ? 1 : 0 }

        if uMhr.hasValidData() {
            put(0x2, uMhr.zone1); put(0x3, uMhr.zone2); put(0x4, uMhr.zone3); put(0x5, uMhr.zone4); put(0x6, uMhr.zone5)
            put(0x7, uMhr.threshold); put(0x8, flag(upright)); put(0x9, upright.warningHRLimit)
            put(0xa, upright.currentMethod.huaweiCode); put(0xb, uMhr.threshold)
        }
        put(0xc, uHrr.resting)
        if uHrr.hasValidData() {
            put(0xd, uHrr.zone1); put(0xe, uHrr.zone2); put(0xf, uHrr.zone3); put(0x10, uHrr.zone4); put(0x11, uHrr.zone5)
        }
        if uLthr.hasValidData() {
            put(0x3f, uLthr.threshold); put(0x40, uLthr.zone5); put(0x41, uLthr.zone4); put(0x42, uLthr.zone3); put(0x43, uLthr.zone2); put(0x44, uLthr.zone1)
        }
        if sMhr.hasValidData() {
            put(0x12, flag(sitting)); put(0x13, sitting.currentMethod.huaweiCode); put(0x14, sitting.warningHRLimit)
            put(0x15, sMhr.zone1); put(0x16, sMhr.zone2); put(0x17, sMhr.zone3); put(0x18, sMhr.zone4); put(0x19, sMhr.zone5); put(0x1a, sMhr.threshold)
        }
        if sHrr.hasValidData() {
            put(0x1b, sHrr.resting); put(0x1c, sHrr.zone1); put(0x1d, sHrr.zone2); put(0x1e, sHrr.zone3); put(0x1f, sHrr.zone4); put(0x20, sHrr.zone5)
        }
        if wMhr.hasValidData() {
            put(0x21, flag(swimming)); put(0x22, swimming.currentMethod.huaweiCode); put(0x23, swimming.warningHRLimit)
            put(0x24, wMhr.zone1); put(0x25, wMhr.zone2); put(0x26, wMhr.zone3); put(0x27, wMhr.zone4); put(0x28, wMhr.zone5); put(0x29, wMhr.threshold)
        }
        if wHrr.hasValidData() {
            put(0x2a, wHrr.resting); put(0x2b, wHrr.zone1); put(0x2c, wHrr.zone2); put(0x2d, wHrr.zone3); put(0x2e, wHrr.zone4); put(0x2f, wHrr.zone5)
        }
        if oMhr.hasValidData() {
            put(0x30, flag(other)); put(0x31, other.currentMethod.huaweiCode); put(0x32, other.warningHRLimit)
            put(0x33, oMhr.zone1); put(0x34, oMhr.zone2); put(0x35, oMhr.zone3); put(0x36, oMhr.zone4); put(0x37, oMhr.zone5); put(0x38, oMhr.threshold)
        }
        if oHrr.hasValidData() {
            put(0x39, oHrr.resting); put(0x3a, oHrr.zone1); put(0x3b, oHrr.zone2); put(0x3c, oHrr.zone3); put(0x3d, oHrr.zone4); put(0x3e, oHrr.zone5)
        }
        return out
    }
}

/// Which way the watch takes its heart-rate zones (GB: Track means P2P, otherwise FitnessData 0x07/0x13|0x21).
public enum HeartRateZonesSync {
    /// Age used when no profile is saved; the same as the live workout's maximum heart rate.
    public static let defaultAge = 35

    public static func age(profile: UserProfileData?, now: Date = Date(), calendar: Calendar = .current) -> Int {
        if let birthYear = profile?.birthYear, birthYear > 0 { return ProfileSender.age(birthYear: birthYear, now: now, calendar: calendar) }
        return defaultAge
    }

    /// GB HuaweiState.supportsTrack: ExpandCapability 0x36 (when the watch sent an ExpandCapability at all).
    public static func supportsTrack(_ caps: DeviceCaps) -> Bool { caps.expandCapability(0x36) }

    /// The route `getHeartRateZonesStatus` reports: `track`, `extended` (07/21), `simple` (07/13) or `none`.
    public static func route(_ caps: DeviceCaps) -> String {
        if supportsTrack(caps) { return "track" }
        if supportsExtended(caps) { return "extended" }
        return supportsSimple(caps) ? "simple" : "none"
    }

    /// GB HuaweiState.supportsHeartRateZones: FitnessData command 0x13.
    public static func supportsSimple(_ caps: DeviceCaps) -> Bool { caps.supports(0x07, 0x13) }

    /// GB HuaweiState.supportsExtendedHeartRateZones: FitnessData command 0x21.
    public static func supportsExtended(_ caps: DeviceCaps) -> Bool { caps.supports(0x07, 0x21) }

    public static func capsLine(_ caps: DeviceCaps) -> String {
        let track = supportsTrack(caps)
        let simple = supportsSimple(caps)
        let branch: String
        if track {
            branch = "P2P module hw.unitedevice.track (iOS has no P2P service yet: zones not sent)"
        } else if simple {
            branch = "FitnessData 07/\(supportsExtended(caps) ? "21" : "13") (sent after the profile)"
        } else {
            branch = "none (the watch takes no zone configuration)"
        }
        return "HR zones: ExpandCapability 0x36 (Track)=\(track), FitnessData 07/13=\(simple), 07/21=\(supportsExtended(caps)), "
            + "P2P 34/01=\(caps.supports(0x34, 0x01)); branch=\(branch)"
    }

    /// SendHeartRateZonesConfig (07/13 or 07/21) for the non-Track branch; false when the watch does not use it (Track watches get the zones
    /// over P2P).
    public static func sendFitnessData(
        session: HuaweiSession, caps: DeviceCaps, log: LogSink, age: Int, user: HeartRateZonesCalc.UserZones? = nil, timeoutMs: Int = Timeouts.initMs
    ) async throws -> Bool {
        if supportsTrack(caps) || !supportsSimple(caps) { return false }
        let extended = supportsExtended(caps)
        guard let config = HeartRateZonesCalc.deviceConfig(age: age, track: false, simpleCommand: true, extended: extended, user: user).first(where: { $0.posture == .upright })
        else { return false }
        let mhr = config.byMethod(.mhr).flatMap { $0.hasValidData() ? $0 : nil }
        let hrr = config.byMethod(.hrr).flatMap { $0.hasValidData() ? $0 : nil }
        let packet =
            extended
            ? FitnessData.HeartRateZoneConfigPacket.requestExtended(
                warningEnable: config.warningEnable, warningHRLimit: config.warningHRLimit, mhr: mhr?.asArray(),
                calculationMethod: config.currentMethod.huaweiCode, hrr: hrr?.asArray()
            )
            : FitnessData.HeartRateZoneConfigPacket.requestSimple(warningEnable: config.warningEnable, warningHRLimit: config.warningHRLimit, mhr: mhr?.asArray())
        _ = try await session.request(packet, timeoutMs: timeoutMs, label: "HeartRateZones")
        let mhrText = mhr.map { "\($0.zone1)/\($0.zone2)/\($0.zone3)/\($0.zone4)/\($0.zone5) of \($0.threshold)" } ?? "nil"
        let hrrText = hrr.map { ", HRR \($0.zone1)/\($0.zone2)/\($0.zone3)/\($0.zone4)/\($0.zone5) resting \($0.resting)" } ?? ""
        log(
            LogEntry(
                .info, service: Int(FitnessData.id), command: extended ? 0x21 : 0x13,
                "HR zones: sent 07/\(extended ? "21" : "13") for \(user.map { "your zones (\($0.logText))" } ?? "age \(age)"), MHR \(mhrText) warning \(config.warningHRLimit)\(hrrText)"
            )
        )
        return true
    }
}
