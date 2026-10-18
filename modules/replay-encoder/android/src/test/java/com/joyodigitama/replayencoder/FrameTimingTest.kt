package com.joyodigitama.replayencoder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class FrameTimingTest {
  @Test
  fun ptsComesFromTheIntegerIndex() {
    assertEquals(0L, FrameClock.ptsUs(0, 30))
    assertEquals(33_333L, FrameClock.ptsUs(1, 30))
    assertEquals(66_666L, FrameClock.ptsUs(2, 30))
    assertEquals(100_000L, FrameClock.ptsUs(3, 30))
    assertEquals(30_000_000L, FrameClock.ptsUs(900, 30))
  }

  @Test
  fun noDriftOverAnHourOfFrames() {
    val frames = 30L * 3_600
    assertEquals(3_600_000_000L, FrameClock.ptsUs(frames, 30))
    assertEquals(3_600_000_000L, FrameClock.ptsUs(frames, 30))
    assertEquals(1_000_000L, FrameClock.ptsUs(24, 24))
    assertEquals(16_666L, FrameClock.ptsUs(1, 60))
  }

  @Test
  fun frameDurationsFollowThePatternOfTheRoundedDownTimes() {
    val durations = (0L until 6).map { FrameClock.ptsUs(it + 1, 30) - FrameClock.ptsUs(it, 30) }
    assertEquals(listOf(33_333L, 33_333L, 33_334L, 33_333L, 33_333L, 33_334L), durations)
    for (fps in listOf(7, 24, 25, 29, 30, 60)) {
      val floor = 1_000_000L / fps
      for (index in 0L until 500) {
        val d = FrameClock.ptsUs(index + 1, fps) - FrameClock.ptsUs(index, fps)
        assertTrue("fps $fps index $index duration $d", d == floor || d == floor + 1)
      }
      assertEquals(1_000_000L, FrameClock.ptsUs(fps.toLong(), fps))
    }
  }

  @Test
  fun durationRoundsDownToTheMillisecond() {
    assertEquals(30_000L, FrameClock.durationMs(900, 30))
    assertEquals(33L, FrameClock.durationMs(1, 30))
    assertEquals(0L, FrameClock.durationMs(0, 30))
    assertEquals(1_000L, FrameClock.durationMs(60, 60))
  }

  @Test
  fun sequencerAcceptsTheNextIndexOnly() {
    val sequencer = FrameSequencer()
    for (i in 0L until 5) {
      sequencer.check(i)
      sequencer.advance()
    }
    assertEquals(5L, sequencer.expected)
  }

  private fun assertFrameError(block: () -> Unit) {
    try {
      block()
      fail("expected ERR_ENCODER_FRAME")
    } catch (e: EncoderException) {
      assertEquals(ErrorCodes.FRAME, e.code)
    }
  }

  @Test
  fun sequencerRejectsGapsRepeatsAndAWrongStart() {
    val sequencer = FrameSequencer()
    assertFrameError { sequencer.check(1) }
    sequencer.check(0)
    sequencer.advance()
    assertFrameError { sequencer.check(0) }
    assertFrameError { sequencer.check(2) }
    assertFrameError { sequencer.check(-1) }
  }

  @Test
  fun aRejectedIndexDoesNotAdvance() {
    val sequencer = FrameSequencer()
    assertFrameError { sequencer.check(3) }
    assertEquals(0L, sequencer.expected)
    sequencer.check(0)
  }
}
