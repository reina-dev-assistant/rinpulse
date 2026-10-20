package com.joyodigitama.huaweiwear

import java.io.File
import java.sql.Connection
import java.sql.DriverManager
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * docs/multi-watch.md, section 7: moving the link to another watch makes that watch pull its whole history on its next sync, so what
 * the other watch overwrote (an older build did, and rows with no watch still lose to any watch) comes back from the watch whatever its
 * own `last_sync` says. Everything runs on the shipped schema through sqlite-jdbc, with the statements and window rules the sync uses.
 */
class SwitchBackfillTest {
  private val a = "AA:AA:AA:AA:AA:01"
  private val b = "BB:BB:BB:BB:BB:02"

  private val prefs = MemoryPrefs()
  private val backfill = SwitchBackfill(prefs)

  // The mark

  @Test
  fun aFirstConnectAndAReconnectOfTheSameWatchAreNotSwitches() {
    backfill.noteConnect(null, a)
    backfill.noteConnect(a, a)
    backfill.noteConnect(a.lowercase(), a)
    assertFalse(backfill.pending(a))
  }

  @Test
  fun connectingAnotherWatchMarksTheWatchTheLinkMovedTo() {
    backfill.noteConnect(a, b)
    assertTrue(backfill.pending(b))
    assertFalse("the watch the link left is not marked", backfill.pending(a))
    assertTrue(backfill.pending(b.lowercase()))
  }

  @Test
  fun theMarkIsKeptUntilTheStepsAndSleepWerePulledAndThenClearedForThatWatchOnly() {
    backfill.noteConnect(a, b)
    backfill.noteConnect(b, a)
    assertTrue(backfill.pending(a))
    assertTrue(backfill.pending(b))
    backfill.done(a)
    assertFalse(backfill.pending(a))
    assertTrue(backfill.pending(b))
  }

  @Test
  fun aPendingSwitchOrAFullHistoryRequestIgnoresTheStoredLastSyncAndTheOrdinaryWindowDoesNot() {
    val last = 1_700_000_000L
    assertEquals(last, backfill.windowBase(a, false) { last })
    assertEquals(last - SYNC_OVERLAP_SEC, syncWindowStart(backfill.windowBase(a, false) { last }))
    assertNull(backfill.windowBase(a, true) { last })
    backfill.noteConnect(b, a)
    assertNull(backfill.windowBase(a, false) { last })
    assertEquals(0L, syncWindowStart(backfill.windowBase(a, false) { last }))
    assertEquals("the other watch keeps its own window", last, backfill.windowBase(b, false) { last })
  }

  // On the shipped schema

  private val connection: Connection = DriverManager.getConnection("jdbc:sqlite::memory:")
  private val db = JdbcWatchDb(connection)

  init {
    val migrations = JSONArray(File("../schema/joyofit-db-migrations.json").readText())
    for (i in 0 until migrations.length()) {
      val statements = migrations.getJSONArray(i)
      for (j in 0 until statements.length()) connection.createStatement().use { it.execute(statements.getString(j)) }
    }
  }

  @After
  fun close() = connection.close()

  private val day = 86_400L
  private val d0 = 20_000L * day

  /** The owner's watch: 12 steps a minute from 08:00 to 18:00 on each of [days]. */
  private fun ownerHistory(days: IntRange): Map<Long, Int> =
    days.flatMap { d -> (480 until 1080).map { m -> d0 + d * day + m * 60 to 12 } }.toMap()

  private fun lastSync(address: String): Long? = db.query("SELECT last_sync FROM device WHERE address = ?", address).firstOrNull()?.get(0) as Long?

  /** One activity sync as `WearLink.syncActivity` runs it: the window from [SwitchBackfill.windowBase], the step upsert, `last_sync`, the mark cleared. */
  private fun sync(address: String, history: Map<Long, Int>, now: Long) {
    val from = syncWindowStart(backfill.windowBase(address, false) { lastSync(address) })
    for ((timestamp, steps) in history) {
      if (timestamp >= from) db.exec(WatchSql.UPSERT_STEP_SAMPLE, timestamp, steps, 0, 0, null, null, null, address)
    }
    db.exec(WatchSql.UPDATE_LAST_SYNC, now, address)
    backfill.done(address)
  }

  private fun total(dayIndex: Int): Long =
    db.query("SELECT COALESCE(SUM(steps), 0) FROM step_samples WHERE timestamp >= ? AND timestamp < ?", d0 + dayIndex * day, d0 + (dayIndex + 1) * day)
      .single()[0] as Long

  /**
   * What a phone holds after the older build let the band overwrite the owner's three days and the 14th migration found two watches
   * (rows it cannot attribute stay without a watch, the one synced last is primary): every minute zero, no watch on it.
   */
  private fun phoneWhereTheBandWroteOverTheOwnersDays(): Map<Long, Int> {
    db.exec("INSERT INTO device (address, name, last_sync, is_primary, added_at) VALUES (?, 'Watch', ?, 0, 1)", a, d0 + 3 * day)
    db.exec("INSERT INTO device (address, name, last_sync, is_primary, added_at) VALUES (?, 'Band', ?, 1, 2)", b, d0 + 3 * day + 600)
    val owner = ownerHistory(0..2)
    for (timestamp in owner.keys) {
      db.exec("INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (?, 0, 0, 0)", timestamp)
    }
    assertEquals(0L, total(0) + total(1) + total(2))
    return owner
  }

  @Test
  fun anOrdinarySyncAfterReconnectingTheSameWatchDoesNotBringALostDayBack() {
    val owner = phoneWhereTheBandWroteOverTheOwnersDays()
    sync(a, owner, d0 + 3 * day + 3_600)
    assertEquals(0L, total(0) + total(1))
  }

  @Test
  fun switchingBackToTheOwnersWatchPullsEverythingItStillHoldsAndTheDaysAreBack() {
    val owner = phoneWhereTheBandWroteOverTheOwnersDays()
    backfill.noteConnect(b, a)
    sync(a, owner, d0 + 3 * day + 3_600)
    assertEquals(listOf(7_200L, 7_200L, 7_200L), listOf(total(0), total(1), total(2)))
    assertEquals(3L * 600, db.query("SELECT COUNT(*) FROM step_samples WHERE device = ?", a).single()[0])
    assertFalse("one backfill per switch", backfill.pending(a))
  }

  @Test
  fun afterTheBackfillTheOwnersWatchGoesBackToItsOrdinaryWindow() {
    val owner = phoneWhereTheBandWroteOverTheOwnersDays()
    backfill.noteConnect(b, a)
    sync(a, owner, d0 + 3 * day + 3_600)
    val last = lastSync(a)!!
    assertEquals(d0 + 3 * day + 3_600, last)
    assertEquals(last - SYNC_OVERLAP_SEC, syncWindowStart(backfill.windowBase(a, false) { last }))
  }

  @Test
  fun theBandsOwnFirstSyncAfterwardsLeavesTheRestoredDaysAloneOnceTheOwnersWatchIsPrimary() {
    val owner = phoneWhereTheBandWroteOverTheOwnersDays()
    backfill.noteConnect(b, a)
    sync(a, owner, d0 + 3 * day + 3_600)
    db.exec("UPDATE device SET is_primary = (address = ?)", a)
    backfill.noteConnect(a, b)
    val band = (0 until 1440).associate { m -> d0 + day + m * 60 to if (m in 600 until 660) 30 else 0 }
    sync(b, band, d0 + 4 * day)
    assertEquals(7_200L, total(1))
    assertEquals(3L * 600, db.query("SELECT COUNT(*) FROM step_samples WHERE device = ?", a).single()[0])
  }
}
