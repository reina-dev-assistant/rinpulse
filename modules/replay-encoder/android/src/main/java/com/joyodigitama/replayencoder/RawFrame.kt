package com.joyodigitama.replayencoder

/**
 * The header of a react-native-view-shot "raw" file: ASCII `<width>:<height>|`, then width * height * 4 bytes in Android
 * `Bitmap.Config.ARGB_8888` memory order (R, G, B, A, premultiplied).
 */
internal data class RawFrameHeader(val width: Int, val height: Int, val payloadOffset: Int) {
  /** The byte count the payload must have. */
  val payloadBytes: Int get() = width * height * BYTES_PER_PIXEL

  /** Rejects a file whose length is not exactly header + payload (truncated write, wrong file). */
  fun checkFileLength(fileLength: Long) {
    val expected = payloadOffset.toLong() + payloadBytes
    if (fileLength != expected) {
      throw EncoderException(ErrorCodes.FRAME, "Raw frame is $fileLength bytes, a ${width}x$height frame needs $expected")
    }
  }

  companion object {
    const val BYTES_PER_PIXEL = 4
    const val MAX_DIMENSION = 8192
    const val MAX_PIXELS = 4096 * 4096

    /** The longest valid header: five digits, ':', five digits, '|'. */
    const val MAX_HEADER_BYTES = 12

    /** Parses the header from the first [length] bytes of the file. Throws ERR_ENCODER_FRAME when it is malformed. */
    fun parse(bytes: ByteArray, length: Int = bytes.size): RawFrameHeader {
      val limit = minOf(length, bytes.size, MAX_HEADER_BYTES)
      var i = 0
      val width = number(bytes, i, limit).also { i = it.second }.first
      if (i >= limit || bytes[i] != ':'.code.toByte()) malformed("expected ':' after the width")
      val height = number(bytes, i + 1, limit).also { i = it.second }.first
      if (i >= limit || bytes[i] != '|'.code.toByte()) malformed("expected '|' after the height")
      if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION || width.toLong() * height > MAX_PIXELS) {
        malformed("size ${width}x$height is out of range")
      }
      return RawFrameHeader(width, height, i + 1)
    }

    /** Reads the decimal digits at [from] and returns the value and the index after the last digit. */
    private fun number(bytes: ByteArray, from: Int, limit: Int): Pair<Int, Int> {
      var i = from
      var value = 0
      while (i < limit && bytes[i] >= '0'.code.toByte() && bytes[i] <= '9'.code.toByte()) {
        value = value * 10 + (bytes[i] - '0'.code.toByte())
        if (value > MAX_DIMENSION) malformed("number too large")
        i++
      }
      if (i == from) malformed("expected digits")
      return Pair(value, i)
    }

    private fun malformed(why: String): Nothing = throw EncoderException(ErrorCodes.FRAME, "Malformed raw frame header: $why")
  }
}
