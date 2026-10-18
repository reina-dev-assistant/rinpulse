package com.joyodigitama.replayencoder

/** The rectangle a scaled source covers in destination pixels. [left] and [top] are negative when the source overflows. */
internal data class FitRect(val left: Int, val top: Int, val width: Int, val height: Int) {
  enum class Mode {
    /** Scale to fill the destination and crop the overflow. */
    COVER,

    /** Scale to fit inside the destination and leave bars. */
    CONTAIN,
  }

  companion object {
    /** Where a [srcW]x[srcH] source lands in a [dstW]x[dstH] destination, centred, with integer math only. */
    fun fit(srcW: Int, srcH: Int, dstW: Int, dstH: Int, mode: Mode): FitRect {
      require(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0) { "sizes must be positive" }
      val sw = srcW.toLong()
      val sh = srcH.toLong()
      val dw = dstW.toLong()
      val dh = dstH.toLong()
      // Compare aspect ratios without division: src wider than dst <=> sw/sh > dw/dh.
      val srcIsWider = sw * dh > sh * dw
      val matchHeight = if (mode == Mode.COVER) srcIsWider else !srcIsWider
      val w: Long
      val h: Long
      if (matchHeight) {
        h = dh
        w = divide(sw * dh, sh, mode)
      } else {
        w = dw
        h = divide(sh * dw, sw, mode)
      }
      val cw = if (mode == Mode.CONTAIN) w.coerceIn(1L, dw) else w
      val ch = if (mode == Mode.CONTAIN) h.coerceIn(1L, dh) else h
      return FitRect(Math.floorDiv(dw - cw, 2L).toInt(), Math.floorDiv(dh - ch, 2L).toInt(), cw.toInt(), ch.toInt())
    }

    /** Cover rounds up so no edge is left bare; contain rounds to nearest. */
    private fun divide(n: Long, d: Long, mode: Mode): Long = if (mode == Mode.COVER) (n + d - 1) / d else (n + d / 2) / d

    /**
     * The power-of-two `inSampleSize` for BitmapFactory: the largest one whose result still covers the destination, so the
     * decoder does the coarse downscale and the filtered draw only the last factor below two.
     */
    fun sampleSize(srcW: Int, srcH: Int, dstW: Int, dstH: Int): Int {
      val target = fit(srcW, srcH, dstW, dstH, Mode.COVER)
      var sample = 1
      while (srcW / (sample * 2) >= target.width && srcH / (sample * 2) >= target.height) sample *= 2
      return sample
    }
  }
}
