// Port of HrvSpot.kt (GB HuaweiStressCalibration startMeasurements / stopMeasurements): the 1-minute HRV measurement the user starts.
// Realtime RR intervals from the watch's PPG sensor (`19/01 {01: 3}` opens them, the watch pushes `19/05 82{83{04 rri, 05 sqi}...}`,
// `19/01 {01: 4}` closes). Service 0x19 is also where live heart rate runs (`LiveHeartRate`), so that is paused for the minute and put back
// afterwards. `collect` is shared with the automatic-stress calibration (`StressFeature`), which needs the same minute of intervals.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

/// One stored spot reading, as `measureHrv` returns it (`HrvReading` in `HuaweiWear.types.ts`). Times are unix seconds.
public struct HrvReadingData: Equatable, Sendable {
    public let start: Int64
    public let end: Int64
    public let rmssd: Double
    public let sdnn: Double
    public let meanRr: Double
    public let beats: Int
    public let heartRate: Int

    public func toJS() -> [String: Any] {
        ["start": start, "end": end, "rmssd": rmssd, "sdnn": sdnn, "meanRr": meanRr, "beats": beats, "heartRate": heartRate]
    }
}

public final class HrvSpot: @unchecked Sendable {
    /// What one minute of measuring produced; `startMs` and `endMs` are the phone's clock around the window.
    public struct Collected: Sendable {
        public let startMs: Int64
        public let endMs: Int64
        public let beats: [RriBeat]
        public let packets: Int
        /// The watch that measured (`device.address`): the reading is attributed to it.
        public let address: String
    }

    private static let logFirstPackets = 5
    private static let logPacketsEvery = 10

    private let handle: @Sendable () -> LinkHandle?
    private let liveHeartRate: LiveHeartRate
    private let syncStore: SyncStore
    private let events: WearEvents
    private let measureMs: Int64
    private let pollMs: Int
    private let wallClockMs: @Sendable () -> Int64
    private let monotonicNs: @Sendable () -> UInt64

    private let lock = NSLock()
    private var running = false
    private var cancelRequested = false

    /// `measureMs`, `pollMs` and the clocks are replaced by tests; the defaults are the real minute, polled every 200 ms.
    public init(
        handle: @escaping @Sendable () -> LinkHandle?, liveHeartRate: LiveHeartRate, syncStore: SyncStore, events: WearEvents,
        measureMs: Int64 = HrvSpotCodec.measureMs, pollMs: Int = 200,
        wallClockMs: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
        monotonicNs: @escaping @Sendable () -> UInt64 = { DispatchTime.now().uptimeNanoseconds }
    ) {
        self.handle = handle
        self.liveHeartRate = liveHeartRate
        self.syncStore = syncStore
        self.events = events
        self.measureMs = measureMs
        self.pollMs = pollMs
        self.wallClockMs = wallClockMs
        self.monotonicNs = monotonicNs
    }

    private func log(_ message: String) { events.info(message) }

    /// True while a measurement owns the sensor.
    public var isRunning: Bool { lock.locked { running } }

    /// Ends a running measurement early; its promise rejects with `ERR_HRV_CANCELLED`.
    public func cancel() { lock.locked { if running { cancelRequested = true } } }

    /// Measures for a minute, stores the result and returns it; throws a `WearError` with a code JS can show.
    public func measure() async throws -> HrvReadingData {
        let collected = try await collect()
        guard let reading = try record(collected) else { throw tooFewBeats(collected) }
        return reading
    }

    private final class Gathered: @unchecked Sendable {
        private let lock = NSLock()
        private var beats: [RriBeat] = []
        private var packets = 0

        func add(_ decoded: [RriBeat]) -> Int {
            lock.locked {
                beats += decoded
                packets += 1
                return packets
            }
        }

        var usable: Int { lock.locked { beats.filter { $0.sqi != 0 }.count } }
        var snapshot: (beats: [RriBeat], packets: Int) { lock.locked { (beats, packets) } }
    }

    /// Opens the RR stream and collects it for `measureMs`. The stream is closed and live heart rate restored whatever ends the minute: done,
    /// `cancel`, the link dropping, or the caller being cancelled.
    public func collect() async throws -> Collected {
        guard let h = handle() else { throw WearError(.notConnected, "The watch is not connected") }
        if !h.caps.supports(HrvSpotCodec.service, HrvSpotCodec.openClose) {
            throw WearError(.unsupported, "This watch does not list the heart rate report command (19/01), so it cannot measure HRV")
        }
        if liveHeartRate.workoutActive { throw WearError(.busy, "A live workout is using the heart rate sensor; finish it first") }
        let acquired = lock.locked { () -> Bool in
            if running { return false }
            running = true
            cancelRequested = false
            return true
        }
        if !acquired { throw WearError(.busy, "An HRV measurement is already running") }

        let session = h.session
        let gathered = Gathered()
        var subscription: Int?
        var opened = false
        do {
            await liveHeartRate.pause()
            let sink = events.sink
            subscription = await session.subscribe(service: UInt8(HrvSpotCodec.service), command: UInt8(HrvSpotCodec.rriData), label: "HRV RR intervals") { packet in
                let decoded = HrvSpotCodec.decodeRri(packet.tlv)
                let number = gathered.add(decoded)
                // The first reports show what the watch really sends (tags, sizes), then a sample.
                if number <= Self.logFirstPackets || number % Self.logPacketsEvery == 0 {
                    sink(
                        LogEntry(
                            .info, service: HrvSpotCodec.service, command: HrvSpotCodec.rriData,
                            "HRV: report #\(number) carried \(decoded.count) intervals: \(decoded.map { "\($0.rri)ms/q\($0.sqi)" }.joined(separator: ", ")) tlv=\(packet.tlv.map { "\($0)" } ?? "nil")"
                        )
                    )
                }
            }
            opened = true
            try await session.send(HrRriTest.OpenOrClose.request(type: HrvSpotCodec.open), label: "HRV measurement open (19/01 {01: 3})")
            let startMs = wallClockMs()
            let startNs = monotonicNs()
            var lastLeft = -1
            while true {
                let elapsedMs = Int64((monotonicNs() &- startNs) / 1_000_000)
                if elapsedMs >= measureMs { break }
                if lock.locked({ cancelRequested }) { throw WearError(.hrvCancelled, "The measurement was cancelled") }
                if let cause = await session.closeCause { throw cause }
                if handle()?.session !== session { throw WearError(.disconnected, "The watch disconnected during the measurement") }
                let left = Int((Double(measureMs - elapsedMs) / 1000.0).rounded(.up))
                if left != lastLeft {
                    lastLeft = left
                    events.hrvProgress(secondsLeft: left, beats: gathered.usable)
                }
                try await Task.sleep(nanoseconds: UInt64(pollMs) * 1_000_000)
            }
            let endMs = wallClockMs()
            let snapshot = gathered.snapshot
            events.hrvProgress(secondsLeft: 0, beats: snapshot.beats.filter { $0.sqi != 0 }.count)
            log(summary(snapshot.beats, snapshot.packets, endMs - startMs))
            await finish(session: session, subscription: subscription, opened: opened)
            return Collected(startMs: startMs, endMs: endMs, beats: snapshot.beats, packets: snapshot.packets, address: h.address)
        } catch {
            await finish(session: session, subscription: subscription, opened: opened)
            throw error
        }
    }

    /// Closes the stream, restores live heart rate and frees the sensor; runs to the end even when the calling task was cancelled.
    private func finish(session: HuaweiSession, subscription: Int?, opened: Bool) async {
        await Task {
            if let subscription { await session.unsubscribe(subscription) }
            if opened {
                do {
                    try await session.send(HrRriTest.OpenOrClose.request(type: HrvSpotCodec.close), label: "HRV measurement close (19/01 {01: 4})")
                } catch let e as WearError {
                    self.events.error("HRV measurement not closed on the watch: \(e.message)")
                } catch {
                    self.events.error("HRV measurement not closed on the watch: \(error)")
                }
            }
            self.liveHeartRate.resume()
            self.lock.locked { self.running = false }
        }.value
    }

    /// Computes RMSSD / SDNN with `HrvMath`, stores the intervals and a `spot` reading; nil when too few beats were clean.
    public func record(_ collected: Collected) throws -> HrvReadingData? {
        guard let result = HrvMath.compute(rr: collected.beats.map(\.rri), sqi: collected.beats.map(\.sqi)) else { return nil }
        let reading = HrvReadingData(
            start: collected.startMs / 1000, end: collected.endMs / 1000, rmssd: result.rmssd, sdnn: result.sdnn, meanRr: result.meanRr,
            beats: result.beats, heartRate: Int((60_000.0 / result.meanRr + 0.5).rounded(.down))
        )
        try store(reading, collected)
        log(String(format: "HRV spot: RMSSD %.1f ms, SDNN %.1f ms, mean RR %.0f ms, %d clean beats of %d", reading.rmssd, reading.sdnn, reading.meanRr, reading.beats, collected.beats.count))
        return reading
    }

    private func store(_ reading: HrvReadingData, _ collected: Collected) throws {
        let timeline = HrvSpotCodec.rriTimeline(startMs: collected.startMs, beats: collected.beats)
        do {
            try syncStore.read { db in
                try db.transaction {
                    for (tsMs, beat) in timeline {
                        try db.run("INSERT OR REPLACE INTO rri_samples (ts_ms, rri, sqi) VALUES (?, ?, ?)", [.int(tsMs), .int(Int64(beat.rri)), .int(Int64(beat.sqi))])
                    }
                    try db.run(
                        "INSERT OR REPLACE INTO hrv_readings (start, end, source, rmssd, sdnn, mean_rr, beats, device) VALUES (?, ?, 'spot', ?, ?, ?, ?, ?)",
                        [.int(reading.start), .int(reading.end), .double(reading.rmssd), .double(reading.sdnn), .double(reading.meanRr), .int(Int64(reading.beats)), .text(collected.address)]
                    )
                }
            }
        } catch let e as SQLiteError {
            throw WearError(.storage, "The HRV reading could not be stored: \(e.message)", underlying: e)
        }
    }

    /// Why `collect`'s intervals gave no reading, in words for the user.
    public func tooFewBeats(_ collected: Collected) -> WearError {
        let usable = collected.beats.filter { $0.sqi != 0 }.count
        let message: String
        if collected.beats.isEmpty {
            message = "The watch sent no beat-to-beat data (\(collected.packets) reports). Wear it snug on the wrist, sit still and try again."
        } else {
            message =
                "Only \(usable) of \(collected.beats.count) beats had a clean signal (at least \(HrvMath.minBeats) are needed). "
                + "Wear the watch snug on the wrist, sit still and try again."
        }
        return WearError(.hrvTooFewBeats, message)
    }

    private func summary(_ beats: [RriBeat], _ packets: Int, _ windowMs: Int64) -> String {
        var histogram: [Int: Int] = [:]
        for b in beats { histogram[b.sqi, default: 0] += 1 }
        // Kotlin prints the sorted map: `{0=2, 100=60}`.
        let sqi = "{" + histogram.keys.sorted().map { "\($0)=\(histogram[$0]!)" }.joined(separator: ", ") + "}"
        var text = "HRV: window \(windowMs) ms, \(packets) reports, \(beats.count) intervals, sqi histogram \(sqi)"
        if let low = beats.map(\.rri).min(), let high = beats.map(\.rri).max() { text += ", rri min \(low) max \(high) ms" }
        return text
    }
}

#endif
