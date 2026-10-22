package com.joyodigitama.huaweiwear

import java.io.File
import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** `sports-health-synthetic.xls` was written with xlwt from made-up values in the layout of `SportsHealth-Data.xls`. */
class HuaweiSportsHealthTest {
  private val file = File("src/test/resources/huawei/sports-health-synthetic.xls").readBytes()

  private class Out : HuaweiImportCollector {
    val totals = ArrayList<ImportedDayTotal>()
    val rejected = ArrayList<Triple<String, String, String?>>()
    override fun heartRate(tsSec: Long, bpm: Int) = Unit
    override fun restingHeartRate(tsSec: Long, bpm: Int) = Unit
    override fun spo2(tsSec: Long, percent: Int) = Unit
    override fun sleep(segment: ImportedSleep) = Unit
    override fun metric(point: ImportedMetric) = Unit
    override fun sleepScore(score: ImportedSleepScore) = Unit
    override fun dayTotal(total: ImportedDayTotal) { totals.add(total) }
    override fun weighIn(weighIn: ImportedWeighIn) = Unit
    override fun meal(meal: ImportedMeal) = Unit
    override fun water(date: String, ml: Int, key: String) = Unit
    override fun profileFact(kind: String, value: Double, tsMs: Long) = Unit
    override fun steps(minuteSec: Long, steps: Int, distance: Int, calories: Int) = Unit
    override fun unmapped(key: String) = Unit
    override fun rejected(key: String, reason: String, sample: String?) { rejected.add(Triple(key, reason, sample)) }
  }

  @Test
  fun readsSheetsCellsAndAStringTableThatSpansContinueRecords() {
    val sheets = HuaweiXlsReader.readSheets(file) { true }
    assertEquals(listOf("1-user basic info", "10-user sport daily statistics", "50-user sample config"), sheets.map { it.name })
    val basic = sheets[0].rows
    assertEquals("weight", basic[0][0])
    assertEquals("70", basic[0][1])
    assertEquals("cm/kg", basic[2][1])
    val daily = sheets[1].rows
    assertEquals("recordDay", daily[0][0])
    assertEquals("\t+0700", daily[1][1])
    assertEquals("20250619", daily[7][0])
    assertEquals("caf\u00e9 \u4e2d\u6587", daily[8][2])
    val config = sheets[2].rows
    assertEquals(400, config.size)
    assertEquals("configuration value number 399 " + "x".repeat(30), config[399][0])
    assertEquals("configuration value number 0 " + "x".repeat(30), config[0][0])
  }

  @Test
  fun dailyTotalsBecomeNoonRowsInTheExportsZone() {
    val out = Out()
    HuaweiSportsHealthParser.parse(file, out)
    // 14th (data), 15th (all zero: nothing), 16th (-03:30), 17th (900 000 steps: rejected), 18th, 19th (numeric day cell); the 20th has no JSON.
    val plus7 = ZoneOffset.ofHours(7)
    assertEquals(
      listOf(
        LocalDate.of(2025, 6, 14).atStartOfDay().toEpochSecond(plus7),
        LocalDate.of(2025, 6, 16).atStartOfDay().toEpochSecond(ZoneOffset.ofHoursMinutes(-3, -30)),
        LocalDate.of(2025, 6, 18).atStartOfDay().toEpochSecond(plus7),
        LocalDate.of(2025, 6, 19).atStartOfDay().toEpochSecond(plus7),
      ),
      out.totals.map { it.dayStartSec },
    )
    val first = out.totals[0]
    assertEquals(first.dayStartSec + 43_200, first.noonSec)
    assertEquals(first.dayStartSec + 86_400, first.dayEndSec)
    assertEquals(1711, first.steps)
    assertEquals(1087, first.distance)
    assertEquals(66726, first.calories)
    assertTrue(out.rejected.any { it.second == "out-of-range" && it.first == "sportBasicInfoData" })
    assertTrue(out.rejected.any { it.second == "no-number" })
  }

  @Test
  fun aFileThatIsNotAWorkbookIsRejected() {
    try {
      HuaweiXlsReader.readSheets(ByteArray(2048) { 7 }) { true }
      fail("expected XlsException")
    } catch (e: HuaweiXlsReader.XlsException) {
      assertTrue(e.message!!.contains("OLE2"))
    }
  }
}
