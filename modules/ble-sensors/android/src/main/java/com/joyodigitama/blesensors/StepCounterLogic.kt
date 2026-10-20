package com.joyodigitama.blesensors

/**
 * The pure part of [WorkoutSteps]: the sensor's clock to wall-clock time, and the cumulative counter (steps since boot) to steps since the
 * session started. One instance per session; not thread safe, the sensor delivers on one thread.
 */
internal class StepCounterLogic {
  private var baseline: Long? = null
  private var last = 0L
  private var total = 0L

  /**
   * Steps counted since the first reading of the session, for a raw counter [counter]. The first reading is the baseline (0). A counter that
   * goes backwards (the phone rebooted, the sensor was reset) restarts the baseline at that value: what it counted before stays counted
   * and the steps the new value stands for are added, so the total never goes down.
   */
  fun total(counter: Float): Long {
    val value = counter.toLong()
    val base = baseline
    if (base == null) {
      baseline = value
      last = value
      return total
    }
    if (value < last) {
      total += value
    } else {
      total += value - last
    }
    last = value
    return total
  }

  companion object {
    /** Wall-clock epoch ms of a sensor event stamped [eventNanos] on the elapsed-realtime clock, seen when the clocks read [nowWallMs] and [nowElapsedNanos]. */
    fun eventWallMs(eventNanos: Long, nowWallMs: Long, nowElapsedNanos: Long): Long =
      nowWallMs - (nowElapsedNanos - eventNanos) / 1_000_000L
  }
}
