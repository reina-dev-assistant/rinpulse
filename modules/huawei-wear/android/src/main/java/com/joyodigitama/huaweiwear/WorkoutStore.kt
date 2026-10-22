package com.joyodigitama.huaweiwear

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Writes workouts into the shared database (`workouts`, `workout_points`; migration 3 in
 * `schema/joyofit-db-migrations.json`) through [SyncStore]'s connection. A workout is replaced as a whole in one
 * transaction: the row is upserted by `start` (the id stays), its old points are deleted and the new ones inserted.
 *
 * [address] is the watch that is writing (the connected one): it is stored in `workouts.device`, and a session that
 * another watch already recorded is stored once ([WorkoutWriter], docs/multi-watch.md section 3).
 */
internal class WorkoutStore(private val store: SyncStore, private val address: String) : WorkoutSink {
  override suspend fun isComplete(start: Long, end: Long, watchHasGps: Boolean): Boolean = withContext(Dispatchers.IO) {
    WorkoutWriter(AndroidWatchDb(store.db()), address).isComplete(start, end, watchHasGps)
  }

  override suspend fun save(record: WorkoutRecord): Boolean = withContext(Dispatchers.IO) {
    WorkoutWriter(AndroidWatchDb(store.db()), address).save(record)
  }

  /**
   * Start of the next workout window, unix seconds: everything after the newest workout this watch recorded (from
   * 2000-01-01, so everything the watch holds, when there is none); the start of the oldest incomplete workout wins over
   * that so it is downloaded again. [fullHistory] always starts from 2000-01-01; stored workouts upsert by start.
   */
  suspend fun syncStart(fullHistory: Boolean = false): Int = withContext(Dispatchers.IO) {
    WorkoutWriter(AndroidWatchDb(store.db()), address).syncStart(fullHistory)
  }

  companion object {
    /** 2000-01-01 00:00:00 UTC; GB's own fallback (2022-06-10) is an app-imposed limit this app does not keep. */
    const val DEFAULT_START_SEC = 946684800L
  }
}

/** The workout statements of one watch on one [WatchDb]; [WorkoutStore] is the Android wrapper. */
internal class WorkoutWriter(private val db: WatchDb, private val address: String) {
  /**
   * True when a complete copy of this session is stored and there is nothing left to fetch, or this watch's copy was
   * dropped for another watch's (`workout_shadow`).
   *
   * A complete row with **no GPS point** is only "done" while the watch does not claim a track for it. A workout
   * stored by a build that did not download GPS files yet is `complete = 1` with no points and would otherwise never
   * be revisited; with [watchHasGps] (the watch's own 17/07 tag 0x0e answer) it is fetched once more. The stored
   * copy's own `summary_json.gps` stops that from looping: `none` (or a row written before the field existed) means
   * the GPS was never attempted, so it is asked for again; `empty`/`failed` means it was tried and the watch did not
   * deliver, and a genuine failure must not become a retry on every 15-minute sync.
   */
  fun isComplete(start: Long, end: Long, watchHasGps: Boolean): Boolean {
    if (db.query(WatchSql.SELECT_WORKOUT_SHADOWED, start, end, address).isNotEmpty()) return true
    val row = db.query(WatchSql.SELECT_WORKOUT_STORED, start, end).firstOrNull() ?: return false
    // An imported row comes from a Huawei export: there is no watch track to fetch for it.
    if ((row[0] as Long) != 0L) return true
    if ((row[2] as Long) != 0L) return true
    if (!watchHasGps) return true
    val gpsStatus = (row[1] as String?)
      ?.let { summary -> runCatching { JSONObject(summary).optString("gps", "") }.getOrNull() }
      ?.takeIf { it.isNotEmpty() }
    return gpsStatus != null && gpsStatus != "none"
  }

  /**
   * Stores the workout and its points, replacing an earlier copy with the same start. True if it is new or was incomplete;
   * false when it was already complete, or when another watch's copy of the same session is kept instead (then this one is
   * only noted in `workout_shadow`).
   */
  fun save(record: WorkoutRecord): Boolean = db.transaction {
    if (!resolveDuplicates(record)) return@transaction false
    val wasComplete = db.query(WatchSql.SELECT_WORKOUT_COMPLETE, record.start).firstOrNull()?.let { (it[0] as Long) == 1L }
    db.exec(
      WatchSql.UPSERT_WORKOUT,
      record.number,
      record.start,
      record.end,
      record.sportType,
      record.sportName,
      record.duration,
      record.distance,
      record.calories,
      record.avgHr,
      record.maxHr,
      record.steps,
      record.summaryJson,
      if (record.complete) 1 else 0,
      address,
    )
    val id = db.query(WatchSql.SELECT_WORKOUT_ID, record.start).first()[0] as Long
    db.exec(WatchSql.DELETE_WORKOUT_POINTS, id)
    db.insertPoints(id, record.points)
    wasComplete != true
  }

  /**
   * Looks for copies of [record]'s session recorded by other watches. When one of them wins ([incomingWinsDuplicate]) the
   * record is not stored: it is noted in `workout_shadow` and this returns false. Otherwise the copies it beats are
   * deleted with their points, each noted in `workout_shadow`, and this returns true.
   */
  private fun resolveDuplicates(record: WorkoutRecord): Boolean {
    val candidates = db.query(WatchSql.SELECT_WORKOUT_CANDIDATES, address, record.end, record.start)
    if (candidates.isEmpty()) return true
    val primary = db.query(WatchSql.SELECT_PRIMARY_DEVICE).firstOrNull()?.get(0) as String?
    val incoming = WorkoutSpan(record.start, record.end, address, record.points.any { it.lat != null && it.lon != null })
    val losers = ArrayList<List<Any?>>()
    for (row in candidates) {
      val stored = WorkoutSpan(row[1] as Long, row[2] as Long, row[3] as String, (row[4] as Long) != 0L)
      if (!isCrossWatchDuplicate(incoming, stored)) continue
      if (!incomingWinsDuplicate(incoming, stored, primary)) {
        db.exec(WatchSql.UPSERT_WORKOUT_SHADOW, address, record.start, record.end, stored.start)
        return false
      }
      losers.add(row)
    }
    for (row in losers) {
      db.exec(WatchSql.DELETE_WORKOUT_POINTS, row[0])
      db.exec(WatchSql.DELETE_WORKOUT, row[0])
      db.exec(WatchSql.UPSERT_WORKOUT_SHADOW, row[3], row[1], row[2], record.start)
    }
    return true
  }

  fun syncStart(fullHistory: Boolean): Int {
    if (fullHistory) return WorkoutStore.DEFAULT_START_SEC.toInt()
    // Workouts imported from a Huawei export say nothing about what the watch still holds.
    val newestEnd = db.query(WatchSql.SELECT_WORKOUT_NEWEST_END, address, address).firstOrNull()?.get(0) as Long?
    val oldestIncomplete = db.query(WatchSql.SELECT_WORKOUT_OLDEST_INCOMPLETE, address).firstOrNull()?.get(0) as Long?
    val start = when {
      newestEnd == null -> WorkoutStore.DEFAULT_START_SEC
      oldestIncomplete != null -> minOf(oldestIncomplete, newestEnd + 1)
      else -> newestEnd + 1
    }
    return minOf(start, Int.MAX_VALUE.toLong()).toInt()
  }
}
