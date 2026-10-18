package com.joyodigitama.replayencoder

/**
 * RGBA to YUV 4:2:0, BT.709, limited (studio) range: Y 16..235, Cb and Cr 16..240. Fixed point with 16 fractional bits and
 * round-to-nearest, no allocation. The coefficient rows of Cb and Cr sum to zero, so every grey maps to exactly 128.
 */
internal object Yuv {
  private const val Y_R = 11966 // 0.2126 * 219 / 255
  private const val Y_G = 40254 // 0.7152 * 219 / 255
  private const val Y_B = 4064 // 0.0722 * 219 / 255
  private const val U_R = -6596
  private const val U_G = -22189
  private const val U_B = 28785 // 0.5 * 224 / 255
  private const val V_R = 28785
  private const val V_G = -26145
  private const val V_B = -2640

  private const val Y_OFFSET = (16 shl 16) + 32768
  private const val C_OFFSET = (128 shl 16) + 32768

  // Chroma of a 2x2 block is computed on the sum of four pixels, so the shift is 18 instead of 16.
  private const val C_OFFSET_SUM4 = (128 shl 18) + (1 shl 17)

  /** Y of one pixel, 16..235. */
  fun y(r: Int, g: Int, b: Int): Int = (Y_R * r + Y_G * g + Y_B * b + Y_OFFSET) shr 16

  /** Cb of one pixel, 16..240. */
  fun u(r: Int, g: Int, b: Int): Int = (U_R * r + U_G * g + U_B * b + C_OFFSET) shr 16

  /** Cr of one pixel, 16..240. */
  fun v(r: Int, g: Int, b: Int): Int = (V_R * r + V_G * g + V_B * b + C_OFFSET) shr 16

  /** Luma of [width] pixels of an RGBA row starting at byte [offset] of [rgba], into out[0 until width]. */
  fun lumaRow(rgba: ByteArray, offset: Int, width: Int, out: ByteArray) {
    var src = offset
    for (x in 0 until width) {
      val r = rgba[src].toInt() and 0xFF
      val g = rgba[src + 1].toInt() and 0xFF
      val b = rgba[src + 2].toInt() and 0xFF
      out[x] = ((Y_R * r + Y_G * g + Y_B * b + Y_OFFSET) shr 16).toByte()
      src += 4
    }
  }

  /**
   * One row of chroma from two RGBA rows: the first starts at byte [topOffset], the second [rowBytes] later. Every sample is
   * the mean of a 2x2 block, so outU and outV get width / 2 values.
   */
  fun chromaRow(rgba: ByteArray, topOffset: Int, rowBytes: Int, width: Int, outU: ByteArray, outV: ByteArray) {
    var top = topOffset
    var bottom = topOffset + rowBytes
    for (x in 0 until width / 2) {
      val r = (rgba[top].toInt() and 0xFF) + (rgba[top + 4].toInt() and 0xFF) + (rgba[bottom].toInt() and 0xFF) + (rgba[bottom + 4].toInt() and 0xFF)
      val g = (rgba[top + 1].toInt() and 0xFF) + (rgba[top + 5].toInt() and 0xFF) + (rgba[bottom + 1].toInt() and 0xFF) + (rgba[bottom + 5].toInt() and 0xFF)
      val b = (rgba[top + 2].toInt() and 0xFF) + (rgba[top + 6].toInt() and 0xFF) + (rgba[bottom + 2].toInt() and 0xFF) + (rgba[bottom + 6].toInt() and 0xFF)
      outU[x] = ((U_R * r + U_G * g + U_B * b + C_OFFSET_SUM4) shr 18).toByte()
      outV[x] = ((V_R * r + V_G * g + V_B * b + C_OFFSET_SUM4) shr 18).toByte()
      top += 8
      bottom += 8
    }
  }
}
