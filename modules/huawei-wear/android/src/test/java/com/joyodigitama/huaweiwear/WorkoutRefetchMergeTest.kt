package com.joyodigitama.huaweiwear

import java.io.File
import java.sql.Connection
import java.sql.DriverManager
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What a refetch of running dynamics writes: [RunDynamics.merge] on a summary string, and [WorkoutWriter.mergeDynamics] on the shipped
 * schema (sqlite-jdbc), where the `rev` trigger of the `workouts` table decides which workouts go to the cloud again.
 */
class WorkoutRefetchMergeTest {
  private val a = "AA:AA:AA:AA:AA:01"
  private val b = "BB:BB:BB:BB:BB:02"

  private val connection: Connection = DriverManager.getConnection("jdbc:sqlite::memory:")
  private val db = JdbcWatchDb(connection)

  init {
    val migrations = JSONArray(File("../schema/joyofit-db-migrations.json").readText())
    for (i in 0 until migrations.length()) {
      val statements = migrations.getJSONArray(i)
      for (j in 0 until statements.length()) connection.createStatement().use { it.execute(statements.getString(j)) }
    }
    for (address in listOf(a, b)) db.exec("INSERT INTO device (address, name) VALUES (?, ?)", address, "W $address")
  }

  @After
  fun close() = connection.close()

  private fun series(): JSONObject =
    JSONObject().put("start", 1_700_000_000L).put("stepSec", 60).put("gct", JSONArray(listOf(250.0, 300.0))).put("vo", JSONArray(listOf(8.7, 10.0)))

  private fun result(withSeries: Boolean = true) = RunDynamics.Result(
    mapOf("avgGroundContactTime" to 275.0, "avgVerticalOscillation" to 9.35, "avgHangTimeMs" to 120.0),
    if (withSeries) series() else null,
  )

  /** The summary of a run synced before the dynamics were kept: a polluted contact-time mean (zero readings counted) and the usual fields. */
  private val before =
    """{"kind":"RUNNING","number":5,"gps":"ok","dataSamples":300,"avgSpeed":2.7,"paceBlocks":[{"type":0,"pace":330}],
        "samples":{"avgHr":151.5,"avgCadence":168.0,"avgGroundContactTime":131.4,"maxSpeed":4.1}}"""

  @Test
  fun mergeReplacesTheRunningFormAndKeepsEveryOtherField() {
    val merged = RunDynamics.merge(before, result())!!

    assertTrue(merged.changed)
    val summary = JSONObject(merged.json)
    val samples = summary.getJSONObject("samples")
    assertEquals(275.0, samples.getDouble("avgGroundContactTime"), 1e-9)
    assertEquals(9.35, samples.getDouble("avgVerticalOscillation"), 1e-9)
    assertEquals(120.0, samples.getDouble("avgHangTimeMs"), 1e-9)
    assertEquals(60, summary.getJSONObject("dynamics").getInt("stepSec"))
    // The rest is what it was.
    val original = JSONObject(before)
    assertEquals(151.5, samples.getDouble("avgHr"), 1e-9)
    assertEquals(168.0, samples.getDouble("avgCadence"), 1e-9)
    assertEquals(4.1, samples.getDouble("maxSpeed"), 1e-9)
    for (key in listOf("kind", "number", "gps", "dataSamples", "avgSpeed")) assertEquals(original.get(key), summary.get(key))
    assertEquals(330, summary.getJSONArray("paceBlocks").getJSONObject(0).getInt("pace"))
    assertEquals(original.keys().asSequence().toSet() + "dynamics", summary.keys().asSequence().toSet())
  }

  @Test
  fun mergingTheSameReadingsAgainChangesNothing() {
    val first = RunDynamics.merge(before, result())!!

    val second = RunDynamics.merge(first.json, result())!!

    assertFalse(second.changed)
    val samples = JSONObject(second.json).getJSONObject("samples")
    assertEquals(275.0, samples.getDouble("avgGroundContactTime"), 1e-9)
    assertEquals(151.5, samples.getDouble("avgHr"), 1e-9)
  }

  @Test
  fun aSummaryWithoutSamplesGetsThemAndAnOldSeriesIsDroppedWhenTheWatchGivesNone() {
    val bare = RunDynamics.merge("""{"kind":"RUNNING"}""", result(withSeries = false))!!
    assertTrue(bare.changed)
    assertTrue(!JSONObject(bare.json).has("dynamics"))
    assertEquals(9.35, JSONObject(bare.json).getJSONObject("samples").getDouble("avgVerticalOscillation"), 1e-9)

    val withOld = RunDynamics.merge(RunDynamics.merge(before, result())!!.json, result(withSeries = false))!!
    assertTrue(withOld.changed)
    assertTrue(!JSONObject(withOld.json).has("dynamics"))
  }

  @Test
  fun aSummaryThatIsNotJsonIsNotMerged() {
    assertNull(RunDynamics.merge("not json", result()))
  }

  private fun record(start: Long, summary: String) = WorkoutRecord(
    number = 5,
    start = start,
    end = start + 1800,
    sportType = 1,
    sportName = "Running",
    duration = 1800,
    distance = 5000,
    calories = 300,
    steps = 5000,
    avgHr = 150,
    maxHr = 170,
    summaryJson = summary,
    points = listOf(WorkoutPoint(start, 1.5, 2.5, null, 120), WorkoutPoint(start + 10, 1.6, 2.6, null, 125, cadence = 160)),
    complete = true,
  )

  private fun row(start: Long) = db.query("SELECT summary_json, rev, distance, calories, avg_hr, complete, device FROM workouts WHERE start = ?", start).single()

  @Test
  fun writerMergesOnlyTheSummaryAndBumpsRevOnlyWhenTheFormChanged() {
    val writer = WorkoutWriter(db, a)
    assertTrue(writer.save(record(1_700_000_000, before)))
    val saved = row(1_700_000_000)
    val points = db.query("SELECT ts, lat, lon, hr, cadence FROM workout_points ORDER BY ts")

    assertEquals(DynamicsMerge.UPDATED, writer.mergeDynamics(1_700_000_000, result()))

    val updated = row(1_700_000_000)
    assertTrue((updated[1] as Long) > (saved[1] as Long))
    assertEquals(saved.drop(2), updated.drop(2))
    assertEquals(9.35, JSONObject(updated[0] as String).getJSONObject("samples").getDouble("avgVerticalOscillation"), 1e-9)
    assertEquals(points, db.query("SELECT ts, lat, lon, hr, cadence FROM workout_points ORDER BY ts"))

    assertEquals(DynamicsMerge.UNCHANGED, writer.mergeDynamics(1_700_000_000, result()))
    assertEquals(updated, row(1_700_000_000))
  }

  @Test
  fun writerLeavesAnotherWatchsOrAnUnknownWorkoutAlone() {
    assertTrue(WorkoutWriter(db, a).save(record(1_700_000_000, before)))
    val stored = row(1_700_000_000)

    assertEquals(DynamicsMerge.NOT_STORED, WorkoutWriter(db, b).mergeDynamics(1_700_000_000, result()))
    assertEquals(DynamicsMerge.NOT_STORED, WorkoutWriter(db, a).mergeDynamics(1_700_099_999, result()))
    assertEquals(stored, row(1_700_000_000))
  }

  @Test
  fun writerLooksUpTheTargetOfItsOwnWatchOnly() {
    val writer = WorkoutWriter(db, a)
    writer.save(record(1_700_000_000, before))

    val target = writer.refetchTarget(1_700_000_000)
    assertNotNull(target)
    assertEquals(1_700_001_800L, target!!.end)
    assertEquals(5, target.number)
    assertNull(WorkoutWriter(db, b).refetchTarget(1_700_000_000))
    assertNull(writer.refetchTarget(1))
    // An imported row says nothing about what this watch holds.
    db.exec("UPDATE workouts SET imported = 1 WHERE start = ?", 1_700_000_000L)
    assertNull(writer.refetchTarget(1_700_000_000))
  }
}
