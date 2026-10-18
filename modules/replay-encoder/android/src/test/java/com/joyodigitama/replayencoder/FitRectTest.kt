package com.joyodigitama.replayencoder

import com.joyodigitama.replayencoder.FitRect.Mode.CONTAIN
import com.joyodigitama.replayencoder.FitRect.Mode.COVER
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FitRectTest {
  @Test
  fun sameAspectIsAPlainScale() {
    assertEquals(FitRect(0, 0, 1080, 1920), FitRect.fit(540, 960, 1080, 1920, COVER))
    assertEquals(FitRect(0, 0, 1080, 1920), FitRect.fit(2160, 3840, 1080, 1920, COVER))
    assertEquals(FitRect(0, 0, 1080, 1920), FitRect.fit(540, 960, 1080, 1920, CONTAIN))
    assertEquals(FitRect(0, 0, 1080, 1920), FitRect.fit(1080, 1920, 1080, 1920, COVER))
  }

  @Test
  fun coverOfAWiderSourceMatchesTheHeightAndCropsTheSides() {
    // 1920x1080 landscape into the 1080x1920 portrait canvas: 3413.33 wide at full height, rounded up, centred.
    assertEquals(FitRect(-1167, 0, 3414, 1920), FitRect.fit(1920, 1080, 1080, 1920, COVER))
  }

  @Test
  fun coverOfATallerSourceMatchesTheWidthAndCropsTheEnds() {
    assertEquals(FitRect(0, -660, 1080, 3240), FitRect.fit(1000, 3000, 1080, 1920, COVER))
  }

  @Test
  fun containLeavesBars() {
    assertEquals(FitRect(0, 656, 1080, 608), FitRect.fit(1920, 1080, 1080, 1920, CONTAIN))
    assertEquals(FitRect(0, 74, 1080, 1772), FitRect.fit(1000, 1641, 1080, 1920, CONTAIN))
  }

  @Test
  fun coverAlwaysCoversAndContainAlwaysFits() {
    val sources = listOf(1 to 1, 2 to 3, 3 to 2, 1079 to 1921, 1921 to 1079, 4000 to 17, 17 to 4000, 540 to 960)
    for ((sw, sh) in sources) {
      val cover = FitRect.fit(sw, sh, 1080, 1920, COVER)
      assertTrue("$sw x $sh cover $cover", cover.width >= 1080 && cover.height >= 1920)
      assertTrue("$sw x $sh cover $cover", cover.left <= 0 && cover.top <= 0 && cover.left + cover.width >= 1080 && cover.top + cover.height >= 1920)
      val contain = FitRect.fit(sw, sh, 1080, 1920, CONTAIN)
      assertTrue("$sw x $sh contain $contain", contain.width in 1..1080 && contain.height in 1..1920)
      assertTrue("$sw x $sh contain $contain", contain.left >= 0 && contain.top >= 0 && contain.left + contain.width <= 1080 && contain.top + contain.height <= 1920)
    }
  }

  @Test
  fun sampleSizeIsTheLargestPowerOfTwoThatStillCovers() {
    assertEquals(1, FitRect.sampleSize(1080, 1920, 1080, 1920))
    assertEquals(2, FitRect.sampleSize(2160, 3840, 1080, 1920))
    assertEquals(2, FitRect.sampleSize(3000, 5000, 1080, 1920))
    assertEquals(4, FitRect.sampleSize(4320, 7680, 1080, 1920))
    assertEquals(1, FitRect.sampleSize(540, 960, 1080, 1920))
    // Landscape source: the cover rect is 3414x1920, so the decode must stay at least that wide.
    assertEquals(1, FitRect.sampleSize(3840, 2160, 1080, 1920))
  }
}
