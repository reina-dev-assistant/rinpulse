// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE): util/sleep/SleepStageEstimator.kt (upstream
// 94e29b935e5e945e, the estimator ported there from OpenVitals by Manuel Marcatili for Garmin watches).
// This file is the Huawei side: it turns the Watch Fit 1's own raw night into the estimator's input.
package com.joyodigitama.huaweiwear

import java.time.Instant
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTruSleepParser
import nodomain.freeyourgadget.gadgetbridge.util.sleep.EstimatedSleepSession
import nodomain.freeyourgadget.gadgetbridge.util.sleep.EstimatedStage
import nodomain.freeyourgadget.gadgetbridge.util.sleep.SleepEstimatorConfig
import nodomain.freeyourgadget.gadgetbridge.util.sleep.SleepMinute
import nodomain.freeyourgadget.gadgetbridge.util.sleep.SleepMinuteKind
import nodomain.freeyourgadget.gadgetbridge.util.sleep.SleepStageEstimator

/**
 * Sleep stages a watch does not send, estimated on the phone from the raw night it does send.
 *
 * The Watch Fit 1 never sends stages over Bluetooth: dictionary sleep (ExpandCapability 143), sleep frames
 * (command 0x0D) and the state file are all silent about them, which is the same dead end Gadgetbridge
 * documents for the Fit 3 ("all sleep show up as light sleep", issue 3829). Huawei Health gets its stages
 * because it works them out on the phone from `sleep_data.bin`; `SleepSync` parses exactly that file and
 * dumped the result into the log ("not mapped, as GB").
 *
 * So the file is not wasted any more. [HuaweiTruSleepParser.TruSleepDataAcc] is the watch's accelerometer
 * sampled **every 60 seconds, 24 h a day**, two axes as activity bytes (0x00 still .. 0xff moving; the third
 * is gravity) — a movement count per minute, which is one half of what [SleepStageEstimator] wants. The other
 * half is heart rate, which the same night already has in `step_samples`. The estimator then does the rest:
 * sleep/wake by actigraphy (Cole-Kripke, Webster rescoring) and stages from heart rate against its own
 * baseline, its variability and the time of night.
 *
 * Rows are stored in `sleep_segments` under [RAW_ESTIMATED], a raw kind the watch never sends, so every
 * consumer keeps working and the rows stay recognisable:
 *
 *  - they carry a stage, so `SleepCleaning` never subtracts awake evidence from them and they are what the
 *    Sleep screen draws;
 *  - an estimate is never written over a night the watch (or a Huawei export) already staged, and the Huawei
 *    export importer drops the estimates of a window it holds real stages for: real stages always win.
 *
 * These are estimates from a heuristic without ground truth, not Huawei's numbers: label them as such
 * wherever they reach the user (see docs/sleep-stages.md).
 */
internal object EstimatedSleepStages {
  /**
   * The raw kind of an estimated row. Not one of the kinds the watch sends (0x06/0x07/0x5656/0x5658/0x5659
   * and 1), so `stageForRawKind` keeps ignoring it and a row is identifiable by its type alone.
   */
  const val RAW_ESTIMATED = 0x5657

  /**
   * ACC axis activity per movement unit, so a 0x00..0xff axis reads as 0..32 counts and the two axes of a
   * sample add up to 0..64. Huawei does not document the unit, so this is where the raw byte becomes a
   * number, and [calibrate] then places the stream's own spread in the range the estimator's constants were
   * fitted on, which is what actually removes the guess. GB divides Huami's intensity by the same 8
   * (`HuamiEstimatedSleepSessionProvider`).
   */
  private const val ACC_PER_MOVEMENT = 8f

  /**
   * The percentile of a stream [calibrate] anchors, and the movement value it is placed on. The value is the
   * median movement of the real night the estimator's constants were fitted on (Garmin Venu SQ, the fixture
   * of its own test), read off that night's minutes; the median is the steadiest of the candidates — the
   * 75th and 90th percentiles of a sparse watch file move with how much of the night was restless.
   */
  private const val REFERENCE_PERCENTILE = 0.5
  private const val REFERENCE_MOVEMENT = 2.23f

  /**
   * The estimator's `SleepEstimatorConfig.sleepThreshold`: a minute whose weighted movement is at or above this
   * is awake. Used only to describe a stream in the log ([scoring]), never to score one -- the estimator does
   * its own scoring with its own constants.
   */
  private const val SLEEP_THRESHOLD = 8f

  /** Below this many minutes a stream cannot hold a night (the estimator wants 150 of sleep in 180). */
  private const val MIN_MINUTES = 180

  /**
   * How many consecutive minutes with no ACC reading a gap may hold and still be filled from the
   * reading before it. The Watch Fit 1 logs 1370 readings over a 3333-minute span (41%, gaps of two or
   * three minutes on average), and at that sparseness the estimator finds no night at all: a minute the
   * file skips is UNMEASURABLE, which is never sleep, so no 180-minute window can hold the 150 sleep
   * minutes a night needs. A minute between two readings is not a break in the stream (the watch stayed
   * on the wrist), so the earlier reading carries across it (zero-order hold).
   *
   * Five, measured on a night replayed at the cadences this file can have (dense = 403 sleep minutes):
   * gaps of 2-3 min recover fully at 3, gaps of 3-7 min need 4, and gaps of 5-9 min need 8 while 5
   * still recovers 336 of 403. It is deliberately well below the estimator's own 45-minute break, so a
   * stretch the watch really was off the wrist is never claimed as sleep.
   */
  private const val MAX_FILLED_GAP_MINUTES = 5

  private const val SECONDS_PER_MINUTE = 60L

  /**
   * The watch's accelerometer as the estimator's minutes. Minutes the file does not cover stay absent (the
   * estimator fills them as not worn, so a sparse file behaves like a gap). Two samples in one minute keep
   * the larger movement: movement is a count, and the busiest reading of a minute is the honest one.
   */
  fun minutesFromAcc(accs: List<HuaweiTruSleepParser.TruSleepDataAcc>): List<SleepMinute> {
    if (accs.isEmpty()) return emptyList()
    val byMinute = HashMap<Long, Float>(accs.size)
    for (acc in accs) {
      // The sample's second is floored to its minute: the watch samples every 60 s, so a minute's worth of jitter
      // must not become a second entry for the same minute (the grid would drop one of them).
      val minute = acc.startTime.toLong() / SECONDS_PER_MINUTE * SECONDS_PER_MINUTE
      // Little endian: the low byte is one axis, the high byte the other; the third axis is gravity and is
      // not in the sample at all (HuaweiTruSleepParser.decodeAcc reads two bytes).
      val low = acc.flags.toInt() and 0xFF
      val high = (acc.flags.toInt() shr 8) and 0xFF
      val movement = (low + high) / ACC_PER_MOVEMENT
      byMinute[minute] = maxOf(byMinute[minute] ?: 0f, movement)
    }
    return byMinute.entries
      .sortedBy { it.key }
      .map { (second, movement) -> SleepMinute(Instant.ofEpochSecond(second), SleepMinuteKind.RAW, movement) }
  }

  /** [minutes] with the heart rate the phone stored for the same minute; a minute without one keeps null. */
  fun withHeartRate(minutes: List<SleepMinute>, heartRateByMinute: Map<Long, Int>): List<SleepMinute> {
    if (heartRateByMinute.isEmpty()) return minutes
    return minutes.map { minute ->
      // Both sides come from the watch's own minute grid, but a file's timestamps are not guaranteed to sit on
      // the minute, so the lookup floors it the same way the map's keys are floored.
      val bpm = heartRateByMinute[minute.time.epochSecond / SECONDS_PER_MINUTE * SECONDS_PER_MINUTE]
      if (bpm == null) minute else minute.copy(heartRate = bpm.toFloat())
    }
  }

  /** Heart rate per minute from `(timestamp, bpm)` pairs, keyed by the minute's start. */
  fun heartRateByMinute(rows: List<Pair<Long, Int?>>): Map<Long, Int> {
    val out = HashMap<Long, Int>(rows.size)
    for ((timestamp, heartRate) in rows) {
      val bpm = heartRate ?: continue
      if (bpm <= 0) continue
      out[timestamp / 60 * 60] = bpm
    }
    return out
  }

  /** Every night the minutes hold, in time order; empty when there are too few minutes to be one. */
  fun estimate(minutes: List<SleepMinute>): List<EstimatedSleepSession> {
    if (minutes.size < MIN_MINUTES) return emptyList()
    return SleepStageEstimator.estimateAll(calibrate(fillGaps(minutes)), SleepEstimatorConfig())
  }

  /**
   * [minutes] with the short gaps between two readings filled from the reading before them (zero-order
   * hold).
   *
   * The estimator reads a minute it has no reading for as not worn ([SleepMinuteKind.UNMEASURABLE]),
   * which is never sleep, and it needs 150 sleep minutes inside a 180-minute window. A watch whose file
   * carries a reading every other minute therefore cannot produce a night at all: no 180-minute window
   * can hold 150 minutes of sleep when half of them are holes. The Watch Fit 1 does exactly this —
   * its `sleep_data.bin` logged 1370 minutes over a 3333-minute span — and the estimate came back empty.
   *
   * A minute between two readings is not a break in the stream (the watch stayed on the wrist), so the
   * earlier reading carries across it. A stretch longer than [MAX_FILLED_GAP_MINUTES] stays absent: that
   * is the watch off the wrist or a real gap, and it must keep reading as a hole.
   */
  fun fillGaps(minutes: List<SleepMinute>, maxGapMinutes: Int = MAX_FILLED_GAP_MINUTES): List<SleepMinute> {
    if (minutes.size < 2) return minutes
    val slots = HashMap<Long, SleepMinute>(minutes.size * 2)
    for (minute in minutes) slots[minute.time.epochSecond / SECONDS_PER_MINUTE * SECONDS_PER_MINUTE] = minute
    val first = slots.keys.min()
    val last = slots.keys.max()
    val out = ArrayList<SleepMinute>(minutes.size)
    var held: SleepMinute? = null
    var heldMinutes = 0
    var at = first
    while (at <= last) {
      val minute = slots[at]
      if (minute != null) {
        out.add(minute)
        held = minute
        heldMinutes = 0
      } else if (held != null && heldMinutes <= maxGapMinutes) {
        out.add(held.copy(time = Instant.ofEpochSecond(at)))
      }
      heldMinutes++
      at += SECONDS_PER_MINUTE
    }
    return out
  }

  /**
   * [minutes] with movement scaled so the stream's own spread sits in the range the estimator's
   * constants were fitted on.
   *
   * Huawei does not document the unit of the accelerometer bytes, so a fixed divisor is a guess, and a
   * wrong one does not merely shift the numbers: too large and every minute scores as awake, which the
   * estimator reports as "no night" exactly like a sparse stream does. Placing the stream's own
   * [REFERENCE_PERCENTILE] percentile on [REFERENCE_MOVEMENT] removes the unknown unit instead of
   * guessing it, and is the same transformation whatever the unit is.
   *
   * Why the midpoint of the stream rather than its median: a worn watch is quiet through the night and
   * loud through the day, and only the night is scored, so a night's own readings sit near the bottom of
   * the stream the day dragged up. The median of a file that holds nothing but night (this watch's
   * `sleep_data.bin` covers the asleep window) is a night value, so the midpoint is used only when the
   * median is not already below it — with a night-only file that leaves the median in charge, and with a
   * 24-hour file it keeps the anchor on the night instead of the day.
   */
  fun calibrate(minutes: List<SleepMinute>): List<SleepMinute> {
    if (minutes.isEmpty()) return minutes
    val at = percentile(minutes.map { it.movement }, REFERENCE_PERCENTILE)
    if (at <= 0f) return minutes
    val factor = REFERENCE_MOVEMENT / at
    return minutes.map { it.copy(movement = maxOf(it.movement * factor, 0f)) }
  }

  /** The [p] (0..1) of [values]; 0 when there are none. */
  fun percentile(values: List<Float>, p: Double): Float {
    if (values.isEmpty()) return 0f
    val sorted = values.sorted()
    return sorted[((sorted.size - 1) * p).toInt()]
  }

  /**
   * What the sleep/wake scoring actually made of these minutes, for the log. A night can fail to come out
   * for reasons the file's density does not show: the estimator calls a minute asleep only when its weighted
   * movement is under its threshold, and a run of minutes has to stay under it for a whole night to exist.
   *
   * The estimator's own scoring is not reachable from here (its grid and labels are internal to the ported
   * package), so this reports the numbers that bound it instead of the labels: how the movement values are
   * spread, how many minutes are quiet enough that the centre of the Cole-Kripke window alone lands under
   * `SleepEstimatorConfig.sleepThreshold` (8, and the centre weight is 1), and the longest unbroken such run.
   * A night that is genuinely there shows a long quiet run; values in the wrong unit show a short one.
   */
  fun scoring(minutes: List<SleepMinute>): String {
    val raw = minutes.filter { it.kind == SleepMinuteKind.RAW }
    if (raw.isEmpty()) return "no readings to score"
    val values = raw.map { it.movement }
    val ordered = raw.sortedBy { it.time.epochSecond }
    var run = 0
    var longest = 0
    for (minute in ordered) {
      if (minute.movement < SLEEP_THRESHOLD) {
        run++
        if (run > longest) longest = run
      } else {
        run = 0
      }
    }
    val quiet = values.count { it < SLEEP_THRESHOLD } * 100 / values.size
    return "movement p50=${percentile(values, 0.5)} p90=${percentile(values, 0.9)} max=${values.max()}, " +
      "$quiet% of minutes under the $SLEEP_THRESHOLD threshold, longest quiet run ${longest}min"
  }

  /**
   * Stored rows for [sessions]. A not-worn stretch inside a night ([EstimatedStage.UNKNOWN]) is left out, so
   * the night keeps its hole instead of claiming sleep over it. The `stage` is the plain
   * `light`/`deep`/`rem`/`awake` every consumer already knows; that these rows are estimates is in the type
   * ([RAW_ESTIMATED]).
   */
  fun segments(sessions: List<EstimatedSleepSession>): List<SleepSegment> {
    val out = ArrayList<SleepSegment>()
    for (session in sessions) {
      for (span in session.stages) {
        val stage = stageOf(span.stage) ?: continue
        val start = span.start.epochSecond
        val end = span.end.epochSecond
        if (end <= start) continue
        out.add(SleepSegment(start, end, RAW_ESTIMATED, stage))
      }
    }
    return out.sortedBy { it.start }
  }

  /** The stored name of an estimated stage, or null for a gap. */
  fun stageOf(stage: EstimatedStage): String? = when (stage) {
    EstimatedStage.AWAKE -> "awake"
    EstimatedStage.LIGHT -> "light"
    EstimatedStage.DEEP -> "deep"
    EstimatedStage.REM -> "rem"
    EstimatedStage.UNKNOWN -> null
  }

  /**
   * One line for the log that says how much the estimate had to work with: the minutes it spanned, how
   * many carried a heart rate, how sparse the stream was, and how much the hold then recovered. The
   * density is the number that decides whether a night can be found at all, so it belongs in the log
   * rather than being recomputed by hand from the timestamps.
   */
  fun coverage(minutes: List<SleepMinute>, filled: List<SleepMinute>): String {
    if (minutes.isEmpty()) return "no minutes"
    val withHeartRate = minutes.count { it.heartRate != null }
    val first = minutes.minOf { it.time }
    val last = minutes.maxOf { it.time }
    val spanMinutes = (last.epochSecond - first.epochSecond) / SECONDS_PER_MINUTE + 1
    val density = minutes.size * 100 / spanMinutes
    val filledDensity = filled.size * 100 / spanMinutes
    return "${minutes.size} minutes $first..$last ($density% of the span), $withHeartRate with heart rate; " +
      "gaps up to $MAX_FILLED_GAP_MINUTES min filled to $filledDensity%"
  }

  /**
   * [stateSegments] (the watch's own judged-asleep windows, stage-less on this watch) plus [estimated]. The ranges are
   * kept: they say when the watch itself judged the wearer asleep, and the reader drops the stage-less ones that sit
   * next to real stages (`withoutStrayUnstaged`). The estimates carry the stages.
   *
   * A window that already carries a stage keeps it: nothing estimated lands on it, so a watch that does stage sleep
   * itself, and a Huawei export (whose stages are imported), both outrank the estimate. For an import that arrives
   * after an estimate, `HuaweiImportStore.writeSleep` deletes the estimated rows of the windows it stages.
   */
  fun withEstimatedStages(
    stateSegments: List<SleepSegment>,
    estimated: List<SleepSegment>,
  ): List<SleepSegment> {
    if (estimated.isEmpty()) return stateSegments
    val staged = stateSegments.filter { it.stage != null }
    val fresh = estimated.filter { row -> staged.none { it.start < row.end && row.start < it.end } }
    if (fresh.isEmpty()) return stateSegments
    return (stateSegments + fresh).distinctBy { listOf(it.start, it.end, it.type) }.sortedBy { it.start }
  }
}
