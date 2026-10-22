package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Workout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkoutRecordTest {
  private fun block(type: Int, pace: Int, correction: Int?) = Workout.WorkoutPace.Response.Block().also {
    it.type = type.toByte()
    it.pace = pace
    if (correction != null) {
      it.hasCorrection = true
      it.correction = correction.toShort()
    }
  }

  @Test
  fun sportTypesUseGadgetbridgeNames() {
    assertEquals("Running", WorkoutSportTypes.name(1))
    assertEquals("RUNNING", WorkoutSportTypes.kind(1))
    assertEquals("Pool Swimming", WorkoutSportTypes.name(6))
    assertEquals("Ping Pong", WorkoutSportTypes.name(128))
    assertEquals("EXERCISE", WorkoutSportTypes.kind(255))
    // The type byte is read unsigned: 0xFF arrives as -1.
    assertEquals("EXERCISE", WorkoutSportTypes.kind(-1))
    assertEquals("Workout (type 99)", WorkoutSportTypes.name(99))
    assertEquals("UNKNOWN", WorkoutSportTypes.kind(99))
  }

  @Test
  fun paceAndSwimClassification() {
    assertTrue(WorkoutSportTypes.isSwim("POOL_SWIM"))
    assertTrue(WorkoutSportTypes.isPace("TRAIL_RUN"))
    assertTrue(WorkoutSportTypes.isPace("INDOOR_WALKING"))
    assertTrue(!WorkoutSportTypes.isPace("CYCLING"))
  }

  @Test
  fun paceAggregatesWeightPartialKilometres() {
    // Two full km at 300 and 360 s/km, then half a km at 330. Per-mile blocks are ignored.
    val blocks = listOf(block(0, 300, null), block(0, 360, null), block(0, 330, 5000), block(1, 500, null))

    val (avg, fastest, slowest) = WorkoutBuilder.paceAggregates(blocks)!!

    assertEquals((300L * 10000 + 360L * 10000 + 330L * 5000) / 25000, avg.toLong())
    assertEquals(300, fastest)
    assertEquals(360, slowest)
    assertNull(WorkoutBuilder.paceAggregates(listOf(block(1, 500, null))))
  }

  @Test
  fun swimStylesFollowGb() {
    assertEquals("breaststroke", WorkoutBuilder.swimStyle(1))
    assertEquals("butterfly", WorkoutBuilder.swimStyle(3))
    assertEquals("backstroke", WorkoutBuilder.swimStyle(4))
    assertEquals("medley", WorkoutBuilder.swimStyle(5))
    assertEquals("freestyle", WorkoutBuilder.swimStyle(0))
  }

  @Test
  fun theWatchsLactateThresholdComesWithTheTotals() {
    assertEquals("lthrHr", Workout.huaweiIdToKey[300010035])
    assertEquals("lthrPace", Workout.huaweiIdToKey[300010036])
  }

  @Test
  fun heartRateMarkersAreNotReadings() {
    assertNull(WorkoutBuilder.validHeartRate(0))
    assertNull(WorkoutBuilder.validHeartRate(-1))
    assertEquals(200, WorkoutBuilder.validHeartRate(200.toByte()))
  }

  private fun data(ts: Int, configure: Workout.WorkoutData.Response.Data.() -> Unit) =
    Workout.WorkoutData.Response.Data().also { it.timestamp = ts; it.configure() }

  private fun parts(type: Int, newSteps: Boolean, vararg samples: Workout.WorkoutData.Response.Data): WorkoutParts {
    val totals = Workout.WorkoutTotals.Response(null)
    totals.type = type.toByte()
    return WorkoutParts(totals).also {
      it.newSteps = newSteps
      it.samples.addAll(samples)
    }
  }

  @Test
  fun samplePointsKeepSpeedCadenceStrideAndPowerInSiUnits() {
    val points = WorkoutBuilder.points(
      parts(
        1, false,
        data(1_700_000_000) { heartRate = 150.toByte(); speed = 31; cadence = 172; stepLength = 105; cyclingPower = 240 },
        // Zero and -1 are "no reading"; a sample with nothing else is dropped.
        data(1_700_000_005) { speed = 0; cadence = 0; stepLength = 0; cyclingPower = 0 },
        data(1_700_000_010) { speed = -1; cadence = -1; stepLength = -1; cyclingPower = -1 },
        data(1_700_000_015) { speed = 28 },
      ),
    )

    assertEquals(2, points.size)
    assertEquals(150, points[0].hr)
    assertEquals(3.1, points[0].speed!!, 1e-9) // decimetres per second on the wire
    assertEquals(172, points[0].cadence)
    assertEquals(1.05, points[0].stride!!, 1e-9) // centimetres on the wire
    assertEquals(240, points[0].power)
    assertEquals(2.8, points[1].speed!!, 1e-9)
    assertNull(points[1].hr)
    assertNull(points[1].cadence)
    assertNull(points[1].stride)
    assertNull(points[1].power)
  }

  @Test
  fun walkingWithTheNewStepAlgorithmReadsCadenceFromTheStepRateByte() {
    val sample = { data(1_700_000_000) { stepRate = 110; cadence = 99 } }
    assertEquals(110, WorkoutBuilder.points(parts(2, true, sample()))[0].cadence)
    assertEquals(99, WorkoutBuilder.points(parts(2, false, sample()))[0].cadence)
    // 0xFF in the step-rate byte (-1) is the "no reading" marker.
    assertTrue(WorkoutBuilder.points(parts(2, true, data(1_700_000_000) { stepRate = -1; cadence = 99 })).isEmpty())
  }

  @Test
  fun aRunWithoutACadenceShortReadsTheStepRateByteAndABikeNeverDoes() {
    // Running (1): the step-rate byte stands in when the cadence short has no reading, and the cadence short wins when both are there.
    assertEquals(158, WorkoutBuilder.points(parts(1, false, data(1_700_000_000) { stepRate = 158.toByte(); cadence = -1 }))[0].cadence)
    assertEquals(172, WorkoutBuilder.points(parts(1, false, data(1_700_000_000) { stepRate = 158.toByte(); cadence = 172 }))[0].cadence)
    assertTrue(WorkoutBuilder.points(parts(1, false, data(1_700_000_000) { stepRate = -1; cadence = 0 })).isEmpty())
    // Cycling (3): its step rate is not pedalling.
    assertTrue(WorkoutBuilder.points(parts(3, false, data(1_700_000_000) { stepRate = 158.toByte(); cadence = -1 })).isEmpty())
  }

  @Test
  fun sampleAveragesLeaveOutZeroReadings() {
    val samples = arrayOf(
      data(1_700_000_000) { cadence = 170; stepLength = 80 },
      data(1_700_000_001) { cadence = 0; stepLength = 0 },
      data(1_700_000_002) { cadence = -1; stepLength = -1 },
      data(1_700_000_003) { cadence = 160; stepLength = 70 },
    )
    val json = org.json.JSONObject()
    SampleStats.of(parts(1, false, *samples), "RUNNING").putAverages(json)
    val averages = json.getJSONObject("samples")
    assertEquals(165.0, averages.getDouble("avgCadence"), 1e-9)
    assertEquals(75.0, averages.getDouble("avgStepLength"), 1e-9)
  }
}
