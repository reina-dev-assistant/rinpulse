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
   * sample add up to 0..64. Huawei does not document the unit, so this is a first calibration chosen to land
   * in the range the estimator's own constants were fitted around — GB divides Huami's intensity by the same
   * 8 (`HuamiEstimatedSleepSessionProvider`). It is the one number to tune first against real nights.
   */
  private const val ACC_PER_MOVEMENT = 8f

  /** Below this many minutes a stream cannot hold a night (the estimator wants 150 of sleep in 180). */
  private const val MIN_MINUTES = 180

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
    return SleepStageEstimator.estimateAll(minutes, SleepEstimatorConfig())
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

  /** One minute, in seconds, for the log line that says how much the estimate had to work with. */
  fun coverage(minutes: List<SleepMinute>): String {
    if (minutes.isEmpty()) return "no minutes"
    val withHeartRate = minutes.count { it.heartRate != null }
    val first = minutes.minOf { it.time }
    val last = minutes.maxOf { it.time }
    return "${minutes.size} minutes $first..$last, $withHeartRate with heart rate"
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
