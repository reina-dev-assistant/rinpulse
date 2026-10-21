import XCTest
@testable import HuaweiProtocol

/// The language the watch is told (SetLanguageSetting, service 0C); the same cases as `WatchLocaleTest.kt`.
final class WatchLocaleTests: XCTestCase {
    private func resolve(_ pinned: String?, _ phone: String, script: Bool = false) -> WatchLocale.Setting {
        WatchLocale.resolve(pinned: pinned, phone: phone, scriptCapable: script)
    }

    func testIndonesianIsTheLegacyInNotId() {
        XCTAssertEqual(resolve(nil, "id-ID").tag, "in-ID")
        XCTAssertEqual(resolve(nil, "in_ID").tag, "in-ID")
    }

    func testHebrewAndYiddishAreLegacyToo() {
        XCTAssertEqual(resolve(nil, "he-IL").tag, "iw-IL")
        XCTAssertEqual(resolve(nil, "yi-US").tag, "ji-US")
    }

    func testEnglishKeepsItsCountry() {
        XCTAssertEqual(resolve(nil, "en-US").tag, "en-US")
        XCTAssertEqual(resolve(nil, "en-GB").tag, "en-GB")
        XCTAssertEqual(resolve(nil, "en-ID").tag, "en-ID")
    }

    func testALanguageWithoutCountryGetsItsUsualOne() {
        XCTAssertEqual(resolve(nil, "id").tag, "in-ID")
        XCTAssertEqual(resolve(nil, "en").tag, "en-US")
        XCTAssertEqual(resolve(nil, "zh").tag, "zh-CN")
        XCTAssertEqual(resolve(nil, "fr").tag, "fr-FR")
    }

    func testAnUnreadablePhoneLanguageIsEnglish() {
        XCTAssertEqual(resolve(nil, "").tag, "en-US")
        XCTAssertEqual(resolve(nil, "!!").tag, "en-US")
    }

    func testTraditionalChineseOutsideTaiwanAndHongKongIsChtWithoutTheScriptCapability() {
        XCTAssertEqual(resolve(nil, "zh-Hant-SG").tag, "zh-CHT")
        XCTAssertEqual(resolve(nil, "zh-Hant-TW").tag, "zh-TW")
        XCTAssertEqual(resolve(nil, "zh-Hant-HK").tag, "zh-HK")
        XCTAssertEqual(resolve(nil, "zh-Hans-CN").tag, "zh-CN")
        XCTAssertEqual(resolve(nil, "zh-CN").tag, "zh-CN")
        XCTAssertEqual(resolve(nil, "zh-Hant-SG", script: true).tag, "zh-SG")
    }

    func testAPinnedAppLanguageBeatsThePhone() {
        XCTAssertEqual(resolve("id", "en-US").tag, "in-ID")
        XCTAssertEqual(resolve("en", "id-ID").tag, "en-US")
        XCTAssertEqual(resolve("en-GB", "id-ID").tag, "en-GB")
        XCTAssertEqual(resolve("id_ID", "en-US").tag, "in-ID")
    }

    func testAPinnedTagThatIsNotALanguageFallsBackToThePhone() {
        XCTAssertEqual(resolve("und", "id-ID").tag, "in-ID")
        XCTAssertEqual(resolve("!!", "en-US").tag, "en-US")
        XCTAssertEqual(resolve("  ", "id-ID").tag, "in-ID")
    }

    func testTheScriptIsSentOnlyWithTheCapability() {
        XCTAssertNil(resolve(nil, "id-Latn-ID").script)
        XCTAssertEqual(resolve(nil, "id-Latn-ID", script: true).script, "Latn")
        XCTAssertNil(resolve(nil, "id-ID", script: true).script)
    }

    func testWhatMayBePinned() {
        XCTAssertTrue(WatchLocale.isLanguageTag("id"))
        XCTAssertTrue(WatchLocale.isLanguageTag("en-US"))
        XCTAssertTrue(WatchLocale.isLanguageTag("zh_Hant_TW"))
        XCTAssertFalse(WatchLocale.isLanguageTag(""))
        XCTAssertFalse(WatchLocale.isLanguageTag("und"))
        XCTAssertFalse(WatchLocale.isLanguageTag("12"))
    }

    func testTheRequestIsServiceZeroCCommandOne() throws {
        let packet = LocaleConfig.SetLanguageSetting.request(locale: Array("in-ID".utf8), measurement: LocaleConfig.MeasurementSystem.metric, script: nil)
        XCTAssertEqual(packet.serviceId, 0x0C)
        XCTAssertEqual(packet.commandId, 0x01)
        let tlv = try XCTUnwrap(packet.tlv)
        XCTAssertEqual(try tlv.string(0x01), "in-ID")
        XCTAssertEqual(try tlv.byte(0x02), 0)
        XCTAssertFalse(tlv.contains(0x03))
        let scripted = LocaleConfig.SetLanguageSetting.request(locale: Array("en-US".utf8), measurement: 1, script: Array("Latn".utf8))
        XCTAssertEqual(try XCTUnwrap(scripted.tlv).string(0x03), "Latn")
    }
}
