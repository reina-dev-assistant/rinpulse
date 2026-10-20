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

  /** The window the watch itself judged asleep for {@link aNight}: its `sleep_state.bin` range. */
  private fun aNightWindow(start: Instant = bedtime, sleepMinutes: Int = 450): List<Pair<Long, Long>> =
    listOf(start.epochSecond to start.plusSeconds((30 + sleepMinutes + 60) * 60L).epochSecond)

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

    val sessions = EstimatedSleepStages.estimate(minutes, aNightWindow())
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
    assertEquals(emptyList<Any>(), EstimatedSleepStages.estimate(minutes, aNightWindow()))
  }

  /**
   * The accelerometer file covers 24 h, so the estimate must be bounded by the watch's own sleep ranges: a
   * whole day of quiet reading is not a night. On the device this came out as 177 h of sleep over a 55-hour
   * file, because the day's own minutes were read as sleep and joined the night's.
   */
  @Test
  fun `only the watch's own sleep ranges are estimated, not the whole day`() {
    // A full day: the night as usual, and the rest of the day quiet enough to be misread as sleep.
    val quietDay = accMinutes(bedtime.minusSeconds(8 * 3600L), 8 * 60) { 0 } +
      aNight() +
      accMinutes(bedtime.plusSeconds(9 * 3600L), 14 * 60) { 0 }
    val minutes = EstimatedSleepStages.minutesFromAcc(quietDay)

    val windows = aNightWindow()
    val bounded = EstimatedSleepStages.within(minutes, windows)
    assertTrue("the day was dropped, got ${bounded.size} of ${minutes.size}", bounded.size < minutes.size * 40 / 100)
    assertTrue("no minute before the window", bounded.all { it.time.epochSecond >= bedtime.epochSecond })

    // What the estimate claims stays inside the window; unbounded it would swallow the day.
    val claimed = EstimatedSleepStages.segments(EstimatedSleepStages.estimate(minutes, windows))
    assertTrue(claimed.isNotEmpty())
    val (from, to) = windows[0]
    assertTrue(
      "the night stays within the watch's range, got ${claimed.first().start}..${claimed.last().end}",
      claimed.first().start >= from && claimed.last().end <= to,
    )
    assertEquals("one night, not the day", 1, EstimatedSleepStages.estimate(minutes, windows).size)
  }

  @Test
  fun `without the watch naming any sleep range nothing is claimed`() {
    // The file alone covers the day too, so there is nothing to tell night from day with.
    val minutes = EstimatedSleepStages.minutesFromAcc(aNight())
    assertEquals(emptyList<Any>(), EstimatedSleepStages.estimate(minutes, emptyList()))
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

    val sessions = EstimatedSleepStages.estimate(sparseMinutes, aNightWindow())
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
    assertEquals("only the hold's limit bridges into the gap", 5, insideHole.size)
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
  fun `the whole-day row a buggy build left behind is dropped, the night it covers is kept`() {
    val night = bedtime.epochSecond to bedtime.epochSecond + 8 * 3600
    val day = night.first - 12 * 3600 to night.first + 12 * 3600 // the unbounded estimate: one row over 24 h
    val stored = listOf(
      StoredEstimated(1, day.first, day.second), // the 177 h bug: reaches outside the watch's own range
      StoredEstimated(2, night.first, night.first + 3600), // a real estimated row inside it
    )
    val ranges = listOf(night)
    val fresh = listOf(SleepSegment(night.first, night.first + 3600, EstimatedSleepStages.RAW_ESTIMATED, "light"))

    // The in-range row shares its start with a fresh row: the upsert wrote over that rowid, so it is replaced,
    // not deleted. Only the unreproducible day-long row goes.
    assertEquals(listOf(1L), EstimatedSleepStages.superseded(stored, fresh, ranges).map { it.rowid })
  }

  @Test
  fun `stale rows an old build left are dropped even though this run never saw their nights`() {
    val at = bedtime.epochSecond
    // The 152 h report: a build that estimated the whole accelerometer day left several day-long rows behind, one
    // per sync. Their own nights are long out of the sync window, so this run re-derived only tonight.
    val old = at - 5 * 24 * 3600
    val stored = listOf(
      StoredEstimated(1, old, old + 24 * 3600),
      StoredEstimated(2, old + 24 * 3600, old + 48 * 3600),
      StoredEstimated(3, at, at + 3600),
    )
    val tonight = listOf(at to at + 8 * 3600)
    val fresh = listOf(SleepSegment(at, at + 3600, EstimatedSleepStages.RAW_ESTIMATED, "light"))

    // Judged against every range on record, the day-long rows sit outside all of them and go; tonight's stays.
    assertEquals(listOf(1L, 2L), EstimatedSleepStages.superseded(stored, fresh, tonight).map { it.rowid })
  }

  @Test
  fun `an older night's estimate is kept when its own range is on record`() {
    val at = bedtime.epochSecond
    val lastWeek = at - 7 * 24 * 3600
    val stored = listOf(StoredEstimated(1, lastWeek, lastWeek + 3600), StoredEstimated(2, at, at + 3600))
    val fresh = listOf(SleepSegment(at, at + 3600, EstimatedSleepStages.RAW_ESTIMATED, "light"))
    // Both nights' ranges are on record: the incremental sync only re-derived tonight, but last week's row lies
    // inside its own range, so it is still reproducible and stays.
    val ranges = listOf(lastWeek to lastWeek + 8 * 3600, at to at + 8 * 3600)

    assertEquals(emptyList<Long>(), EstimatedSleepStages.superseded(stored, fresh, ranges).map { it.rowid })
  }

  @Test
  fun `a shifted re-run drops the rows it no longer lands on`() {
    val at = bedtime.epochSecond
    // The previous run's rows, at the minutes it began on; this run begins a minute earlier, so nothing collides.
    val stored = listOf(StoredEstimated(1, at, at + 600), StoredEstimated(2, at + 600, at + 1200))
    val fresh = listOf(
      SleepSegment(at - 60, at + 540, EstimatedSleepStages.RAW_ESTIMATED, "light"),
      SleepSegment(at + 540, at + 1140, EstimatedSleepStages.RAW_ESTIMATED, "deep"),
    )
    val ranges = listOf(at - 3600 to at + 3600)

    assertEquals(listOf(1L, 2L), EstimatedSleepStages.superseded(stored, fresh, ranges).map { it.rowid })
  }

  @Test
  fun `a night this run could not estimate keeps its earlier rows`() {
    val at = bedtime.epochSecond
    // Sparse data: the estimator found no night this time, so there are no fresh rows at all. The range is still
    // on record, so the rows inside it are still reproducible and stay.
    val stored = listOf(StoredEstimated(1, at, at + 3600), StoredEstimated(2, at + 3600, at + 7200))
    val ranges = listOf(at to at + 8 * 3600)

    assertEquals(emptyList<Long>(), EstimatedSleepStages.superseded(stored, emptyList(), ranges).map { it.rowid })
  }

  @Test
  fun `a sync that saw nothing judges nothing`() {
    val at = bedtime.epochSecond
    val stored = listOf(StoredEstimated(1, at, at + 3600))

    // No estimate and no range: the file was missing and no night is on record. Nothing to judge a row against.
    assertEquals(emptyList<Long>(), EstimatedSleepStages.superseded(stored, emptyList(), emptyList()).map { it.rowid })
  }

  @Test
  fun `an estimate overrunning its range by the minute the grid ends on is still inside it`() {
    val at = bedtime.epochSecond
    val range = at to at + 8 * 3600
    // The grid runs to the last minute it was given, so a row's end can sit one minute past the range's end.
    val stored = listOf(StoredEstimated(1, range.first, range.second + 60))

    assertEquals(emptyList<Long>(), EstimatedSleepStages.superseded(stored, emptyList(), listOf(range)).map { it.rowid })
  }

  @Test
  fun `the watch's own stage-less ranges in this sync do not condemn the estimates inside them`() {
    val at = bedtime.epochSecond
    // The sync hands over the watch's own ranges alongside the estimate. A range spans the whole night, so if it
    // counted as a "fresh row" every estimate inside it would read as covered and be dropped.
    val stored = listOf(StoredEstimated(1, at, at + 3600), StoredEstimated(2, at + 3600, at + 7200))
    val state = SleepSegment(at, at + 8 * 3600, 0x06, null)
    val fresh = listOf(state) + listOf(SleepSegment(at, at + 3600, EstimatedSleepStages.RAW_ESTIMATED, "light"))
    val ranges = listOf(at to at + 8 * 3600)

    // Only the row the estimate re-landed on is replaced; the one behind it keeps its earlier estimate.
    assertEquals(emptyList<Long>(), EstimatedSleepStages.superseded(stored, fresh, ranges).map { it.rowid })
  }

  @Test
  fun `every stage the estimator can produce has a stored name, and a gap has none`() {
    assertEquals("awake", EstimatedSleepStages.stageOf(EstimatedStage.AWAKE))
    assertEquals("light", EstimatedSleepStages.stageOf(EstimatedStage.LIGHT))
    assertEquals("deep", EstimatedSleepStages.stageOf(EstimatedStage.DEEP))
    assertEquals("rem", EstimatedSleepStages.stageOf(EstimatedStage.REM))
    assertNull(EstimatedSleepStages.stageOf(EstimatedStage.UNKNOWN))
  }

  /**
   * A PPG packet exactly as the watch writes it: tag 0x02, a two-byte length, the packet's start second, the peak
   * count, then the peaks and the amplitudes as raw little-endian shorts. A peak is in hundredths of a second after
   * the packet's start ([HuaweiTruSleepParser.decodePpg]), so 97 is 970 ms — an interval between two beats.
   */
  /** A minute's start, so a packet's beats do not spill into the next minute and split the rate in two. */
  private val MINUTE_START = 1_000_020

  private fun ppgPacket(startSecond: Int, beats: List<Int>): ByteArray {
    val body = java.nio.ByteBuffer.allocate(7 + beats.size * 4).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    body.putInt(startSecond)
    body.put(beats.size.toByte())
    body.put(0xaa.toByte()) // uncompressed peaks
    for (beat in beats) body.putShort(beat.toShort())
    body.put(0xaa.toByte()) // uncompressed amplitudes
    for (beat in beats) body.putShort((beat / 2).toShort())
    val packet = java.nio.ByteBuffer.allocate(3 + body.capacity()).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    packet.put(2.toByte()) // TAG_PPG
    packet.putShort(body.capacity().toShort())
    packet.put(body.array())
    return packet.array()
  }

  /** [expected] peak marks, `intervalCs` hundredths of a second apart from the packet's own start. */
  private fun beatsFor(intervalCs: Int, expected: Int): List<Int> =
    List(expected) { index -> index * intervalCs }

  @Test
  fun `the file's own PPG gives the night's heart rate`() {
    // The watch writes a packet a minute at night; 97 hundredths of a second between peaks is 970 ms = 61.9 bpm.
    val packet = ppgPacket(MINUTE_START, beatsFor(97, 60))
    val ppgs = HuaweiTruSleepParser.parseData(packet).dataPPGs
    assertTrue("expected the packet to parse, got ${ppgs.size} beats", ppgs.size >= 50)

    val rate = EstimatedSleepStages.heartRateFromPpg(ppgs)
    assertEquals(1, rate.size)
    // Sixty-odd beats a minute, a plausible night value; the fixtures come out at 48-75 bpm.
    assertEquals(62, rate.values.first())
  }

  @Test
  fun `a gap between two packets is not read as a slow heart rate`() {
    // Two packets a minute apart: the interval spanning the gap is a hole in the data, not a beat, so it is dropped
    // rather than averaged in. One packet alone still yields its own minute's rate.
    val first = ppgPacket(MINUTE_START, beatsFor(97, 60))
    val second = ppgPacket(MINUTE_START + 60, beatsFor(97, 60))
    val ppgs = HuaweiTruSleepParser.parseData(first + second).dataPPGs

    val rate = EstimatedSleepStages.heartRateFromPpg(ppgs)
    // Both minutes are covered, and neither rate has been dragged down by the packet boundary.
    assertEquals(2, rate.size)
    assertTrue("rates were $rate", rate.values.all { it in 55..70 })
  }

  @Test
  fun `a file with no PPG leaves the night without a heart rate`() {
    val accOnly = acc(bedtime, 8, 8)
    val packet = java.nio.ByteBuffer.allocate(1 + 1 + 7).order(java.nio.ByteOrder.LITTLE_ENDIAN)
      .put(1.toByte()) // TAG_ACC
      .put(7.toByte()) // length
      .putInt(accOnly.startTime)
      .putShort(accOnly.flags)
      .array()
    val parsed = HuaweiTruSleepParser.parseData(packet)

    assertEquals(1, parsed.dataACCs.size)
    assertTrue(EstimatedSleepStages.heartRateFromPpg(parsed.dataPPGs).isEmpty())
  }
}
