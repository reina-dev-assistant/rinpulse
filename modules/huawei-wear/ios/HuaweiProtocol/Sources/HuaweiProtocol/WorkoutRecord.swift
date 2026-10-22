// Port of WorkoutRecord.kt (Derived from Gadgetbridge, AGPL-3.0-or-later): HuaweiWorkoutGbParser.updateBaseSummary (how the totals, data samples,
// pace and swim blocks become summary values) and HuaweiWorkoutSyncManager.addWorkoutTotalsDataToDb. GB writes these into its own database; here
// they become one `WorkoutRecord` for the app's `workouts` / `workout_points` tables, with the same `summary_json` keys as Android.
import Foundation

/// One sample of the route / heart-rate series. GPS points carry lat/lon (and the GPS altitude when the file has one); data samples carry the
/// heart rate, the barometric altitude and the per-sample motion fields. A point has only the fields its source had; a missing or zero reading
/// is nil.
///
/// Units: `speed` metres per second, `cadence` steps per minute (revolutions per minute when cycling), `stride` metres per step, `power` watts.
public struct WorkoutPoint: Equatable, Sendable {
    public let ts: Int64
    public let lat: Double?
    public let lon: Double?
    public let alt: Double?
    public let hr: Int?
    public let speed: Double?
    public let cadence: Int?
    public let stride: Double?
    public let power: Int?

    public init(
        ts: Int64, lat: Double?, lon: Double?, alt: Double?, hr: Int?,
        speed: Double? = nil, cadence: Int? = nil, stride: Double? = nil, power: Int? = nil
    ) {
        self.ts = ts
        self.lat = lat
        self.lon = lon
        self.alt = alt
        self.hr = hr
        self.speed = speed
        self.cadence = cadence
        self.stride = stride
        self.power = power
    }
}

/// One workout as stored (`workouts` row plus its points). Times are unix seconds, distance metres.
public struct WorkoutRecord: Equatable, Sendable {
    /// The watch's own workout counter (FitnessData 0x17 tag 0x02); not unique across watches or resets.
    public let number: Int
    public let start: Int64
    public let end: Int64
    /// The raw Huawei sport type byte, read unsigned.
    public let sportType: Int
    public let sportName: String
    public let duration: Int
    public let distance: Int
    public let calories: Int
    public let steps: Int
    public let avgHr: Int?
    public let maxHr: Int?
    public let summaryJson: String
    public let points: [WorkoutPoint]
    /// False while a part of the download failed; the next sync fetches the workout again.
    public let complete: Bool

    public init(
        number: Int, start: Int64, end: Int64, sportType: Int, sportName: String, duration: Int, distance: Int, calories: Int, steps: Int,
        avgHr: Int?, maxHr: Int?, summaryJson: String, points: [WorkoutPoint], complete: Bool
    ) {
        self.number = number
        self.start = start
        self.end = end
        self.sportType = sportType
        self.sportName = sportName
        self.duration = duration
        self.distance = distance
        self.calories = calories
        self.steps = steps
        self.avgHr = avgHr
        self.maxHr = maxHr
        self.summaryJson = summaryJson
        self.points = points
        self.complete = complete
    }
}

/// Everything downloaded for one workout, filled in by `WorkoutSync`.
public final class WorkoutParts {
    public let totals: Workout.WorkoutTotals.Response
    public var samples: [Workout.WorkoutData.Response.Data] = []
    public var paceBlocks: [Workout.WorkoutPace.Response.Block] = []
    public var swimBlocks: [Workout.WorkoutSwimSegments.Response.Block] = []
    public var spo2Blocks: [Workout.WorkoutSpO2.Response.Block] = []
    public var sectionBlocks: [Workout.WorkoutSections.Response.Block] = []
    public var gps: [GpsPoint] = []

    /// GB `currentWorkoutMissingData`: the watch kept refusing some part after the retries.
    public var missingData = false

    /// WorkoutCapability `supportNewStep`, GB `HuaweiWorkoutSummarySample.newSteps`.
    public var newSteps = false

    /// What happened to the GPS file: `none` (not asked), `empty`, `ok`, `failed`.
    public var gpsStatus = "none"

    public init(totals: Workout.WorkoutTotals.Response) { self.totals = totals }
}

/// An ordered JSON tree with the `org.json` value kinds the summary uses.
enum SummaryJSON {
    case int(Int64)
    case double(Double)
    case string(String)
    case bool(Bool)
    case null
    case array([SummaryJSON])
    case object([(String, SummaryJSON)])

    func serialized() -> String {
        var out = ""
        write(into: &out)
        return out
    }

    private func write(into out: inout String) {
        switch self {
        case .int(let v): out += String(v)
        case .double(let v):
            // org.json refuses NaN and infinities; none can reach here from finite wire values.
            out += v.isFinite ? "\(v)" : "null"
        case .string(let s): SummaryJSON.writeString(s, into: &out)
        case .bool(let b): out += b ? "true" : "false"
        case .null: out += "null"
        case .array(let items):
            out += "["
            for (i, item) in items.enumerated() {
                if i > 0 { out += "," }
                item.write(into: &out)
            }
            out += "]"
        case .object(let pairs):
            out += "{"
            for (i, pair) in pairs.enumerated() {
                if i > 0 { out += "," }
                SummaryJSON.writeString(pair.0, into: &out)
                out += ":"
                pair.1.write(into: &out)
            }
            out += "}"
        }
    }

    private static func writeString(_ s: String, into out: inout String) {
        out += "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
            }
        }
        out += "\""
    }
}

/// A mutable ordered JSON object; `put` replaces an existing key in place (a later `put` of the same key wins, as `JSONObject.put`).
struct SummaryObject {
    private(set) var pairs: [(String, SummaryJSON)] = []

    var isEmpty: Bool { pairs.isEmpty }

    mutating func put(_ key: String, _ value: SummaryJSON) {
        if let i = pairs.firstIndex(where: { $0.0 == key }) { pairs[i].1 = value } else { pairs.append((key, value)) }
    }

    mutating func put(_ key: String, _ value: Int) { put(key, .int(Int64(value))) }
    mutating func put(_ key: String, _ value: Int32) { put(key, .int(Int64(value))) }
    mutating func put(_ key: String, _ value: Int64) { put(key, .int(value)) }
    mutating func put(_ key: String, _ value: Double) { put(key, .double(value)) }
    mutating func put(_ key: String, _ value: String) { put(key, .string(value)) }
    mutating func put(_ key: String, _ value: Bool) { put(key, .bool(value)) }

    var json: SummaryJSON { .object(pairs) }
}

public enum WorkoutBuilder {
    public static func build(_ parts: WorkoutParts, complete: Bool) -> WorkoutRecord {
        let totals = parts.totals
        let type = Int(UInt8(bitPattern: totals.type))
        let kind = WorkoutSportTypes.kind(type)
        let start = Int64(UInt32(bitPattern: totals.startTime))
        let end = Int64(UInt32(bitPattern: totals.endTime))

        let duration: Int
        if totals.duration >= 0 {
            duration = Int(totals.duration)
        } else if totals.totalTime >= 0 {
            duration = Int(totals.totalTime)
        } else {
            duration = Int(Int32(truncatingIfNeeded: max(0, end - start)))
        }
        let distance = max(0, Int(totals.distance))
        let calories = max(0, Int(totals.calories))
        let steps = max(0, Int(totals.stepCount))

        let stats = SampleStats.of(parts, kind: kind)
        let peakMin = Int(UInt8(bitPattern: totals.minHeartRatePeak))
        let peakMax = Int(UInt8(bitPattern: totals.maxHeartRatePeak))
        let maxHr = stats.maxHr ?? (peakMax > 0 ? peakMax : nil)

        return WorkoutRecord(
            number: Int(totals.number),
            start: start,
            end: end,
            sportType: type,
            sportName: WorkoutSportTypes.name(type),
            duration: duration,
            distance: distance,
            calories: calories,
            steps: steps,
            avgHr: stats.avgHr,
            maxHr: maxHr,
            summaryJson: summaryJson(parts, kind: kind, duration: duration, distance: distance, stats: stats, peakMin: peakMin, peakMax: peakMax).json.serialized(),
            points: points(parts),
            complete: complete
        )
    }

    public static func points(_ parts: WorkoutParts) -> [WorkoutPoint] {
        var out = [WorkoutPoint]()
        out.reserveCapacity(parts.samples.count + parts.gps.count)
        let kind = WorkoutSportTypes.kind(Int(UInt8(bitPattern: parts.totals.type)))
        // Same cadence field choice as SampleStats.of: the step-rate byte for new-algorithm walking, the cadence short otherwise.
        let walkingSteps = parts.newSteps && (kind == "WALKING" || kind == "OUTDOOR_WALKING")
        for d in parts.samples {
            let hr = validHeartRate(d.heartRate)
            let alt = d.altitude.map { Double($0) / 10.0 }
            // The wire speed is decimetres per second (SampleStats.maxSpeed divides by 10 the same way); step length is centimetres.
            // 0 and -1 (0xFF in the step-rate byte) are "no reading".
            let speed: Double? = d.speed > 0 ? Double(d.speed) / 10.0 : nil
            let cadence: Int?
            if walkingSteps {
                let rate = Int(UInt8(bitPattern: d.stepRate))
                cadence = (1...0xFE).contains(rate) ? rate : nil
            } else {
                cadence = d.cadence > 0 ? Int(d.cadence) : nil
            }
            let stride: Double? = d.stepLength > 0 ? Double(d.stepLength) / 100.0 : nil
            let power: Int? = d.cyclingPower > 0 ? Int(d.cyclingPower) : nil
            if hr != nil || alt != nil || speed != nil || cadence != nil || stride != nil || power != nil {
                out.append(WorkoutPoint(
                    ts: Int64(UInt32(bitPattern: d.timestamp)), lat: nil, lon: nil, alt: alt, hr: hr,
                    speed: speed, cadence: cadence, stride: stride, power: power
                ))
            }
        }
        for p in parts.gps {
            out.append(WorkoutPoint(ts: Int64(UInt32(bitPattern: p.timestamp)), lat: p.latitude, lon: p.longitude, alt: p.altitudeSupported ? p.altitude : nil, hr: nil))
        }
        // Stable: samples before GPS points of the same second.
        return out.enumerated().sorted { a, b in a.element.ts != b.element.ts ? a.element.ts < b.element.ts : a.offset < b.offset }.map { $0.element }
    }

    /// GB: the watch's 0 and -1 (0xFF) mean "no heart rate in this sample".
    public static func validHeartRate(_ value: Int8) -> Int? {
        let hr = Int(UInt8(bitPattern: value))
        return (hr == 0 || hr == 0xFF) ? nil : hr
    }

    private static func summaryJson(_ parts: WorkoutParts, kind: String, duration: Int, distance: Int, stats: SampleStats, peakMin: Int, peakMax: Int) -> SummaryObject {
        let t = parts.totals
        var json = SummaryObject()
        json.put("kind", kind)
        json.put("number", Int(t.number))
        if t.status >= 0 { json.put("status", Int(t.status)) }
        if t.totalTime >= 0 { json.put("totalTime", t.totalTime) }
        json.put("newSteps", parts.newSteps)
        json.put("gps", parts.gpsStatus)
        json.put("gpsPoints", parts.gps.count)
        json.put("dataSamples", parts.samples.count)
        json.put("missingData", parts.missingData)
        if let raw = t.rawData { json.put("rawTotals", raw.hexUpper) }

        // GB: average speed is distance / active time; swim pace per 100 m, others per km.
        if duration > 0 && distance > 0 {
            let avgSpeed = Double(distance) / Double(duration)
            json.put("avgSpeed", avgSpeed)
            if WorkoutSportTypes.isSwim(kind) {
                json.put("avgPaceSecPer100m", 100.0 / avgSpeed)
            } else if WorkoutSportTypes.isPace(kind) {
                json.put("avgPaceSecPerKm", 1000.0 / avgSpeed)
            }
        }
        if let speed = stats.maxSpeed {
            json.put("maxSpeed", speed)
            if speed > 0 {
                if WorkoutSportTypes.isSwim(kind) {
                    json.put("minPaceSecPer100m", 100.0 / speed)
                } else if WorkoutSportTypes.isPace(kind) {
                    json.put("minPaceSecPerKm", 1000.0 / speed)
                }
            }
        }
        if kind == "JUMP_ROPING" {
            json.put("jumps", max(Int(t.stepCount), 0))
            if t.longestStreak > 0 { json.put("longestStreak", t.longestStreak) }
            if t.tripped > 0 { json.put("interruptions", t.tripped) }
        }

        if peakMin > 0 { json.put("hrPeakMin", peakMin) }
        if peakMax > 0 { json.put("hrPeakMax", peakMax) }
        if let minHr = stats.minHr { json.put("minHr", minHr) }

        // Altitudes and elevation are decimetres on the wire (GB divides by 10).
        let minAlt = t.minAltitude.map { Int($0) } ?? stats.minAlt
        let maxAlt = t.maxAltitude.map { Int($0) } ?? stats.maxAlt
        let gain = t.elevationGain.map { Int($0) } ?? stats.altUp
        let loss = t.elevationLoss.map { Int($0) } ?? stats.altDown
        if WorkoutSportTypes.isDiving(kind) {
            // GB: for diving the "elevation loss" is the maximum depth.
            if let loss { json.put("maxDepth", Double(loss) / 10.0) }
        } else {
            if let minAlt { json.put("minAltitude", Double(minAlt) / 10.0) }
            if let maxAlt { json.put("maxAltitude", Double(maxAlt) / 10.0) }
            if let gain { json.put("elevationGain", Double(gain) / 10.0) }
            if let loss { json.put("elevationLoss", Double(loss) / 10.0) }
        }
        if let avgAlt = stats.avgAlt { json.put("avgAltitude", Double(avgAlt) / 10.0) }

        if t.workoutLoad > 0 { json.put("workoutLoad", t.workoutLoad) }
        if t.workoutAerobicEffect > 0 { json.put("aerobicEffect", Double(t.workoutAerobicEffect) / 10.0) }
        if t.workoutAnaerobicEffect >= 0 { json.put("anaerobicEffect", Double(t.workoutAnaerobicEffect) / 10.0) }
        if t.recoveryTime > 0 { json.put("recoveryHours", Double(t.recoveryTime) / 60.0) }
        if t.maxMET > 0 { json.put("vo2max", Int(PacketsJava.floatToInt(Float(t.maxMET) * 3.5) / 65536)) }
        if t.trainingPoints >= 0 { json.put("trainingPoints", t.trainingPoints) }
        if t.hrZoneType >= 0 { json.put("hrZoneType", Int(t.hrZoneType)) }
        if let rec = t.recoveryHeartRates, !rec.isEmpty {
            json.put("recoveryHeartRates", .array(rec.map { .int(Int64($0)) }))
        }

        var swim = SummaryObject()
        if t.swimType >= 0 { swim.put("style", swimStyle(Int(t.swimType))) }
        if t.strokes >= 0 { swim.put("strokes", Int(t.strokes)) }
        if t.avgStrokeRate > 0 { swim.put("avgStrokeRate", Int(t.avgStrokeRate)) }
        if t.poolLength >= 0 { swim.put("poolLengthCm", Int(t.poolLength)) }
        if t.laps >= 0 { swim.put("laps", Int(t.laps)) }
        if t.avgSwolf > 0 { swim.put("avgSwolf", Int(t.avgSwolf)) }
        if !swim.isEmpty { json.put("swim", swim.json) }

        let zoneMin = [t.runPaceZone1Min, t.runPaceZone2Min, t.runPaceZone3Min, t.runPaceZone4Min, t.runPaceZone5Min]
        let zoneTime = [t.runPaceZone1Time, t.runPaceZone2Time, t.runPaceZone3Time, t.runPaceZone4Time, t.runPaceZone5Time]
        if zoneTime.contains(where: { $0 >= 0 }) {
            var zones = [SummaryJSON]()
            for i in 0..<5 {
                var z = SummaryObject()
                z.put("minPace", Int(zoneMin[i]))
                z.put("seconds", Int(zoneTime[i]))
                zones.append(z.json)
            }
            var runPace = SummaryObject()
            runPace.put("zones", .array(zones))
            runPace.put("slowestMax", Int(t.runPaceZone5Max))
            json.put("runPaceZones", runPace.json)
        }

        if !t.additionalValues.isEmpty {
            var extra = SummaryObject()
            for key in t.additionalValues.keys.sorted() { extra.put(key, t.additionalValues[key]!) }
            json.put("additional", extra.json)
        }

        stats.putAverages(&json)

        if !parts.paceBlocks.isEmpty {
            var blocks = [SummaryJSON]()
            for b in parts.paceBlocks {
                var o = SummaryObject()
                o.put("type", Int(b.type)) // GB: 0 = per km, 1 = per mile
                o.put("distance", Int(b.distance))
                o.put("correction", b.hasCorrection ? .int(Int64(b.correction)) : .null) // 1/10000 of a unit
                o.put("pace", b.pace) // seconds per unit
                o.put("pointIndex", Int(b.pointIndex))
                blocks.append(o.json)
            }
            json.put("paceBlocks", .array(blocks))
            if let (avg, fastest, slowest) = paceAggregates(parts.paceBlocks) {
                json.put("paceAvgSecPerKm", avg)
                json.put("paceFastestSecPerKm", fastest)
                json.put("paceSlowestSecPerKm", slowest)
            }
        }
        if !parts.swimBlocks.isEmpty {
            var blocks = [SummaryJSON]()
            for b in parts.swimBlocks {
                var o = SummaryObject()
                o.put("distance", Int(b.distance))
                o.put("type", Int(b.type))
                o.put("pace", b.pace)
                o.put("pointIndex", Int(b.pointIndex))
                o.put("segment", Int(b.segment))
                o.put("swimType", Int(b.swimType))
                o.put("strokes", Int(b.strokes))
                o.put("avgSwolf", Int(b.avgSwolf))
                o.put("time", b.time)
                blocks.append(o.json)
            }
            json.put("swimSegments", .array(blocks))
        }
        if !parts.spo2Blocks.isEmpty {
            var blocks = [SummaryJSON]()
            for b in parts.spo2Blocks {
                var o = SummaryObject()
                o.put("interval", b.interval)
                o.put("value", b.value)
                blocks.append(o.json)
            }
            json.put("spo2", .array(blocks))
        }
        if !parts.sectionBlocks.isEmpty {
            var blocks = [SummaryJSON]()
            for b in parts.sectionBlocks {
                var o = SummaryObject()
                o.put("num", b.num)
                o.put("time", b.time)
                o.put("distance", b.distance)
                o.put("pace", b.pace)
                o.put("heartRate", b.heartRate)
                o.put("cadence", b.cadence)
                o.put("stepLength", b.stepLength)
                o.put("totalRise", b.totalRise)
                o.put("totalDescend", b.totalDescend)
                blocks.append(o.json)
            }
            json.put("sections", .array(blocks))
        }
        return json
    }

    /// GB: over the per-km blocks (type 0), the average weighted by each block's share of a km (`correction`, 10000 = a whole km), plus the
    /// fastest and slowest. Seconds per km.
    public static func paceAggregates(_ blocks: [Workout.WorkoutPace.Response.Block]) -> (avg: Int, fastest: Int, slowest: Int)? {
        var weightSum: Int64 = 0
        var paceSum: Int64 = 0
        var fastest = Int(Int32.max)
        var slowest = 0
        for b in blocks {
            if b.type != 0 { continue }
            let weight: Int64 = b.hasCorrection ? Int64(b.correction) : 10000
            weightSum += weight
            paceSum += Int64(b.pace) * weight
            if Int(b.pace) < fastest { fastest = Int(b.pace) }
            if Int(b.pace) > slowest { slowest = Int(b.pace) }
        }
        if weightSum == 0 || paceSum == 0 { return nil }
        return (Int(Int32(truncatingIfNeeded: paceSum / weightSum)), fastest, slowest)
    }

    /// GB HuaweiWorkoutGbParser.getSwimStyle.
    public static func swimStyle(_ swimType: Int) -> String {
        switch swimType {
        case 1: return "breaststroke"
        case 3: return "butterfly"
        case 4: return "backstroke"
        case 5: return "medley"
        default: return "freestyle"
        }
    }
}

/// The aggregates GB's updateBaseSummary computes over the data samples.
struct SampleStats {
    var avgHr: Int?
    var maxHr: Int?
    var minHr: Int?

    /// Metres per second (the wire speed is decimetres per second).
    var maxSpeed: Double?

    var minAlt: Int?
    var maxAlt: Int?
    var avgAlt: Int?
    var altUp: Int?
    var altDown: Int?

    private var averages: [(String, Double)] = []
    private var extremes: [(String, Int)] = []
    /// Per-minute running form for the chart (`summary_json.dynamics`); nil without enough readings.
    private var dynamics: SummaryJSON?

    func putAverages(_ json: inout SummaryObject) {
        if let dynamics { json.put("dynamics", dynamics) }
        if averages.isEmpty && extremes.isEmpty { return }
        var out = SummaryObject()
        for (k, v) in averages { out.put(k, v) }
        for (k, v) in extremes { out.put(k, v) }
        json.put("samples", out.json)
    }

    private struct Mean {
        var sum: Int64 = 0
        var count = 0
        mutating func add(_ v: Int) { sum += Int64(v); count += 1 }
        func value() -> Double? { count > 0 ? Double(sum) / Double(count) : nil }
    }

    /// Java `Math.round(double)`: floor(x + 0.5).
    private static func round(_ x: Double) -> Int { Int((x + 0.5).rounded(.down)) }

    static func of(_ parts: WorkoutParts, kind: String) -> SampleStats {
        var s = SampleStats()
        let samples = parts.samples
        if samples.isEmpty { return s }

        var hr = Mean(), cadence = Mean(), stepLength = Mean(), contact = Mean(), swing = Mean(), impact = Mean()
        var eversion = Mean(), swolf = Mean(), strokeRate = Mean(), power = Mean(), alt = Mean()
        var maxSpeed = Int.min, maxImpact = Int.min, maxEversion = Int.min
        var minSwolf = Int.max, maxSwolf = Int.min, maxStrokeRate = Int.min
        var minPower = Int.max, maxPower = Int.min, maxFrequency = Int.min
        var minHr = Int.max, maxHr = Int.min
        var minAlt = Int.max, maxAlt = Int.min
        var previousAlt: Int?
        var up = 0, down = 0, altCount = 0

        let walkingSteps = parts.newSteps && (kind == "WALKING" || kind == "OUTDOOR_WALKING")

        for d in samples {
            if d.speed != -1 { maxSpeed = max(maxSpeed, Int(d.speed)) }
            // GB: with the new step algorithm walking reports cadence in the step-rate byte.
            if walkingSteps {
                if d.stepRate != -1 { cadence.add(Int(UInt8(bitPattern: d.stepRate))) }
            } else if d.cadence != -1 {
                cadence.add(Int(d.cadence))
            }
            if d.stepLength != -1 { stepLength.add(Int(d.stepLength)) }
            if d.groundContactTime != -1 { contact.add(Int(d.groundContactTime)) }
            if d.impact != -1 {
                impact.add(Int(d.impact))
                maxImpact = max(maxImpact, Int(d.impact))
            }
            if d.swingAngle != -1 { swing.add(Int(d.swingAngle)) }
            if d.eversionAngle != -1 {
                eversion.add(Int(d.eversionAngle))
                maxEversion = max(maxEversion, Int(d.eversionAngle))
            }
            if d.swolf != -1 {
                swolf.add(Int(d.swolf))
                minSwolf = min(minSwolf, Int(d.swolf))
                maxSwolf = max(maxSwolf, Int(d.swolf))
            }
            if d.strokeRate != -1 {
                strokeRate.add(Int(d.strokeRate))
                maxStrokeRate = max(maxStrokeRate, Int(d.strokeRate))
            }
            if let v = WorkoutBuilder.validHeartRate(d.heartRate) {
                hr.add(v)
                minHr = min(minHr, v)
                maxHr = max(maxHr, v)
            }
            if d.frequency != -1 { maxFrequency = max(maxFrequency, Int(d.frequency)) }
            if d.cyclingPower != -1 {
                power.add(Int(d.cyclingPower))
                minPower = min(minPower, Int(d.cyclingPower))
                maxPower = max(maxPower, Int(d.cyclingPower))
            }
            if let a32 = d.altitude {
                let a = Int(a32)
                alt.add(a)
                altCount += 1
                minAlt = min(minAlt, a)
                maxAlt = max(maxAlt, a)
                if let prev = previousAlt {
                    if a > prev { up += a - prev } else { down += prev - a }
                }
                previousAlt = a
            }
        }

        s.avgHr = hr.value().map { round($0) }
        if hr.count > 0 {
            s.maxHr = maxHr
            s.minHr = minHr
        }
        if maxSpeed != Int.min { s.maxSpeed = Double(maxSpeed) / 10.0 }
        if altCount > 0 {
            s.minAlt = minAlt
            s.maxAlt = maxAlt
            s.avgAlt = alt.value().map { round($0) }
            s.altUp = up
            s.altDown = down
        }
        if let v = cadence.value() { s.averages.append((walkingSteps ? "avgStepRate" : "avgCadence", v)) }
        if let v = stepLength.value() { s.averages.append(("avgStepLength", v)) }
        if let v = contact.value() { s.averages.append(("avgGroundContactTime", v)) }
        if let v = swing.value() { s.averages.append(("avgSwingAngle", v)) }
        if let v = impact.value() { s.averages.append(("avgImpact", v)) }
        if let v = eversion.value() { s.averages.append(("avgEversionAngle", v)) }
        if let v = swolf.value() { s.averages.append(("avgSwolf", v)) }
        if let v = strokeRate.value() { s.averages.append(("avgStrokeRate", v)) }
        if let v = power.value() { s.averages.append(("avgPower", v)) }
        if maxImpact != Int.min { s.extremes.append(("maxImpact", maxImpact)) }
        if maxEversion != Int.min { s.extremes.append(("maxEversionAngle", maxEversion)) }
        if minSwolf != Int.max { s.extremes.append(("minSwolf", minSwolf)) }
        if maxSwolf != Int.min { s.extremes.append(("maxSwolf", maxSwolf)) }
        if maxStrokeRate != Int.min { s.extremes.append(("maxStrokeRate", maxStrokeRate)) }
        if minPower != Int.max { s.extremes.append(("minPower", minPower)) }
        if maxPower != Int.min { s.extremes.append(("maxPower", maxPower)) }
        if maxFrequency > 0 { s.extremes.append(("maxJumpRate", maxFrequency)) }
        // Running form: means over the readings that exist (replaces the contact-time mean above, which also counted zeros) and the chart series.
        if let dyn = RunDynamics.of(samples) {
            for (k, v) in dyn.averages {
                if let i = s.averages.firstIndex(where: { $0.0 == k }) { s.averages[i].1 = v } else { s.averages.append((k, v)) }
            }
            s.dynamics = dyn.series
        }
        return s
    }
}
