package com.joyodigitama.replayencoder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class EncoderConfigTest {
  private fun rejected(width: Double = 1080.0, height: Double = 1920.0, fps: Double = 30.0, bitrate: Double? = null): EncoderException {
    try {
      EncoderConfig.resolve(width, height, fps, bitrate)
    } catch (e: EncoderException) {
      return e
    }
    fail("expected a rejection")
    throw IllegalStateException()
  }

  @Test
  fun theDefaultBitrateIsElevenHundredthsOfABitPerPixel() {
    val config = EncoderConfig.resolve(1080.0, 1920.0, 30.0, null)
    assertEquals(EncoderConfig(1080, 1920, 30, 6_842_880), config)
  }

  @Test
  fun theDefaultBitrateIsClamped() {
    assertEquals(1_000_000, EncoderConfig.defaultBitrate(16, 16, 1))
    assertEquals(20_000_000, EncoderConfig.defaultBitrate(4096, 4096, 60))
  }

  @Test
  fun anExplicitBitrateIsKeptWithinTheRange() {
    assertEquals(8_000_000, EncoderConfig.resolve(1080.0, 1920.0, 30.0, 8_000_000.0).bitrate)
    assertEquals(1_000_000, EncoderConfig.resolve(1080.0, 1920.0, 30.0, 10.0).bitrate)
    assertEquals(20_000_000, EncoderConfig.resolve(1080.0, 1920.0, 30.0, 1e12).bitrate)
  }

  @Test
  fun theLimitsAreInclusive() {
    EncoderConfig.resolve(16.0, 16.0, 1.0, null)
    EncoderConfig.resolve(4096.0, 4096.0, 60.0, null)
  }

  @Test
  fun badSizesAndRatesAreConfigErrors() {
    val bad = listOf(
      rejected(width = 14.0),
      rejected(width = 4098.0),
      rejected(height = 8.0),
      rejected(height = 5000.0),
      rejected(width = 1081.0),
      rejected(height = 1919.0),
      rejected(width = 1080.5),
      rejected(width = Double.NaN),
      rejected(height = Double.POSITIVE_INFINITY),
      rejected(fps = 0.0),
      rejected(fps = 61.0),
      rejected(fps = 29.97),
      rejected(fps = -30.0),
      rejected(bitrate = 0.0),
      rejected(bitrate = -5.0),
      rejected(bitrate = Double.NaN),
    )
    bad.forEach { assertEquals(ErrorCodes.CONFIG, it.code) }
  }

  @Test
  fun alignmentRoundsUpToSixteen() {
    assertEquals(1088, EncoderConfig.alignUp16(1080))
    assertEquals(1920, EncoderConfig.alignUp16(1920))
    assertEquals(16, EncoderConfig.alignUp16(2))
    assertEquals(4096, EncoderConfig.alignUp16(4096))
  }

  @Test
  fun filePathsAcceptUrisAndAbsolutePaths() {
    assertEquals("/data/user/0/app/cache/replay.mp4", FilePaths.fromUri("file:///data/user/0/app/cache/replay.mp4", ErrorCodes.CONFIG))
    assertEquals("/data/a b/\u00e9.mp4", FilePaths.fromUri("file:///data/a%20b/%C3%A9.mp4", ErrorCodes.CONFIG))
    assertEquals("/sd/100%.mp4", FilePaths.fromUri("/sd/100%.mp4", ErrorCodes.CONFIG))
    assertEquals("/sd/100%zz.mp4", FilePaths.fromUri("file:///sd/100%zz.mp4", ErrorCodes.CONFIG))
    assertEquals("/a+b.mp4", FilePaths.fromUri("file:///a+b.mp4", ErrorCodes.CONFIG))
  }

  @Test
  fun filePathsRejectEverythingElseWithTheGivenCode() {
    for (bad in listOf("", "relative/frame.png", "content://media/1", "https://x/y.png", "file://", "/dir/")) {
      try {
        FilePaths.fromUri(bad, ErrorCodes.FRAME)
        fail("expected a rejection for '$bad'")
      } catch (e: EncoderException) {
        assertEquals(ErrorCodes.FRAME, e.code)
        assertTrue(e.message!!.isNotEmpty())
      }
    }
  }
}
