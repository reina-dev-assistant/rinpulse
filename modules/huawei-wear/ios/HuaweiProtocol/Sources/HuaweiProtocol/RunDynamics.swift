import Foundation

/// Running form the watch sends in the inner part of a workout data sample (Gadgetbridge `WorkoutData.Response.Data`): ground contact
/// time (ms), vertical oscillation (`vo`, wire value / 10), vertical ratio (`vr`, wire value / 10, percent), ground contact balance
/// (`gtb`, wire value / 100, percent) and hang time (ms). The three floats default to 0 and the shorts to -1 when the sample did not
/// carry them; both mean "no reading" here. Mirrors `RunDynamics.kt`.
///
/// `of` gives the means for `summary_json.samples` and a per-minute series for the chart (`summary_json.dynamics`).
enum RunDynamics {
    /// One bucket of the chart series: long enough to smooth a stride-by-stride reading, short enough to show a fade.
    static let bucketSec = 60

    struct Result {
        var averages: [(String, Double)]
        var series: SummaryJSON?
    }

    private struct Acc {
        var sum = 0.0
        var count = 0
        mutating func add(_ v: Double) { sum += v; count += 1 }
        func mean() -> Double? { count > 0 ? sum / Double(count) : nil }
    }

    private struct Field {
        let key: String
        let averageKey: String
        let read: (Workout.WorkoutData.Response.Data) -> Double?
        var all = Acc()
        var buckets: [Int: Acc] = [:]
    }

    private static func newFields() -> [Field] {
        [
            Field(key: "gct", averageKey: "avgGroundContactTime", read: { $0.groundContactTime > 0 ? Double($0.groundContactTime) : nil }),
            Field(key: "vo", averageKey: "avgVerticalOscillation", read: { $0.vo > 0 ? Double($0.vo) : nil }),
            Field(key: "vr", averageKey: "avgVerticalRatio", read: { $0.vr > 0 ? Double($0.vr) : nil }),
            Field(key: "gtb", averageKey: "avgGroundContactBalance", read: { $0.gtb > 0 ? Double($0.gtb) : nil }),
            Field(key: "hang", averageKey: "avgHangTimeMs", read: { $0.hangTime > 0 ? Double($0.hangTime) : nil }),
        ]
    }

    static func of(_ samples: [Workout.WorkoutData.Response.Data]) -> Result? {
        var fields = newFields()
        var first: Int64?
        for d in samples where d.timestamp != -1 {
            let ts = Int64(UInt32(bitPattern: d.timestamp))
            if first == nil || ts < first! { first = ts }
        }
        var any = false
        for d in samples {
            var bucket: Int?
            if d.timestamp != -1, let first {
                bucket = Int((Int64(UInt32(bitPattern: d.timestamp)) - first) / Int64(bucketSec))
            }
            for i in fields.indices {
                guard let v = fields[i].read(d) else { continue }
                any = true
                fields[i].all.add(v)
                if let bucket { fields[i].buckets[bucket, default: Acc()].add(v) }
            }
        }
        if !any { return nil }

        var averages: [(String, Double)] = []
        for f in fields { if let m = f.all.mean() { averages.append((f.averageKey, m)) } }

        let lastBucket = fields.map { $0.buckets.keys.max() ?? -1 }.max() ?? -1
        var series: SummaryJSON?
        if lastBucket >= 1, let first {
            var out = SummaryObject()
            out.put("start", first)
            out.put("stepSec", bucketSec)
            for f in fields where !f.buckets.isEmpty {
                var arr: [SummaryJSON] = []
                for i in 0...lastBucket {
                    if let m = f.buckets[i]?.mean() { arr.append(.double((m * 100).rounded() / 100)) } else { arr.append(.null) }
                }
                out.put(f.key, .array(arr))
            }
            series = out.json
        }
        return Result(averages: averages, series: series)
    }

    /// The summary with the running form replaced; `changed` is false when the watch's readings give what the summary already had.
    struct Merged {
        let json: String
        let changed: Bool
    }

    private static let averageKeys = [
        "avgGroundContactTime", "avgVerticalOscillation", "avgVerticalRatio", "avgGroundContactBalance", "avgHangTimeMs",
    ]

    /// Puts `result` into a stored `summary_json` and leaves every other field as it was: the five means under `samples` are replaced (an
    /// older sync's contact-time mean, which also counted zero readings, goes with them) and `dynamics` is replaced or dropped as the new
    /// series says. Nil when `summaryJson` is not a JSON object. Running it again with the same readings changes nothing. Mirrors
    /// `RunDynamics.merge` in Kotlin; the keys come out sorted, which no reader depends on.
    static func merge(summaryJson: String, result: Result) -> Merged? {
        guard var summary = (try? JSONSerialization.jsonObject(with: Data(summaryJson.utf8))) as? [String: Any] else { return nil }
        var samples = summary["samples"] as? [String: Any] ?? [:]
        let before = form(samples, summary)
        for key in averageKeys { samples.removeValue(forKey: key) }
        for (key, value) in result.averages { samples[key] = value }
        summary["samples"] = samples
        if let series = result.series, let tree = try? JSONSerialization.jsonObject(with: Data(series.serialized().utf8)) {
            summary["dynamics"] = tree
        } else {
            summary.removeValue(forKey: "dynamics")
        }
        guard let data = try? JSONSerialization.data(withJSONObject: summary, options: [.sortedKeys, .withoutEscapingSlashes]),
              let text = String(data: data, encoding: .utf8)
        else { return nil }
        return Merged(json: text, changed: before != form(samples, summary))
    }

    /// The running-form part of a summary as text with sorted keys, to tell a real change from the same readings again.
    private static func form(_ samples: [String: Any], _ summary: [String: Any]) -> String {
        averageKeys.sorted().map { "\($0)=\(canonical(samples[$0]))" }.joined(separator: ";") + ";" + canonical(summary["dynamics"])
    }

    private static func canonical(_ value: Any?) -> String {
        switch value {
        case nil, is NSNull: return "null"
        case let s as String: return s
        case let d as [String: Any]: return "{" + d.keys.sorted().map { "\($0):\(canonical(d[$0]))" }.joined(separator: ",") + "}"
        case let a as [Any]: return "[" + a.map { canonical($0) }.joined(separator: ",") + "]"
        case let n as NSNumber: return "\(n.doubleValue)"
        case let d as Double: return "\(d)"
        case let i as Int: return "\(Double(i))"
        default: return "\(value!)"
        }
    }
}
