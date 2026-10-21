package com.joyodigitama.huaweiwear

import com.joyodigitama.huaweiwear.HealthConnectRoute.Point
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthConnectRouteTest {
  private fun fix(ts: Long, lat: Double? = -6.2, lon: Double? = 106.8, alt: Double? = null) = WorkoutPoint(ts, lat, lon, alt, null)

  @Test
  fun keepsFixesInsideTheSessionWithStartInclusiveAndEndExclusive() {
    val points = listOf(fix(99), fix(100), fix(150), fix(199), fix(200), fix(201))
    val route = HealthConnectRoute.plan(points, startSec = 100, endSec = 200)
    // Health Connect: first location at or after the start, last strictly before the end.
    assertEquals(listOf(100L, 150L, 199L), route.map { it.timeSec })
  }

  @Test
  fun dropsRowsWithoutAUsableCoordinate() {
    val points = listOf(
      fix(100),
      fix(101, lat = null),
      fix(102, lon = null),
      fix(103, lat = 0.0, lon = 0.0),
      fix(104, lat = 91.0),
      fix(105, lon = -181.0),
      fix(106, lat = Double.NaN),
      fix(107, lon = Double.POSITIVE_INFINITY),
      fix(108, lat = -6.21),
    )
    assertEquals(listOf(100L, 108L), HealthConnectRoute.plan(points, 0, 1_000).map { it.timeSec })
  }

  @Test
  fun timesAreStrictlyIncreasingAndARepeatedSecondKeepsItsFirstFix() {
    val points = listOf(fix(10, lat = -6.1), fix(10, lat = -6.9), fix(9, lat = -6.8), fix(11, lat = -6.3))
    val route = HealthConnectRoute.plan(points, 0, 100)
    assertEquals(listOf(10L, 11L), route.map { it.timeSec })
    assertEquals(-6.1, route.first().lat, 0.0)
  }

  @Test
  fun altitudeIsKeptWhenFiniteAndNullOtherwise() {
    val route = HealthConnectRoute.plan(listOf(fix(1, alt = 12.5), fix(2, alt = Double.NaN), fix(3, alt = null)), 0, 10)
    assertEquals(listOf<Double?>(12.5, null, null), route.map { it.altM })
  }

  @Test
  fun aSingleFixIsNoRoute() {
    assertTrue(HealthConnectRoute.plan(listOf(fix(5)), 0, 10).isEmpty())
    assertTrue(HealthConnectRoute.plan(listOf(fix(5), fix(50)), 0, 10).isEmpty())
    assertTrue(HealthConnectRoute.plan(emptyList(), 0, 10).isEmpty())
  }

  @Test
  fun longRoutesAreThinnedEvenlyKeepingTheEnds() {
    val points = (0 until 36_000).map { fix(1_000L + it, lat = -6.0 - it / 1e6, lon = 106.0 + it / 1e6) }
    val route = HealthConnectRoute.plan(points, 1_000, 1_000 + 36_000)
    assertEquals(HealthConnectRoute.MAX_POINTS, route.size)
    assertEquals(1_000L, route.first().timeSec)
    assertEquals(1_000L + 35_999, route.last().timeSec)
    assertTrue(route.zipWithNext().all { (a, b) -> a.timeSec < b.timeSec })
    // Evenly spaced: the gap between kept fixes stays within one step of the mean (18 s).
    assertTrue(route.zipWithNext().all { (a, b) -> b.timeSec - a.timeSec in 17..19 })
  }

  @Test
  fun aRouteAtTheCapIsLeftAlone() {
    val points = (0 until 5).map { fix(it.toLong()) }
    assertEquals(5, HealthConnectRoute.plan(points, 0, 10, maxPoints = 5).size)
    assertEquals(listOf(0L, 4L), HealthConnectRoute.plan(points, 0, 10, maxPoints = 2).map { it.timeSec })
    assertEquals(listOf(0L, 2L, 4L), HealthConnectRoute.plan(points, 0, 10, maxPoints = 3).map { it.timeSec })
  }

  @Test
  fun pointsCarryTheStoredValues() {
    val route = HealthConnectRoute.plan(listOf(fix(1, -6.2, 106.8, 10.0), fix(2, -6.3, 106.9, 11.0)), 0, 10)
    assertEquals(listOf(Point(1, -6.2, 106.8, 10.0), Point(2, -6.3, 106.9, 11.0)), route)
  }

  @Test
  fun signatureChangesWhenARouteCanBeAttached() {
    val base = "100|700|38|500"
    // Without the permission, or without a line, the signature is the one earlier builds stored: nothing is rewritten.
    assertEquals(base, HealthConnectRoute.signature(base, gpsFixes = 300, routeAllowed = false))
    assertEquals(base, HealthConnectRoute.signature(base, gpsFixes = 1, routeAllowed = true))
    assertEquals(base, HealthConnectRoute.signature(base, gpsFixes = 0, routeAllowed = true))
    // With both, it differs from what an earlier build stored, so the workout is written again, with its route.
    assertEquals("$base|r300", HealthConnectRoute.signature(base, gpsFixes = 300, routeAllowed = true))
  }

  @Test
  fun usableCoordinateMatchesTheAppRule() {
    assertTrue(HealthConnectRoute.usable(-6.2, 106.8))
    assertTrue(HealthConnectRoute.usable(0.0, 106.8))
    assertTrue(HealthConnectRoute.usable(90.0, 180.0))
    assertTrue(!HealthConnectRoute.usable(0.0, 0.0))
    assertTrue(!HealthConnectRoute.usable(90.1, 0.0))
  }
}
