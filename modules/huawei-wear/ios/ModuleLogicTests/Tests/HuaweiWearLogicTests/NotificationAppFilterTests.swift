import XCTest
@testable import HuaweiWearLogic

private typealias Entry = Notifications.AppSwitches.Entry

/// Plays the watch: decodes what is written (transactions are not encrypted here), records every 02/0B and answers it with result code 100000.
private final class AppSwitchWatch: FrameSink, @unchecked Sendable {
    private let lock = NSLock()
    private var assembler = PacketAssembler()
    private var _requests: [[Entry]] = []
    private var _failNext = 0
    weak var session: HuaweiSession?
    let params = ParamsProvider()

    init() { params.transactionsCrypted = false }

    var requests: [[Entry]] { lock.locked { _requests } }
    var last: [Entry] { requests.last ?? [] }
    /// The next `count` writes fail as a dropped link would.
    func failNext(_ count: Int = 1) { lock.locked { _failNext = count } }

    func write(_ frames: [Bytes]) async throws {
        let failing: Bool = lock.locked {
            if _failNext > 0 { _failNext -= 1; return true }
            return false
        }
        if failing { throw WearError(.disconnected, "link dropped") }
        for frame in frames {
            let result = try lock.locked { try assembler.feed(frame, params: params) }
            guard let packet = result.packet, packet.serviceId == Notifications.id, packet.commandId == Notifications.AppSwitches.id else { continue }
            let parsed = try Notifications.AppSwitches.Response(packet: packet)
            lock.locked { _requests.append(parsed.entries) }
            var reply = HuaweiTLV()
            reply.put(0x7F, int: 100_000)
            let answer = HuaweiPacket(serviceId: Notifications.id, commandId: Notifications.AppSwitches.id, tlv: reply, isEncrypted: false, isSliced: false)
            for out in try answer.serialize(params: params) { session?.onData(out) }
        }
    }
}

private final class AppSwitchLink: NotificationFilterLink, @unchecked Sendable {
    private let lock = NSLock()
    private var _handle: LinkHandle?
    private var _ancs: Bool? = true
    var handleValue: LinkHandle? {
        get { lock.locked { _handle } }
        set { lock.locked { _handle = newValue } }
    }
    var ancs: Bool? {
        get { lock.locked { _ancs } }
        set { lock.locked { _ancs = newValue } }
    }
    func handle() -> LinkHandle? { handleValue }
    func ancsAuthorized() -> Bool? { ancs }
}

final class NotificationAppFilterTests: XCTestCase {
    private let messages = "com.apple.MobileSMS"
    private let whatsApp = "net.whatsapp.WhatsApp"

    private struct Rig {
        let filter: NotificationAppFilter
        let watch: AppSwitchWatch
        let link: AppSwitchLink
        let settings: NotificationFilterSettings
        let events: RecordingEvents
        let handle: LinkHandle
    }

    /// A connected watch that lists the 02/0B capability (ExpandCapability bit 161) unless `gate` is false.
    private func rig(gate: Bool = true, defaults: UserDefaults? = nil) -> Rig {
        let watch = AppSwitchWatch()
        let session = HuaweiSession(sink: watch, log: { _ in })
        session.params.transactionsCrypted = false
        watch.session = session
        let caps = DeviceCaps()
        caps.supportedCommands = [0x02: [0x01, 0x04, 0x0B]]
        if gate {
            var bitmap = Bytes(repeating: 0, count: 24)
            bitmap[161 / 8] |= UInt8(1 << (161 % 8))
            caps.expandCapabilities = bitmap
        }
        let handle = LinkHandle(address: "A", session: session, caps: caps, operationLock: AsyncLock())
        let link = AppSwitchLink()
        link.handleValue = handle
        let settings = NotificationFilterSettings(defaults: defaults ?? ephemeralDefaults())
        let events = RecordingEvents()
        return Rig(filter: NotificationAppFilter(link: link, events: events, settings: settings), watch: watch, link: link, settings: settings, events: events, handle: handle)
    }

    private func entry(_ id: String, _ value: UInt8) -> Entry { Entry(appId: id, value: value) }

    // MARK: the list

    func testTheCatalogueIsTheRequestedAppsAndOther() {
        let keys = NotificationFilterCatalogue.all.map(\.key)
        XCTAssertEqual(keys.count, Set(keys).count, "one row per app")
        for key in [
            "com.apple.MobileSMS", "net.whatsapp.WhatsApp", "net.whatsapp.WhatsAppSMB", "ph.telegra.Telegraph", "com.burbn.instagram", "com.google.Gmail",
            "com.microsoft.Office.Outlook", "jp.naver.line", "com.facebook.Messenger", "com.facebook.Facebook", "com.atebits.Tweetie2", "com.tinyspeck.chatlyio",
            "com.hammerandchisel.discord", "org.whispersystems.signal", "com.microsoft.skype.teams", "com.beeasy.shopee.id", "com.tokopedia.Tokopedia",
            "com.go-jek.ios", "com.grabtaxi.iphone", "com.bca.bcamobile", "other",
        ] {
            XCTAssertTrue(keys.contains(key), key)
        }
        XCTAssertEqual(NotificationFilterCatalogue.all.last?.key, "other")
    }

    func testTheEncodingsWriteIdAndByteAsDocumented() {
        let sms = NotificationFilterCatalogue.app(forKey: messages)!
        let line = NotificationFilterCatalogue.app(forKey: "jp.naver.line")!
        XCTAssertEqual(NotificationFilterEncoding.a.wireId(for: sms), messages)
        XCTAssertEqual(NotificationFilterEncoding.c1.wireId(for: sms), "1")
        XCTAssertNil(NotificationFilterEncoding.c2.wireId(for: line), "Huawei's number is only known for Messages")
        XCTAssertEqual([NotificationFilterEncoding.a, .b, .c1, .c2].map(\.offValue), [1, 0, 1, 0])
        XCTAssertEqual([NotificationFilterEncoding.a, .b, .c1, .c2].map(\.onValue), [0, 1, 0, 1])
    }

    func testTheWholeListUsesTheEncodingAndTheChoices() {
        let all = NotificationAppFilter.entries(encoding: .a, choices: [:])
        XCTAssertEqual(all.count, NotificationFilterCatalogue.all.count)
        XCTAssertTrue(all.allSatisfy { $0.value == 0 }, "A: on is 0")
        let off = NotificationAppFilter.entries(encoding: .b, choices: [whatsApp: false])
        XCTAssertEqual(off.first { $0.appId == whatsApp }?.value, 0, "B: off is 0")
        XCTAssertEqual(off.first { $0.appId == messages }?.value, 1)
        let numbers = NotificationAppFilter.entries(encoding: .c1, choices: [messages: false])
        XCTAssertEqual(numbers, [entry("1", 1)], "only Messages has a number")
    }

    // MARK: the test

    func testTheTestNeedsAWatchTheCapabilityAndAnAuthorizedANCS() async throws {
        let r = rig()
        r.link.handleValue = nil
        await assertThrows(.notConnected) { _ = try await r.filter.startTest(appKey: self.messages) }
        r.link.handleValue = r.handle

        let noGate = rig(gate: false)
        await assertThrows(.unsupported) { _ = try await noGate.filter.startTest(appKey: self.messages) }
        XCTAssertTrue(noGate.watch.requests.isEmpty)

        r.link.ancs = false
        await assertThrows(.unsupported) { _ = try await r.filter.startTest(appKey: self.messages) }
        r.link.ancs = true
        await assertThrows(.invalidArgument) { _ = try await r.filter.startTest(appKey: "other") }
        XCTAssertTrue(r.watch.requests.isEmpty, "nothing reached the watch")
    }

    func testFirstCandidateHidesTheAppAndSwitchingBackBringsItBack() async throws {
        let r = rig()
        var step = try await r.filter.startTest(appKey: messages)
        XCTAssertEqual(step.phase, .probe)
        XCTAssertEqual(step.candidate, .a)
        XCTAssertEqual(step.steps, 4)
        XCTAssertEqual(r.watch.requests, [[entry(messages, 1)]], "one entry, A: 1 = off")
        XCTAssertEqual(r.settings.pendingRestore, entry(messages, 0), "the undo is written down before it is needed")

        step = try await r.filter.answerTest(shown: false)
        XCTAssertEqual(step.phase, .confirm)
        XCTAssertEqual(r.watch.last, [entry(messages, 0)], "switched back")
        XCTAssertNil(r.settings.pendingRestore)
        XCTAssertNil(r.settings.encoding, "not stored before the app came back")

        step = try await r.filter.answerTest(shown: true)
        XCTAssertEqual(step.phase, .finished)
        XCTAssertEqual(step.outcome, .winner)
        XCTAssertEqual(step.candidate, .a)
        XCTAssertEqual(r.settings.encoding, .a)
        XCTAssertEqual(r.watch.last.count, NotificationFilterCatalogue.all.count, "then everything is sent, all on")
        XCTAssertTrue(r.watch.last.allSatisfy { $0.value == 0 })
        let report = try XCTUnwrap(step.report)
        XCTAssertTrue(report.contains("winner"), report)
        XCTAssertTrue(report.contains("A=hidden"), report)
        XCTAssertEqual(r.settings.report, report)
        XCTAssertTrue(r.events.messages().contains(report), "the line is in the support log")
        let shown = r.filter.status()["test"] as? [String: Any]
        XCTAssertEqual(shown?["outcome"] as? String, "winner", "the finished step stays for the screen")
    }

    func testASecondCandidateIsTriedWhenTheFirstDidNotHide() async throws {
        let r = rig()
        _ = try await r.filter.startTest(appKey: whatsApp)
        XCTAssertEqual(r.watch.last, [entry(whatsApp, 1)])
        var step = try await r.filter.answerTest(shown: true)
        XCTAssertEqual(step.phase, .probe)
        XCTAssertEqual(step.candidate, .b)
        XCTAssertEqual(step.steps, 2, "no Huawei number for WhatsApp: only the two bundle id candidates")
        XCTAssertEqual(r.watch.last, [entry(whatsApp, 0)], "B: 0 = off")
        XCTAssertEqual(r.settings.pendingRestore, entry(whatsApp, 1))

        step = try await r.filter.answerTest(shown: false)
        XCTAssertEqual(r.watch.last, [entry(whatsApp, 1)])
        step = try await r.filter.answerTest(shown: true)
        XCTAssertEqual(step.outcome, .winner)
        XCTAssertEqual(r.settings.encoding, .b)
        XCTAssertEqual(r.watch.last.first { $0.appId == whatsApp }?.value, 1, "B: on is 1")
    }

    func testMessagesTriesTheHuaweiNumbersAfterTheBundleIds() async throws {
        let r = rig()
        _ = try await r.filter.startTest(appKey: messages)
        _ = try await r.filter.answerTest(shown: true)
        var step = try await r.filter.answerTest(shown: true)
        XCTAssertEqual(step.candidate, .c1)
        XCTAssertEqual(r.watch.last, [entry("1", 1)])
        step = try await r.filter.answerTest(shown: true)
        XCTAssertEqual(step.candidate, .c2)
        XCTAssertEqual(r.watch.last, [entry("1", 0)])
        step = try await r.filter.answerTest(shown: true)
        XCTAssertEqual(step.outcome, NotificationFilterTestStep.Outcome.none)
        XCTAssertNil(r.settings.encoding)
        XCTAssertNil(r.settings.pendingRestore, "every value tried left the app showing: nothing to switch back")
        XCTAssertEqual(r.watch.requests.count, 4, "no restore, no list")
        XCTAssertTrue(try XCTUnwrap(step.report).contains("A=shown, B=shown, C1=shown, C2=shown"))
    }

    func testAnAppThatStaysHiddenAfterSwitchingBackStoresNothing() async throws {
        let r = rig()
        _ = try await r.filter.startTest(appKey: messages)
        _ = try await r.filter.answerTest(shown: false)
        let step = try await r.filter.answerTest(shown: false)
        XCTAssertEqual(step.outcome, .inconclusive)
        XCTAssertNil(r.settings.encoding)
        XCTAssertEqual(r.watch.requests.count, 2, "the probe and the switch back, no list")
    }

    func testLeavingTheScreenSwitchesTheProbeBack() async throws {
        let r = rig()
        _ = try await r.filter.startTest(appKey: messages)
        let step = await r.filter.cancelTest(reason: "left the screen")
        XCTAssertEqual(step?.outcome, .cancelled)
        XCTAssertEqual(r.watch.last, [entry(messages, 0)], "all on again: the probe's own undo")
        XCTAssertNil(r.settings.pendingRestore)
        XCTAssertNil(r.settings.encoding)
        XCTAssertEqual(r.filter.status()["restorePending"] as? Bool, false)
        // With nothing running there is nothing to send.
        let before = r.watch.requests.count
        _ = await r.filter.cancelTest(reason: "left again")
        XCTAssertEqual(r.watch.requests.count, before)
    }

    func testATestCannotStartTwiceAndAnAnswerNeedsATest() async throws {
        let r = rig()
        await assertThrows(.invalidArgument) { _ = try await r.filter.answerTest(shown: true) }
        r.settings.encoding = .a // a re-test of a proven encoding: the switches wait for it to end
        _ = try await r.filter.startTest(appKey: messages)
        await assertThrows(.busy) { _ = try await r.filter.startTest(appKey: self.whatsApp) }
        await assertThrows(.busy) { try await r.filter.setEnabled(key: self.whatsApp, enabled: false) }
    }

    func testAProbeThatCouldNotBeSentEndsTheTestAndTriesToPutItBack() async throws {
        let r = rig()
        r.watch.failNext()
        let step = try await r.filter.startTest(appKey: messages)
        XCTAssertEqual(step.outcome, .failed)
        XCTAssertNil(r.settings.pendingRestore, "the probe's undo went out right after")
        XCTAssertEqual(r.watch.requests.count, 1, "only the undo was recorded: the probe never arrived")
        XCTAssertEqual(r.watch.last, [entry(messages, 0)])
    }

    func testALostLinkLeavesTheUndoForTheNextConnect() async throws {
        let defaults = ephemeralDefaults()
        let r = rig(defaults: defaults)
        _ = try await r.filter.startTest(appKey: messages)
        r.link.handleValue = nil
        r.filter.linkDisconnected()
        XCTAssertEqual(r.filter.status()["restorePending"] as? Bool, true)
        let test = r.filter.status()["test"] as? [String: Any]
        XCTAssertEqual(test?["outcome"] as? String, "failed")

        // A new session (the app was killed in between: same defaults, new objects).
        let again = rig(defaults: defaults)
        XCTAssertEqual(again.settings.pendingRestore, entry(messages, 0), "it survived in the defaults")
        await again.filter.linkConnected(again.handle)
        XCTAssertEqual(again.watch.requests, [[entry(messages, 0)]])
        XCTAssertNil(again.settings.pendingRestore)
    }

    // MARK: the switches

    func testSwitchesAreRefusedUntilATestProvedTheEncoding() async throws {
        let r = rig()
        await assertThrows(.unsupported) { try await r.filter.setEnabled(key: self.whatsApp, enabled: false) }
        XCTAssertTrue(r.watch.requests.isEmpty)
        let status = r.filter.status()
        XCTAssertTrue(status["encoding"] is NSNull)
        let apps = try XCTUnwrap(status["apps"] as? [[String: Any]])
        XCTAssertTrue(apps.allSatisfy { $0["sendable"] as? Bool == false })
        XCTAssertTrue(apps.allSatisfy { $0["enabled"] as? Bool == true })
    }

    func testASwitchIsStoredAndTheWholeListIsSent() async throws {
        let r = rig()
        r.settings.encoding = .a
        try await r.filter.setEnabled(key: whatsApp, enabled: false)
        XCTAssertEqual(r.settings.choices, [whatsApp: false])
        XCTAssertEqual(r.watch.requests.count, 1)
        XCTAssertEqual(r.watch.last.first { $0.appId == whatsApp }?.value, 1, "A: off is 1")
        XCTAssertEqual(r.watch.last.filter { $0.value == 1 }.count, 1)
        let apps = r.filter.apps()
        XCTAssertEqual(apps.first { $0["packageName"] as? String == whatsApp }?["enabled"] as? Bool, false)
        XCTAssertEqual(apps.first { $0["packageName"] as? String == messages }?["enabled"] as? Bool, true)
    }

    func testASwitchWithoutAWatchIsKeptAndSentAtTheNextConnect() async throws {
        let r = rig()
        r.settings.encoding = .b
        r.link.handleValue = nil
        try await r.filter.setEnabled(key: whatsApp, enabled: false)
        XCTAssertTrue(r.watch.requests.isEmpty)
        await r.filter.linkConnected(r.handle)
        XCTAssertEqual(r.watch.requests.count, 1, "on connect")
        XCTAssertEqual(r.watch.last.first { $0.appId == whatsApp }?.value, 0, "B: off is 0")
    }

    func testNothingIsSentOnConnectUntilThePersonChoseSomething() async {
        let r = rig()
        r.settings.encoding = .a
        await r.filter.linkConnected(r.handle)
        XCTAssertTrue(r.watch.requests.isEmpty, "a watch's list set elsewhere is left alone")
        XCTAssertTrue(r.events.messages().contains { $0.contains("ExpandCapability 161 = yes") && $0.contains("encoding A") })
    }

    func testAWatchWithoutTheCapabilityIsNeverSent02_0B() async throws {
        let r = rig(gate: false)
        r.settings.encoding = .a
        r.settings.choices = [whatsApp: false]
        r.settings.pendingRestore = entry(messages, 0)
        await r.filter.linkConnected(r.handle)
        XCTAssertTrue(r.watch.requests.isEmpty)
        XCTAssertTrue(r.events.messages().contains { $0.contains("ExpandCapability 161 = no") })
        try await r.filter.setEnabled(key: messages, enabled: false)
        XCTAssertTrue(r.watch.requests.isEmpty, "stored, not sent")
        XCTAssertEqual(r.filter.status()["gate"] as? Bool, false)
    }

    func testTheSupportSummaryNamesTheGateTheEncodingAndTheLastTest() async throws {
        let r = rig()
        var lines = r.filter.supportSummary(caps: r.handle.caps)
        XCTAssertEqual(lines, ["Notification app switches (02/0B): ExpandCapability 161 = yes, encoding not proven"])
        _ = try await r.filter.startTest(appKey: messages)
        _ = try await r.filter.answerTest(shown: false)
        _ = try await r.filter.answerTest(shown: true)
        lines = r.filter.supportSummary(caps: r.handle.caps)
        XCTAssertEqual(lines.count, 2)
        XCTAssertTrue(lines[0].contains("encoding A (bundle ids, 1 = off)"))
        XCTAssertTrue(lines[1].hasPrefix("Notification filter test: winner app=com.apple.MobileSMS"))
        XCTAssertFalse(lines.joined().lowercased().contains("message content"))
    }

    func testTheStatusShapeIsWhatJSReads() async throws {
        let r = rig()
        r.settings.encoding = .c1
        let status = r.filter.status()
        XCTAssertEqual(Set(status.keys), ["connected", "gate", "ancs", "encoding", "apps", "test", "restorePending", "report"])
        XCTAssertEqual(status["encoding"] as? String, "C1")
        let apps = try XCTUnwrap(status["apps"] as? [[String: Any]])
        XCTAssertEqual(apps.filter { $0["sendable"] as? Bool == true }.compactMap { $0["packageName"] as? String }, [messages])
    }

    /// Writes the JS shapes for check-inert-shapes.mjs (next to INERT_SHAPES_OUT, as `<name>.notification-filter.json`) when it is set.
    func testDumpShapesForTheTypeScriptCheck() async throws {
        guard let out = ProcessInfo.processInfo.environment["INERT_SHAPES_OUT"] else { return }
        let r = rig()
        let fresh = r.filter.status()
        let probe = try await r.filter.startTest(appKey: messages)
        let proving = r.filter.status()
        _ = try await r.filter.answerTest(shown: false)
        let finished = try await r.filter.answerTest(shown: true)
        let proven = r.filter.status()
        let shapes: [String: Any] = [
            "NotificationFilterStatus": fresh,
            "NotificationFilterStatus#testing": proving,
            "NotificationFilterStatus#proven": proven,
            "NotificationFilterTest": probe.toJS(),
            "NotificationFilterTest#finished": finished.toJS(),
        ]
        let url = URL(fileURLWithPath: out)
        let target = url.deletingLastPathComponent().appendingPathComponent(url.deletingPathExtension().lastPathComponent + ".notification-filter.json")
        try JSONSerialization.data(withJSONObject: shapes, options: [.sortedKeys]).write(to: target)
    }

    // MARK: helpers

    private func assertThrows(_ code: ErrorCode, file: StaticString = #filePath, line: UInt = #line, _ body: () async throws -> Void) async {
        do {
            try await body()
            XCTFail("expected \(code)", file: file, line: line)
        } catch let e as WearError {
            XCTAssertEqual(e.code, code, file: file, line: line)
        } catch {
            XCTFail("\(error)", file: file, line: line)
        }
    }
}
