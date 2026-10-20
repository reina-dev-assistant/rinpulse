package com.joyodigitama.blesensors

import org.junit.Assert.assertEquals
import org.junit.Test

class StepCounterLogicTest {
  @Test
  fun theFirstReadingIsTheBaseline() {
    val logic = StepCounterLogic()
    assertEquals(0L, logic.total(12_345f))
    assertEquals(3L, logic.total(12_348f))
    assertEquals(3L, logic.total(12_348f))
    assertEquals(10L, logic.total(12_355f))
  }

  @Test
  fun aCounterThatGoesBackwardsKeepsWhatWasCountedAndAddsTheNewSteps() {
    val logic = StepCounterLogic()
    logic.total(5_000f)
    assertEquals(20L, logic.total(5_020f))
    // reboot: the counter starts again from a small value
    assertEquals(25L, logic.total(5f))
    assertEquals(40L, logic.total(20f))
  }

  @Test
  fun eventTimeIsWallClockMinusTheAgeOfTheEvent() {
    // the event is 250 ms old
    assertEquals(999_750L, StepCounterLogic.eventWallMs(eventNanos = 9_750_000_000L, nowWallMs = 1_000_000L, nowElapsedNanos = 10_000_000_000L))
    assertEquals(1_000_000L, StepCounterLogic.eventWallMs(eventNanos = 10_000_000_000L, nowWallMs = 1_000_000L, nowElapsedNanos = 10_000_000_000L))
  }
}
