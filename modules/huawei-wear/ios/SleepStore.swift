// Reads stored sleep segments the way every consumer must: with the stage-less ones cleaned of what was not sleep (`SleepCleaning`). The rows in
// `sleep_segments` stay as the watch sent them, so a rule change re-derives every stored night the next time it is read. Port of `cleanedSleep` /
// `sleepEvidence` in src/db/queries.ts.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public enum SleepStore {
    /// What the stored workouts, spot HRV measurements and per-minute steps say about [`fromSec`, `toSec`]. Every row counts as evidence, imported or
    /// not, and only minutes with real walking are read, never the whole step history. A table that does not exist yet gives no evidence.
    public static func evidence(_ db: SQLiteDatabase, fromSec: Int64, toSec: Int64) throws -> SleepEvidence {
        var evidence = SleepEvidence()
        if try db.tableExists("workouts") {
            evidence.workouts = try db.query(
                "SELECT start, end, duration FROM workouts WHERE complete = 1 AND end >= ? AND start <= ?", [.int(fromSec), .int(toSec)]
            ) { SleepCleaning.workoutSpan(start: $0.int64(0), end: $0.int64(1), duration: $0.int64(2)) }
        }
        if try db.tableExists("hrv_readings") {
            evidence.spots = try db.query(
                "SELECT start, end FROM hrv_readings WHERE source = 'spot' AND end >= ? AND start <= ?", [.int(fromSec), .int(toSec)]
            ) { SleepSpan(start: $0.int64(0), end: $0.int64(1)) }
        }
        if try db.tableExists("step_samples") {
            evidence.activeMinutes = try db.query(
                "SELECT timestamp FROM step_samples WHERE timestamp >= ? AND timestamp <= ? AND steps >= ?",
                [.int(fromSec - 60), .int(toSec), .int(Int64(SleepCleaning.activeStepsPerMin))]
            ) { $0.int64(0) }
        }
        return evidence
    }

    /// `rows` with the stage-less ones cleaned; staged rows come back as stored. Reads no evidence when every row has a stage.
    public static func cleaned(_ db: SQLiteDatabase, _ rows: [SleepSegment]) throws -> [SleepSegment] {
        var from = Int64.max
        var to = Int64.min
        for r in rows where r.stage == nil {
            from = min(from, r.start)
            to = max(to, r.end)
        }
        if from > to { return rows }
        return SleepCleaning.cleanUnstagedSleep(rows, try evidence(db, fromSec: from, toSec: to))
    }

    /// The cleaned segments whose stored row ends in [`endFromSec`, `endBeforeSec`). `importedOnly` keeps the consumer's own filter for rows
    /// that came from a Huawei export (`imported = 0`); the evidence ignores it.
    public static func load(
        _ db: SQLiteDatabase, endFromSec: Int64, endBeforeSec: Int64 = Int64.max, importedOnly: Bool
    ) throws -> [SleepSegment] {
        let rows = try db.query(
            "SELECT start, end, type, stage FROM sleep_segments WHERE \(importedOnly ? "imported = 0 AND " : "")end >= ? AND end < ? ORDER BY start, end",
            [.int(endFromSec), .int(endBeforeSec)]
        ) { SleepSegment(start: $0.int64(0), end: $0.int64(1), type: $0.int(2), stage: $0.text(3)) }
        return try cleaned(db, rows)
    }
}

#endif
