// The characteristic table and the GATT operation plan of the BleSensors module. Foundation only, so it is tested on Linux (SensorLogicTests).
// The table mirrors SENSOR_CHARACTERISTICS in src/BleSensors.types.ts and SensorProfile.kt; keep the three in step.
import Foundation

/// GATT characteristic properties. The raw values are the Bluetooth ones, which CBCharacteristicProperties shares.
public struct GattProperties: OptionSet, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let read = GattProperties(rawValue: 0x02)
    public static let notify = GattProperties(rawValue: 0x10)
    public static let indicate = GattProperties(rawValue: 0x20)
}

public enum SensorMode: Sendable { case notify, read, readNotify }

public struct SensorCharacteristic: Equatable, Sendable {
    public let service: String
    public let characteristic: String
    public let mode: SensorMode
}

public enum GattStep: Equatable, Sendable {
    case subscribe(service: String, characteristic: String, indicate: Bool)
    case read(service: String, characteristic: String)
}

public enum SensorProfile {
    /// The supported sensor services a scan filters by and `onScanResult.services` reports (4 hex digits).
    public static let scanServices = ["180d", "1816", "1818", "1814"]

    public static let table: [SensorCharacteristic] = [
        SensorCharacteristic(service: "180d", characteristic: "2a37", mode: .notify),
        SensorCharacteristic(service: "1816", characteristic: "2a5b", mode: .notify),
        SensorCharacteristic(service: "1818", characteristic: "2a63", mode: .notify),
        SensorCharacteristic(service: "1814", characteristic: "2a53", mode: .notify),
        SensorCharacteristic(service: "180f", characteristic: "2a19", mode: .readNotify),
        SensorCharacteristic(service: "180a", characteristic: "2a29", mode: .read),
        SensorCharacteristic(service: "180a", characteristic: "2a24", mode: .read),
    ]

    /// Every service the GATT discovery asks for, in table order, without repeats.
    public static let discoveryServices: [String] = {
        var seen: [String] = []
        for entry in table where !seen.contains(entry.service) { seen.append(entry.service) }
        return seen
    }()

    /// Services whose presence makes a link useful. Battery and device information alone do not.
    public static let sensorServices: Set<String> = Set(scanServices)

    public static func uuid128(_ short: String) -> String { "0000\(short.lowercased())-0000-1000-8000-00805f9b34fb" }

    /// The 4-digit form of a Bluetooth base UUID string, or nil for any other UUID. Also accepts the 4-digit form itself.
    public static func short(_ uuid: String) -> String? {
        let lower = uuid.lowercased()
        if lower.count == 4, lower.allSatisfy(\.isHexDigit) { return lower }
        let suffix = "-0000-1000-8000-00805f9b34fb"
        guard lower.count == 36, lower.hasPrefix("0000"), lower.hasSuffix(suffix) else { return nil }
        let start = lower.index(lower.startIndex, offsetBy: 4)
        let digits = lower[start..<lower.index(start, offsetBy: 4)]
        return digits.allSatisfy(\.isHexDigit) ? String(digits) : nil
    }

    /// The operations to run after discovery, in order. `found` maps service (4 hex) to its characteristics (4 hex) with their properties.
    public static func plan(found: [String: [String: GattProperties]]) -> [GattStep] {
        var steps: [GattStep] = []
        for entry in table {
            guard let properties = found[entry.service]?[entry.characteristic] else { continue }
            let canRead = properties.contains(.read)
            let subscribe: GattStep? =
                properties.contains(.notify)
                ? .subscribe(service: entry.service, characteristic: entry.characteristic, indicate: false)
                : properties.contains(.indicate)
                    ? .subscribe(service: entry.service, characteristic: entry.characteristic, indicate: true) : nil
            switch entry.mode {
            case .notify:
                if let subscribe { steps.append(subscribe) }
            case .read:
                if canRead { steps.append(.read(service: entry.service, characteristic: entry.characteristic)) }
            case .readNotify:
                if canRead { steps.append(.read(service: entry.service, characteristic: entry.characteristic)) }
                if let subscribe { steps.append(subscribe) }
            }
        }
        return steps
    }
}

public enum Backoff {
    /// Delay before reconnect attempt `attempt` (0-based): 1, 2, 4, 8, 16 s, then 30 s.
    public static func nextDelayMs(attempt: Int) -> Int {
        let schedule = [1000, 2000, 4000, 8000, 16000]
        if attempt < 0 { return schedule[0] }
        return attempt < schedule.count ? schedule[attempt] : 30000
    }
}

public func hexString(_ data: Data) -> String {
    let digits = Array("0123456789abcdef")
    var out = ""
    out.reserveCapacity(data.count * 2)
    for byte in data {
        out.append(digits[Int(byte >> 4)])
        out.append(digits[Int(byte & 0x0f)])
    }
    return out
}
