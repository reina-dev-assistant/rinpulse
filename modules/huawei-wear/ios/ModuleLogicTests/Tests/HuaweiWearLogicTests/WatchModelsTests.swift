import XCTest
@testable import HuaweiWearLogic

final class WatchModelsTests: XCTestCase {
    func testTableHasTheSixtyFourModelsOfTheAndroidList() {
        XCTAssertEqual(WatchModels.all.count, 64)
        XCTAssertEqual(Set(WatchModels.all.map(\.prefix)).count, 64, "every prefix is unique")
    }

    func testTheTestedWatchMatchesItsAdvertisedName() {
        let m = WatchModels.match("HUAWEI WATCH FIT 4 Pro-40A")
        XCTAssertEqual(m.model?.name, "Huawei Watch Fit 4 Pro")
        XCTAssertEqual(m.support, .tested)
        XCTAssertNil(m.reason)
        XCTAssertTrue(m.connectable)
        XCTAssertEqual(m.deviceType, .ble)
        XCTAssertTrue(m.crypted)
    }

    func testTheLongestPrefixWins() {
        XCTAssertEqual(WatchModels.match("HUAWEI WATCH FIT 4-1B2").model?.name, "Huawei Watch Fit 4")
        XCTAssertEqual(WatchModels.match("HUAWEI WATCH GT 3 Pro-ABC").model?.name, "Huawei Watch GT 3 Pro")
        XCTAssertEqual(WatchModels.match("HUAWEI WATCH GT 3-ABC").model?.name, "Huawei Watch GT 3")
    }

    func testUnlistedAndForeignNames() {
        XCTAssertEqual(WatchModels.match("Huawei Mystery-12").support, .unknown)
        XCTAssertEqual(WatchModels.match(nil).support, .unknown, "no name: let the connect decide")
        XCTAssertEqual(WatchModels.match("  ").support, .unknown)
        XCTAssertEqual(WatchModels.match("Pixel Watch").support, .unsupported)
        XCTAssertFalse(WatchModels.match("Pixel Watch").connectable)
        XCTAssertEqual(WatchModels.match("HUAWEI FreeBuds 5-AB").support, .unsupported)
        XCTAssertEqual(WatchModels.match("HUAWEI FreeBuds 5-AB").reason, "Earphones, not a watch")
    }

    func testHonorPakeWatchesAreUnsupportedAndNewHonorProtocolBandsExperimental() {
        let watch5 = WatchModels.match("honor watch 5-ABC")
        XCTAssertEqual(watch5.support, .unsupported)
        XCTAssertFalse(watch5.connectable)
        let band7 = WatchModels.match("Honor Band 7-ABC")
        XCTAssertEqual(band7.support, .experimental)
        XCTAssertTrue(band7.newHonorProtocol)
        XCTAssertEqual(band7.reason, "Not tested with JoyoFit yet; Gadgetbridge calls it experimental too")
        XCTAssertFalse(WatchModels.match("HUAWEI WATCH GT 4-1").newHonorProtocol)
    }

    func testAwBandsUseTheAwDeviceTypeAndTalkBandIsNotCrypted() {
        XCTAssertEqual(WatchModels.match("HUAWEI Band 4e-ABC").deviceType, .aw)
        XCTAssertEqual(WatchModels.match("HUAWEI Band 4-ABC").deviceType, .ble)
        XCTAssertFalse(WatchModels.match("HUAWEI B6-ABC").crypted)
    }

    func testToJSHasTheBondedDeviceFields() {
        let js = WatchModels.match("HUAWEI WATCH GT 4-1").toJS()
        XCTAssertEqual(js["model"] as? String, "Huawei Watch GT 4")
        XCTAssertEqual(js["support"] as? String, "experimental")
        XCTAssertEqual(js["reason"] as? String, "Not tested with JoyoFit yet")
        let unknown = WatchModels.match("Pixel Watch").toJS()
        XCTAssertTrue(unknown["model"] is NSNull)
    }

    // BleTransport.kt sameWatchName
    func testSameWatchNameIsEqualOrEqualBeforeTheLastDash() {
        XCTAssertTrue(WatchModels.sameWatchName(advertised: "HUAWEI WATCH FIT 4 Pro-40A", remembered: "HUAWEI WATCH FIT 4 Pro-40A"))
        XCTAssertTrue(WatchModels.sameWatchName(advertised: "huawei watch fit 4 pro-40a", remembered: "HUAWEI WATCH FIT 4 Pro-77F"))
        XCTAssertTrue(WatchModels.sameWatchName(advertised: " HUAWEI WATCH FIT 4 Pro-40A ", remembered: "HUAWEI WATCH FIT 4 Pro-40A"))
        XCTAssertFalse(WatchModels.sameWatchName(advertised: "HUAWEI WATCH FIT 4-40A", remembered: "HUAWEI WATCH FIT 4 Pro-40A"))
        XCTAssertFalse(WatchModels.sameWatchName(advertised: "HUAWEI WATCH", remembered: "HUAWEI WATCH FIT"), "no dash and not equal")
        XCTAssertTrue(WatchModels.sameWatchName(advertised: "HUAWEI WATCH", remembered: "huawei watch"))
        XCTAssertFalse(WatchModels.sameWatchName(advertised: nil, remembered: "HUAWEI WATCH FIT 4 Pro-40A"))
        XCTAssertFalse(WatchModels.sameWatchName(advertised: "HUAWEI WATCH FIT 4 Pro-40A", remembered: nil))
        // A stem split on the LAST dash: a model with a dash in its name still matches by its suffix-less stem.
        XCTAssertTrue(WatchModels.sameWatchName(advertised: "A-B-1", remembered: "A-B-2"))
        XCTAssertFalse(WatchModels.sameWatchName(advertised: "A-B-1", remembered: "A-C-1"))
    }

    func testHuaweiOrHonorNames() {
        XCTAssertTrue(WatchModels.looksLikeHuaweiOrHonor("HUAWEI WATCH FIT 4 Pro-40A"))
        XCTAssertTrue(WatchModels.looksLikeHuaweiOrHonor("HONOR Band 9-1"))
        XCTAssertFalse(WatchModels.looksLikeHuaweiOrHonor("Mi Band 8"))
        XCTAssertFalse(WatchModels.looksLikeHuaweiOrHonor(nil))
    }

    /// site/src/jam.ts is generated from WatchModels.kt by site/scripts/gen-jam.ts; the Swift table must classify every model the same way.
    func testTableAgreesWithTheCatalogGeneratedFromTheAndroidTable() throws {
        let url = repoRoot.appendingPathComponent("site/src/jam.ts")
        let text = try String(contentsOf: url, encoding: .utf8)
        func list(_ name: String) -> [String] {
            guard let start = text.range(of: "export const \(name) = [") else { return [] }
            let rest = text[start.upperBound...]
            guard let end = rest.range(of: "] as const;") else { return [] }
            return rest[..<end.lowerBound].split(separator: "\n").compactMap { line in
                let t = line.trimmingCharacters(in: .whitespaces)
                guard t.hasPrefix("\""), let close = t.lastIndex(of: "\"") else { return nil }
                return String(t[t.index(after: t.startIndex)..<close])
            }
        }
        XCTAssertEqual(list("JAM_SUDAH_DIUJI"), WatchModels.all.filter { $0.tested }.map(\.name))
        XCTAssertEqual(list("JAM_EKSPERIMEN_CLASSIC"), WatchModels.all.filter { $0.transport == .br && !$0.pake && !$0.tested }.map(\.name))
        XCTAssertEqual(list("JAM_EKSPERIMEN_LE"), WatchModels.all.filter { $0.transport == .le && !$0.tested }.map(\.name))
        XCTAssertEqual(list("JAM_BELUM_PAKE"), WatchModels.all.filter { $0.pake }.map(\.name))
    }
}
