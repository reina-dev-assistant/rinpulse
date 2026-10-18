package com.joyodigitama.blesensors

import android.app.Notification
import android.app.NotificationManager
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingNotificationSpecTest {
  private val now = 5_000_000L
  private val controls = RecordingNotificationSpec.Controls("id", "Dijeda", "Jeda", "Lanjut", "Lap")

  private fun progress(elapsedMs: Long, distanceM: Double, hr: Int?, paused: Boolean = false) =
    RecordingProgress().apply { apply(RecordingProgress.Update(elapsedMs, distanceM, hr, paused), now) }

  private fun spec(p: RecordingProgress, at: Long = now, c: RecordingNotificationSpec.Controls? = controls, sdk: Int = 34) =
    RecordingNotificationSpec.spec("Lari", "Lari", p, at, c, sdk)

  @Test
  fun theChannelShowsOnTheLockScreenAndNeverMakesASound() {
    val c = RecordingNotificationSpec.channel
    assertEquals(NotificationManager.IMPORTANCE_DEFAULT, c.importance)
    assertEquals(Notification.VISIBILITY_PUBLIC, c.lockscreenVisibility)
    assertFalse(c.sound)
    assertFalse(c.vibration)
    assertFalse(c.badge)
  }

  @Test
  fun theChannelIsANewOneBecauseTheImportanceOfTheOldOneCannotChange() {
    assertNotEquals(RecordingNotificationSpec.LEGACY_CHANNEL_ID, RecordingNotificationSpec.CHANNEL_ID)
    assertEquals("workout_recording", RecordingNotificationSpec.LEGACY_CHANNEL_ID)
  }

  @Test
  fun theNotificationIsOngoingPublicAndAlertsOnlyOnce() {
    val s = spec(progress(1000, 0.0, null))
    assertTrue(s.ongoing)
    assertTrue(s.onlyAlertOnce)
    assertEquals(Notification.VISIBILITY_PUBLIC, s.visibility)
    assertEquals(RecordingNotificationSpec.CHANNEL_ID, s.channelId)
  }

  @Test
  fun theCategoryIsWorkoutFromAndroid12() {
    assertEquals(Notification.CATEGORY_WORKOUT, spec(progress(0, 0.0, null), sdk = 31).category)
    assertEquals(Notification.CATEGORY_SERVICE, spec(progress(0, 0.0, null), sdk = 30).category)
  }

  @Test
  fun beforeTheFirstReportThereIsNoClockAndNoButtons() {
    val s = spec(RecordingProgress())
    assertEquals("Lari", s.text)
    assertNull(s.chronometerBase)
    assertTrue(s.actions.isEmpty())
  }

  @Test
  fun aRunningClockIsAChronometerThatTicksWithoutUpdates() {
    val p = progress(65_000, 0.0, null)
    assertEquals(now - 65_000, spec(p).chronometerBase)
    // 30 s later, no report in between: the base is the same moment in time
    assertEquals(now - 65_000, spec(p, at = now + 30_000).chronometerBase)
  }

  @Test
  fun theTextHasDistanceAndHeartRateButNotTheTime() {
    assertEquals("1,20 km · 150 bpm", spec(progress(0, 1200.0, 150)).text)
    assertEquals("1.20 km", RecordingNotificationSpec.spec("Lari", "Lari", progress(0, 1200.0, null), now, RecordingNotificationSpec.Controls("en", "", "", "", ""), 34).text)
    assertEquals("150 bpm", spec(progress(0, 4.0, 150)).text)
    assertEquals("Lari", spec(progress(0, 4.0, null)).text)
  }

  @Test
  fun aRunningWorkoutOffersPauseAndLap() {
    val s = spec(progress(1000, 0.0, null))
    assertEquals(listOf(RecordingNotificationSpec.Control.PAUSE, RecordingNotificationSpec.Control.LAP), s.actions.map { it.control })
    assertEquals(listOf("Jeda", "Lap"), s.actions.map { it.title })
  }

  @Test
  fun aPausedWorkoutFreezesTheTimeInTheTextAndOffersResume() {
    val s = spec(progress(3_725_000, 5000.0, 140, paused = true), at = now + 600_000)
    assertNull(s.chronometerBase)
    assertEquals("Dijeda · 1:02:05 · 5,00 km · 140 bpm", s.text)
    assertEquals(listOf(RecordingNotificationSpec.Control.RESUME), s.actions.map { it.control })
    assertEquals("Lanjut", s.actions[0].title)
  }

  @Test
  fun withoutControlsThereAreNoButtons() {
    assertTrue(spec(progress(1000, 0.0, null), c = null).actions.isEmpty())
  }

  @Test
  fun theButtonsRoundTripThroughTheirIntentActions() {
    for (c in RecordingNotificationSpec.Control.values()) {
      assertEquals(c, RecordingNotificationSpec.Control.fromAction(c.action))
    }
    assertNull(RecordingNotificationSpec.Control.fromAction(null))
    assertNull(RecordingNotificationSpec.Control.fromAction("android.intent.action.MAIN"))
  }

  @Test
  fun elapsedTimeFormatsLikeTheApp() {
    assertEquals("0:00", RecordingNotificationSpec.formatElapsed(0))
    assertEquals("42:10", RecordingNotificationSpec.formatElapsed(2530))
    assertEquals("1:05:09", RecordingNotificationSpec.formatElapsed(3909))
    assertEquals("0:00", RecordingNotificationSpec.formatElapsed(-4))
  }

  @Test
  fun distanceUnderTenMetresIsNotShown() {
    assertNull(RecordingNotificationSpec.formatDistance(9.9, Locale.ROOT))
    assertEquals("0.01 km", RecordingNotificationSpec.formatDistance(10.0, Locale.ROOT))
  }
}
