package com.joyodigitama.blesensors

internal object Backoff {
  private val STEPS_MS = longArrayOf(1_000, 2_000, 4_000, 8_000, 16_000)
  private const val MAX_MS = 30_000L

  /** The pause before reconnect attempt number [attempt], counted from 0 after each successful connect: 1, 2, 4, 8, 16 s, then 30 s. */
  fun nextDelayMs(attempt: Int): Long = if (attempt < 0) STEPS_MS[0] else STEPS_MS.getOrElse(attempt) { MAX_MS }
}
