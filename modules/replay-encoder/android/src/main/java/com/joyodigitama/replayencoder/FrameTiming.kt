package com.joyodigitama.replayencoder

/** Presentation times, always computed from the integer frame index so nothing drifts. */
internal object FrameClock {
  /** index * 1_000_000 / fps microseconds, rounded down. 30 fps gives 0, 33_333, 66_666, 100_000, ... */
  fun ptsUs(index: Long, fps: Int): Long = Math.multiplyExact(index, 1_000_000L) / fps

  /** Length of [frames] frames at [fps], rounded down to a millisecond. */
  fun durationMs(frames: Long, fps: Int): Long = Math.multiplyExact(frames, 1_000L) / fps
}

/** Accepts the frame indexes 0, 1, 2, ... in order and nothing else. */
internal class FrameSequencer {
  /** The index the next frame must have, which is also the number of frames accepted so far. */
  var expected: Long = 0
    private set

  /** Throws ERR_ENCODER_FRAME for a gap or a repeat; does not advance. */
  fun check(index: Long) {
    if (index == expected) return
    val what = if (index < expected) "repeated or out of order" else "skips ahead"
    throw EncoderException(ErrorCodes.FRAME, "Frame index $index is $what; expected $expected")
  }

  /** Counts the frame [check] approved. */
  fun advance() {
    expected += 1
  }
}
