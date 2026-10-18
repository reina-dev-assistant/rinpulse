package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchVisitTest {
  private val active = "AA:AA:AA:AA:AA:01"
  private val b = "BB:BB:BB:BB:BB:02"
  private val c = "CC:CC:CC:CC:CC:03"
  private val now = 1_000_000L
  private val interval = 7_200L

  private fun watch(address: String, lastSync: Long?, bound: Boolean = true, attempt: Long? = null) =
    VisitCandidate(address, lastSync, bound, attempt)

  private fun next(devices: List<VisitCandidate>, busy: Boolean = false) = nextVisit(devices, active, now, interval, busy)

  @Test
  fun intervalIsFourSyncIntervalsButAtLeastTwoHours() {
    assertEquals(120L, watchVisitIntervalMinutes(15))
    assertEquals(120L, watchVisitIntervalMinutes(30))
    assertEquals(240L, watchVisitIntervalMinutes(60))
    assertEquals(480L, watchVisitIntervalMinutes(120))
  }

  @Test
  fun noWatchWithBackgroundSyncMeansNoVisit() {
    assertNull(next(emptyList()))
  }

  @Test
  fun aDueWatchIsVisited() {
    assertEquals(b, next(listOf(watch(b, now - interval)))?.address)
    assertEquals(b, next(listOf(watch(b, null)))?.address)
  }

  @Test
  fun aWatchSyncedWithinTheIntervalWaits() {
    assertNull(next(listOf(watch(b, now - interval + 1))))
  }

  @Test
  fun theActiveWatchIsNeverVisited() {
    assertNull(next(listOf(watch(active, null))))
  }

  @Test
  fun anUnboundWatchIsNeverVisited() {
    assertNull(next(listOf(watch(b, null, bound = false))))
  }

  @Test
  fun nothingIsVisitedWhileBusy() {
    assertNull(next(listOf(watch(b, null)), busy = true))
  }

  @Test
  fun aFailedVisitWaitsForTheNextInterval() {
    assertNull(next(listOf(watch(b, null, attempt = now - 60))))
    assertNull(next(listOf(watch(b, null, attempt = now - interval + 1))))
    assertEquals(b, next(listOf(watch(b, null, attempt = now - interval)))?.address)
  }

  @Test
  fun theWatchThatWaitedLongestGoesFirst() {
    val devices = listOf(watch(c, now - 20_000), watch(b, now - 30_000))
    assertEquals(b, next(devices)?.address)
    assertEquals(c, next(listOf(watch(c, now - 20_000), watch(b, now - 30_000, attempt = now - 10)))?.address)
  }

  @Test
  fun aWatchThatNeverSyncedGoesBeforeOneThatDid() {
    assertEquals(c, next(listOf(watch(b, now - 90_000), watch(c, null)))?.address)
  }

  @Test
  fun tiesGoByAddress() {
    assertEquals(b, next(listOf(watch(c, null), watch(b, null)))?.address)
  }
}
