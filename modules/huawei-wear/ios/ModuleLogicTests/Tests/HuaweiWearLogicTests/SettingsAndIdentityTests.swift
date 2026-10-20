import XCTest
@testable import HuaweiWearLogic

final class SettingsAndIdentityTests: XCTestCase {
    func testWatchBackgroundAndIntervalSettings() {
        let settings = WearSettings(defaults: ephemeralDefaults())
        XCTAssertNil(settings.watchAddress)
        XCTAssertFalse(settings.backgroundEnabled)
        XCTAssertEqual(settings.syncIntervalMinutes, 30)
        settings.watchAddress = "6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77"
        settings.watchName = "HUAWEI WATCH FIT 4 Pro-40A"
        settings.backgroundEnabled = true
        settings.syncIntervalMinutes = 15
        XCTAssertEqual(settings.watchAddress, "6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77")
        XCTAssertEqual(settings.watchName, "HUAWEI WATCH FIT 4 Pro-40A")
        XCTAssertTrue(settings.backgroundEnabled)
        XCTAssertEqual(settings.syncIntervalMinutes, 15)
        settings.watchAddress = nil
        XCTAssertNil(settings.watchAddress)
    }

    /// docs/multi-watch.md, section 7 (SwitchBackfillTest on Android): only moving the link to another watch marks it for a full pull.
    func testSwitchBackfillMarksTheWatchTheLinkMovedToUntilItIsDone() {
        let settings = WearSettings(defaults: ephemeralDefaults())
        settings.noteConnect(previous: nil, address: "AA")
        settings.noteConnect(previous: "AA", address: "aa")
        XCTAssertFalse(settings.switchBackfillPending("AA"))
        settings.noteConnect(previous: "AA", address: "BB")
        XCTAssertTrue(settings.switchBackfillPending("BB"))
        XCTAssertTrue(settings.switchBackfillPending("bb"))
        XCTAssertFalse(settings.switchBackfillPending("AA"), "the watch the link left is not marked")
        settings.noteConnect(previous: "BB", address: "AA")
        settings.switchBackfillDone("BB")
        XCTAssertFalse(settings.switchBackfillPending("BB"))
        XCTAssertTrue(settings.switchBackfillPending("AA"))
    }

    func testProfileRoundTripAndClear() {
        let settings = WearSettings(defaults: ephemeralDefaults())
        XCTAssertNil(settings.profile)
        let profile = UserProfileData(heightCm: 172, weightKg: 68.5, birthYear: 1990, sex: "female", dailyStepGoal: 8000)
        settings.profile = profile
        XCTAssertEqual(settings.profile, profile)
        XCTAssertEqual(settings.profile?.weightKg, 68.5)
        settings.profile = nil
        XCTAssertNil(settings.profile)
    }

    func testProfileValidationMatchesTheAndroidRanges() {
        func valid(_ h: Int = 170, _ w: Double = 65, _ y: Int = 1990, _ s: String = "male", _ g: Int = 8000) -> String? {
            UserProfileData(heightCm: h, weightKg: w, birthYear: y, sex: s, dailyStepGoal: g).validationError(thisYear: 2026)
        }
        XCTAssertNil(valid())
        XCTAssertEqual(valid(99), "Height must be 100 to 250 cm")
        XCTAssertEqual(valid(251), "Height must be 100 to 250 cm")
        XCTAssertEqual(valid(170, 19.9), "Weight must be 20 to 300 kg")
        XCTAssertEqual(valid(170, .nan), "Weight must be 20 to 300 kg")
        XCTAssertEqual(valid(170, 65, 1899), "Birth year must be 1900 to 2026")
        XCTAssertEqual(valid(170, 65, 2027), "Birth year must be 1900 to 2026")
        XCTAssertEqual(valid(170, 65, 1990, "x"), "Sex must be male, female or unknown")
        XCTAssertEqual(valid(170, 65, 1990, "unknown", 999), "Step goal must be 1000 to 100000")
        XCTAssertNil(valid(100, 20, 1900, "unknown", 100_000))
    }

    func testProfileToJSHasTheTypeScriptFields() {
        let js = UserProfileData(heightCm: 172, weightKg: 68.5, birthYear: 1990, sex: "female", dailyStepGoal: 8000).toJS()
        XCTAssertEqual(Set(js.keys), ["heightCm", "weightKg", "birthYear", "sex", "dailyStepGoal"])
    }

    // DeviceStore.kt

    func testIdentityIsCreatedOnceAndStable() {
        let store = DeviceStore(secrets: MemorySecretStore())
        let identity = store.forDevice("  6b1c2a55-3e21-4a7b-9d6e-5f1a0c0c9b77 ")
        XCTAssertEqual(identity.deviceAddress, "6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77")
        identity.ensureCreated()
        let mac = identity.macString
        XCTAssertTrue(mac.hasPrefix("FF:FF:FF:"))
        XCTAssertEqual(mac.count, 17)
        XCTAssertEqual(mac, mac.uppercased())
        XCTAssertEqual(String(decoding: identity.macAddressBytes, as: UTF8.self), mac)
        XCTAssertEqual(identity.androidIdString.count, 32)
        XCTAssertEqual(identity.serialBytes.count, 6)
        XCTAssertEqual(String(decoding: identity.serialBytes, as: UTF8.self), String(mac.replacingOccurrences(of: ":", with: "").suffix(6)))
        // A second handle on the same watch sees the same values.
        let again = store.forDevice("6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77")
        XCTAssertEqual(again.macString, mac)
        XCTAssertEqual(again.androidIdString, identity.androidIdString)
    }

    func testIdentitiesOfTwoWatchesAreIndependent() {
        let store = DeviceStore(secrets: MemorySecretStore())
        let a = store.forDevice("6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77")
        let b = store.forDevice("11111111-2222-3333-4444-555555555555")
        a.authKey = Bytes(repeating: 0xAB, count: 16)
        XCTAssertNil(b.authKey)
        XCTAssertNotEqual(a.androidIdString, b.androidIdString)
    }

    func testFirstConnectionUntilABindCompletedWithAKey() {
        let identity = DeviceStore(secrets: MemorySecretStore()).forDevice("6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77")
        XCTAssertTrue(identity.isFirstConnection)
        // HiChain writes the key mid-bind: a key alone does not count.
        identity.authKey = Bytes(0..<16)
        XCTAssertTrue(identity.isFirstConnection)
        identity.markBonded()
        XCTAssertFalse(identity.isFirstConnection)
        // A bonded flag without a key (cleared key) is a first connection again.
        identity.authKey = nil
        XCTAssertTrue(identity.isFirstConnection)
    }

    func testCreateSecretKeyKeepsAStoredKey() {
        let identity = DeviceStore(secrets: MemorySecretStore()).forDevice("6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77")
        let first = identity.createSecretKey()
        XCTAssertEqual(first.count, 16)
        XCTAssertEqual(identity.createSecretKey(), first)
        XCTAssertEqual(identity.authKey, first)
    }

    func testAuthKeyRoundTripsAsUpperCaseHex() {
        let secrets = MemorySecretStore()
        let identity = DeviceStore(secrets: secrets).forDevice("6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77")
        identity.authKey = [0x00, 0xAB, 0xFF]
        XCTAssertEqual(secrets.get("6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77|authkey"), "00ABFF")
        XCTAssertEqual(identity.authKey, [0x00, 0xAB, 0xFF])
    }

    func testForgetDropsKeyIdentityAndBondFlag() {
        let secrets = MemorySecretStore()
        let store = DeviceStore(secrets: secrets)
        let identity = store.forDevice("6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77")
        identity.ensureCreated()
        identity.authKey = Bytes(0..<16)
        identity.markBonded()
        let other = store.forDevice("11111111-2222-3333-4444-555555555555")
        other.authKey = [1]
        store.forget("6b1c2a55-3e21-4a7b-9d6e-5f1a0c0c9b77")
        XCTAssertNil(store.forDevice("6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77").authKey)
        XCTAssertTrue(store.forDevice("6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77").isFirstConnection)
        XCTAssertEqual(other.authKey, [1], "another watch is untouched")
        XCTAssertEqual(secrets.count, 1)
    }
}
