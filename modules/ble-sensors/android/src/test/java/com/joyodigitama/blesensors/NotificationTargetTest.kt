package com.joyodigitama.blesensors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationTargetTest {
  @Test
  fun theLiveScreenLinkOfTheAppIsOpened() {
    assertEquals("joyofit://workouts/record", NotificationTarget.viewUrl("joyofit://workouts/record"))
  }

  @Test
  fun surroundingWhitespaceIsDroppedAndTheSchemeIsCaseInsensitive() {
    assertEquals("JoyoFit://workouts/record", NotificationTarget.viewUrl("  JoyoFit://workouts/record \n"))
  }

  @Test
  fun noLinkMeansTheLauncher() {
    assertNull(NotificationTarget.viewUrl(null))
    assertNull(NotificationTarget.viewUrl(""))
    assertNull(NotificationTarget.viewUrl("   "))
  }

  @Test
  fun aLinkOfAnotherSchemeIsNeverOpened() {
    assertNull(NotificationTarget.viewUrl("https://example.com/workouts/record"))
    assertNull(NotificationTarget.viewUrl("exp+joyofit://workouts/record"))
    assertNull(NotificationTarget.viewUrl("intent://workouts/record#Intent;scheme=joyofit;end"))
    assertNull(NotificationTarget.viewUrl("/workouts/record"))
  }

  @Test
  fun aBareSchemeHasNothingToOpen() {
    assertNull(NotificationTarget.viewUrl("joyofit://"))
    assertNull(NotificationTarget.viewUrl("joyofit:"))
  }
}
