package com.joyodigitama.blesensors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingProgressTest {
  private val t0 = 1_000_000L

  /** About 11.1 m per 0.0001 degree of latitude. */
  private fun lat(steps: Int) = 52.0 + steps * 0.0001

  private fun running(distanceM: Double = 0.0, elapsedMs: Long = 0, hr: Int? = null) =
    RecordingProgress().apply { apply(RecordingProgress.Update(elapsedMs, distanceM, hr, paused = false), t0) }

  @Test
  fun nothingToShowBeforeTheFirstReport() {
    val p = RecordingProgress()
    assertFalse(p.hasProgress)
    p.onFix(lat(0), 5.0, t0, 5.0)
    p.onFix(lat(1), 5.0, t0 + 1000, 5.0)
    assertEquals(0.0, p.distanceM, 0.0)
  }

  @Test
  fun theClockRunsOnItsOwnFromTheLastReport() {
    val p = running(elapsedMs = 65_000)
    assertEquals(65_000L, p.elapsedMs(t0))
    assertEquals(95_000L, p.elapsedMs(t0 + 30_000))
  }

  @Test
  fun aPausedClockStandsStill() {
    val p = RecordingProgress()
    p.apply(RecordingProgress.Update(65_000, 120.0, 140, paused = true), t0)
    assertFalse(p.running)
    assertEquals(65_000L, p.elapsedMs(t0 + 60_000))
  }

  @Test
  fun fixesAddTheStepsToTheReportedDistance() {
    val p = running(distanceM = 100.0)
    p.onFix(lat(0), 5.0, t0, 5.0)
    p.onFix(lat(1), 5.0, t0 + 3000, 5.0)
    p.onFix(lat(2), 5.0, t0 + 6000, 5.0)
    assertEquals(100.0 + 22.2, p.distanceM, 0.5)
  }

  @Test
  fun aNewReportReplacesTheEstimate() {
    val p = running()
    p.onFix(lat(0), 5.0, t0, 5.0)
    p.onFix(lat(2), 5.0, t0 + 6000, 5.0)
    p.apply(RecordingProgress.Update(10_000, 18.0, 150, paused = false), t0 + 10_000)
    assertEquals(18.0, p.distanceM, 0.0)
    assertEquals(150, p.hr)
  }

  @Test
  fun pausedFixesMoveTheAnchorButAddNothing() {
    val p = running()
    p.onFix(lat(0), 5.0, t0, 5.0)
    p.apply(RecordingProgress.Update(5000, 0.0, null, paused = true), t0 + 5000)
    p.onFix(lat(50), 5.0, t0 + 10_000, 5.0)
    p.apply(RecordingProgress.Update(5000, 0.0, null, paused = false), t0 + 11_000)
    p.onFix(lat(51), 5.0, t0 + 12_000, 5.0)
    assertEquals(11.1, p.distanceM, 0.3)
  }

  @Test
  fun poorFixesJumpsAndJitterAreIgnored() {
    val p = running()
    p.onFix(lat(0), 5.0, t0, 5.0)
    p.onFix(lat(9), 5.0, t0 + 1000, 80.0) // inaccurate
    p.onFix(lat(900), 5.0, t0 + 1000, 5.0) // 10 km in a second
    p.onFix(lat(0) + 0.00001, 5.0, t0 + 2000, 5.0) // 1 m of jitter
    assertEquals(0.0, p.distanceM, 0.0)
  }

  @Test
  fun aLongGapReanchorsInsteadOfCountingTheJump() {
    val p = running()
    p.onFix(lat(0), 5.0, t0, 5.0)
    p.onFix(lat(30), 5.0, t0 + 60_000, 5.0)
    assertEquals(0.0, p.distanceM, 0.0)
    p.onFix(lat(31), 5.0, t0 + 61_000, 5.0)
    assertEquals(11.1, p.distanceM, 0.3)
  }

  @Test
  fun resetForgetsTheSession() {
    val p = running(distanceM = 500.0, elapsedMs = 9000, hr = 120)
    p.reset()
    assertFalse(p.hasProgress)
    assertEquals(0.0, p.distanceM, 0.0)
    assertNull(p.hr)
    assertTrue(p.elapsedMs(t0 + 5000) == 0L)
  }
}
