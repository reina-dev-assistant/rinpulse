// Per-app notification switches on iPhone, like Huawei Health's: a fixed list of common apps plus "Other", sent to the watch as 02/0B (the
// watch reads the iPhone's notifications itself over ANCS and filters on the app identifier). The layout of 02/0B is known (Huawei Health's own
// schema), but two things are NOT proven for an iPhone: which id string the watch matches (iOS bundle ids, or Huawei's catalogue numbers) and
// which byte means "off" (docs/ios-notification-app-switches.md). So the switches stay disabled until a test on the user's own watch has found
// the encoding that works: `startTest` turns one app off with one candidate encoding at a time, the person says whether a message from that
// app still reaches the watch, and the first candidate that hides it, and lets it through again once switched back, is stored.
//
// Safety rules the test keeps:
// - a probe is ONE entry (the app under test), never the whole list: a wrong polarity guess for the whole list would silence every app;
// - the value that would switch the app back is written down (`pendingRestore`) before the probe is sent and is sent again at the next connect
//   when the test never finished (app killed, link lost), so an interrupted test cannot leave an app hidden for good;
// - leaving the screen or the app (`cancelTest`) sends that value at once.
// The one thing a restore cannot know is whether the probe took effect; it assumes the person's answer, or, for an unanswered probe, that it did.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// One way of writing an app switch: which id string, which byte means "off".
public enum NotificationFilterEncoding: String, CaseIterable, Sendable {
    /// iOS bundle id, 1 = off (what Huawei Health Android's decompile says: "closed" is 1).
    case a = "A"
    /// iOS bundle id, 0 = off (the schema's field name `notification_enable`, and huac).
    case b = "B"
    /// Huawei's own catalogue number, 1 = off.
    case c1 = "C1"
    /// Huawei's own catalogue number, 0 = off.
    case c2 = "C2"

    public var usesBundleIds: Bool { self == .a || self == .b }
    public var offValue: UInt8 { self == .a || self == .c1 ? 1 : 0 }
    public var onValue: UInt8 { offValue == 1 ? 0 : 1 }

    public var detail: String {
        switch self {
        case .a: return "bundle ids, 1 = off"
        case .b: return "bundle ids, 0 = off"
        case .c1: return "Huawei app numbers, 1 = off"
        case .c2: return "Huawei app numbers, 0 = off"
        }
    }

    /// The `app_id` string this encoding sends for `app`, or nil when the encoding has none for it (Huawei's numbers are known for a few apps only).
    public func wireId(for app: NotificationFilterApp) -> String? { usesBundleIds ? app.wireBundleId : app.huaweiAppId }
}

/// One row of the list. `key` is what JS calls `packageName`: the iOS bundle id, or `"other"`.
public struct NotificationFilterApp: Equatable, Sendable {
    public let key: String
    public let label: String
    /// The bundle id sent under A and B (differs from `key` only for "Other", whose id is a guess).
    public let wireBundleId: String
    /// Huawei Health's catalogue number (`appid` of its `message_notification_switch` config), where known.
    public let huaweiAppId: String?

    public init(key: String, label: String, wireBundleId: String? = nil, huaweiAppId: String? = nil) {
        self.key = key
        self.label = label
        self.wireBundleId = wireBundleId ?? key
        self.huaweiAppId = huaweiAppId
    }
}

public enum NotificationFilterCatalogue {
    /// ExpandCapability bit that gates 02/0B (Huawei Health: `egs.e(deviceInfo, 161)`).
    public static let gateBit = 161
    public static let otherKey = "other"

    /// Bundle ids checked against the App Store (iTunes lookup, Indonesian storefront, 2026-10-22). That they exist is verified; that the watch
    /// matches them is what the test finds out. Huawei's catalogue numbers are known only for Messages (`appid` 1); the rest of its top-100 list
    /// was cut off in the capture. Phone calls are left out: iOS delivers them under the system id `com.apple.mobilephone`, which no store
    /// lookup can confirm, and the watch's call switch is 02/04.
    public static let apps: [NotificationFilterApp] = [
        NotificationFilterApp(key: "com.apple.MobileSMS", label: "Messages", huaweiAppId: "1"),
        NotificationFilterApp(key: "net.whatsapp.WhatsApp", label: "WhatsApp"),
        NotificationFilterApp(key: "net.whatsapp.WhatsAppSMB", label: "WhatsApp Business"),
        NotificationFilterApp(key: "ph.telegra.Telegraph", label: "Telegram"),
        NotificationFilterApp(key: "com.burbn.instagram", label: "Instagram"),
        NotificationFilterApp(key: "com.google.Gmail", label: "Gmail"),
        NotificationFilterApp(key: "com.microsoft.Office.Outlook", label: "Outlook"),
        NotificationFilterApp(key: "jp.naver.line", label: "LINE"),
        NotificationFilterApp(key: "com.facebook.Messenger", label: "Messenger"),
        NotificationFilterApp(key: "com.facebook.Facebook", label: "Facebook"),
        NotificationFilterApp(key: "com.atebits.Tweetie2", label: "X"),
        NotificationFilterApp(key: "com.tinyspeck.chatlyio", label: "Slack"),
        NotificationFilterApp(key: "com.hammerandchisel.discord", label: "Discord"),
        NotificationFilterApp(key: "org.whispersystems.signal", label: "Signal"),
        NotificationFilterApp(key: "com.microsoft.skype.teams", label: "Teams"),
        NotificationFilterApp(key: "com.beeasy.shopee.id", label: "Shopee"),
        NotificationFilterApp(key: "com.tokopedia.Tokopedia", label: "Tokopedia"),
        NotificationFilterApp(key: "com.go-jek.ios", label: "Gojek"),
        NotificationFilterApp(key: "com.grabtaxi.iphone", label: "Grab"),
        NotificationFilterApp(key: "com.bca.bcamobile", label: "BCA mobile"),
        NotificationFilterApp(key: "id.bmri.livin", label: "Livin' by Mandiri"),
        NotificationFilterApp(key: "id.co.bri.newbrimobile", label: "BRImo"),
        NotificationFilterApp(key: "id.bni.wondr", label: "wondr by BNI"),
    ]

    /// "Other": every app that has no row of its own. The id the watch uses for it is unknown (no capture); `other` is a guess, and the test does
    /// not cover it.
    public static let other = NotificationFilterApp(key: otherKey, label: "Other", wireBundleId: "other")

    /// The rows in the order the screen shows them.
    public static var all: [NotificationFilterApp] { apps + [other] }

    public static func app(forKey key: String) -> NotificationFilterApp? { all.first { $0.key == key } }
}

/// What the app remembers, on this phone: the encoding the test proved, the person's switches, an unfinished test and the last result line.
public final class NotificationFilterSettings: @unchecked Sendable {
    private let defaults: UserDefaults
    private static let encodingKey = "watch_notification_filter_encoding"
    private static let choicesKey = "watch_notification_filter_choices"
    private static let pendingKey = "watch_notification_filter_pending_restore"
    private static let reportKey = "watch_notification_filter_report"

    public init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: "joyofit_settings") ?? .standard
    }

    /// nil until a test proved one: the switches stay off until then.
    public var encoding: NotificationFilterEncoding? {
        get { defaults.string(forKey: Self.encodingKey).flatMap(NotificationFilterEncoding.init(rawValue:)) }
        set {
            if let newValue { defaults.set(newValue.rawValue, forKey: Self.encodingKey) } else { defaults.removeObject(forKey: Self.encodingKey) }
        }
    }

    /// Only the apps the person touched; everything else is on.
    public var choices: [String: Bool] {
        get { (defaults.dictionary(forKey: Self.choicesKey) as? [String: Bool]) ?? [:] }
        set { defaults.set(newValue, forKey: Self.choicesKey) }
    }

    /// The single entry that undoes the probe that is on the watch (or may be).
    public var pendingRestore: Notifications.AppSwitches.Entry? {
        get {
            guard let raw = defaults.dictionary(forKey: Self.pendingKey), let id = raw["id"] as? String, let value = raw["value"] as? Int else { return nil }
            return Notifications.AppSwitches.Entry(appId: id, value: UInt8(truncatingIfNeeded: value))
        }
        set {
            if let newValue { defaults.set(["id": newValue.appId, "value": Int(newValue.value)], forKey: Self.pendingKey) } else {
                defaults.removeObject(forKey: Self.pendingKey)
            }
        }
    }

    /// The line of the last finished test (also written to the support log).
    public var report: String? {
        get { defaults.string(forKey: Self.reportKey) }
        set { if let newValue { defaults.set(newValue, forKey: Self.reportKey) } else { defaults.removeObject(forKey: Self.reportKey) } }
    }
}

/// Where a test stands, as JS sees it (`NotificationFilterTest` in HuaweiWear.types.ts).
public struct NotificationFilterTestStep: Equatable, Sendable {
    public enum Phase: String, Sendable { case probe, confirm, finished }
    public enum Outcome: String, Sendable {
        /// An encoding hid the app, and let it through again once switched back: stored.
        case winner
        /// No candidate hid the app.
        case none
        /// The app was hidden, but did not come back after switching back: the hiding was probably not the filter. Nothing stored.
        case inconclusive
        /// The person left (screen or app) before the end; the app was switched back.
        case cancelled
        /// The watch did not take a packet, or the link dropped.
        case failed
    }

    public var phase: Phase
    public var app: String
    public var candidate: NotificationFilterEncoding?
    public var step: Int
    public var steps: Int
    public var outcome: Outcome?
    public var report: String?

    public func toJS() -> [String: Any] {
        [
            "phase": phase.rawValue,
            "app": app,
            "candidate": candidate?.rawValue ?? NSNull(),
            "step": step,
            "steps": steps,
            "outcome": outcome?.rawValue ?? NSNull(),
            "report": report ?? NSNull(),
        ]
    }
}

/// What the filter needs of the link: the live session and whether iOS shares notifications with the watch. `WearLink` is the one real
/// conformer; the tests script it.
public protocol NotificationFilterLink: AnyObject, Sendable {
    func handle() -> LinkHandle?
    func ancsAuthorized() -> Bool?
}

extension WearLink: NotificationFilterLink {}

public final class NotificationAppFilter: LinkObserver, @unchecked Sendable {
    typealias Entry = Notifications.AppSwitches.Entry

    private struct Run {
        let app: NotificationFilterApp
        let candidates: [NotificationFilterEncoding]
        var index = 0
        var phase: NotificationFilterTestStep.Phase = .probe
        var trail: [String] = []
        var lastReply: Int32?
        var candidate: NotificationFilterEncoding { candidates[index] }
    }

    private let link: NotificationFilterLink
    private let events: WearEvents
    public let settings: NotificationFilterSettings
    /// One start / answer / cancel / send at a time: the screen, the background hook and a reconnect can arrive together.
    private let stepLock = AsyncLock()
    private let lock = NSLock()
    private var run: Run?
    private var finished: NotificationFilterTestStep?

    public init(link: NotificationFilterLink, events: WearEvents, settings: NotificationFilterSettings = NotificationFilterSettings()) {
        self.link = link
        self.events = events
        self.settings = settings
    }

    // MARK: LinkObserver

    /// Logs what the watch reports about 02/0B (the support report shows it for every model), switches back an interrupted test and sends the
    /// person's switches once the encoding is proven.
    public func linkConnected(_ handle: LinkHandle) async {
        let gate = handle.caps.expandCapability(NotificationFilterCatalogue.gateBit)
        let listed = handle.caps.supports(Int(Notifications.id), Int(Notifications.AppSwitches.id))
        events.info(
            "Notifications: ExpandCapability \(NotificationFilterCatalogue.gateBit) = \(gate ? "yes" : "no"), 02/0B \(listed ? "listed" : "not listed"), " +
                "app switches \(settings.encoding.map { "encoding \($0.rawValue) (\($0.detail))" } ?? "not proven yet")"
        )
        guard gate else { return }
        // The watch can report an app switched off on the watch with the same tags; the meaning of the byte is the unproven part, so it is logged only.
        _ = await handle.session.subscribe(service: Notifications.id, command: Notifications.AppSwitches.id, label: "NotificationAppSwitches report") { [events] packet in
            if let report = try? Notifications.AppSwitches.Response(packet: packet) {
                events.info("Notification app switches: the watch reported \(report.entries.map { "\($0.appId)=\($0.value)" }.joined(separator: ", "))")
            }
        }
        await stepLock.withLock { () async -> Void in
            await restorePending(handle)
            guard let encoding = settings.encoding, !settings.choices.isEmpty else { return }
            do {
                try await sendChoices(handle, encoding: encoding, why: "connect")
            } catch {
                events.error("Notification app switches not sent: \(error)")
            }
        }
    }

    /// The link is gone: a running test cannot go on. A probe that is on the watch stays in `pendingRestore` for the next connect.
    public func linkDisconnected() {
        let current: Run? = lock.locked {
            let r = run
            run = nil
            return r
        }
        if let current { finish(current, .failed, note: "the watch disconnected") }
    }

    // MARK: JS

    /// `NotificationFilterStatus` in HuaweiWear.types.ts.
    public func status() -> [String: Any] {
        let handle = link.handle()
        let encoding = settings.encoding
        let choices = settings.choices
        let step: NotificationFilterTestStep? = lock.locked { run.map(Self.step(of:)) ?? finished }
        return [
            "connected": handle != nil,
            "gate": handle?.caps.expandCapability(NotificationFilterCatalogue.gateBit) ?? false,
            "ancs": link.ancsAuthorized() ?? false,
            "encoding": encoding?.rawValue ?? NSNull(),
            "apps": NotificationFilterCatalogue.all.map { app -> [String: Any] in
                [
                    "packageName": app.key,
                    "label": app.label,
                    "enabled": choices[app.key] ?? true,
                    "sendable": encoding.map { $0.wireId(for: app) != nil } ?? false,
                ]
            },
            "test": step?.toJS() ?? NSNull(),
            "restorePending": settings.pendingRestore != nil,
            "report": settings.report ?? NSNull(),
        ]
    }

    /// `getNotificationApps`: the list with the person's switches, in the Android contract's shape.
    public func apps() -> [[String: Any]] {
        let choices = settings.choices
        return NotificationFilterCatalogue.all.map { ["packageName": $0.key, "label": $0.label, "enabled": choices[$0.key] ?? true] }
    }

    /// Stores the switch and sends the whole list when the watch is connected. Rejects until a test has proven the encoding.
    public func setEnabled(key: String, enabled: Bool) async throws {
        try await stepLock.withLock { () async throws -> Void in
            guard let app = NotificationFilterCatalogue.app(forKey: key) else { throw WearError(.invalidArgument, "Unknown app: \(key)") }
            guard let encoding = settings.encoding else {
                throw WearError(.unsupported, "The app switches are not proven on this watch yet: run the filter test first")
            }
            guard encoding.wireId(for: app) != nil else {
                throw WearError(.unsupported, "\(app.label) has no id in the proven encoding (\(encoding.detail))")
            }
            if lock.locked({ run != nil }) { throw WearError(.busy, "The filter test is running") }
            var choices = settings.choices
            choices[key] = enabled
            settings.choices = choices
            guard let handle = link.handle(), handle.caps.expandCapability(NotificationFilterCatalogue.gateBit) else {
                events.info("Notification app switches: choice kept, sent at the next connect to a watch that lists the capability")
                return
            }
            try await sendChoices(handle, encoding: encoding, why: "change")
        }
    }

    // MARK: the test

    /// Starts the test for `appKey`: the first candidate is on the watch when this returns. Throws when there is no watch, the watch does not list
    /// 02/0B (ExpandCapability 161), iOS does not share notifications with the watch (nothing to filter) or a test already runs.
    public func startTest(appKey: String) async throws -> NotificationFilterTestStep {
        try await stepLock.withLock { () async throws -> NotificationFilterTestStep in
            guard let app = NotificationFilterCatalogue.apps.first(where: { $0.key == appKey }) else {
                throw WearError(.invalidArgument, "Unknown app: \(appKey)")
            }
            guard let handle = link.handle() else { throw WearError(.notConnected, "Connect the watch to test the app switches") }
            guard handle.caps.expandCapability(NotificationFilterCatalogue.gateBit) else {
                throw WearError(.unsupported, "This watch does not list the app switches (ExpandCapability \(NotificationFilterCatalogue.gateBit))")
            }
            guard link.ancsAuthorized() == true else {
                throw WearError(.unsupported, "iOS does not share notifications with the watch yet (Settings, Bluetooth, the watch, Show Notifications)")
            }
            if lock.locked({ run != nil }) { throw WearError(.busy, "The filter test is already running") }
            // A probe an earlier test left on the watch (link lost, app killed) goes back before a new one starts.
            await restorePending(handle)
            // Huawei's numbers are known for Messages only: the number candidates need one.
            let candidates: [NotificationFilterEncoding] = app.huaweiAppId == nil ? [.a, .b] : [.a, .b, .c1, .c2]
            lock.locked {
                run = Run(app: app, candidates: candidates)
                finished = nil
            }
            events.info("Notification filter test: started for \(app.key), candidates \(candidates.map(\.rawValue).joined(separator: " "))")
            return await sendProbe(handle)
        }
    }

    /// The person's answer: `shown` is whether the test message still reached the watch. Moves to the next candidate, to the confirmation, or to
    /// the end.
    public func answerTest(shown: Bool) async throws -> NotificationFilterTestStep {
        try await stepLock.withLock { () async throws -> NotificationFilterTestStep in
            guard let current = lock.locked({ run }) else { throw WearError(.invalidArgument, "No filter test is running") }
            guard let handle = link.handle() else {
                lock.locked { run = nil }
                return finish(current, .failed, note: "the watch is not connected")
            }
            let candidate = current.candidate
            switch current.phase {
            case .probe:
                if shown {
                    // This value did not hide the app, so there is nothing to switch back; the next candidate overwrites it.
                    settings.pendingRestore = nil
                    let updated: Run = lock.locked {
                        run?.trail.append("\(candidate.rawValue)=shown")
                        return run ?? current
                    }
                    if updated.index + 1 < updated.candidates.count {
                        lock.locked { run?.index += 1 }
                        return await sendProbe(handle)
                    }
                    lock.locked { run = nil }
                    return finish(updated, .none, note: nil)
                }
                // Hidden: switch it back, then ask whether the app comes through again.
                do {
                    let code = try await restoreProbe(handle, app: current.app, candidate: candidate)
                    lock.locked {
                        run?.trail.append("\(candidate.rawValue)=hidden")
                        run?.phase = .confirm
                        run?.lastReply = code
                    }
                    events.info("Notification filter test: candidate \(candidate.rawValue) hid \(current.app.key); switched back, asking for a second message")
                    return lock.locked { run.map(Self.step(of:)) }!
                } catch {
                    lock.locked { run = nil }
                    return finish(current, .failed, note: "switching back failed: \(error)")
                }
            case .confirm:
                lock.locked { run = nil }
                if shown {
                    settings.encoding = candidate
                    var done = current
                    done.trail.append("\(candidate.rawValue)=restored")
                    // "Restore all on": the whole list, with the person's own switches (all on unless they chose otherwise), in the proven encoding.
                    do {
                        try await sendChoices(handle, encoding: candidate, why: "test finished")
                    } catch {
                        events.error("Notification app switches not sent after the test: \(error)")
                    }
                    return finish(done, .winner, note: nil)
                }
                var done = current
                done.trail.append("\(candidate.rawValue)=still hidden")
                return finish(done, .inconclusive, note: "the app did not come back after switching back")
            case .finished:
                // A run never rests in this phase; it is only the step JS sees at the end.
                lock.locked { run = nil }
                return finish(current, .failed, note: "the test was in no state to answer")
            }
        }
    }

    /// Ends a running test and puts the probe back: called when the person leaves the screen or the app goes to the background. With no running
    /// test it only returns the last result.
    @discardableResult
    public func cancelTest(reason: String) async -> NotificationFilterTestStep? {
        await stepLock.withLock { () async -> NotificationFilterTestStep? in
            guard let current = lock.locked({ () -> Run? in
                let r = run
                run = nil
                return r
            }) else {
                return lock.locked { finished }
            }
            // Whatever is pending is the probe that may be on the watch: put it back (a confirmed probe was already switched back, nothing pends).
            if let handle = link.handle() { await restorePending(handle) }
            return finish(current, .cancelled, note: reason)
        }
    }

    /// The summary lines of the support report: the capability, the encoding and the last test.
    public func supportSummary(caps: DeviceCaps?) -> [String] {
        let gate = caps.map { $0.expandCapability(NotificationFilterCatalogue.gateBit) ? "yes" : "no" } ?? "unknown"
        var lines = [
            "Notification app switches (02/0B): ExpandCapability \(NotificationFilterCatalogue.gateBit) = \(gate), " +
                "encoding \(settings.encoding.map { "\($0.rawValue) (\($0.detail))" } ?? "not proven")",
        ]
        if let report = settings.report { lines.append(report) }
        return lines
    }

    // MARK: sending

    /// One 02/0B and the result code of the answer (nil when the answer carries none).
    static func send(handle: LinkHandle, entries: [Entry], label: String) async throws -> Int32? {
        let response = try await handle.operationLock.withLock {
            try await handle.session.request(
                Notifications.AppSwitches.request(entries: entries), as: Notifications.AppSwitches.Response.self, timeoutMs: Timeouts.queryMs, label: label
            )
        }
        return response.resultCode
    }

    /// The list for the whole catalogue: every app the encoding has an id for, with the person's choice (on unless they turned it off).
    static func entries(encoding: NotificationFilterEncoding, choices: [String: Bool]) -> [Entry] {
        NotificationFilterCatalogue.all.compactMap { app in
            guard let id = encoding.wireId(for: app) else { return nil }
            return Entry(appId: id, value: (choices[app.key] ?? true) ? encoding.onValue : encoding.offValue)
        }
    }

    private func sendChoices(_ handle: LinkHandle, encoding: NotificationFilterEncoding, why: String) async throws {
        let entries = Self.entries(encoding: encoding, choices: settings.choices)
        let code = try await Self.send(handle: handle, entries: entries, label: "NotificationAppSwitches")
        let off = entries.filter { $0.value == encoding.offValue }.count
        events.info("Notification app switches: \(entries.count) apps, \(off) off, encoding \(encoding.rawValue), \(why), watch answer \(Self.describe(code))")
    }

    /// Puts the interrupted probe back (the entry saved before it was sent). Keeps it saved when that fails.
    private func restorePending(_ handle: LinkHandle) async {
        guard let pending = settings.pendingRestore else { return }
        do {
            let code = try await Self.send(handle: handle, entries: [pending], label: "NotificationAppSwitches (switch back)")
            settings.pendingRestore = nil
            events.info("Notification filter test: switched back \(pending.appId), watch answer \(Self.describe(code))")
        } catch {
            events.error("Notification filter test: could not switch back \(pending.appId): \(error)")
        }
    }

    /// Sends the probe for the run's current candidate. The entry that undoes it is saved first. A failure ends the test (`failed`).
    private func sendProbe(_ handle: LinkHandle) async -> NotificationFilterTestStep {
        guard let current = lock.locked({ run }), let wire = current.candidate.wireId(for: current.app) else {
            return NotificationFilterTestStep(phase: .finished, app: "", candidate: nil, step: 0, steps: 0, outcome: .failed, report: nil)
        }
        let candidate = current.candidate
        settings.pendingRestore = Entry(appId: wire, value: candidate.onValue)
        do {
            let code = try await Self.send(
                handle: handle, entries: [Entry(appId: wire, value: candidate.offValue)], label: "NotificationAppSwitches (test \(candidate.rawValue))"
            )
            lock.locked {
                run?.phase = .probe
                run?.lastReply = code
            }
            events.info(
                "Notification filter test: candidate \(candidate.rawValue) (\(candidate.detail)) sent for \(current.app.key) as \(wire)=\(candidate.offValue), " +
                    "watch answer \(Self.describe(code))"
            )
            return lock.locked { run.map(Self.step(of:)) }!
        } catch {
            lock.locked { run = nil }
            // The probe may have reached the watch although no answer came: try to put it back now.
            await restorePending(handle)
            return finish(current, .failed, note: "candidate \(candidate.rawValue) not sent: \(error)")
        }
    }

    private func restoreProbe(_ handle: LinkHandle, app: NotificationFilterApp, candidate: NotificationFilterEncoding) async throws -> Int32? {
        guard let wire = candidate.wireId(for: app) else { return nil }
        let code = try await Self.send(
            handle: handle, entries: [Entry(appId: wire, value: candidate.onValue)], label: "NotificationAppSwitches (test \(candidate.rawValue) back)"
        )
        settings.pendingRestore = nil
        return code
    }

    // MARK: results

    private static func step(of run: Run) -> NotificationFilterTestStep {
        NotificationFilterTestStep(
            phase: run.phase, app: run.app.key, candidate: run.candidate, step: run.index + 1, steps: run.candidates.count, outcome: nil, report: nil
        )
    }

    static func describe(_ code: Int32?) -> String { code.map(String.init) ?? "(no code)" }

    /// Ends `run` (already removed from `self.run` by the caller): stores and logs the one report line, with no message content.
    @discardableResult
    private func finish(_ run: Run, _ outcome: NotificationFilterTestStep.Outcome, note: String?) -> NotificationFilterTestStep {
        let gate = link.handle()?.caps.expandCapability(NotificationFilterCatalogue.gateBit)
        var line = "Notification filter test: \(outcome.rawValue) app=\(run.app.key)"
        line += " tried=[\(run.trail.joined(separator: ", "))]"
        if outcome == .winner { line += " encoding=\(run.candidate.rawValue) (\(run.candidate.detail))" }
        line += " gate\(NotificationFilterCatalogue.gateBit)=\(gate.map { $0 ? "yes" : "no" } ?? "unknown")"
        line += " ancs=\(link.ancsAuthorized().map { $0 ? "yes" : "no" } ?? "unknown")"
        line += " lastAnswer=\(Self.describe(run.lastReply))"
        if let note { line += " (\(note))" }
        settings.report = line
        if outcome == .failed { events.error(line) } else { events.info(line) }
        let step = NotificationFilterTestStep(
            phase: .finished, app: run.app.key, candidate: outcome == .winner ? run.candidate : nil, step: run.index + 1, steps: run.candidates.count,
            outcome: outcome, report: line
        )
        lock.locked { finished = step }
        return step
    }
}

#endif
