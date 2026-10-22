// Port of WorkoutSync.kt (Derived from Gadgetbridge, AGPL-3.0-or-later): HuaweiWorkoutSyncManager, HuaweiSupportProvider.downloadWorkoutGpsFiles and
// requests/GetWorkoutCapability.
import Foundation

/// Where `WorkoutSync` reads what is already stored and writes each finished workout. Synchronous: the sync's own cancellation must not stop a
/// workout from being stored once its parts are downloaded.
public protocol WorkoutSink: AnyObject {
    /// True when there is nothing left to download for this start/end: a complete copy is stored — **unless** the
    /// watch says it has a `_gps.bin` (`watchHasGps`) and the stored copy has no point and never attempted one.
    ///
    /// `watchHasGps` is the watch's own answer (17/07 tag 0x0e), never a guess from the sport type. A workout stored
    /// before this app downloaded GPS files is `complete = 1` with no points and would otherwise never be revisited.
    func isComplete(start: Int64, end: Int64, watchHasGps: Bool) throws -> Bool

    /// Stores the workout and its points, replacing an earlier copy with the same start. True if it is new or was incomplete.
    func save(_ record: WorkoutRecord) throws -> Bool
}

/// Port of HuaweiWorkoutSyncManager. GB drives callbacks through a request queue; here each step is an `await` with the same order and the same
/// retry rules:
///
///  1. WorkoutCount (17/07) for the window. An error answer or a count that does not match the list asks twice for each half of the window
///     instead (at most `maxSmallerTimeslotDepth` levels deep).
///  2. Per workout, in workout number order: Totals (17/08), Data (17/0A), Pace (17/0C), SwimSegments (17/0E), SpO2 (17/14), Sections
///     (17/16), then the GPS file (`<n>_gps.bin`, service 2C or 0A).
///  3. Every request that can answer with an error is repeated up to `maxRetries` times, then skipped and the workout is flagged
///     `missingData` (GB shows a toast). A timeout aborts the sync, as in GB.
///
/// Unlike GB the workout is not written to the database until its parts are downloaded, and the sync keeps going after a workout whose totals
/// could not be read. A workout cut short by a timeout is stored as incomplete and fetched again next sync.
public final class WorkoutSync: @unchecked Sendable {
    private let session: HuaweiSession
    private let caps: DeviceCaps
    private let log: LogSink
    private let downloader: FileDownloader

    /// Workouts newly stored (or completed) by `sync` so far.
    public private(set) var saved = 0

    private struct Range {
        let start: Int
        let end: Int
        let depth: Int
    }

    private static let service = 0x17
    private static let maxRetries = 3
    private static let maxSmallerTimeslotDepth = 5
    private static let sectionsNormalError: Int32 = 0x0001_E079
    /// GB uses 5 s for every workout request; the Fit 4 answers the data requests slowly, so more room here.
    private static let defaultWorkoutMs = 10_000

    /// Replaced by tests: how long one workout request waits for its answer.
    var requestTimeoutMs = WorkoutSync.defaultWorkoutMs

    public init(session: HuaweiSession, caps: DeviceCaps, log: @escaping LogSink) {
        self.session = session
        self.caps = caps
        self.log = log
        self.downloader = FileDownloader(session: session, log: log)
    }

    private func info(_ message: String) { log(LogEntry(.info, message)) }

    public func sync(startSec: Int, endSec: Int, sink: WorkoutSink) async throws {
        let supportedServices = caps.supportedCommands
        if !supportedServices.isEmpty && supportedServices[Self.service] == nil {
            info("Workout: service 0x17 not offered by the watch, workout sync skipped")
            return
        }
        let commands17 = supportedServices[Self.service].map { $0.map { $0.hex2 }.joined(separator: " ") } ?? "none"
        info(
            "Workout gates: 17/07=\(caps.supports(Self.service, 0x07)) 17/08=\(caps.supports(Self.service, 0x08)) "
                + "17/0A=\(caps.supports(Self.service, 0x0A)) 17/15=\(caps.supports(Self.service, 0x15)) "
                + "gpsNewSync(SettingRelated)=\(caps.gpsNewSync) commands17=[\(commands17)]"
        )

        let newSteps = try await queryNewSteps()
        info("Workout: from=\(startSec) to=\(endSec) newSteps=\(newSteps)")

        var queue = [Range(start: startSec, end: endSec, depth: 0)]
        while !queue.isEmpty {
            let range = queue.removeFirst()
            let label = "WorkoutCount \(range.start)..\(range.end)"
            let count: Workout.WorkoutCount.Response? = try await requestOrNil(
                Workout.WorkoutCount.request(start: Int32(truncatingIfNeeded: range.start), end: Int32(truncatingIfNeeded: range.end)), label
            )
            guard let count else {
                // The Fit 4 can leave out the 0x81 container like it does for the step counts: no workouts.
                info("Workout: no count in the answer for \(range.start)..\(range.end); nothing to sync")
                continue
            }
            if let error = count.error {
                info("Workout: error \(error) on the count for \(range.start)..\(range.end)")
                try split(&queue, range)
                continue
            }
            guard count.count != 0, let listed = count.workoutNumbers else {
                info("Workout: 0 workouts in \(range.start)..\(range.end)")
                continue
            }
            if Int(count.count) != listed.count {
                info("Workout: count \(count.count) does not match \(listed.count) entries in \(range.start)..\(range.end)")
                try split(&queue, range)
                continue
            }

            // GB: sorted by workout number, the timestamp based sync state depends on it. Stable, like Kotlin's sortedBy.
            let numbers = listed.enumerated().sorted { a, b in
                a.element.workoutNumber != b.element.workoutNumber ? a.element.workoutNumber < b.element.workoutNumber : a.offset < b.offset
            }.map { $0.element }
            info("Workout: \(numbers.count) workouts in \(range.start)..\(range.end): \(numbers.map { describe($0) }.joined(separator: ", "))")
            for n in numbers { try await syncWorkout(n, newSteps: newSteps, sink: sink) }
        }
    }

    private func split(_ queue: inout [Range], _ range: Range) throws {
        if range.depth >= Self.maxSmallerTimeslotDepth {
            throw WearError(.protocolError, "Workout: asked for a smaller timeslot too many times, giving up on \(range.start)..\(range.end)")
        }
        let half = range.start + (range.end - range.start) / 2
        info("Workout: retrying \(range.start)..\(range.end) as \(range.start)..\(half) and \(half + 1)..\(range.end)")
        queue.append(Range(start: range.start, end: half, depth: range.depth + 1))
        queue.append(Range(start: half + 1, end: range.end, depth: range.depth + 1))
    }

    /// GB GetWorkoutCapability: the ExpandCapability-free gate is the command itself (17/15).
    private func queryNewSteps() async throws -> Bool {
        if !caps.supports(Self.service, 0x15) { return false }
        let response: Workout.WorkoutCapability.Response? = try await requestOrNil(Workout.WorkoutCapability.request(), "WorkoutCapability")
        info("Workout capability: NewSteps: \(response.map { String($0.supportNewStep) } ?? "nil")")
        return response?.supportNewStep == true
    }

    private func syncWorkout(_ numbers: Workout.WorkoutCount.Response.WorkoutNumbers, newSteps: Bool, sink: WorkoutSink) async throws {
        let wn = numbers.workoutNumber
        let label = "workout \(wn)"
        let totals: Workout.WorkoutTotals.Response? = try await retrying("WorkoutTotals \(wn)") { attempt in
            let r: Workout.WorkoutTotals.Response? = try await self.requestOrNil(Workout.WorkoutTotals.request(number: wn), "WorkoutTotals \(wn)")
            guard let r else { return nil }
            if let error = r.error {
                self.info("\(label) totals: error \(error) (attempt \(attempt))")
                return nil
            }
            if r.number != wn {
                self.info("\(label) totals: incorrect workout number \(r.number)")
                return nil
            }
            return r
        }
        guard let totals else {
            info("\(label): totals failed after \(Self.maxRetries) retries, moving to the next workout")
            return
        }
        info(
            "\(label) totals: status=\(totals.status) start=\(totals.startTime) end=\(totals.endTime) calories=\(totals.calories) "
                + "distance=\(totals.distance) steps=\(totals.stepCount) time=\(totals.totalTime) duration=\(totals.duration) type=\(UInt8(bitPattern: totals.type))"
        )
        let start = Int64(UInt32(bitPattern: totals.startTime))
        let end = Int64(UInt32(bitPattern: totals.endTime))
        // The watch's own answer for this workout (17/07 tag 0x0e): it is the gate for re-fetching a stored workout
        // that has no GPS point. Never inferred from the sport — a firmware that omits the tag gets no backfill.
        let hasTrajectoryTag = (try? HuaweiTLV(parsing: numbers.rawData))?.contains(0x0e) ?? false
        let watchHasGps = hasTrajectoryTag && numbers.trajectoriesData == 1
        if try sink.isComplete(start: start, end: end, watchHasGps: watchHasGps) {
            info("\(label): already stored (start=\(start)), skipped")
            return
        }

        let parts = WorkoutParts(totals: totals)
        parts.newSteps = newSteps
        var complete = false
        var failure: Error?
        do {
            try await downloadParts(numbers, parts)
            complete = true
        } catch {
            failure = error
        }
        // A timeout or lost link keeps what was downloaded, flagged incomplete so the next sync retries.
        let record = WorkoutBuilder.build(parts, complete: complete)
        let isNew = try sink.save(record)
        if isNew { saved += 1 }
        info(
            "\(label): stored \(complete ? "complete" : "incomplete") \(record.sportName) "
                + "\(record.start)..\(record.end) dur=\(record.duration)s dist=\(record.distance)m avgHr=\(record.avgHr.map(String.init) ?? "nil") "
                + "maxHr=\(record.maxHr.map(String.init) ?? "nil") points=\(record.points.count) "
                + "(data=\(parts.samples.count) gps=\(parts.gps.count) gpsStatus=\(parts.gpsStatus)) missingData=\(parts.missingData)"
        )
        if let failure { throw failure }
    }

    private func downloadParts(_ numbers: Workout.WorkoutCount.Response.WorkoutNumbers, _ parts: WorkoutParts) async throws {
        let wn = numbers.workoutNumber
        let label = "workout \(wn)"

        for i in 0..<max(Int(numbers.dataCount), 0) {
            let l = "WorkoutData \(wn)/\(i)"
            let r: Workout.WorkoutData.Response? = try await retrying(l) { attempt in
                let isAW = self.session.params.isAW
                let r: Workout.WorkoutData.Response? = try await self.requestOrNil(
                    Workout.WorkoutData.request(workoutNumber: wn, dataNumber: Int16(truncatingIfNeeded: i), newSteps: parts.newSteps), l
                ) { try Workout.WorkoutData.Response(packet: $0, isAW: isAW) }
                guard let r else { return nil }
                if let error = r.error {
                    self.info("\(l): error \(error) (attempt \(attempt))")
                    return nil
                }
                if r.workoutNumber != wn {
                    self.info("\(l): incorrect workout number \(r.workoutNumber)")
                    return nil
                }
                if Int(r.dataNumber) != i {
                    self.info("\(l): incorrect data number \(r.dataNumber)")
                    return nil
                }
                return r
            }
            guard let r else { skipped(parts, l); continue }
            info("\(l): \(r.dataList.count) samples, interval \(r.header?.interval ?? 0)s, bitmap \(r.header?.bitmap ?? 0), inner bitmap \(r.innerBitmap)")
            parts.samples.append(contentsOf: r.dataList)
        }

        for i in 0..<max(Int(numbers.paceCount), 0) {
            let l = "WorkoutPace \(wn)/\(i)"
            let r: Workout.WorkoutPace.Response? = try await retrying(l) { attempt in
                let r: Workout.WorkoutPace.Response? = try await self.requestOrNil(
                    Workout.WorkoutPace.request(workoutNumber: wn, paceNumber: Int16(truncatingIfNeeded: i)), l
                )
                guard let r else { return nil }
                if let error = r.error {
                    self.info("\(l): error \(error) (attempt \(attempt))")
                    return nil
                }
                if r.workoutNumber != wn {
                    self.info("\(l): incorrect workout number \(r.workoutNumber)")
                    return nil
                }
                if Int(r.paceNumber) != i {
                    self.info("\(l): incorrect pace number \(r.paceNumber)")
                    return nil
                }
                return r
            }
            guard let r else { skipped(parts, l); continue }
            info("\(l): \(r.blocks.count) blocks")
            parts.paceBlocks.append(contentsOf: r.blocks)
        }

        for i in 0..<max(Int(numbers.segmentsCount), 0) {
            let l = "WorkoutSwimSegments \(wn)/\(i)"
            let r: Workout.WorkoutSwimSegments.Response? = try await retrying(l) { attempt in
                let r: Workout.WorkoutSwimSegments.Response? = try await self.requestOrNil(
                    Workout.WorkoutSwimSegments.request(workoutNumber: wn, segmentNumber: Int16(truncatingIfNeeded: i)), l
                )
                guard let r else { return nil }
                if let error = r.error {
                    self.info("\(l): error \(error) (attempt \(attempt))")
                    return nil
                }
                if r.workoutNumber != wn {
                    self.info("\(l): incorrect workout number \(r.workoutNumber)")
                    return nil
                }
                if Int(r.segmentNumber) != i {
                    self.info("\(l): incorrect swim segment number \(r.segmentNumber)")
                    return nil
                }
                return r
            }
            guard let r else { skipped(parts, l); continue }
            info("\(l): \(r.blocks.count) blocks")
            parts.swimBlocks.append(contentsOf: r.blocks)
        }

        for i in 0..<max(Int(numbers.spO2Count), 0) {
            let l = "WorkoutSpO2 \(wn)/\(i)"
            let r: Workout.WorkoutSpO2.Response? = try await retrying(l) { attempt in
                let r: Workout.WorkoutSpO2.Response? = try await self.requestOrNil(
                    Workout.WorkoutSpO2.request(workoutNumber: wn, spO2Number: Int16(truncatingIfNeeded: i)), l
                )
                guard let r else { return nil }
                if let error = r.error {
                    self.info("\(l): error \(error) (attempt \(attempt))")
                    return nil
                }
                return r
            }
            guard let r else { skipped(parts, l); continue }
            info("\(l): \(r.blocks.count) blocks")
            parts.spo2Blocks.append(contentsOf: r.blocks)
        }

        for i in 0..<max(Int(numbers.sectionsCount), 0) {
            let l = "WorkoutSections \(wn)/\(i)"
            // GB: 0x0001E079 "seems to be normal", ignored without retries and without flagging missing data.
            let normalError = Flag()
            let r: Workout.WorkoutSections.Response? = try await retrying(l) { attempt in
                let r: Workout.WorkoutSections.Response? = try await self.requestOrNil(
                    Workout.WorkoutSections.request(workoutNumber: wn, additionalDataNumber: Int16(truncatingIfNeeded: i)), l
                )
                guard let r else { return nil }
                if r.error == Self.sectionsNormalError {
                    normalError.value = true
                    self.info("\(l): error 0001E079, ignored (normal)")
                    return r
                }
                if let error = r.error {
                    self.info("\(l): error \(error) (attempt \(attempt))")
                    return nil
                }
                return r
            }
            guard let r else { skipped(parts, l); continue }
            if normalError.value { continue }
            info("\(l): \(r.blocks.count) blocks")
            parts.sectionBlocks.append(contentsOf: r.blocks)
        }

        try await downloadGps(numbers, parts)
        info("\(label): downloaded, missingData=\(parts.missingData)")
    }

    private final class Flag: @unchecked Sendable {
        var value = false
    }

    /// GB finishSingleWorkoutSync -> downloadWorkoutGpsFiles.
    private func downloadGps(_ numbers: Workout.WorkoutCount.Response.WorkoutNumbers, _ parts: WorkoutParts) async throws {
        let wn = numbers.workoutNumber
        let label = "workout \(wn) GPS"
        // WorkoutCount tag 0x0e: 1 when the watch has a _gps.bin/_pdr.bin for the workout. GB ignores it (older firmware does not send it);
        // here a watch that says 0 is believed, one that sends nothing is asked.
        let reported = (try? HuaweiTLV(parsing: numbers.rawData))?.contains(0x0e) ?? false
        info("\(label): trajectoriesData=\(numbers.trajectoriesData) (reported=\(reported))")
        if reported && numbers.trajectoriesData == 0 {
            info("\(label): watch reports no trajectory data, GPS download skipped")
            return
        }

        let data: Bytes
        do {
            data = try await downloader.download(FileRequest.workoutGps(newSync: caps.gpsNewSync, workoutId: wn))
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError {
            // A watch without a GPS file for an indoor workout answers the init with an error; that is not a failure.
            if e.code != .protocolError { throw e }
            info("\(label): no GPS file (\(e.message))")
            parts.gpsStatus = "failed"
            return
        }
        if data.isEmpty {
            info("\(label): GPS file empty")
            parts.gpsStatus = "empty"
            return
        }
        let points: [GpsPoint]
        do {
            points = try HuaweiGpsParser.parse(data)
        } catch {
            info("\(label): GPS file of \(data.count) bytes could not be parsed (\(error))")
            parts.gpsStatus = "failed"
            return
        }
        // The file parser does no range checks; a garbled file must not put NaN or off-planet points in the table.
        let valid = points.filter {
            $0.latitude.isFinite && $0.longitude.isFinite && (-90.0...90.0).contains($0.latitude) && (-180.0...180.0).contains($0.longitude)
        }
        info("\(label): received \(points.count) GPS points, \(valid.count) valid")
        if valid.isEmpty {
            parts.gpsStatus = "empty"
            return
        }
        parts.gpsStatus = "ok"
        parts.gps.append(contentsOf: valid)
    }

    private func skipped(_ parts: WorkoutParts, _ label: String) {
        info("\(label): max tries exceeded, moving to the next part")
        parts.missingData = true
    }

    /// GB: up to `maxRetries` repeats of a request that answered with an error, then nil.
    private func retrying<T>(_ label: String, _ block: (_ attempt: Int) async throws -> T?) async throws -> T? {
        var attempt = 0
        while true {
            if let value = try await block(attempt) { return value }
            if attempt >= Self.maxRetries { return nil }
            attempt += 1
            info("\(label): retry \(attempt)/\(Self.maxRetries)")
        }
    }

    /// Sends `packet` and returns the typed answer, or nil when the answer cannot be used (it did not parse: the watch answers some workout
    /// requests without the expected container). A timeout or a lost link still throws.
    private func requestOrNil<R>(_ packet: HuaweiPacket, _ label: String, parse: (HuaweiPacket) throws -> R) async throws -> R? {
        do {
            let response = try await session.request(packet, timeoutMs: requestTimeoutMs, label: label)
            do {
                return try parse(response)
            } catch let e as WearError {
                throw e
            } catch {
                throw WearError(.protocolError, "\(label): failed to parse response: \(error)", underlying: error, isParseFailure: true)
            }
        } catch let e as WearError {
            if e.code != .protocolError { throw e }
            info("\(label): unusable answer (\(e.message))")
            return nil
        }
    }

    private func requestOrNil<R: PacketResponse>(_ packet: HuaweiPacket, _ label: String) async throws -> R? {
        try await requestOrNil(packet, label) { try R(packet: $0) }
    }

    private func describe(_ n: Workout.WorkoutCount.Response.WorkoutNumbers) -> String {
        "#\(n.workoutNumber)(data=\(n.dataCount) pace=\(n.paceCount) swim=\(n.segmentsCount) spo2=\(n.spO2Count) "
            + "sections=\(n.sectionsCount) trajectories=\(n.trajectoriesData))"
    }
}
