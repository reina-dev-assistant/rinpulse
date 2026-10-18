import XCTest

@testable import SensorLogic

final class SensorProfileTests: XCTestCase {
    private let read = GattProperties.read
    private let notify = GattProperties.notify
    private let indicate = GattProperties.indicate

    func testTableIds() {
        XCTAssertEqual(
            SensorProfile.table.map { "\($0.service)/\($0.characteristic)" },
            ["180d/2a37", "1816/2a5b", "1818/2a63", "1814/2a53", "180f/2a19", "180a/2a29", "180a/2a24"]
        )
        XCTAssertEqual(SensorProfile.table[4].mode, .readNotify)
        XCTAssertEqual(SensorProfile.scanServices, ["180d", "1816", "1818", "1814"])
        XCTAssertEqual(SensorProfile.discoveryServices, ["180d", "1816", "1818", "1814", "180f", "180a"])
    }

    func testUuidHelpers() {
        XCTAssertEqual(SensorProfile.uuid128("180D"), "0000180d-0000-1000-8000-00805f9b34fb")
        XCTAssertEqual(SensorProfile.short("0000180D-0000-1000-8000-00805F9B34FB"), "180d")
        XCTAssertEqual(SensorProfile.short("2A37"), "2a37")
        XCTAssertNil(SensorProfile.short("6e400001-b5a3-f393-e0a9-e50e24dcca9e"))
    }

    func testHeartRateStrap() {
        let found: [String: [String: GattProperties]] = [
            "180d": ["2a37": [notify], "2a38": [read]],
            "180f": ["2a19": [read, notify]],
            "180a": ["2a29": [read], "2a24": [read], "2a25": [read]],
        ]
        XCTAssertEqual(
            SensorProfile.plan(found: found),
            [
                .subscribe(service: "180d", characteristic: "2a37", indicate: false),
                .read(service: "180f", characteristic: "2a19"),
                .subscribe(service: "180f", characteristic: "2a19", indicate: false),
                .read(service: "180a", characteristic: "2a29"),
                .read(service: "180a", characteristic: "2a24"),
            ]
        )
    }

    func testIndicateOnlyHeartRate() {
        XCTAssertEqual(
            SensorProfile.plan(found: ["180d": ["2a37": [indicate]]]),
            [.subscribe(service: "180d", characteristic: "2a37", indicate: true)]
        )
    }

    func testPowerMeterWithCsc() {
        let found: [String: [String: GattProperties]] = [
            "1818": ["2a63": [notify]],
            "1816": ["2a5b": [notify]],
        ]
        XCTAssertEqual(
            SensorProfile.plan(found: found),
            [
                .subscribe(service: "1816", characteristic: "2a5b", indicate: false),
                .subscribe(service: "1818", characteristic: "2a63", indicate: false),
            ]
        )
    }

    func testSkippedWithoutProperty() {
        let found: [String: [String: GattProperties]] = [
            "180d": ["2a37": [read]],
            "180f": ["2a19": [notify]],
            "180a": ["2a29": [notify]],
        ]
        XCTAssertEqual(
            SensorProfile.plan(found: found),
            [.subscribe(service: "180f", characteristic: "2a19", indicate: false)]
        )
    }

    func testEmptyDiscovery() {
        XCTAssertEqual(SensorProfile.plan(found: [:]), [])
        XCTAssertEqual(SensorProfile.plan(found: ["180d": [:]]), [])
    }

    func testBackoff() {
        XCTAssertEqual((0..<8).map { Backoff.nextDelayMs(attempt: $0) }, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
        XCTAssertEqual(Backoff.nextDelayMs(attempt: 1_000_000), 30000)
        XCTAssertEqual(Backoff.nextDelayMs(attempt: -1), 1000)
    }

    func testHex() {
        XCTAssertEqual(hexString(Data([0x00, 0x7f, 0xab, 0xff])), "007fabff")
        XCTAssertEqual(hexString(Data()), "")
    }
}
