package com.joyodigitama.replayencoder

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class YuvTest {
  private fun yuv(r: Int, g: Int, b: Int) = Triple(Yuv.y(r, g, b), Yuv.u(r, g, b), Yuv.v(r, g, b))

  @Test
  fun blackAndWhiteAreTheLimitedRangeEnds() {
    assertEquals(Triple(16, 128, 128), yuv(0, 0, 0))
    assertEquals(Triple(235, 128, 128), yuv(255, 255, 255))
  }

  @Test
  fun everyGreyHasNeutralChroma() {
    for (level in 0..255) {
      val (y, u, v) = yuv(level, level, level)
      assertEquals("grey $level", 128, u)
      assertEquals("grey $level", 128, v)
      assertTrue("grey $level -> $y", y in 16..235)
    }
  }

  @Test
  fun primariesMatchTheBt709Table() {
    assertEquals(Triple(63, 102, 240), yuv(255, 0, 0))
    assertEquals(Triple(173, 42, 26), yuv(0, 255, 0))
    assertEquals(Triple(32, 240, 118), yuv(0, 0, 255))
  }

  @Test
  fun secondariesMatchTheBt709Table() {
    assertEquals(Triple(219, 16, 138), yuv(255, 255, 0))
    assertEquals(Triple(188, 154, 16), yuv(0, 255, 255))
    assertEquals(Triple(78, 214, 230), yuv(255, 0, 255))
  }

  @Test
  fun everyOutputStaysInTheLimitedRange() {
    for (r in 0..255 step 15) for (g in 0..255 step 15) for (b in 0..255 step 15) {
      val (y, u, v) = yuv(r, g, b)
      assertTrue("$r,$g,$b y=$y", y in 16..235)
      assertTrue("$r,$g,$b u=$u", u in 16..240)
      assertTrue("$r,$g,$b v=$v", v in 16..240)
    }
  }

  private fun rgba(vararg pixels: Int): ByteArray {
    val out = ByteArray(pixels.size * 4)
    pixels.forEachIndexed { i, rgb ->
      out[i * 4] = (rgb shr 16).toByte()
      out[i * 4 + 1] = (rgb shr 8).toByte()
      out[i * 4 + 2] = rgb.toByte()
      out[i * 4 + 3] = 0xFF.toByte()
    }
    return out
  }

  @Test
  fun lumaRowConvertsEveryPixelAndHonoursTheOffset() {
    val data = rgba(0x123456, 0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00)
    val out = ByteArray(3)
    Yuv.lumaRow(data, 4, 3, out)
    assertArrayEquals(byteArrayOf(16, 235.toByte(), 63), out)
  }

  @Test
  fun chromaRowAveragesTwoByTwoBlocks() {
    // Row 0: red red | black white. Row 1: red red | black white.
    val data = rgba(0xFF0000, 0xFF0000, 0x000000, 0xFFFFFF, 0xFF0000, 0xFF0000, 0x000000, 0xFFFFFF)
    val u = ByteArray(2)
    val v = ByteArray(2)
    Yuv.chromaRow(data, 0, 16, 4, u, v)
    assertEquals(102, u[0].toInt() and 0xFF)
    assertEquals(240, v[0].toInt() and 0xFF)
    // black and white average to a mid grey: neutral chroma.
    assertEquals(128, u[1].toInt() and 0xFF)
    assertEquals(128, v[1].toInt() and 0xFF)
  }

  @Test
  fun chromaOfAUniformBlockEqualsTheSinglePixelValue() {
    for (color in listOf(0x000000, 0xFFFFFF, 0x336699, 0xFF8000, 0x00FF00)) {
      val data = rgba(color, color, color, color)
      val u = ByteArray(1)
      val v = ByteArray(1)
      Yuv.chromaRow(data, 0, 8, 2, u, v)
      val r = (color shr 16) and 0xFF
      val g = (color shr 8) and 0xFF
      val b = color and 0xFF
      assertEquals(Yuv.u(r, g, b), u[0].toInt() and 0xFF)
      assertEquals(Yuv.v(r, g, b), v[0].toInt() and 0xFF)
    }
  }
}
