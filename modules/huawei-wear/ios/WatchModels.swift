// Device list ported from Gadgetbridge (AGPL-3.0-or-later; see NOTICE) via the Android WatchModels.kt: devices/huawei/*/...Coordinator
// (getSupportedDeviceName, Huawei/Honor BR vs LE base class, isTransactionCrypted, supportsHiChainPake) and HuaweiConstants.*_NAME.
// Pure logic (Foundation only), shared with the logic tests that run on Linux.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

/// How far JoyoFit gets with a watch model. Raw values are the wire names of `ModelSupport` in HuaweiWear.types.ts.
public enum ModelSupport: String, Sendable {
    /// Checked on a real watch.
    case tested
    /// In Gadgetbridge's list, on a link and an auth mode JoyoFit implements; never tried with JoyoFit.
    case experimental
    /// A Huawei or Honor name Gadgetbridge does not list; JoyoFit tries it like a Huawei watch.
    case unknown
    /// JoyoFit cannot talk to it; `ModelMatch.reason` says why.
    case unsupported
}

/// The link a model's Gadgetbridge coordinator uses. iOS has no Bluetooth Classic, so every model is opened over LE GATT whatever it lists.
public enum ModelTransport: Sendable {
    case br
    case le

    /// What the support report says.
    public var label: String {
        switch self {
        case .br: return "Bluetooth Classic (RFCOMM)"
        case .le: return "Bluetooth LE (GATT)"
        }
    }
}

public struct WatchModel: Sendable {
    /// For people: "Huawei Watch GT 4".
    public let name: String
    /// Lower case start of the Bluetooth name, as in GB's coordinator ("huawei watch gt 4-").
    public let prefix: String
    public let transport: ModelTransport
    /// HonorBRCoordinator: the RFCOMM service is UUID_SERVICE_HONOR_SDP. Not used on iOS (no RFCOMM).
    public let honorSdp: Bool
    /// GB isTransactionCrypted.
    public let crypted: Bool
    /// GB supportsHiChainPake: Honor's newer pairing, which JoyoFit does not implement.
    public let pake: Bool
    public let tested: Bool
    /// GB HuaweiDeviceType.AW (HuaweiBandAw70Coordinator: Band 3e, 4e): LE, but asks LinkParams and ProductInfo with the AW tag sets.
    public let aw: Bool
    /// GB isNewHonorProtocol (Honor Band 7, 9, 10): LE with Honor's own GATT service instead of 0xFE86.
    public let newHonorProtocol: Bool

    public init(
        _ name: String, _ prefix: String, _ transport: ModelTransport,
        honorSdp: Bool = false, crypted: Bool = true, pake: Bool = false, tested: Bool = false, aw: Bool = false, newHonorProtocol: Bool = false
    ) {
        self.name = name
        self.prefix = prefix
        self.transport = transport
        self.honorSdp = honorSdp
        self.crypted = crypted
        self.pake = pake
        self.tested = tested
        self.aw = aw
        self.newHonorProtocol = newHonorProtocol
    }
}

public struct ModelMatch: Sendable {
    public let model: WatchModel?
    public let support: ModelSupport
    public let reason: String?

    public init(model: WatchModel?, support: ModelSupport, reason: String?) {
        self.model = model
        self.support = support
        self.reason = reason
    }

    public var crypted: Bool { model?.crypted ?? true }

    /// GATT service and characteristics are Honor's own ones, not 0xFE86 with FE01 and FE02.
    public var newHonorProtocol: Bool { model?.newHonorProtocol == true }

    public var connectable: Bool { support != .unsupported }

    /// GB's HuaweiDeviceType. iOS opens every watch over LE: AW for the AW70 bands, BLE for everything else.
    public var deviceType: HuaweiDeviceType { model?.aw == true ? .aw : .ble }

    /// `{model, support, reason}`, the fields `BondedDevice` shares with `DeviceInfo`.
    public func toJS() -> [String: Any] {
        [
            "model": model?.name ?? NSNull(),
            "support": support.rawValue,
            "reason": reason ?? NSNull(),
        ]
    }
}

public enum WatchModels {
    public static let all: [WatchModel] = [
        WatchModel("Huawei Watch Fit 4 Pro", "huawei watch fit 4 pro-", .br, tested: true),
        WatchModel("Huawei Watch Fit 4", "huawei watch fit 4-", .br),
        WatchModel("Huawei Watch Fit 5", "huawei watch fit 5-", .br),
        WatchModel("Huawei Watch Fit 5 Pro", "huawei watch fit 5 pro-", .br),
        WatchModel("Huawei Watch Fit 3", "huawei watch fit 3-", .br),
        WatchModel("Huawei Watch Fit 2", "huawei watch fit 2-", .br, tested: true),
        WatchModel("Huawei Watch GT 2", "huawei watch gt 2-", .br),
        WatchModel("Huawei Watch GT 2 Pro", "huawei watch gt 2 pro-", .br),
        WatchModel("Huawei Watch GT 3", "huawei watch gt 3-", .br),
        WatchModel("Huawei Watch GT 3 Pro", "huawei watch gt 3 pro-", .br),
        WatchModel("Huawei Watch GT 3 SE", "huawei watch gt 3 se-", .br),
        WatchModel("Huawei Watch GT 4", "huawei watch gt 4-", .br),
        WatchModel("Huawei Watch GT 5", "huawei watch gt 5-", .br),
        WatchModel("Huawei Watch GT 5 Pro", "huawei watch gt 5 pro-", .br),
        WatchModel("Huawei Watch GT 6", "huawei watch gt 6-", .br),
        WatchModel("Huawei Watch GT 6 Pro", "huawei watch gt 6 pro-", .br),
        WatchModel("Huawei Watch GT 7", "huawei watch gt 7-", .br),
        WatchModel("Huawei Watch GT 7 Pro", "huawei watch gt 7 pro-", .br),
        WatchModel("Huawei Watch GT Runner", "huawei watch gt runner-", .br),
        WatchModel("Huawei Watch GT Runner 2", "watch gt runner 2-", .br),
        WatchModel("Huawei Watch GT Cyber", "huawei watch gt cyber-", .br),
        WatchModel("Huawei Watch 3", "huawei watch 3-", .br),
        WatchModel("Huawei Watch 3 Pro", "huawei watch 3 pro-", .br),
        WatchModel("Huawei Watch 4", "huawei watch 4-", .br),
        WatchModel("Huawei Watch 4 Pro", "huawei watch 4 pro-", .br),
        WatchModel("Huawei Watch 5", "huawei watch 5-", .br),
        WatchModel("Huawei Watch D2", "huawei watch d2-", .br),
        WatchModel("Huawei Watch Ultimate", "huawei watch ultimate-", .br),
        WatchModel("Huawei Watch Ultimate 2", "watch ultimate 2-", .br),
        WatchModel("Huawei TalkBand B6", "huawei b6-", .br, crypted: false),
        WatchModel("Honor MagicWatch 2", "honor magicwatch 2-", .br, crypted: false),
        WatchModel("Honor Watch GS 3", "honor watch gs 3-", .br, crypted: false),
        WatchModel("Honor Watch GS Pro", "honor watch gs pro-", .br, crypted: false),
        WatchModel("Honor Watch 4", "honor watch 4-", .br, honorSdp: true, crypted: false),
        WatchModel("Honor Watch 4 Pro", "honor watch 4 pro-", .br, honorSdp: true, crypted: false),
        WatchModel("Honor Watch 5", "honor watch 5-", .br, honorSdp: true, crypted: false, pake: true),
        WatchModel("Honor Watch 5 Pro", "honor watch 5 pro-", .br, honorSdp: true, crypted: false, pake: true),
        WatchModel("Honor Watch 6", "honor watch 6-", .br, honorSdp: true, crypted: false, pake: true),
        WatchModel("Huawei Watch Fit", "huawei watch fit-", .le),
        WatchModel("Huawei Watch GT", "huawei watch gt-", .le),
        WatchModel("Huawei Watch GT 2e", "huawei watch gt 2e-", .le),
        WatchModel("Huawei Band 2", "huawei band 2-", .le),
        WatchModel("Huawei Band 2 Pro", "huawei band 2 pro-", .le),
        WatchModel("Huawei Band 3", "huawei band 3-", .le),
        WatchModel("Huawei Band 3 Pro", "huawei band 3 pro-", .le),
        WatchModel("Huawei Band 3e", "huawei band 3e-", .le, aw: true),
        WatchModel("Huawei Band 4", "huawei band 4-", .le),
        WatchModel("Huawei Band 4 Pro", "huawei band 4 pro-", .le),
        WatchModel("Huawei Band 4e", "huawei band 4e-", .le, aw: true),
        WatchModel("Huawei Band 6", "huawei band 6-", .le),
        WatchModel("Huawei Band 7", "huawei band 7-", .le),
        WatchModel("Huawei Band 8", "huawei band 8-", .le, tested: true),
        WatchModel("Huawei Band 9", "huawei band 9-", .le),
        WatchModel("Huawei Band 10", "huawei band 10-", .le),
        WatchModel("Huawei Band 11", "huawei band 11-", .le),
        WatchModel("Huawei Band 11 Pro", "huawei band 11 pro-", .le, tested: true),
        WatchModel("Honor Band 3", "honor band 3-", .le),
        WatchModel("Honor Band 4", "honor band 4-", .le),
        WatchModel("Honor Band 5", "honor band 5-", .le),
        WatchModel("Honor Band 6", "honor band 6-", .le),
        WatchModel("Honor Band 7", "honor band 7-", .le, newHonorProtocol: true),
        WatchModel("Honor Band 9", "honor band 9-", .le, newHonorProtocol: true),
        WatchModel("Honor Band 10", "honor band 10-", .le, newHonorProtocol: true),
        WatchModel("Honor Watch", "honor watch-", .le),
    ]

    /// Earphones share the Huawei/Honor names but not the watch protocol.
    private static let audio = ["freebuds", "freeclip", "freearc", "freelace", "earbuds"]

    /// The catalog entry for a Bluetooth name (longest matching prefix, case-insensitive) and what JoyoFit can do with it.
    public static func match(_ bluetoothName: String?) -> ModelMatch {
        let lower = (bluetoothName ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        // Kotlin `maxByOrNull` keeps the first of equally long matches; the table has no two prefixes of the same length that both match.
        var model: WatchModel?
        for candidate in all where lower.hasPrefix(candidate.prefix.lowercased()) {
            if model == nil || candidate.prefix.count > model!.prefix.count { model = candidate }
        }
        if model == nil {
            if audio.contains(where: { lower.contains($0) }) {
                return ModelMatch(model: nil, support: .unsupported, reason: "Earphones, not a watch")
            }
            // No name: let the connect decide.
            if lower.isEmpty || lower.hasPrefix("huawei") || lower.hasPrefix("honor") {
                return ModelMatch(model: nil, support: .unknown, reason: "Not in the list of known watches; it may not work")
            }
            return ModelMatch(model: nil, support: .unsupported, reason: "Not a Huawei or Honor watch")
        }
        let m = model!
        if m.pake {
            return ModelMatch(model: m, support: .unsupported, reason: "Uses Honor's newer pairing, which JoyoFit does not support yet")
        }
        if m.tested { return ModelMatch(model: m, support: .tested, reason: nil) }
        // GB's coordinators for these three carry isExperimental() (its issue #6027).
        if m.newHonorProtocol {
            return ModelMatch(model: m, support: .experimental, reason: "Not tested with JoyoFit yet; Gadgetbridge calls it experimental too")
        }
        return ModelMatch(model: m, support: .experimental, reason: "Not tested with JoyoFit yet")
    }

    /// Huawei names are "MODEL-XXX" with a per-watch suffix: an LE name matches the remembered one when it is equal, or equal before the last dash
    /// (BleTransport.kt `sameWatchName`).
    public static func sameWatchName(advertised: String?, remembered: String?) -> Bool {
        guard let bonded = remembered, let advertised else { return false }
        let a = advertised.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let b = bonded.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if a == b { return true }
        guard let ia = a.lastIndex(of: "-"), let ib = b.lastIndex(of: "-") else { return false }
        return a[..<ia] == b[..<ib]
    }

    /// A name that looks like a Huawei or Honor device (the scan logs these even when they are not the remembered watch).
    public static func looksLikeHuaweiOrHonor(_ name: String?) -> Bool {
        guard let lower = name?.lowercased() else { return false }
        return lower.contains("huawei") || lower.contains("honor")
    }
}
