import XCTest
@testable import HuaweiWearLogic

final class WearRuntimeTests: XCTestCase {
    private let watch = "6B1C2A55-3E21-4A7B-9D6E-5F1A0C0C9B77"
    private var settings: WearSettings!
    private var nearbyCalls = 0
    private var nearby: [NearbyWatch] = []
    private var nearbyError: WearError?
    private var system: [NearbyWatch] = []
    private var systemCalls = 0
    private var systemError: WearError?
    private var scanTimeouts: [Int] = []
    private var transports: TransportLog!
    private var clockMs = 0

    override func setUp() {
        settings = WearSettings(defaults: ephemeralDefaults())
        nearbyCalls = 0
        nearby = []
        nearbyError = nil
        system = []
        systemCalls = 0
        systemError = nil
        scanTimeouts = []
        transports = TransportLog()
        clockMs = 0
    }

    private func makeRuntime(behavior: FakeTransport.Behavior = .hangConnect) -> WearRuntime {
        let log = transports!
        let box = ClockBox()
        let runtime = WearRuntime(
            settings: settings, syncStore: SyncStore(url: temporaryDatabaseURL()), deviceStore: DeviceStore(secrets: MemorySecretStore()),
            gate: AlwaysReadyGate(), environment: .init(app: "app 1 (1)", phone: "Apple test"), phoneModel: "test",
            transportFactory: { request, delegate in
                let t = FakeTransport(behavior, request: request, delegate: delegate)
                log.add(t)
                return t
            },
            nearby: { [unowned self] timeoutMs in
                self.nearbyCalls += 1
                self.scanTimeouts.append(timeoutMs)
                if let e = self.nearbyError { throw e }
                return self.nearby
            },
            systemConnected: { [unowned self] in
                self.systemCalls += 1
                if let e = self.systemError { throw e }
                return self.system
            },
            clock: { box.value }
        )
        clockBox = box
        return runtime
    }

    private var clockBox: ClockBox!

    final class ClockBox: @unchecked Sendable {
        private let lock = NSLock()
        private var ms = 0
        var value: Int { lock.locked { ms } }
        func advance(_ by: Int) { lock.locked { ms += by } }
    }

    // MARK: bonded devices

    func testBondedDevicesListsTheRememberedWatchWithItsModel() async throws {
        settings.watchAddress = watch
        settings.watchName = "HUAWEI WATCH FIT 4 Pro-40A"
        let list = try await makeRuntime().bondedDevices()
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list[0]["address"] as? String, watch)
        XCTAssertEqual(list[0]["name"] as? String, "HUAWEI WATCH FIT 4 Pro-40A")
        XCTAssertEqual(list[0]["model"] as? String, "Huawei Watch Fit 4 Pro")
        XCTAssertEqual(list[0]["support"] as? String, "tested")
        XCTAssertTrue(list[0]["reason"] is NSNull)
        XCTAssertEqual(Set(list[0].keys), ["address", "name", "model", "support", "reason", "nearby", "systemConnected"])
    }

    func testBondedDevicesAddsNearbyWatchesAndSortsByName() async throws {
        settings.watchAddress = watch
        settings.watchName = "HUAWEI WATCH FIT 4 Pro-40A"
        nearby = [
            NearbyWatch(identifier: "11111111-2222-3333-4444-555555555555", name: "HONOR Band 9-1A"),
            NearbyWatch(identifier: watch.lowercased(), name: "HUAWEI WATCH FIT 4 Pro-40A"),
            NearbyWatch(identifier: "99999999-2222-3333-4444-555555555555", name: nil),
        ]
        let list = try await makeRuntime().bondedDevices()
        XCTAssertEqual(list.map { $0["name"] as! String }, ["99999999-2222-3333-4444-555555555555", "HONOR Band 9-1A", "HUAWEI WATCH FIT 4 Pro-40A"])
        XCTAssertEqual(list.filter { ($0["address"] as! String) == watch }.count, 1, "the remembered watch is not listed twice")
        XCTAssertEqual(list.first { ($0["name"] as! String).hasPrefix("HONOR") }?["support"] as? String, "experimental")
    }

    func testBondedDevicesScanIsCachedForThirtySeconds() async throws {
        nearby = [NearbyWatch(identifier: watch, name: "HUAWEI WATCH FIT 4 Pro-40A")]
        let runtime = makeRuntime()
        _ = try await runtime.bondedDevices()
        _ = try await runtime.bondedDevices()
        XCTAssertEqual(nearbyCalls, 1)
        clockBox.advance(31_000)
        _ = try await runtime.bondedDevices()
        XCTAssertEqual(nearbyCalls, 2)
    }

    func testBluetoothOffWithNothingRememberedIsReportedButARememberedWatchStillLists() async throws {
        nearbyError = WearError(.bluetoothOff, "Bluetooth is turned off; turn it on and try again")
        let runtime = makeRuntime()
        do {
            _ = try await runtime.bondedDevices()
            XCTFail("expected ERR_BLUETOOTH_OFF")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .bluetoothOff)
        }
        settings.watchAddress = watch
        settings.watchName = "HUAWEI WATCH FIT 4 Pro-40A"
        let list = try await runtime.bondedDevices()
        XCTAssertEqual(list.count, 1)
    }

    func testNoScanWhileALinkIsOpen() async throws {
        let runtime = makeRuntime()
        let connect = Task { try await runtime.connectFromApp(watch) }
        await eventually("connecting") { runtime.link.currentState() == .connecting }
        _ = try await runtime.bondedDevices()
        XCTAssertEqual(nearbyCalls, 0)
        runtime.disconnectFromApp()
        _ = try? await connect.value
    }

    // MARK: finding the watch from the app (JRG-173)

    private let fit = "HUAWEI WATCH FIT 4 Pro-40A"

    func testAWatchTheSystemHoldsListsWithoutAScanResult() async throws {
        system = [NearbyWatch(identifier: watch, name: fit)]
        let list = try await makeRuntime().bondedDevices()
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list[0]["name"] as? String, fit)
        XCTAssertEqual(list[0]["systemConnected"] as? Bool, true)
        XCTAssertEqual(list[0]["nearby"] as? Bool, true)
    }

    func testASystemWatchThatIsAlsoScannedAndRememberedIsOneRow() async throws {
        settings.watchAddress = watch
        settings.watchName = fit
        system = [NearbyWatch(identifier: watch.lowercased(), name: fit)]
        nearby = [NearbyWatch(identifier: watch, name: fit)]
        let list = try await makeRuntime().bondedDevices()
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list[0]["systemConnected"] as? Bool, true)
    }

    func testARememberedWatchOutOfReachListsAsNotNearby() async throws {
        settings.watchAddress = watch
        settings.watchName = fit
        let list = try await makeRuntime().bondedDevices()
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list[0]["nearby"] as? Bool, false)
        XCTAssertEqual(list[0]["systemConnected"] as? Bool, false)
    }

    func testAnEmptyScanIsNotCachedSoAWatchThatJustAppearedShows() async throws {
        let runtime = makeRuntime()
        _ = try await runtime.bondedDevices()
        XCTAssertEqual(nearbyCalls, 1)
        nearby = [NearbyWatch(identifier: watch, name: fit)]
        let list = try await runtime.bondedDevices()
        XCTAssertEqual(nearbyCalls, 2, "an empty result must not hide the watch for 30 s")
        XCTAssertEqual(list.count, 1)
    }

    func testRefreshIgnoresTheCacheAndScansLonger() async throws {
        nearby = [NearbyWatch(identifier: watch, name: fit)]
        let runtime = makeRuntime()
        _ = try await runtime.bondedDevices()
        _ = try await runtime.bondedDevices()
        XCTAssertEqual(nearbyCalls, 1)
        nearby = [
            NearbyWatch(identifier: watch, name: fit),
            NearbyWatch(identifier: "11111111-2222-3333-4444-555555555555", name: "HONOR Band 9-1A"),
        ]
        let list = try await runtime.bondedDevices(refresh: true)
        XCTAssertEqual(nearbyCalls, 2)
        XCTAssertEqual(scanTimeouts, [4_000, 8_000])
        XCTAssertEqual(list.count, 2)
    }

    func testTheSystemListIsNeverCachedSoAWatchHeldByiOSShowsAtOnce() async throws {
        nearby = [NearbyWatch(identifier: "11111111-2222-3333-4444-555555555555", name: "HONOR Band 9-1A")]
        let runtime = makeRuntime()
        _ = try await runtime.bondedDevices()
        system = [NearbyWatch(identifier: watch, name: fit)]
        let list = try await runtime.bondedDevices()
        XCTAssertEqual(nearbyCalls, 1, "the scan stays cached")
        XCTAssertEqual(list.count, 2)
        XCTAssertEqual(systemCalls, 2)
    }

    func testDisconnectingDropsTheCachedScan() async throws {
        nearby = [NearbyWatch(identifier: watch, name: fit)]
        let runtime = makeRuntime()
        _ = try await runtime.bondedDevices()
        runtime.disconnectFromApp()
        _ = try await runtime.bondedDevices()
        XCTAssertEqual(nearbyCalls, 2)
    }

    func testListingMergesDuplicatesByIdentifierIgnoringCase() {
        let rows = WearRuntime.listing(
            remembered: NearbyWatch(identifier: watch, name: nil), active: nil,
            system: [NearbyWatch(identifier: watch.lowercased(), name: fit)],
            scanned: [NearbyWatch(identifier: watch, name: fit), NearbyWatch(identifier: watch, name: fit)]
        )
        XCTAssertEqual(rows, [WearRuntime.ListedWatch(identifier: watch, name: fit, nearby: true, systemConnected: true)])
    }

    func testARememberedWatchSeenUnderANewIdentifierWithTheSameFullNameIsOneRow() {
        let renewed = "AAAAAAAA-2222-3333-4444-555555555555"
        let rows = WearRuntime.listing(
            remembered: NearbyWatch(identifier: watch, name: fit), active: nil,
            system: [], scanned: [NearbyWatch(identifier: renewed, name: fit.lowercased())]
        )
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].identifier, watch, "connecting by the remembered identifier keeps the stored key")
        XCTAssertTrue(rows[0].nearby)
    }

    func testAnotherWatchOfTheSameModelIsItsOwnRow() {
        let other = "AAAAAAAA-2222-3333-4444-555555555555"
        let rows = WearRuntime.listing(
            remembered: NearbyWatch(identifier: watch, name: fit), active: nil,
            system: [], scanned: [NearbyWatch(identifier: other, name: "HUAWEI WATCH FIT 4 Pro-77B")]
        )
        XCTAssertEqual(rows.count, 2)
        XCTAssertFalse(rows[0].nearby)
        XCTAssertTrue(rows[1].nearby)
    }

    func testTheRememberedIdentifierSeenBesideASameNamedOtherOneStaysItsOwnRow() {
        let other = "AAAAAAAA-2222-3333-4444-555555555555"
        let rows = WearRuntime.listing(
            remembered: NearbyWatch(identifier: watch, name: fit), active: nil,
            system: [], scanned: [NearbyWatch(identifier: watch, name: fit), NearbyWatch(identifier: other, name: fit)]
        )
        XCTAssertEqual(rows.count, 2)
    }

    func testTheLinksOwnWatchCountsAsInReach() {
        let rows = WearRuntime.listing(remembered: nil, active: watch, system: [], scanned: [])
        XCTAssertEqual(rows, [WearRuntime.ListedWatch(identifier: watch, name: nil, nearby: true, systemConnected: false)])
    }

    func testTheSystemScanFailingWithBluetoothOffStillListsTheRememberedWatch() async throws {
        settings.watchAddress = watch
        settings.watchName = fit
        systemError = WearError(.bluetoothOff, "Bluetooth is turned off; turn it on and try again")
        let list = try await makeRuntime().bondedDevices()
        XCTAssertEqual(list.count, 1)
    }

    // MARK: events

    func testEventsFanOutToListenersAndFillTheSupportLog() {
        let runtime = makeRuntime()
        let events = RecordingEvents()
        let token = runtime.addListener(events)
        runtime.events.state(.connecting, error: nil)
        runtime.events.log(LogEntry(.tx, service: 0x01, command: 0x03, hex: "5A00", "LinkParams"))
        runtime.events.info("plain")
        runtime.events.battery(63)
        runtime.events.state(.disconnected, error: "gone")
        runtime.events.syncComplete(SyncSummary(from: 1, to: 99, samples: 0, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0))
        XCTAssertEqual(events.stateNames, ["connecting", "disconnected"])
        XCTAssertEqual(events.batteries, [63])
        XCTAssertEqual(events.syncs.count, 1)
        XCTAssertEqual(events.logs.count, 2)
        XCTAssertEqual(runtime.status.battery, 63)
        XCTAssertEqual(runtime.status.lastSyncSec, 99)
        XCTAssertEqual(runtime.status.state, .disconnected)

        // The DataSync features announce themselves while the runtime is built (as on Android); those lines are not what this test is about.
        let lines = runtime.supportLog.lines().map(\.text).filter { !$0.hasPrefix("INFO DataSync: feature ") }
        XCTAssertEqual(lines, ["STATE connecting", "TX svc=01 cmd=03 LinkParams", "INFO plain", "STATE disconnected: gone"])
        XCTAssertFalse(lines.joined().contains("5A00"), "frame hex stays out of the support log")

        runtime.removeListener(token)
        runtime.events.battery(10)
        XCTAssertEqual(events.batteries, [63])
    }

    func testSyncCompleteHookRuns() {
        let runtime = makeRuntime()
        let seen = Seen()
        runtime.onSyncComplete = { seen.add($0.to) }
        runtime.events.syncComplete(SyncSummary(from: 1, to: 7, samples: 0, sleep: 0, totalSteps: 0, totalCalories: 0, totalDistance: 0))
        XCTAssertEqual(seen.values, [7])
    }

    final class Seen: @unchecked Sendable {
        private let lock = NSLock()
        private var items: [Int64] = []
        func add(_ v: Int64) { lock.locked { items.append(v) } }
        var values: [Int64] { lock.locked { items } }
    }

    // MARK: support report

    func testSupportReportNeverContainsTheDeviceIdentifier() {
        settings.watchAddress = watch
        settings.watchName = "HUAWEI WATCH FIT 4 Pro-40A"
        let runtime = makeRuntime()
        runtime.events.info("GATT connect to \(watch), attempt 1 of 3")
        let report = runtime.supportReport()
        XCTAssertFalse((report["log"] as! String).contains(watch))
        XCTAssertTrue((report["log"] as! String).contains("(device id left out)"))
        XCTAssertEqual(report["watch"] as? String, "HUAWEI WATCH FIT 4 Pro-40A")
        XCTAssertEqual(report["support"] as? String, "tested")
        XCTAssertTrue((report["summary"] as! String).contains("Phone: Apple test"))
    }

    // MARK: background mode

    func testBackgroundStatusAndSwitching() throws {
        let runtime = makeRuntime()
        var status = runtime.backgroundStatus()
        XCTAssertEqual(status["enabled"] as? Bool, false)
        XCTAssertTrue(status["address"] is NSNull)
        XCTAssertEqual(status["syncIntervalMinutes"] as? Int, 30)
        XCTAssertEqual(status["running"] as? Bool, false)
        XCTAssertEqual(Set(status.keys), ["enabled", "address", "name", "running", "paused", "syncIntervalMinutes"])

        try runtime.setBackground(watch.lowercased())
        status = runtime.backgroundStatus()
        XCTAssertEqual(status["enabled"] as? Bool, true)
        XCTAssertEqual(status["address"] as? String, watch)
        XCTAssertEqual(status["running"] as? Bool, true)
        XCTAssertEqual(status["paused"] as? Bool, false)

        try runtime.setBackground(nil)
        status = runtime.backgroundStatus()
        XCTAssertEqual(status["enabled"] as? Bool, false)
        XCTAssertEqual(status["running"] as? Bool, false)
        XCTAssertEqual(status["address"] as? String, watch, "the remembered watch stays remembered")
    }

    func testBackgroundNeedsAPeripheralIdentifier() {
        XCTAssertThrowsError(try makeRuntime().setBackground("AA:BB:CC:DD:EE:FF")) { error in
            XCTAssertEqual((error as? WearError)?.code, .invalidAddress)
        }
    }

    func testSwitchingBackgroundToAnotherWatchForgetsTheOldName() throws {
        settings.watchAddress = watch
        settings.watchName = "HUAWEI WATCH FIT 4 Pro-40A"
        let runtime = makeRuntime()
        try runtime.setBackground("11111111-2222-3333-4444-555555555555")
        XCTAssertNil(settings.watchName)
        try runtime.setBackground(nil)
    }

    func testSyncIntervalIsValidated() throws {
        let runtime = makeRuntime()
        for bad in [4, 1441, 0, -1] {
            XCTAssertThrowsError(try runtime.setSyncInterval(bad)) { error in
                XCTAssertEqual((error as? WearError)?.code, .invalidArgument)
                XCTAssertEqual((error as? WearError)?.message, "Sync interval must be 5 to 1440 minutes, got \(bad)")
            }
        }
        try runtime.setSyncInterval(5)
        XCTAssertEqual(settings.syncIntervalMinutes, 5)
        try runtime.setSyncInterval(1440)
        XCTAssertEqual(runtime.backgroundStatus()["syncIntervalMinutes"] as? Int, 1440)
    }

    func testDisconnectInTheAppPausesBackgroundReconnect() throws {
        let runtime = makeRuntime()
        try runtime.setBackground(watch)
        runtime.disconnectFromApp()
        XCTAssertTrue(runtime.paused)
        XCTAssertEqual(runtime.backgroundStatus()["paused"] as? Bool, true)
        XCTAssertEqual(runtime.status.note, "Disconnected in the app. Connect there to resume.")
        // Switching background off and on again resumes it.
        try runtime.setBackground(nil)
        XCTAssertFalse(runtime.paused)
        try runtime.setBackground(watch)
        XCTAssertFalse(runtime.paused)
        try runtime.setBackground(nil)
    }

    func testDisconnectWithBackgroundOffDoesNotPause() {
        let runtime = makeRuntime()
        runtime.disconnectFromApp()
        XCTAssertFalse(runtime.paused)
    }

    func testForgetDropsTheRememberedWatchAndStopsBackground() throws {
        settings.watchAddress = watch
        settings.watchName = "HUAWEI WATCH FIT 4 Pro-40A"
        let runtime = makeRuntime()
        try runtime.setBackground(watch)
        runtime.forget(watch.lowercased())
        XCTAssertNil(settings.watchAddress)
        XCTAssertNil(settings.watchName)
        XCTAssertFalse(settings.backgroundEnabled)
        XCTAssertFalse(runtime.controller.isRunning)
    }

    func testEnsureBackgroundRunningRestartsTheControllerOnlyWhenOn() throws {
        let runtime = makeRuntime()
        runtime.ensureBackgroundRunning()
        XCTAssertFalse(runtime.controller.isRunning)
        settings.watchAddress = watch
        settings.backgroundEnabled = true
        runtime.ensureBackgroundRunning()
        XCTAssertTrue(runtime.controller.isRunning)
        try runtime.setBackground(nil)
    }

    func testModuleDestroyedClosesTheLinkOnlyWithBackgroundOff() async {
        let runtime = makeRuntime()
        let connect = Task { try await runtime.connectFromApp(watch) }
        await eventually("connecting") { runtime.link.currentState() == .connecting }
        runtime.onModuleDestroyed()
        _ = try? await connect.value
        XCTAssertEqual(runtime.link.currentState(), .disconnected)
    }

    // MARK: profile

    func testProfileIsValidatedStoredAndNotSentWithoutAWatch() async throws {
        let runtime = makeRuntime()
        let good = UserProfileData(heightCm: 172, weightKg: 68.5, birthYear: 1990, sex: "female", dailyStepGoal: 8000)
        let sent = try await runtime.setUserProfile(good, thisYear: 2026)
        XCTAssertFalse(sent, "stored only: no watch is connected")
        XCTAssertEqual(settings.profile, good)

        do {
            _ = try await runtime.setUserProfile(UserProfileData(heightCm: 50, weightKg: 68.5, birthYear: 1990, sex: "female", dailyStepGoal: 8000), thisYear: 2026)
            XCTFail("expected ERR_INVALID_ARGUMENT")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .invalidArgument)
            XCTAssertEqual(e.message, "Height must be 100 to 250 cm")
        }
        XCTAssertEqual(settings.profile, good, "an invalid profile is not stored")
    }

    // MARK: heart-rate zones

    func testHeartRateZonesAreValidatedStoredClearedAndNotSentWithoutAWatch() async throws {
        let runtime = makeRuntime()
        let zones = HeartRateZonesCalc.UserZones(
            method: .hrr, maxHr: 190, restingHr: 55, zones: [100, 120, 140, 160, 180], warningEnabled: false, warningLimit: 200
        )
        XCTAssertEqual(runtime.heartRateZonesStatus()["configured"] as? Bool, false)
        let sent = try await runtime.setHeartRateZones(zones)
        XCTAssertFalse(sent, "stored only: no watch is connected")
        XCTAssertEqual(settings.heartRateZones, zones)
        XCTAssertEqual(runtime.heartRateZonesStatus()["configured"] as? Bool, true)
        XCTAssertTrue(runtime.heartRateZonesStatus()["via"] is NSNull)

        var bad = zones
        bad.zones = [100, 120, 120, 160, 180]
        do {
            _ = try await runtime.setHeartRateZones(bad)
            XCTFail("expected ERR_INVALID_ARGUMENT")
        } catch let e as WearError {
            XCTAssertEqual(e.code, .invalidArgument)
        }
        XCTAssertEqual(settings.heartRateZones, zones, "invalid zones are not stored")

        _ = try await runtime.setHeartRateZones(nil)
        XCTAssertNil(settings.heartRateZones)
        XCTAssertEqual(runtime.heartRateZonesStatus()["configured"] as? Bool, false)
    }
}
