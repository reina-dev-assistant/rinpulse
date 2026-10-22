package com.joyodigitama.huaweiwear

import com.joyodigitama.huaweiwear.HeartRateZonesCalc.Method
import com.joyodigitama.huaweiwear.HeartRateZonesCalc.Posture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Expected numbers are worked out by hand from GB's HuaweiHeartRateZones for age 35 (maximum 220 - 35 = 185 bpm, resting 60,
 * per-posture correction 0/6/10/5, `Math.round` of float percentages, so x.5 rounds up).
 */
class HeartRateZonesCalcTest {
  private fun z(c: HeartRateZonesCalc.Config, m: Method): List<Int> =
    c.byMethod(m)!!.let { listOf(it.zone1, it.zone2, it.zone3, it.zone4, it.zone5, it.threshold) }

  private val track35 = HeartRateZonesCalc.deviceConfig(35, track = true, simpleCommand = false, extended = false)

  private fun posture(p: Posture) = track35.first { it.posture == p }

  @Test
  fun uprightZonesForAge35() {
    val c = posture(Posture.UPRIGHT)
    assertEquals(185, c.warningHRLimit)
    assertTrue(c.warningEnable)
    // 185 * 50/60/70/80/90 % = 92.5, 111, 129.5, 148, 166.5
    assertEquals(listOf(93, 111, 130, 148, 167, 185), z(c, Method.MHR))
    // reserve 125: 59/74/84/88/95 % = 73.75, 92.5, 105, 110, 118.75 plus 60
    assertEquals(listOf(134, 153, 165, 170, 179, 185), z(c, Method.HRR))
    // threshold 60 + 125 * 85 % = 166.25 -> 166; 67/80/89/97/102 % of it
    assertEquals(listOf(111, 133, 148, 161, 169, 166), z(c, Method.LTHR))
  }

  @Test
  fun otherPosturesApplyTheirCorrection() {
    val sitting = posture(Posture.SITTING) // 179
    assertEquals(listOf(90, 107, 125, 143, 161, 179), z(sitting, Method.MHR))
    assertEquals(listOf(130, 148, 160, 165, 173, 179), z(sitting, Method.HRR))
    assertNull(sitting.byMethod(Method.LTHR))

    val swimming = posture(Posture.SWIMMING) // 175
    assertEquals(listOf(88, 105, 123, 140, 158, 175), z(swimming, Method.MHR))
    assertEquals(listOf(128, 145, 157, 161, 169, 175), z(swimming, Method.HRR))

    val other = posture(Posture.OTHER) // 180
    assertEquals(listOf(90, 108, 126, 144, 162, 180), z(other, Method.MHR))
    assertEquals(listOf(131, 149, 161, 166, 174, 180), z(other, Method.HRR))
    assertEquals(185, other.warningHRLimit)
  }

  @Test
  fun withoutTrackOnlyUprightMhrAndExtendedHrr() {
    val simple = HeartRateZonesCalc.deviceConfig(35, track = false, simpleCommand = true, extended = false)
    assertEquals(listOf(Posture.UPRIGHT), simple.map { it.posture })
    assertEquals(listOf(Method.MHR), simple[0].zones.map { it.method })

    val extended = HeartRateZonesCalc.deviceConfig(35, track = false, simpleCommand = true, extended = true)
    assertEquals(listOf(Method.MHR, Method.HRR), extended[0].zones.map { it.method })
    assertEquals(listOf(93, 111, 130, 148, 167, 185), z(extended[0], Method.MHR))

    assertTrue(HeartRateZonesCalc.deviceConfig(35, track = false, simpleCommand = false, extended = false).isEmpty())
  }

  @Test
  fun trackTlvForAge35() {
    val tlv = HeartRateZonesCalc.trackTlv(track35)
    assertNotNull(tlv)
    val expected = listOf(
      // upright MHR, warning switch, limit, method MHR, threshold
      0x02 to 93, 0x03 to 111, 0x04 to 130, 0x05 to 148, 0x06 to 167, 0x07 to 185, 0x08 to 1, 0x09 to 185, 0x0a to 0, 0x0b to 185,
      // upright HRR with resting, LTHR
      0x0c to 60, 0x0d to 134, 0x0e to 153, 0x0f to 165, 0x10 to 170, 0x11 to 179,
      0x3f to 166, 0x40 to 169, 0x41 to 161, 0x42 to 148, 0x43 to 133, 0x44 to 111,
      // sitting
      0x12 to 1, 0x13 to 0, 0x14 to 185, 0x15 to 90, 0x16 to 107, 0x17 to 125, 0x18 to 143, 0x19 to 161, 0x1a to 179,
      0x1b to 60, 0x1c to 130, 0x1d to 148, 0x1e to 160, 0x1f to 165, 0x20 to 173,
      // swimming
      0x21 to 1, 0x22 to 0, 0x23 to 185, 0x24 to 88, 0x25 to 105, 0x26 to 123, 0x27 to 140, 0x28 to 158, 0x29 to 175,
      0x2a to 60, 0x2b to 128, 0x2c to 145, 0x2d to 157, 0x2e to 161, 0x2f to 169,
      // other
      0x30 to 1, 0x31 to 0, 0x32 to 185, 0x33 to 90, 0x34 to 108, 0x35 to 126, 0x36 to 144, 0x37 to 162, 0x38 to 180,
      0x39 to 60, 0x3a to 131, 0x3b to 149, 0x3c to 161, 0x3d to 166, 0x3e to 174,
    )
    assertEquals(expected, tlv)
  }

  @Test
  fun zonesOutsideTheByteRangeAreRefusedLikeGb() {
    // age 0: the maximum 220 fails HeartRateZonesUtils.checkValue (< 220), so GB sends nothing
    val config = HeartRateZonesCalc.deviceConfig(0, track = true, simpleCommand = false, extended = false)
    assertNull(HeartRateZonesCalc.trackTlv(config))
  }

  private val userMax = HeartRateZonesCalc.UserZones(Method.MHR, 190, 55, listOf(95, 114, 133, 152, 171), warningEnabled = true, warningLimit = 190)
  private val userHrr = HeartRateZonesCalc.UserZones(Method.HRR, 190, 55, listOf(100, 120, 140, 160, 175), warningEnabled = false, warningLimit = 180)

  private fun userTrack(user: HeartRateZonesCalc.UserZones) =
    HeartRateZonesCalc.deviceConfig(35, track = true, simpleCommand = false, extended = false, user = user)

  @Test
  fun userZonesMaxMethodTlv() {
    val tlv = HeartRateZonesCalc.trackTlv(userTrack(userMax))
    // default HRR for max 190 / rest 55: reserve 135 -> 59/74/84/88/95 % = 79.65, 99.9, 113.4, 118.8, 128.25 plus 55
    val hrr = listOf(135, 155, 168, 174, 183)
    val mhr = listOf(95, 114, 133, 152, 171)
    val expected = listOf(
      0x02 to 95, 0x03 to 114, 0x04 to 133, 0x05 to 152, 0x06 to 171, 0x07 to 190, 0x08 to 1, 0x09 to 190, 0x0a to 0, 0x0b to 190,
      0x0c to 55, 0x0d to 135, 0x0e to 155, 0x0f to 168, 0x10 to 174, 0x11 to 183,
      // LTHR 55 + 135 * 85 % = 169.75 -> 170; 67/80/89/97/102 % of it
      0x3f to 170, 0x40 to 173, 0x41 to 165, 0x42 to 151, 0x43 to 136, 0x44 to 114,
    ) + listOf(0x12, 0x21, 0x30).flatMap { base ->
      // switch, method, limit, MHR zones + threshold, resting, HRR zones
      listOf(base to 1, base + 1 to 0, base + 2 to 190) + mhr.mapIndexed { i, v -> base + 3 + i to v } + listOf(base + 8 to 190, base + 9 to 55) +
        hrr.mapIndexed { i, v -> base + 10 + i to v }
    }
    assertEquals(expected, tlv)
  }

  @Test
  fun userZonesHrrMethodCarriesTheUserSetAndMhrDefaults() {
    val configs = userTrack(userHrr)
    for (c in configs) {
      assertEquals(false, c.warningEnable)
      assertEquals(180, c.warningHRLimit)
      assertEquals(Method.HRR, c.currentMethod)
      assertEquals(HeartRateZonesCalc.Zones(Method.HRR, 190, 55, 100, 120, 140, 160, 175), c.byMethod(Method.HRR))
      assertEquals(HeartRateZonesCalc.Zones(Method.MHR, 190, 55, 95, 114, 133, 152, 171), c.byMethod(Method.MHR))
      assertTrue(c.isValid())
    }
    assertEquals(Posture.values().toList(), configs.map { it.posture })
    assertNotNull(configs.first { it.posture == Posture.UPRIGHT }.byMethod(Method.LTHR))
    assertNull(configs.first { it.posture == Posture.SITTING }.byMethod(Method.LTHR))
    val tlv = HeartRateZonesCalc.trackTlv(configs)!!.toMap()
    // method HRR (1) and switch off in all four postures, the user's HRR zones at 0x0d.. and 0x1c..
    assertEquals(listOf(1, 1, 1, 1), listOf(0x0a, 0x13, 0x22, 0x31).map { tlv[it] })
    assertEquals(listOf(0, 0, 0, 0), listOf(0x08, 0x12, 0x21, 0x30).map { tlv[it] })
    assertEquals(listOf(100, 120, 140, 160, 175), (0x0d..0x11).map { tlv[it] })
    assertEquals(listOf(100, 120, 140, 160, 175), (0x1c..0x20).map { tlv[it] })
  }

  @Test
  fun userZonesSimpleRouteSendsTheEffectiveZonesWhateverTheMethod() {
    val simple = HeartRateZonesCalc.deviceConfig(35, track = false, simpleCommand = true, extended = false, user = userHrr).single()
    assertEquals(
      listOf(100, 120, 140, 160, 175, 190),
      simple.byMethod(Method.MHR)!!.asArray().toList(),
    )
    assertEquals(false, simple.warningEnable)
    assertEquals(180, simple.warningHRLimit)

    val ext = HeartRateZonesCalc.deviceConfig(35, track = false, simpleCommand = true, extended = true, user = userHrr).single()
    assertEquals(Method.HRR, ext.currentMethod)
    assertEquals(listOf(95, 114, 133, 152, 171, 190), ext.byMethod(Method.MHR)!!.asArray().toList())
    assertEquals(listOf(100, 120, 140, 160, 175, 55), ext.byMethod(Method.HRR)!!.asArray().toList())
    val extMax = HeartRateZonesCalc.deviceConfig(35, track = false, simpleCommand = true, extended = true, user = userMax).single()
    assertEquals(listOf(95, 114, 133, 152, 171, 190), extMax.byMethod(Method.MHR)!!.asArray().toList())
    assertEquals(listOf(135, 155, 168, 174, 183, 55), extMax.byMethod(Method.HRR)!!.asArray().toList())
  }

  @Test
  fun withoutUserZonesTheDefaultsAreUnchanged() {
    assertEquals(track35, HeartRateZonesCalc.deviceConfig(35, track = true, simpleCommand = false, extended = false, user = null))
  }

  @Test
  fun userZonesValidation() {
    assertNull(userMax.problem())
    assertNull(userHrr.problem())
    fun bad(u: HeartRateZonesCalc.UserZones) = assertNotNull(u.problem())
    bad(userMax.copy(maxHr = 99))
    bad(userMax.copy(maxHr = 220, zones = listOf(95, 114, 133, 152, 171)))
    bad(userMax.copy(restingHr = 29))
    bad(userMax.copy(restingHr = 111))
    bad(userMax.copy(maxHr = 100, restingHr = 100, zones = listOf(31, 32, 33, 34, 35)))
    bad(userMax.copy(zones = listOf(95, 114, 133, 152)))
    bad(userMax.copy(zones = listOf(29, 114, 133, 152, 171)))
    bad(userMax.copy(zones = listOf(95, 114, 114, 152, 171)))
    bad(userMax.copy(zones = listOf(95, 114, 133, 152, 190)))
    bad(userMax.copy(warningLimit = 99))
    bad(userMax.copy(warningLimit = 220))
  }
}
