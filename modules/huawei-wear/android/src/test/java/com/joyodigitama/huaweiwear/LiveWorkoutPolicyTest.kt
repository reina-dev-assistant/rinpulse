package com.joyodigitama.huaweiwear

import com.joyodigitama.huaweiwear.LiveWorkoutPolicy.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveWorkoutPolicyTest {
  @Test
  fun clockIsEmptyUntilTheWorkoutStarts() {
    val clock = WorkoutClock()
    assertNull(clock.seconds(1_000_000L))
    assertFalse(clock.started)
  }

  @Test
  fun clockCountsFromTheStartNotFromTheGpsSearch() {
    val clock = WorkoutClock()
    // GPS search began at t=0 (nothing counted); the watch reports the workout running at t=90 s.
    clock.start(90_000L)
    assertEquals(0, clock.seconds(90_000L))
    assertEquals(30, clock.seconds(120_500L))
  }

  @Test
  fun clockLeavesPausesOut() {
    val clock = WorkoutClock()
    clock.start(0L)
    clock.pause(60_000L)
    assertEquals(60, clock.seconds(300_000L))
    clock.resume(300_000L)
    assertEquals(70, clock.seconds(310_000L))
    // A second pause call while paused does not move the pause point.
    clock.pause(320_000L)
    clock.pause(400_000L)
    assertEquals(80, clock.seconds(500_000L))
  }

  @Test
  fun clockFreezesWhenTheWorkoutEnds() {
    val clock = WorkoutClock()
    clock.start(0L)
    clock.pause(45_000L)
    assertEquals(45, clock.seconds(10_000_000L))
  }

  @Test
  fun resumeBeforeStartStartsTheClock() {
    val clock = WorkoutClock()
    clock.resume(5_000L)
    assertTrue(clock.started)
    assertEquals(2, clock.seconds(7_500L))
  }

  @Test
  fun pauseBeforeStartIsAFrozenZero() {
    val clock = WorkoutClock()
    clock.pause(5_000L)
    assertEquals(0, clock.seconds(50_000L))
  }

  @Test
  fun aSessionStillSearchingForGpsIsNotEndedByIdleAnswersWhileTheWatchAsks() {
    // Idle answers during the GPS search are normal: the workout has not started.
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.idleVerdict(preparing = true, confirmed = false, idleAnswers = 9, msSinceGps = 20_000L))
  }

  @Test
  fun aSearchTheWatchGaveUpIsDropped() {
    assertEquals(Verdict.END, LiveWorkoutPolicy.idleVerdict(preparing = true, confirmed = false, idleAnswers = 3, msSinceGps = 61_000L))
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.idleVerdict(preparing = true, confirmed = false, idleAnswers = 2, msSinceGps = 61_000L))
  }

  @Test
  fun aWorkoutTheWatchConfirmedEndsOnIdleAnswersEvenWhileGpsRequestsContinue() {
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = true, idleAnswers = 2, msSinceGps = 5_000L))
    assertEquals(Verdict.END, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = true, idleAnswers = 3, msSinceGps = 5_000L))
  }

  @Test
  fun anUnconfirmedWorkoutThatStillAsksForGpsPromptsInsteadOfEnding() {
    assertEquals(Verdict.SUSPECT, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = false, idleAnswers = 3, msSinceGps = 30_000L))
    assertEquals(Verdict.END, LiveWorkoutPolicy.idleVerdict(preparing = false, confirmed = false, idleAnswers = 3, msSinceGps = 130_000L))
  }

  @Test
  fun silenceDefersToAStatusPollThatAnswers() {
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.silenceVerdict(preparing = false, msSinceGps = 500_000L, msSinceStatus = 30_000L))
  }

  @Test
  fun silenceWithoutStatusAnswersPromptsThenEnds() {
    val stale = LiveWorkoutPolicy.STATUS_STALE_MS + 1
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.silenceVerdict(preparing = false, msSinceGps = 60_000L, msSinceStatus = stale))
    assertEquals(Verdict.SUSPECT, LiveWorkoutPolicy.silenceVerdict(preparing = false, msSinceGps = 121_000L, msSinceStatus = stale))
    assertEquals(Verdict.END, LiveWorkoutPolicy.silenceVerdict(preparing = false, msSinceGps = 301_000L, msSinceStatus = stale))
  }

  @Test
  fun aPreparingSessionWithNothingToWaitForIsDropped() {
    val stale = LiveWorkoutPolicy.STATUS_STALE_MS + 1
    assertEquals(Verdict.END, LiveWorkoutPolicy.silenceVerdict(preparing = true, msSinceGps = 61_000L, msSinceStatus = stale))
    assertEquals(Verdict.KEEP, LiveWorkoutPolicy.silenceVerdict(preparing = true, msSinceGps = 30_000L, msSinceStatus = stale))
  }

  @Test
  fun aFrameOfAWorkoutThatOnlyPreparesDoesNotStartTheTimer() {
    assertFalse(LiveWorkoutPolicy.isRunningFrame(running = false, durationSec = 0))
    assertFalse(LiveWorkoutPolicy.isRunningFrame(running = false, durationSec = null))
    assertTrue(LiveWorkoutPolicy.isRunningFrame(running = true, durationSec = null))
    assertTrue(LiveWorkoutPolicy.isRunningFrame(running = false, durationSec = 3))
  }

  @Test
  fun onlyAFreshStartPassesTheGuardAfterAWorkoutEnded() {
    assertTrue(LiveWorkoutPolicy.isFreshStart(running = true, durationSec = 2))
    assertTrue(LiveWorkoutPolicy.isFreshStart(running = true, durationSec = null))
    assertFalse(LiveWorkoutPolicy.isFreshStart(running = true, durationSec = 1_800))
    assertFalse(LiveWorkoutPolicy.isFreshStart(running = false, durationSec = 0))
  }

  @Test
  fun aWatchFedSessionWithALostStopEndsOnceFramesAndPollAgree() {
    assertFalse(LiveWorkoutPolicy.watchFedEnds(preparing = false, idleAnswers = 2, msSinceFrame = 60_000L))
    assertFalse(LiveWorkoutPolicy.watchFedEnds(preparing = false, idleAnswers = 3, msSinceFrame = 5_000L))
    assertTrue(LiveWorkoutPolicy.watchFedEnds(preparing = false, idleAnswers = 3, msSinceFrame = 31_000L))
    // A countdown or GPS search on the watch has no frames and an idle poll: it waits much longer.
    assertFalse(LiveWorkoutPolicy.watchFedEnds(preparing = true, idleAnswers = 9, msSinceFrame = 120_000L))
    assertTrue(LiveWorkoutPolicy.watchFedEnds(preparing = true, idleAnswers = 9, msSinceFrame = 301_000L))
  }
}
