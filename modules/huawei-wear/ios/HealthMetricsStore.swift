// `health_metrics` (one row per dictionary entry the watch reported: type, start second, last second, the number a chart plots, every value as
// JSON) and `health_metric_status` (what the last gate check and sync did per metric, so the screen can say which ones the watch does not
// support). Port of HealthMetricsStore.kt; schema: migration `health_metrics` in schema/joyofit-db-migrations.json.
import Foundation
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

#if canImport(SQLite3) || canImport(CSQLite)

public final class HealthMetricsStore: HealthMetricsStoring, @unchecked Sendable {
    private let store: SyncStore
    private let nowSec: @Sendable () -> Int64
    /// The connected watch (`device.address`) at the time of each call; rows are attributed to it and the fetch cursor is its own. nil binds NULL.
    private let address: @Sendable () -> String?

    public init(store: SyncStore, address: @escaping @Sendable () -> String? = { nil }, nowSec: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970) }) {
        self.store = store
        self.address = address
        self.nowSec = nowSec
    }

    public func lastFetchTimestamp(_ type: String) -> Int64 {
        do {
            return try store.read { db in
                try db.query("SELECT MAX(last_ts) FROM health_metrics WHERE type = ? AND device IS ?", [.text(type), .string(address())]) { $0.isNull(0) ? Int64(0) : $0.int64(0) * 1000 }.first ?? 0
            }
        } catch {
            return 0
        }
    }

    public func persist(_ rows: [DictionaryRow]) throws {
        if rows.isEmpty { return }
        let device = address()
        try store.read { db in
            try db.transaction {
                let statement = try db.prepare(
                    """
                    INSERT INTO health_metrics (type, ts, last_ts, value, values_json, device) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(type, ts) DO UPDATE SET last_ts = excluded.last_ts, value = excluded.value, values_json = excluded.values_json, device = excluded.device
                    """
                )
                for r in rows {
                    statement.reset()
                    try statement.bind([
                        .text(r.type), .int(r.timestamp / 1000), .int(max(r.lastTimestamp, r.timestamp) / 1000),
                        r.value.map { .double($0) } ?? .null, .text(r.valuesJson), .string(device),
                    ])
                    while try statement.step() {}
                }
            }
        }
    }

    /// Records the outcome of the gate check or sync of one metric; `rowsAdded` adds to the stored count when not nil.
    public func setStatus(type: String, dictClass: Int, title: String, supported: Bool, gate: String, note: String?, rowsAdded: Int?) throws {
        let now = nowSec()
        try store.read { db in
            try db.run(
                """
                INSERT INTO health_metric_status (type, dict_class, title, supported, gate, checked_at, synced_at, rows_added, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(type) DO UPDATE SET
                  dict_class = excluded.dict_class, title = excluded.title, supported = excluded.supported, gate = excluded.gate,
                  checked_at = excluded.checked_at,
                  synced_at = COALESCE(excluded.synced_at, health_metric_status.synced_at),
                  rows_added = COALESCE(excluded.rows_added, health_metric_status.rows_added),
                  note = excluded.note
                """,
                [
                    .text(type), .int(Int64(dictClass)), .text(title), .int(supported ? 1 : 0), .text(gate), .int(now),
                    rowsAdded != nil ? .int(now) : .null, .integer(rowsAdded), .string(note),
                ]
            )
        }
    }

    public func count(_ type: String) -> Int {
        do {
            return try store.read { db in try db.query("SELECT COUNT(*) FROM health_metrics WHERE type = ?", [.text(type)]) { $0.int(0) }.first ?? 0 }
        } catch {
            return 0
        }
    }
}

#endif
