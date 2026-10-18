package com.joyodigitama.replayencoder

/** A validated encoder configuration. Build it with [resolve]. */
internal data class EncoderConfig(val width: Int, val height: Int, val fps: Int, val bitrate: Int) {
  companion object {
    const val MIN_SIZE = 16
    const val MAX_SIZE = 4096
    const val MIN_FPS = 1
    const val MAX_FPS = 60
    const val BITS_PER_PIXEL = 0.11
    const val MIN_BITRATE = 1_000_000
    const val MAX_BITRATE = 20_000_000

    /** round(width * height * fps * 0.11), clamped to 1..20 Mbps. */
    fun defaultBitrate(width: Int, height: Int, fps: Int): Int =
      clampBitrate(Math.round(width.toDouble() * height * fps * BITS_PER_PIXEL))

    /**
     * Validates the values JS sent (numbers arrive as doubles) and fills in the bitrate. Throws [EncoderException] with
     * ERR_ENCODER_CONFIG for a non-integer, non-finite, out-of-range or odd size, a bad fps, or a non-positive bitrate.
     */
    fun resolve(width: Double, height: Double, fps: Double, bitrate: Double?): EncoderConfig {
      val w = integer("width", width)
      val h = integer("height", height)
      val f = integer("fps", fps)
      if (w !in MIN_SIZE..MAX_SIZE) fail("width must be $MIN_SIZE..$MAX_SIZE, got $w")
      if (h !in MIN_SIZE..MAX_SIZE) fail("height must be $MIN_SIZE..$MAX_SIZE, got $h")
      if (w % 2 != 0) fail("width must be even, got $w")
      if (h % 2 != 0) fail("height must be even, got $h")
      if (f !in MIN_FPS..MAX_FPS) fail("fps must be $MIN_FPS..$MAX_FPS, got $f")
      val rate = if (bitrate == null) {
        defaultBitrate(w, h, f)
      } else {
        if (!bitrate.isFinite() || bitrate <= 0.0) fail("bitrate must be a positive number, got $bitrate")
        clampBitrate(Math.round(bitrate))
      }
      return EncoderConfig(w, h, f, rate)
    }

    /** Rounds up to a multiple of 16, the alignment every H.264 encoder accepts. */
    fun alignUp16(value: Int): Int = (value + 15) / 16 * 16

    private fun clampBitrate(value: Long): Int = value.coerceIn(MIN_BITRATE.toLong(), MAX_BITRATE.toLong()).toInt()

    private fun integer(name: String, value: Double): Int {
      if (!value.isFinite() || value != Math.rint(value) || value < Int.MIN_VALUE || value > Int.MAX_VALUE) {
        fail("$name must be an integer, got $value")
      }
      return value.toInt()
    }

    private fun fail(message: String): Nothing = throw EncoderException(ErrorCodes.CONFIG, message)
  }
}

/** `file://` URIs and plain paths of the files JS hands over. */
internal object FilePaths {
  /** `file:///a%20b/c.mp4` -> `/a b/c.mp4`; an absolute path passes through. Rejects anything else with [code]. */
  fun fromUri(value: String, code: String): String {
    val raw = value.trim()
    val path = when {
      raw.startsWith("file://") -> decode(raw.removePrefix("file://").substringBefore('?').substringBefore('#'))
      raw.startsWith("/") -> raw
      else -> throw EncoderException(code, "Not a file:// URI or absolute path: $value")
    }
    if (!path.startsWith("/") || path.endsWith("/")) throw EncoderException(code, "Not a file path: $value")
    return path
  }

  /** Percent-decoding of UTF-8 sequences; a stray `%` stays as it is, `+` is not a space. */
  private fun decode(text: String): String {
    if ('%' !in text) return text
    val result = StringBuilder(text.length)
    val run = java.io.ByteArrayOutputStream()
    var i = 0
    while (i < text.length) {
      val hi = if (text[i] == '%' && i + 2 < text.length) Character.digit(text[i + 1], 16) else -1
      val lo = if (hi >= 0) Character.digit(text[i + 2], 16) else -1
      if (lo >= 0) {
        run.write(hi * 16 + lo)
        i += 3
        continue
      }
      if (run.size() > 0) {
        result.append(String(run.toByteArray(), Charsets.UTF_8))
        run.reset()
      }
      result.append(text[i])
      i += 1
    }
    if (run.size() > 0) result.append(String(run.toByteArray(), Charsets.UTF_8))
    return result.toString()
  }
}
