import XCTest
@testable import HuaweiProtocol

private typealias AppSwitchEntry = Notifications.AppSwitches.Entry

final class NotificationPacketsTests: XCTestCase {
    func testNotificationStateRequestMatchesJava() throws {
        let cases = try Golden.load("notifications").list("requests")
        XCTAssertEqual(cases.count, 2)
        for c in cases {
            let name = c.str("name")
            let packet = Notifications.NotificationState.request(enabled: c.bool("enabled"))
            XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
            XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
            XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
            XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)
            XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name)
            XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name)
        }
    }

    // MARK: 02/0B, the per-app switch list

    func testAppSwitchesRequestMatchesTheJavaBuiltFrames() throws {
        let cases = try Golden.load("notifications").list("appSwitches")
        XCTAssertEqual(cases.count, 5)
        for c in cases {
            let name = c.str("name")
            let entries = c.list("entries").map { AppSwitchEntry(appId: $0.str("appId"), value: UInt8($0.int("value"))) }
            let packet = Notifications.AppSwitches.request(entries: entries)
            XCTAssertEqual(packet.serviceId, UInt8(c.int("service")), name)
            XCTAssertEqual(packet.commandId, UInt8(c.int("command")), name)
            XCTAssertEqual(packet.isEncrypted, c.bool("encrypted"), name)
            XCTAssertEqual(packet.isSliced, c.bool("sliced"), name)
            XCTAssertEqual(packet.tlv!.serialize().hexLower, c.str("tlv"), name)
            XCTAssertEqual(try PacketsKit.frames(packet), (c["frames"] as? [String]) ?? [], name)
        }
    }

    func testTheResearchDocumentsExamplePlaintext() {
        // docs/ios-notification-app-switches.md 2.3: 28 plaintext bytes for com.apple.MobileSMS with the value 1.
        let packet = Notifications.AppSwitches.request(entries: [AppSwitchEntry(appId: "com.apple.MobileSMS", value: 1)])
        let plain = packet.tlv!.serialize()
        XCTAssertEqual(plain.hexLower, "811a82180313636f6d2e6170706c652e4d6f62696c65534d53040101")
        XCTAssertEqual(plain.count, 28)
    }

    func testAppSwitchesResponseReadsTheWatchsReportAndTheResultCode() throws {
        // The watch turned one app off and says so with the request's own shape; 7F is the result code.
        let report = try PacketsKit.tlvPacket(2, 0x0B, "81148212030d6a702e6e617665722e6c696e65040101")
        let parsed = try Notifications.AppSwitches.Response(packet: report)
        XCTAssertEqual(parsed.entries, [AppSwitchEntry(appId: "jp.naver.line", value: 1)])
        XCTAssertNil(parsed.resultCode)

        let ack = try PacketsKit.tlvPacket(2, 0x0B, "7f04000186a0")
        let acked = try Notifications.AppSwitches.Response(packet: ack)
        XCTAssertEqual(acked.entries, [])
        XCTAssertEqual(acked.resultCode, 100_000)
    }

    func testAppSwitchesResponseToleratesAnEmptyAnswerAndSkipsHalfEntries() throws {
        let empty = try Notifications.AppSwitches.Response(packet: HuaweiPacket(serviceId: 2, commandId: 0x0B))
        XCTAssertEqual(empty.entries, [])
        XCTAssertNil(empty.resultCode)
        // 81 { 82 { 03 "a" } 82 { 03 "b" 04 00 } }: the entry without a value is skipped.
        let half = try PacketsKit.tlvPacket(2, 0x0B, "810d82030301618206030162040100")
        let parsed = try Notifications.AppSwitches.Response(packet: half)
        XCTAssertEqual(parsed.entries, [AppSwitchEntry(appId: "b", value: 0)])
    }
}

