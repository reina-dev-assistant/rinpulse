package com.joyodigitama.replayencoder

/** The error codes `ReplayEncoder.ts` documents. */
internal object ErrorCodes {
  const val UNSUPPORTED = "ERR_ENCODER_UNSUPPORTED"
  const val CONFIG = "ERR_ENCODER_CONFIG"
  const val FRAME = "ERR_ENCODER_FRAME"
  const val STATE = "ERR_ENCODER_STATE"
  const val IO = "ERR_ENCODER_IO"
}

/** A failure that reaches JS as a rejection with [code]. Pure Kotlin so the logic around it is unit-tested on the JVM. */
internal class EncoderException(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause)
