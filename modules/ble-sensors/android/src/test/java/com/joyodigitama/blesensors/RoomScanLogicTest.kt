package com.joyodigitama.blesensors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomScanLogicTest {
  @Test
  fun pickPrefersEnvironmentalServiceDataThenBthome() {
    assertEquals("181a" to "aa", RoomScanLogic.pickServiceData(mapOf("fcd2" to "bb", "181a" to "aa")))
    assertEquals("fcd2" to "bb", RoomScanLogic.pickServiceData(mapOf("fcd2" to "bb", "fe95" to "cc")))
    assertEquals("fe95" to "cc", RoomScanLogic.pickServiceData(mapOf("fe95" to "cc")))
    assertNull(RoomScanLogic.pickServiceData(mapOf("fe96" to "cc")))
    assertNull(RoomScanLogic.pickServiceData(emptyMap()))
    assertEquals(listOf("181a", "fcd2", "fe95"), RoomScanLogic.KEPT_SERVICES)
  }

  @Test
  fun addressesAreNormalisedFilteredAndDeduplicated() {
    val ids = listOf(" a4:c1:38:8d:18:b2 ", "A4:C1:38:8D:18:B2", "not an address", "A4C1388D18B2", "", "A4:C1:38:00:00:01")
    assertEquals(listOf("A4:C1:38:8D:18:B2", "A4:C1:38:00:00:01"), RoomScanLogic.scanAddresses(ids))
    // An iOS peripheral UUID is not a Bluetooth address: the Android scan never gets one, but must not crash on one.
    assertTrue(RoomScanLogic.scanAddresses(listOf("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")).isEmpty())
  }

  @Test
  fun heardAtPlacesALateBatchByItsElapsedClock() {
    val now = 1_700_000_000_000L
    val elapsed = 50_000_000_000_000L // 50,000 s since boot, in nanoseconds
    assertEquals(now, RoomScanLogic.heardAtMs(now, elapsed, elapsed))
    assertEquals(now - 90_000L, RoomScanLogic.heardAtMs(now, elapsed, elapsed - 90_000_000_000L))
    // A result stamped after "now" (clock jitter) is not placed in the future.
    assertEquals(now, RoomScanLogic.heardAtMs(now, elapsed, elapsed + 5_000_000L))
  }

  @Test
  fun windowEndIsNullInThePastAndCappedAtEighteenHours() {
    val now = 1_000_000L
    assertNull(RoomScanLogic.windowEnd(now, now))
    assertNull(RoomScanLogic.windowEnd(now, now - 1))
    assertEquals(now + 3_600_000L, RoomScanLogic.windowEnd(now, now + 3_600_000L))
    assertEquals(now + RoomScanLogic.MAX_WINDOW_MS, RoomScanLogic.windowEnd(now, now + 30 * 3_600_000L))
  }

  @Test
  fun throttleKeepsOnePerSensorPerFiveMinutes() {
    val t = RoomAdvertThrottle()
    val minute = 60_000L
    assertTrue(t.shouldKeep("A", 1_000_000))
    for (s in 1 until 30) assertFalse(t.shouldKeep("A", 1_000_000 + s * 10_000L))
    assertFalse(t.shouldKeep("A", 1_000_000 + 5 * minute - 1))
    assertTrue(t.shouldKeep("A", 1_000_000 + 5 * minute))
    assertFalse(t.shouldKeep("A", 1_000_000 + 7 * minute))
    assertTrue(t.shouldKeep("A", 1_000_000 + 10 * minute))
  }

  @Test
  fun throttleIsPerSensorAndKeepsAnOlderAdvertisementOfALateBatch() {
    val t = RoomAdvertThrottle()
    assertTrue(t.shouldKeep("A", 10_000_000))
    assertTrue(t.shouldKeep("B", 10_000_001))
    assertFalse(t.shouldKeep("B", 10_000_002))
    assertTrue(t.shouldKeep("A", 1_000_000)) // heard before the last kept one
    t.clear()
    assertTrue(t.shouldKeep("B", 10_000_002))
  }

  @Test
  fun configSurvivesTheRoundTripThroughPreferences() {
    val config = RoomCaptureConfig(listOf("A4:C1:38:8D:18:B2", "A4:C1:38:00:00:01"), 1_700_000_000_000L, "Room", "Listening", "Stop")
    assertEquals(config, RoomCaptureConfig.fromMap(config.toMap()))
  }

  @Test
  fun configIsNullWhenAnythingNeededIsMissing() {
    val ok = mapOf("ids" to "A4:C1:38:8D:18:B2", "untilMs" to "5", "title" to "t", "text" to "x", "stopLabel" to "s")
    assertEquals(listOf("A4:C1:38:8D:18:B2"), RoomCaptureConfig.fromMap(ok)?.ids)
    assertNull(RoomCaptureConfig.fromMap(ok - "ids"))
    assertNull(RoomCaptureConfig.fromMap(ok - "untilMs"))
    assertNull(RoomCaptureConfig.fromMap(ok + ("untilMs" to "soon")))
    assertNull(RoomCaptureConfig.fromMap(ok + ("ids" to "nonsense")))
    assertEquals("", RoomCaptureConfig.fromMap(ok - "title")?.title)
  }

  @Test
  fun miBeaconThrottleKeepsTheDistinctFramesOfAWindowAndDropsRepeats() {
    val t = MiBeaconThrottle()
    val start = 1_000_000L
    assertTrue(t.shouldKeep("A", start, "t")) // temperature frame
    assertTrue(t.shouldKeep("A", start + 1_000, "h")) // humidity frame
    assertTrue(t.shouldKeep("A", start + 2_000, "b")) // battery frame
    assertFalse(t.shouldKeep("A", start + 3_000, "t")) // the same payload again
    assertFalse(t.shouldKeep("A", start + 4_000, "h"))
    assertTrue(t.shouldKeep("A", start + 5_000, "t2")) // a new measurement
  }

  @Test
  fun miBeaconThrottleCapsAWindowAndStartsAnotherAfterFiveMinutes() {
    val t = MiBeaconThrottle()
    val start = 1_000_000L
    for (i in 0 until MiBeaconThrottle.BURST) assertTrue(t.shouldKeep("A", start + i, "f$i"))
    assertFalse(t.shouldKeep("A", start + 100, "extra"))
    assertFalse(t.shouldKeep("A", start + 5 * 60_000L - 1, "extra"))
    assertTrue(t.shouldKeep("A", start + 5 * 60_000L, "extra"))
    // The same payload as in the earlier window is a new frame in the new one.
    assertFalse(t.shouldKeep("A", start + 5 * 60_000L + 1, "extra"))
    assertTrue(t.shouldKeep("A", start + 10 * 60_000L, "f0"))
  }

  @Test
  fun miBeaconThrottleIsPerSensorAndKeepsALateOlderFrame() {
    val t = MiBeaconThrottle()
    assertTrue(t.shouldKeep("A", 10_000_000, "x"))
    assertTrue(t.shouldKeep("B", 10_000_001, "x"))
    assertFalse(t.shouldKeep("B", 10_000_002, "x"))
    assertTrue(t.shouldKeep("A", 1_000_000, "x")) // heard before the window of the last kept one
    t.clear()
    assertTrue(t.shouldKeep("B", 10_000_002, "x"))
  }
}
