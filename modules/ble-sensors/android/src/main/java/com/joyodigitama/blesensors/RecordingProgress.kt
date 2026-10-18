package com.joyodigitama.blesensors

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * What the recording notification shows between two updates from JS: the clock, and the distance and heart rate last reported. JS stays
 * the source of truth (the recorder merges GPS, wheel sensors and auto-pause); every [apply] re-bases the clock and the distance on it.
 * Between updates the clock needs nothing (the notification's chronometer ticks by itself) and the distance grows from the GPS fixes the
 * service receives itself, so a JS thread that is throttled with the screen off leaves the notification counting instead of frozen.
 * Pure: plain JVM tests cover it. Not thread safe, [WorkoutSession] guards it with its lock.
 */
internal class RecordingProgress {
  /** What JS reports: the recorder's clock (stops while paused), distance and latest heart rate. */
  class Update(val elapsedMs: Long, val distanceM: Double, val hr: Int?, val paused: Boolean)

  private class Fix(val lat: Double, val lon: Double, val tsMs: Long)

  /** False until the first [apply]: the session is warming up or has no recorder behind it (no clock to show). */
  var hasProgress = false
    private set

  var running = false
    private set

  var distanceM = 0.0
    private set

  var hr: Int? = null
    private set

  private var baseElapsedMs = 0L
  private var baseAtMs = 0L
  private var anchor: Fix? = null

  fun reset() {
    hasProgress = false
    running = false
    distanceM = 0.0
    hr = null
    baseElapsedMs = 0L
    baseAtMs = 0L
    anchor = null
  }

  fun apply(update: Update, nowMs: Long) {
    hasProgress = true
    running = !update.paused
    baseElapsedMs = update.elapsedMs
    baseAtMs = nowMs
    distanceM = update.distanceM
    hr = update.hr
  }

  fun elapsedMs(nowMs: Long): Long = if (running) baseElapsedMs + (nowMs - baseAtMs).coerceAtLeast(0) else baseElapsedMs

  /** Adds the step from the previous fix while the clock runs. A paused clock only moves the anchor, so the gap is never counted. */
  fun onFix(lat: Double, lon: Double, tsMs: Long, accuracyM: Double?) {
    if (accuracyM != null && accuracyM > MAX_ACCURACY_M) return
    val fix = Fix(lat, lon, tsMs)
    val prev = anchor
    if (prev == null || !running) {
      anchor = fix
      return
    }
    val dtS = (tsMs - prev.tsMs) / 1000.0
    if (dtS <= 0) return
    if (dtS > MAX_GAP_S) {
      anchor = fix
      return
    }
    val d = haversineM(prev.lat, prev.lon, lat, lon)
    if (d / dtS > MAX_SPEED_MPS) return
    if (d < MIN_STEP_M) return
    distanceM += d
    anchor = fix
  }

  companion object {
    const val MAX_ACCURACY_M = 25.0
    const val MIN_STEP_M = 3.0
    const val MAX_SPEED_MPS = 15.0
    const val MAX_GAP_S = 20.0
    private const val EARTH_RADIUS_M = 6_371_000.0

    fun haversineM(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
      val p1 = Math.toRadians(lat1)
      val p2 = Math.toRadians(lat2)
      val dp = p2 - p1
      val dl = Math.toRadians(lon2 - lon1)
      val a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
      return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(a)))
    }
  }
}
