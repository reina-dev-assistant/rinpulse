// Writes workouts into the shared database (`workouts`, `workout_points`; migration 3 in schema/joyofit-db-migrations.json) through SyncStore's
// connection, and runs the workout phase of the activity sync. Port of WorkoutStore.kt and WearLink.syncWorkouts. A workout is replaced as a
// whole in one transaction: the row is upserted by `start` (the id stays), its old points are deleted and the new ones inserted.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class WorkoutStore: WorkoutSink {
    /// GB HuaweiWorkoutSyncManager.getStartTimeFromDb fallback: 2022-06-10 00:00:00 UTC.
    public static let defaultStartSec: Int64 = 1_654_819_200
    /// A full-history pull starts here (2000-01-01, the Kotlin `DEFAULT_START_SEC`): everything the watch still holds.
    public static let fullHistoryStartSec: Int64 = 946_684_800

    private let store: SyncStore
    /// The watch that writes (`device.address`): attributes every row and keeps this watch's sync window apart from the other watches'.
    private let address: String

    public init(_ store: SyncStore, address: String) {
        self.store = store
        self.address = address
    }

    /// Who keeps a session two watches recorded (docs/multi-watch.md, section 3): the copy with a GPS track, else the primary watch's, else the
    /// one stored first. True when the incoming copy replaces the stored one.
    public static func incomingWins(incomingHasGps: Bool, storedHasGps: Bool, incomingIsPrimary: Bool, storedIsPrimary: Bool) -> Bool {
        if incomingHasGps != storedHasGps { return incomingHasGps }
        return incomingIsPrimary && !storedIsPrimary
    }

    /// Two sessions of different watches are one when they overlap by at least half of the shorter one.
    public static func isDuplicate(startA: Int64, endA: Int64, startB: Int64, endB: Int64) -> Bool {
        let overlap = min(endA, endB) - max(startA, startB)
        let shorter = min(endA - startA, endB - startB)
        return overlap > 0 && overlap * 2 >= shorter
    }

    /// True when a complete copy of this session is stored and there is nothing left to fetch, or this watch's copy
    /// was dropped for another watch's (`workout_shadow`).
    ///
    /// A complete row with **no GPS point** is only "done" while the watch does not claim a track for it. A workout
    /// stored by a build that did not download GPS files yet is `complete = 1` with no points and would otherwise
    /// never be revisited; with `watchHasGps` (the watch's own 17/07 tag 0x0e answer) it is fetched once more. The
    /// stored copy's own `summary_json.gps` stops that from looping: `none` (or a row written before the field
    /// existed) means the GPS was never attempted, so it is asked for again; `empty`/`failed` means it was tried and
    /// the watch did not deliver, and a genuine failure must not become a retry on every sync.
    public func isComplete(start: Int64, end: Int64, watchHasGps: Bool) throws -> Bool {
        try store.read { db in
            if !db.query(
                "SELECT 1 FROM workout_shadow WHERE start = ? AND end = ? AND device = ?",
                [.int(start), .int(end), .text(address)]
            ) { _ in true }.isEmpty {
                return true
            }
            let rows = try db.query(
                "SELECT w.imported, w.summary_json, EXISTS (SELECT 1 FROM workout_points p WHERE p.workout_id = w.id AND p.lat IS NOT NULL AND p.lon IS NOT NULL)"
                    + " FROM workouts w WHERE w.start = ? AND w.end = ? AND w.complete = 1 LIMIT 1",
                [.int(start), .int(end)]
            ) { row in (row.int(0) != 0, row.text(1), row.int(2) != 0) }
            guard let (imported, summary, hasPoint) = rows.first else { return false }
            // An imported row comes from a Huawei export: there is no watch track to fetch for it.
            if imported { return true }
            if hasPoint { return true }
            if !watchHasGps { return true }
            guard let summary, let data = summary.data(using: .utf8),
                  let gps = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let status = gps["gps"] as? String, !status.isEmpty
            else { return false }
            return status != "none"
        }
    }

    private struct Stored {
        let id: Int64
        let device: String
        let start: Int64
        let end: Int64
    }

    /// Settles a session another watch also recorded. Returns false (and notes the loser in `workout_shadow`) when the stored copy stays;
    /// otherwise deletes the stored copies it replaces, noting them in `workout_shadow`.
    private func keepsIncoming(_ db: SQLiteDatabase, _ record: WorkoutRecord) throws -> Bool {
        let others = try db.query(
            "SELECT id, device, start, end FROM workouts WHERE device IS NOT NULL AND device <> ? AND imported = 0 AND start < ? AND end > ? ORDER BY start, id",
            [.text(address), .int(record.end), .int(record.start)]
        ) { Stored(id: $0.int64(0), device: $0.text(1)!, start: $0.int64(2), end: $0.int64(3)) }
            .filter { WorkoutStore.isDuplicate(startA: record.start, endA: record.end, startB: $0.start, endB: $0.end) }
        if others.isEmpty { return true }
        func isPrimary(_ device: String) throws -> Bool {
            try db.query("SELECT is_primary FROM device WHERE address = ?", [.text(device)]) { $0.int(0) == 1 }.first ?? false
        }
        func hasGps(_ id: Int64) throws -> Bool {
            try !db.query("SELECT 1 FROM workout_points WHERE workout_id = ? AND lat IS NOT NULL AND lon IS NOT NULL LIMIT 1", [.int(id)]) { _ in true }.isEmpty
        }
        let incomingGps = record.points.contains { $0.lat != nil && $0.lon != nil }
        let incomingPrimary = try isPrimary(address)
        for other in others {
            if !WorkoutStore.incomingWins(
                incomingHasGps: incomingGps, storedHasGps: try hasGps(other.id), incomingIsPrimary: incomingPrimary, storedIsPrimary: try isPrimary(other.device)
            ) {
                try db.run(
                    "INSERT OR REPLACE INTO workout_shadow (device, start, end, kept_start) VALUES (?, ?, ?, ?)",
                    [.text(address), .int(record.start), .int(record.end), .int(other.start)]
                )
                return false
            }
        }
        for other in others {
            try db.run("DELETE FROM workout_points WHERE workout_id = ?", [.int(other.id)])
            try db.run("DELETE FROM workouts WHERE id = ?", [.int(other.id)])
            try db.run(
                "INSERT OR REPLACE INTO workout_shadow (device, start, end, kept_start) VALUES (?, ?, ?, ?)",
                [.text(other.device), .int(other.start), .int(other.end), .int(record.start)]
            )
        }
        return true
    }

    /// Stores the workout; false when it was not newly stored (it was complete already, or another watch's copy of the session was kept).
    public func save(_ record: WorkoutRecord) throws -> Bool {
        try store.read { db in
            try db.transaction {
                if try !keepsIncoming(db, record) { return false }
                let wasComplete: Bool? = try db.query("SELECT complete FROM workouts WHERE start = ?", [.int(record.start)]) { $0.int(0) == 1 }.first
                try db.run(
                    """
                    INSERT INTO workouts
                      (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, device)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(start) DO UPDATE SET
                      workout_number = excluded.workout_number,
                      end = excluded.end,
                      sport_type = excluded.sport_type,
                      sport_name = excluded.sport_name,
                      duration = excluded.duration,
                      distance = excluded.distance,
                      calories = excluded.calories,
                      avg_hr = excluded.avg_hr,
                      max_hr = excluded.max_hr,
                      steps = excluded.steps,
                      summary_json = excluded.summary_json,
                      complete = excluded.complete,
                      device = excluded.device,
                      imported = 0
                    """,
                    [
                        .int(Int64(record.number)), .int(record.start), .int(record.end), .int(Int64(record.sportType)), .text(record.sportName),
                        .int(Int64(record.duration)), .int(Int64(record.distance)), .int(Int64(record.calories)), .integer(record.avgHr),
                        .integer(record.maxHr), .int(Int64(record.steps)), .text(record.summaryJson), .int(record.complete ? 1 : 0), .text(address),
                    ]
                )
                guard let id = try db.query("SELECT id FROM workouts WHERE start = ?", [.int(record.start)], { $0.int64(0) }).first else {
                    throw SQLiteError(code: -1, message: "workout row for start \(record.start) is missing right after its upsert")
                }
                try db.run("DELETE FROM workout_points WHERE workout_id = ?", [.int(id)])
                let insert = try db.prepare(
                    "INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                )
                for p in record.points {
                    insert.reset()
                    try insert.bind([
                        .int(id), .int(p.ts), p.lat.map { .double($0) } ?? .null, p.lon.map { .double($0) } ?? .null, p.alt.map { .double($0) } ?? .null,
                        .integer(p.hr), p.speed.map { .double($0) } ?? .null, .integer(p.cadence), p.stride.map { .double($0) } ?? .null, .integer(p.power),
                    ])
                    while try insert.step() {}
                }
                return wasComplete != true
            }
        }
    }

    /// Start of the next workout window, unix seconds. GB asks for everything after the newest stored workout (and from 2022-06-10 when there
    /// is none); the start of the oldest incomplete workout wins over that so it is downloaded again. Workouts imported from a Huawei export say
    /// nothing about what the watch still holds, so they do not count.
    /// The newest end counts this watch's workouts and the ones of its that lost a duplicate (`workout_shadow`), so another watch's newest
    /// workout does not move this watch's window; the oldest incomplete one is this watch's or an unattributed one.
    /// `fullHistory` always starts from 2000-01-01; stored workouts upsert by start.
    public func syncStart(fullHistory: Bool = false) throws -> Int {
        if fullHistory { return Int(WorkoutStore.fullHistoryStartSec) }
        let (newestEnd, oldestIncomplete): (Int64?, Int64?) = try store.read { db in
            let newest = try db.query(
                """
                SELECT MAX(end) FROM (
                  SELECT end FROM workouts WHERE imported = 0 AND device = ?
                  UNION ALL SELECT end FROM workout_shadow WHERE device = ?
                )
                """,
                [.text(address), .text(address)]
            ) { $0.isNull(0) ? nil : $0.int64(0) }.first ?? nil
            let incomplete = try db.query(
                "SELECT MIN(start) FROM workouts WHERE complete = 0 AND (device = ? OR device IS NULL)", [.text(address)]
            ) { $0.isNull(0) ? nil : $0.int64(0) }.first ?? nil
            return (newest, incomplete)
        }
        let start: Int64
        if let newestEnd {
            start = oldestIncomplete.map { min($0, newestEnd + 1) } ?? newestEnd + 1
        } else {
            start = WorkoutStore.defaultStartSec
        }
        return Int(min(start, Int64(Int32.max)))
    }
}

/// The workout phase of the activity sync, run after the steps, sleep and totals are committed.
public enum WorkoutPhase {
    /// Workout sessions and their GPS tracks. Whatever fails here is logged and does not fail the sync: the steps, sleep and totals are already
    /// committed. Returns the workouts newly stored (or completed). Only cancellation propagates.
    public static func run(session: HuaweiSession, caps: DeviceCaps, syncStore: SyncStore, address: String, events: WearEvents, nowSec: Int64, fullHistory: Bool = false) async throws -> Int {
        let workouts = WorkoutStore(syncStore, address: address)
        let sync = WorkoutSync(session: session, caps: caps, log: events.sink)
        do {
            let start = try workouts.syncStart(fullHistory: fullHistory)
            try await sync.sync(startSec: start, endSec: Int(Int32(truncatingIfNeeded: nowSec)), sink: workouts)
        } catch is CancellationError {
            throw CancellationError()
        } catch let e as WearError {
            events.error("Workout sync failed: \(e.message)")
        } catch let e as SQLiteError {
            events.error("Workout sync failed: \(e.message)")
        } catch {
            events.error("Workout sync failed: \(error)")
        }
        events.info("Workout sync: \(sync.saved) workouts stored")
        return sync.saved
    }
}

#endif
