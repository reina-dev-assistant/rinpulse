package com.joyodigitama.blesensors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionPolicyTest {
  @Test
  fun anAcceptedServiceKeepsEverythingAndReportsNothing() {
    assertEquals(
      SessionPolicy.Plan(gps = true, wakeLock = true, notification = true, reportNoService = false),
      SessionPolicy.afterServiceStart(gps = true, serviceStarted = true),
    )
  }

  @Test
  fun aRefusedServiceStillRunsTheGpsAndTheWakeLockAndSaysSo() {
    val plan = SessionPolicy.afterServiceStart(gps = true, serviceStarted = false)
    assertTrue(plan.gps)
    assertTrue(plan.wakeLock)
    assertFalse(plan.notification)
    assertTrue(plan.reportNoService)
  }

  @Test
  fun aWorkoutWithoutGpsNeverStartsLocationUpdates() {
    assertFalse(SessionPolicy.afterServiceStart(gps = false, serviceStarted = true).gps)
    assertFalse(SessionPolicy.afterServiceStart(gps = false, serviceStarted = false).gps)
  }

  @Test
  fun theWakeLockIsHeldWhateverAndNoServiceMeansAWarning() {
    for (gps in listOf(true, false)) {
      for (started in listOf(true, false)) {
        val plan = SessionPolicy.afterServiceStart(gps, started)
        assertTrue(plan.wakeLock)
        assertEquals(!started, plan.reportNoService)
        assertEquals(started, plan.notification)
      }
    }
  }
}
