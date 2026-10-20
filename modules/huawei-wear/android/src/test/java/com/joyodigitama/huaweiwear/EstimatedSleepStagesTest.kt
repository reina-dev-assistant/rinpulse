package com.joyodigitama.huaweiwear

import java.time.Instant
import java.time.LocalTime
import java.time.ZoneOffset
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTruSleepParser
import nodomain.freeyourgadget.gadgetbridge.util.sleep.EstimatedStage
import nodomain.freeyourgadget.gadgetbridge.util.sleep.SleepMinute
import nodomain.freeyourgadget.gadgetbridge.util.sleep.SleepMinuteKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The adapter that feeds the Watch Fit 1's own raw night to the ported stage estimator: accelerometer
 * seconds become movement minutes, the sync's heart rate is joined in, and the night comes out as stored rows.
 *
 * What comes out is an estimate, and these tests say how far it goes: the shape of a night (one night, at
 * night, with plausible shares of deep and REM) and the plumbing (minutes on the watch's grid, a hole stays a
 * hole, real stages are never overwritten). It is not a test against Huawei's numbers — the estimator has no
 * ground truth (see its own documentation), and the calibration constant is expected to be tuned on real nights.
 */
class EstimatedSleepStagesTest {

  private val zone: ZoneOffset = ZoneOffset.ofHours(7)
  private val bedtime: Instant = Instant.parse("2026-10-18T15:30:00Z") // 22:30 WIB

  // The estimator's own generators, reused so the input shape matches its documentation.

  private fun acc(at: Instant, low: Int, high: Int): HuaweiTruSleepParser.TruSleepDataAcc =
    HuaweiTruSleepParser.TruSleepDataAcc(at.epochSecond.toInt(), ((high shl 8) or (low and 0xFF)).toShort())

  /**
   * [count] minutes of axis activity from [start], one ACC sample a minute, as the watch sends them. [movement] is
   * the axis that carries the movement and comes last so it can be passed as the trailing lambda; [secondAxis] is
   * the other axis, still by default.
   */
  private fun accMinutes(
    start: Instant,
    count: Int,
    secondAxis: (Int) -> Int = { 0 },
    movement: (Int) -> Int,
  ): List<HuaweiTruSleepParser.TruSleepDataAcc> =
    List(count) { index -> acc(start.plusSeconds(60L * index), movement(index), secondAxis(index)) }

  /** Heart rate a minute, keyed the way `heartRateByMinute` keys it. */
  private fun heartRate(start: Instant, count: Int, bpm: (Int) -> Int): Map<Long, Int> =
    List(count) { index -> start.plusSeconds(60L * index).epochSecond to bpm(index) }.toMap()

  /**
   * A plausible night's heart rate: settles over the first hour and dips every 90 minutes, the shape the
   * estimator's own tests use; `still`/moving minutes are derived from the same curve.
   */
  private fun nightHeartRate(index: Int): Int {
    val settling = if (index < 60) (60 - index) / 8 else 0
    val cycle = (4 * Math.sin(2 * Math.PI * index / 90.0)).toInt()
    val jitter = ((index * 7) % 3) - 1
    return 52 + settling + cycle + jitter
  }

  /** 30 restless minutes, then [sleepMinutes] still ones, then 60 restless, as axis activity. */
  private fun aNight(start: Instant = bedtime, sleepMinutes: Int = 450): List<HuaweiTruSleepParser.TruSleepDataAcc> =
    accMinutes(start, 30) { 70 + (it * 5) % 8 * 20 } +
      accMinutes(start.plusSeconds(30 * 60L), sleepMinutes) { 4 } +
      accMinutes(start.plusSeconds((30 + sleepMinutes) * 60L), 60) { 80 }

  @Test
  fun `the axes are summed into movement, and the busiest sample of a minute wins`() {
    val minutes = EstimatedSleepStages.minutesFromAcc(
      listOf(
        acc(bedtime, low = 8, high = 8),
        // The same minute delivered twice, ten seconds apart: floored to the minute, and the busier one wins.
        acc(bedtime.plusSeconds(10), low = 160, high = 0),
        acc(bedtime.plusSeconds(60), low = 0, high = 0),
        acc(bedtime.plusSeconds(120), low = 255, high = 255),
      ),
    )

    assertEquals(3, minutes.size)
    // Two samples fell in the first minute: the busier one (20) is the one kept, not the earlier 2.
    assertEquals(20f, minutes[0].movement, 0.0001f) // (160 + 0) / 8 beats (8 + 8) / 8
    assertEquals(0f, minutes[1].movement, 0.0001f)
    assertEquals(bedtime.epochSecond, minutes[0].time.epochSecond)
    assertEquals(bedtime.plusSeconds(120).epochSecond, minutes[2].time.epochSecond)
    // (255 + 255) / 8 came from the third sample of the minute; the busiest one is the one kept.
    assertEquals(63.75f, minutes[2].movement, 0.0001f)
  }

  @Test
  fun `a minute without an ACC sample stays absent and the heart rate lookup floors to the minute`() {
    val accs = listOf(acc(bedtime, 8, 0), acc(bedtime.plusSeconds(120), 8, 0))
    val minutes = EstimatedSleepStages.minutesFromAcc(accs)
    val heartRate = mapOf(bedtime.epochSecond to 58, bedtime.plusSeconds(120).epochSecond to 49)

    assertEquals(2, minutes.size)
    // The minute in between is not invented: it is absent, so the estimator treats it as a hole.
    assertEquals(bedtime.plusSeconds(120).epochSecond, minutes[1].time.epochSecond)

    val joined = EstimatedSleepStages.withHeartRate(minutes, heartRate)
    assertEquals(58f, joined[0].heartRate!!, 0.0001f)
    assertEquals(49f, joined[1].heartRate!!, 0.0001f)
    // A row the map has nothing for keeps a null heart rate instead of a zero.
    assertNull(EstimatedSleepStages.withHeartRate(listOf(minutes[0]), emptyMap())[0].heartRate)
  }

  @Test
  fun `heart rate per minute comes from the step samples and ignores the unusable rows`() {
    val samples = listOf<Pair<Long, Int?>>(
      bedtime.epochSecond to 57,
      // A later sample in the same minute replaces the earlier one, as the watch sends the fresher value last.
      bedtime.epochSecond + 20 to 61,
      // Not a measurement: dropped, so the minute keeps whatever it had.
      bedtime.epochSecond + 60 to 0,
      bedtime.epochSecond + 120 to null,
    )

    val byMinute = EstimatedSleepStages.heartRateByMinute(samples)

    assertEquals(mapOf(bedtime.epochSecond to 61), byMinute)
  }

  @Test
  fun `a raw night becomes one staged night at night, with deep and REM inside the estimator's shares`() {
    val accs = aNight()
    val minutes = EstimatedSleepStages.withHeartRate(
      EstimatedSleepStages.minutesFromAcc(accs),
      heartRate(bedtime, 30 + 450 + 60, ::nightHeartRate),
    )

    val sessions = EstimatedSleepStages.estimate(minutes)
    val segments = EstimatedSleepStages.segments(sessions)

    assertEquals("one night out of ${minutes.size} minutes", 1, sessions.size)
    val onset = sessions[0].onset.atOffset(zone).toLocalTime()
    val end = sessions[0].end.atOffset(zone).toLocalTime()
    assertTrue("onset $onset", onset >= LocalTime.of(21, 0) || onset <= LocalTime.of(1, 0))
    assertTrue("end $end", end >= LocalTime.of(5, 0) && end <= LocalTime.of(9, 0))

    val session = sessions[0]
    val deep = session.stages.filter { it.stage == EstimatedStage.DEEP }.sumOf { it.end.epochSecond - it.start.epochSecond }
    val rem = session.stages.filter { it.stage == EstimatedStage.REM }.sumOf { it.end.epochSecond - it.start.epochSecond }
    // sleepMinutes is minutes, the spans are seconds: compare the deep/REM shares of the night's sleep.
    val asleepSeconds = session.sleepMinutes * 60f
    assertTrue("deep share ${deep / asleepSeconds}", deep / asleepSeconds in 0.10f..0.25f)
    assertTrue("rem share ${rem / asleepSeconds}", rem / asleepSeconds in 0.15f..0.30f)

    // The stored rows: the estimate's own raw kind, a plain stage name, and no gap row for a hole.
    assertTrue(segments.isNotEmpty())
    assertTrue(segments.all { it.type == EstimatedSleepStages.RAW_ESTIMATED })
    assertTrue(segments.all { it.stage in setOf("light", "deep", "rem", "awake") })
    assertTrue(segments.all { it.end > it.start })
    assertEquals(segments.sortedBy { it.start }, segments)
  }

  @Test
  fun `too few minutes are no night at all`() {
    val minutes = EstimatedSleepStages.minutesFromAcc(accMinutes(bedtime, 60) { 4 })
    assertEquals(emptyList<Any>(), EstimatedSleepStages.estimate(minutes))
  }

  @Test
  fun `a reading every other minute still makes a night, and a long gap stays a hole`() {
    // The watch's file on the wrist: a reading every other minute (the Fit 1 logged 1370 minutes over a
    // 3333-minute span). Without the hold, no 180-minute window can hold 150 sleep minutes, so the whole
    // night is lost -- the estimate came back empty on the device.
    val sparse = aNight().filterIndexed { index, _ -> index % 2 == 0 }
    val sparseMinutes = EstimatedSleepStages.minutesFromAcc(sparse)
    assertEquals("half the readings", aNight().size / 2, sparseMinutes.size)

    val filled = EstimatedSleepStages.fillGaps(sparseMinutes)
    assertTrue("the gaps were filled, got ${filled.size}", filled.size > sparseMinutes.size * 3 / 2)

    val sessions = EstimatedSleepStages.estimate(sparseMinutes)
    assertEquals("a night out of a sparse stream", 1, sessions.size)

    // A stretch the watch was off the wrist is not bridged for more than the hold's own limit; the rest
    // keeps reading as a hole, so a night cannot be claimed over it.
    val withBreak = EstimatedSleepStages.minutesFromAcc(
      accMinutes(bedtime, 60) { 4 } + accMinutes(bedtime.plusSeconds(600 * 60L), 300) { 4 },
    )
    val bridged = EstimatedSleepStages.fillGaps(withBreak)
    val holeStart = 60L
    val holeEnd = 600L
    val insideHole = bridged.filter {
      val minute = (it.time.epochSecond - bedtime.epochSecond) / 60
      minute in holeStart until holeEnd
    }
    assertEquals("only the hold's limit bridges into the gap", 3, insideHole.size)
    assertTrue(
      "the rest of the long gap stays absent",
      bridged.any { (it.time.epochSecond - bedtime.epochSecond) / 60 == holeEnd },
    )
  }

  @Test
  fun `movement is calibrated onto the range the estimator was fitted on, whatever the raw unit`() {
    fun minute(index: Int, movement: Float) =
      SleepMinute(bedtime.plusSeconds(60L * index), SleepMinuteKind.RAW, movement)

    val raw = listOf(1f, 2f, 3f, 4f, 5f).mapIndexed(::minute)
    val scaled = EstimatedSleepStages.calibrate(raw)
    // The stream's own median lands on the reference, so an undocumented unit cancels out.
    assertEquals(2.23f, EstimatedSleepStages.percentile(scaled.map { it.movement }, 0.5), 0.001f)

    // The same stream in a unit 64 times larger comes out identical: a wrong unit cannot turn every
    // minute into awake, which is what the estimator reports as "no night".
    val busy = listOf(1f, 2f, 3f, 4f, 5f).mapIndexed { index, movement -> minute(index, movement * 64f) }
    val calibratedBusy = EstimatedSleepStages.calibrate(busy).map { it.movement }
    scaled.forEachIndexed { index, minute ->
      assertEquals("minute $index", minute.movement, calibratedBusy[index], 0.001f)
    }

    // A stream that never moves has no spread to anchor on and is left alone.
    val still = listOf(0f, 0f, 0f, 0f).mapIndexed(::minute)
    assertEquals(still.map { it.movement }, EstimatedSleepStages.calibrate(still).map { it.movement })
  }

  @Test
  fun `a staged window outranks the estimate, and a stage-less range does not`() {
    val state = listOf(SleepSegment(bedtime.epochSecond, bedtime.epochSecond + 3600, 0x06, null))
    val staged = listOf(SleepSegment(bedtime.epochSecond, bedtime.epochSecond + 3600, 0x07, "deep"))
    val estimate = listOf(SleepSegment(bedtime.epochSecond + 1800, bedtime.epochSecond + 5400, EstimatedSleepStages.RAW_ESTIMATED, "light"))

    // Nothing is estimated on a watch that stages itself (and the import's rows look the same here).
    assertEquals(staged, EstimatedSleepStages.withEstimatedStages(staged, estimate))

    // A stage-less range says when the watch judged you asleep, not that it knows a stage: it does not outrank the
    // estimate, and the estimate is added whole (segments tile a night, so no trimming).
    val merged = EstimatedSleepStages.withEstimatedStages(state, estimate)
    assertEquals(2, merged.size)
    assertTrue(merged.any { it.stage == null })
    assertEquals(estimate[0].start, merged.first { it.stage != null }.start)
  }

  @Test
  fun `an estimate that clears a staged window is kept whole`() {
    val staged = listOf(SleepSegment(bedtime.epochSecond, bedtime.epochSecond + 3600, 0x07, "deep"))
    val estimate = listOf(
      SleepSegment(bedtime.epochSecond + 3600, bedtime.epochSecond + 7200, EstimatedSleepStages.RAW_ESTIMATED, "light"),
    )

    val merged = EstimatedSleepStages.withEstimatedStages(staged, estimate)
    assertEquals(2, merged.size)
    assertEquals(estimate[0].start, merged[1].start)
  }

  @Test
  fun `without an estimate the watch's own ranges are handed through untouched`() {
    val state = listOf(SleepSegment(bedtime.epochSecond, bedtime.epochSecond + 3600, 0x06, null))
    assertEquals(state, EstimatedSleepStages.withEstimatedStages(state, emptyList()))
  }

  @Test
  fun `every stage the estimator can produce has a stored name, and a gap has none`() {
    assertEquals("awake", EstimatedSleepStages.stageOf(EstimatedStage.AWAKE))
    assertEquals("light", EstimatedSleepStages.stageOf(EstimatedStage.LIGHT))
    assertEquals("deep", EstimatedSleepStages.stageOf(EstimatedStage.DEEP))
    assertEquals("rem", EstimatedSleepStages.stageOf(EstimatedStage.REM))
    assertNull(EstimatedSleepStages.stageOf(EstimatedStage.UNKNOWN))
  }
}
