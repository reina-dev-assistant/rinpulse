package com.joyodigitama.huaweiwear

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkoutDuplicatesTest {
  private val a = "AA:AA:AA:AA:AA:01"
  private val b = "BB:BB:BB:BB:BB:02"
  private val c = "CC:CC:CC:CC:CC:03"

  private fun span(start: Long, end: Long, device: String?, gps: Boolean = false) = WorkoutSpan(start, end, device, gps)

  @Test
  fun sameSessionOfTwoWatchesIsADuplicate() {
    assertTrue(isCrossWatchDuplicate(span(1_000, 2_000, a), span(1_010, 1_990, b)))
  }

  @Test
  fun aWatchNeverDuplicatesItself() {
    assertFalse(isCrossWatchDuplicate(span(1_000, 2_000, a), span(1_000, 2_000, a)))
  }

  @Test
  fun aRowWithoutDeviceIsNeverADuplicate() {
    assertFalse(isCrossWatchDuplicate(span(1_000, 2_000, a), span(1_000, 2_000, null)))
    assertFalse(isCrossWatchDuplicate(span(1_000, 2_000, null), span(1_000, 2_000, b)))
    assertFalse(isCrossWatchDuplicate(span(1_000, 2_000, null), span(1_000, 2_000, null)))
  }

  @Test
  fun overlapMustReachHalfOfTheShorterSession() {
    // shorter = 100 s ([1000, 1100]); stored [1050, 1500] overlaps it by exactly 50 s
    assertTrue(isCrossWatchDuplicate(span(1_000, 1_100, a), span(1_050, 1_500, b)))
    // 49 s is under half
    assertFalse(isCrossWatchDuplicate(span(1_000, 1_100, a), span(1_051, 1_500, b)))
    // the threshold is of the shorter session, whichever copy that is
    assertTrue(isCrossWatchDuplicate(span(1_050, 1_500, a), span(1_000, 1_100, b)))
    assertFalse(isCrossWatchDuplicate(span(1_051, 1_500, a), span(1_000, 1_100, b)))
  }

  @Test
  fun aShortSessionInsideALongOneIsADuplicate() {
    assertTrue(isCrossWatchDuplicate(span(1_200, 1_260, a), span(1_000, 4_000, b)))
  }

  @Test
  fun sessionsThatOnlyTouchOrAreApartAreNotDuplicates() {
    assertFalse(isCrossWatchDuplicate(span(1_000, 2_000, a), span(2_000, 3_000, b)))
    assertFalse(isCrossWatchDuplicate(span(1_000, 2_000, a), span(5_000, 6_000, b)))
  }

  @Test
  fun aSessionWithoutDurationOverlapsNothing() {
    assertFalse(isCrossWatchDuplicate(span(1_500, 1_500, a), span(1_000, 2_000, b)))
  }

  @Test
  fun aGpsTrackBeatsThePrimaryWatch() {
    assertTrue(incomingWinsDuplicate(span(0, 1, b, gps = true), span(0, 1, a, gps = false), primary = a))
    assertFalse(incomingWinsDuplicate(span(0, 1, a, gps = false), span(0, 1, b, gps = true), primary = a))
  }

  @Test
  fun aGpsTrackBeatsTheFirstStoredCopy() {
    assertTrue(incomingWinsDuplicate(span(0, 1, c, gps = true), span(0, 1, b, gps = false), primary = null))
  }

  @Test
  fun withEqualGpsThePrimaryBeatsTheFirstStoredCopy() {
    assertTrue(incomingWinsDuplicate(span(0, 1, a), span(0, 1, b), primary = a))
    assertTrue(incomingWinsDuplicate(span(0, 1, a, gps = true), span(0, 1, b, gps = true), primary = a))
    assertFalse(incomingWinsDuplicate(span(0, 1, b), span(0, 1, a), primary = a))
  }

  @Test
  fun withEqualGpsAndNoPrimaryTheFirstStoredCopyStays() {
    assertFalse(incomingWinsDuplicate(span(0, 1, b), span(0, 1, c), primary = a))
    assertFalse(incomingWinsDuplicate(span(0, 1, b), span(0, 1, c), primary = null))
    assertFalse(incomingWinsDuplicate(span(0, 1, b, gps = true), span(0, 1, c, gps = true), primary = null))
  }
}
