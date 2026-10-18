package com.joyodigitama.blesensors

import org.junit.Assert.assertEquals
import org.junit.Test

class BackoffTest {
  @Test
  fun delaysDoubleFromOneSecondToSixteen() {
    assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L), (0..4).map { Backoff.nextDelayMs(it) })
  }

  @Test
  fun thirtySecondsFromTheSixthAttemptOn() {
    assertEquals(30_000L, Backoff.nextDelayMs(5))
    assertEquals(30_000L, Backoff.nextDelayMs(6))
    assertEquals(30_000L, Backoff.nextDelayMs(1_000))
    assertEquals(30_000L, Backoff.nextDelayMs(Int.MAX_VALUE))
  }

  @Test
  fun aNegativeAttemptStartsOver() {
    assertEquals(1_000L, Backoff.nextDelayMs(-1))
  }
}
