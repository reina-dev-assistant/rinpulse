package com.joyodigitama.huaweiwear

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import net.lingala.zip4j.ZipFile
import net.lingala.zip4j.model.ZipParameters
import net.lingala.zip4j.model.enums.AesKeyStrength
import net.lingala.zip4j.model.enums.EncryptionMethod
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Synthetic fixtures only. */
class HuaweiExportImporterTest {
  private val t0 = 1_750_000_020_000L
  private val tempFiles = ArrayList<File>()

  @After
  fun cleanUp() {
    tempFiles.forEach { it.delete() }
  }

  private class MinuteCopy(val ts: Long, val steps: Int, val distance: Int, val heartRate: Int?, val spo2: Int?, val resting: Int?, val calories: Int = 0)

  private class FakeStore : HuaweiImportStore {
    val minutes = ArrayList<MinuteCopy>()
    val sleep = ArrayList<ImportedSleep>()
    val metrics = ArrayList<ImportedMetric>()
    val sleepScores = ArrayList<ImportedSleepScore>()
    val dayTotals = ArrayList<ImportedDayTotal>()
    val weighIns = ArrayList<ImportedWeighIn>()
    val workouts = ArrayList<ImportedWorkout>()
    var writeCalls = 0

    override fun writeMinutes(rows: Collection<ImportedMinute>): Int {
      writeCalls++
      rows.forEach { minutes.add(MinuteCopy(it.ts, it.steps, it.distance, it.heartRate, it.spo2, it.restingHeartRate, it.calories)) }
      return rows.size
    }

    override fun writeSleep(segments: List<ImportedSleep>): Int {
      sleep.addAll(segments)
      return segments.size
    }

    override fun writeMetrics(points: List<ImportedMetric>): Map<String, Int> {
      metrics.addAll(points)
      return points.groupingBy { it.type }.eachCount()
    }

    override fun writeSleepScores(scores: List<ImportedSleepScore>): Int {
      sleepScores.addAll(scores)
      return scores.size
    }

    override fun writeDayTotals(totals: List<ImportedDayTotal>): Int {
      dayTotals.addAll(totals)
      return totals.size
    }

    val queued = ArrayList<QueuedImport>()

    override fun queueForRogo(items: List<QueuedImport>): Int {
      queued.addAll(items)
      return items.size
    }

    override fun writeWeighIns(weighIns: List<ImportedWeighIn>): Int {
      this.weighIns.addAll(weighIns)
      return weighIns.size
    }

    override fun writeWorkout(workout: ImportedWorkout): WorkoutWrite {
      workouts.add(workout)
      return WorkoutWrite(true, workout.points.size)
    }
  }

  private class MapSource(private val files: Map<String, String>) : HuaweiExportSource {
    override fun entries() = files.map { (name, text) -> HuaweiExportEntry(name, text.toByteArray().size.toLong()) }
    override fun open(entry: HuaweiExportEntry): InputStream = ByteArrayInputStream(files.getValue(entry.name).toByteArray())
  }

  private fun sample(key: String, startMs: Long, endMs: Long, value: String) =
    """{"key":"$key","startTime":$startMs,"endTime":$endMs,"unit":"0","value":"${value.replace("\"", "\\\"")}"}"""

  private fun healthRecord(vararg samples: String) =
    """{"type":7,"startTime":$t0,"endTime":${t0 + 60_000},"timeZone":"+0700","recordId":"x","samplePoints":[${samples.joinToString(",")}]}"""

  private val healthFile = "Health detail data & description/Health detail data1.json"
  private val sportFile = "Sport per minute merged data & description/Sport per minute1.json"
  private val motionFile = "Motion path detail data & description/Motion path detail data1.json"

  private fun sportRecord(vararg entries: String) = """{"recordDay":20250615,"sportDataUserData":[${entries.joinToString(",")}]}"""

  private fun sportEntry(steps: Int, distance: Int) =
    """{"startTime":$t0,"endTime":${t0 + 60_000},"sportType":5,"sportBasicInfos":[{"steps":$steps,"distance":$distance,"calorie":5,"duration":1}]}"""

  private fun motionRecord(startMs: Long = t0) =
    """{"abnormalTrack":"","sportType":4,"startTime":$startMs,"endTime":${startMs + 600_000},"totalSteps":900,"totalDistance":1200,"totalCalories":80,""" +
      """"attribute":"HW_EXT_TRACK_DETAIL@is\ntp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=${startMs / 1000}.0;\ntp=h-r;k=${startMs + 5_000};v=130;\n"}"""

  private fun run(files: Map<String, String>, store: FakeStore = FakeStore(), cancelled: () -> Boolean = { false }): HuaweiImportSummary =
    HuaweiExportImporter(store, onProgress = {}, isCancelled = cancelled).run(MapSource(files))

  @Test
  fun mergesReadingsOfTheSameMinuteAndKeepsTheLargestStepCount() {
    val store = FakeStore()
    val summary = run(
      mapOf(
        healthFile to "[" + healthRecord(
          sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 5_000, t0 + 5_000, "80"),
          sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 35_000, t0 + 35_000, "90"),
          sample("BLOOD_OXYGEN_SATURATION", t0 + 10_000, t0 + 10_000, """{"avgSaturation":97}"""),
          sample("DATA_POINT_REST_HEARTRATE", t0, t0 + 1000, "58"),
          sample("STRESS_DATA", t0, t0, """{"score":30}"""),
          sample("PROFESSIONAL_SLEEP_DEEP", t0, t0 + 1_800_000, ""),
          sample("WEIGHT_BODYFAT_BROAD", t0, t0, """{"bodyWeight":70}"""),
        ) + "]",
        // The export repeats minutes: 10, 12 and 10 steps are one minute, not 32.
        sportFile to "[" + sportRecord(sportEntry(10, 8), sportEntry(12, 9), sportEntry(10, 8)) + "]",
      ),
      store,
    )
    // The health file and the sport file are flushed separately; the database merges the two rows of the minute.
    assertEquals(2, store.minutes.size)
    val (health, sport) = store.minutes
    assertEquals(1_750_000_020L, health.ts)
    assertEquals(1_750_000_020L, sport.ts)
    assertEquals(80, health.heartRate)
    assertEquals(97, health.spo2)
    assertEquals(58, health.resting)
    assertEquals(12, sport.steps)
    assertEquals(5, sport.calories)
    assertEquals(9, sport.distance)
    assertEquals(1, store.sleep.size)
    assertEquals(0x07, store.sleep.single().type)
    assertEquals(30.0, store.metrics.single().value, 0.0)
    // Two readings in one minute are one reading: the export repeats them under a second numeric type.
    assertEquals(1, summary.heartRateReadings)
    assertEquals(0, summary.unmappedSamples)
    assertEquals(1, summary.weighInsAdded)
    assertEquals(70.0, store.weighIns.single().weightKg, 0.001)
    assertEquals(2, summary.minutesWritten)
    assertEquals(1, summary.sleepSegmentsAdded)
    assertEquals(2, summary.filesRead)
    assertEquals(0, summary.badRecords)
    assertEquals(1_750_000_020L, summary.oldestSec)
    assertEquals(1_750_000_020L + 1800, summary.newestSec)
  }

  @Test
  fun aBadRecordIsCountedAndTheRestStillImported() {
    val store = FakeStore()
    val summary = run(
      mapOf(
        healthFile to "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) +
          ",{\"samplePoints\": }," + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 120_000, t0 + 120_000, "75")) + "]",
      ),
      store,
    )
    assertEquals(1, summary.badRecords)
    assertEquals(listOf(70, 75), store.minutes.sortedBy { it.ts }.map { it.heartRate })
  }

  @Test
  fun motionPathBecomesAWorkout() {
    val store = FakeStore()
    val summary = run(mapOf(motionFile to "[${motionRecord()}]"), store)
    assertEquals(1, store.workouts.size)
    assertEquals(1, summary.workoutsFound)
    assertEquals(1, summary.workoutsAdded)
    assertEquals(2, summary.workoutPointsAdded)
    assertEquals(1200, store.workouts.single().distance)
    assertEquals(130, store.workouts.single().avgHr)
  }

  @Test
  fun aStrayQuoteThatSwallowsTheNextWorkoutLosesNeitherOfThem() {
    // The odd quote after "a " flips string state for the rest of the file, so the record never closes by itself.
    val second = motionRecord(t0 + 7_200_000)
    val broken = """[{"abnormalTrack":"","sportType":4,"startTime":$t0,"endTime":${t0 + 600_000},"totalDistance":900,"attribute":"a "b;\n""" +
      """tp=lbs;k=0;lat=-6.2;lon=106.8;alt=0.0;t=1.75000002E9;\n"},$second]"""
    val store = FakeStore()
    val summary = run(mapOf(motionFile to broken), store)
    assertEquals(0, summary.badRecords)
    assertEquals(2, store.workouts.size)
    assertEquals(900, store.workouts[0].distance)
  }

  @Test
  fun filesOutsideTheDataFoldersAreIgnoredAndAnExportWithoutThemIsRejected() {
    val store = FakeStore()
    val summary = run(
      mapOf(
        healthFile to "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) + "]",
        "User run plan data & description/user run plan data.json" to "[]",
        "Health detail data & description/Health detail data-Data Field Description.xlsx" to "binary",
        "SportsHealth data & desciption/SportsHealth-Data Field Description.xls" to "binary",
      ),
      store,
    )
    assertEquals(3, summary.filesIgnored)
    assertEquals(1, summary.filesRead)
    try {
      run(mapOf("somewhere/else.json" to "[]"))
      fail("expected NOT_AN_EXPORT")
    } catch (e: HuaweiImportException) {
      assertEquals(HuaweiImportException.Kind.NOT_AN_EXPORT, e.kind)
    }
  }

  @Test
  fun aSpreadsheetThatIsNotAWorkbookCostsOnlyThatFile() {
    val summary = run(
      mapOf(
        healthFile to "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) + "]",
        "SportsHealth data & desciption/SportsHealth-Data.xls" to "this is not an xls file".repeat(100),
      ),
    )
    assertEquals(2, summary.filesRead)
    assertEquals(1, summary.badRecords)
    assertEquals(listOf("sports_health/not an OLE2 file"), summary.badRecordReasons.keys.toList())
    assertEquals(1, summary.heartRateReadings)
  }

  @Test
  fun daysSheetAndScoresGoThroughTheStoreAfterTheMinutes() {
    val xls = File("src/test/resources/huawei/sports-health-synthetic.xls").readBytes()
    val store = FakeStore()
    val source = object : HuaweiExportSource {
      private val names = listOf(
        "SportsHealth data & desciption/SportsHealth-Data.xls",
        "Sport per minute merged data & description/Sport per minute1.json",
        "Sample sequence data & description/sample sequence data1.json",
      )
      override fun entries() = names.map { HuaweiExportEntry(it, 1) }
      override fun open(entry: HuaweiExportEntry): InputStream = when {
        entry.name.endsWith(".xls") -> ByteArrayInputStream(xls)
        entry.name.contains("Sport per minute") -> ByteArrayInputStream(("[" + sportRecord(sportEntry(10, 8)) + "]").toByteArray())
        else -> ByteArrayInputStream(
          ("""[{"type":"700013","startTime":"$t0","endTime":"${t0 + 30_000_000}","summaryData":"{\"sleepScore\":85}"}]""").toByteArray(),
        )
      }
    }
    val summary = HuaweiExportImporter(store, onProgress = {}).run(source)
    assertEquals(4, summary.dayTotalsFound)
    assertEquals(4, summary.dayTotalsAdded)
    assertEquals(1, summary.sleepScoresAdded)
    assertEquals(1, summary.minutesWritten)
    // The minute is written before the day totals that may only fill days without rows.
    assertEquals(1, store.writeCalls)
  }

  private fun drinkPoint(ms: Long, ml: Int) = sample("DRINK_WATER", ms, ms, """{"drinkWater":$ml}""")

  @Test
  fun mealsAndWaterAreQueuedForJoyoRogoAndTheProfileComesFromTheWeighIn() {
    val store = FakeStore()
    val day = 1_785_603_600_000L // 2026-08-02 00:00 in +0700
    val nutrition = """{"dietaryEnergy":584,"protein":12.5,"carbohydrates":50,"fat":8,"meal":20,"mealEatTime":${day / 1000 + 43_200},"mealRecordTime":${day / 1000 + 75_000}}"""
    val summary = run(
      mapOf(
        healthFile to "[" + healthRecord(
          sample("NUTRITION_RECORD", day, day, nutrition),
          drinkPoint(day + 8 * 3_600_000, 250),
          drinkPoint(day + 9 * 3_600_000, 500),
          drinkPoint(day + 30 * 3_600_000, 250),
          sample("WEIGHT_BODYFAT_BROAD", t0, t0, """{"age":33,"bodyWeight":89.2,"gender":1,"height":170}"""),
          sample("USER_HEIGHT", t0 + 1000, t0 + 1000, """{"userHeight":172}"""),
        ) + "]",
      ),
      store,
    )
    assertEquals(1, summary.mealsFound)
    assertEquals(1, summary.mealsQueued)
    val meal = store.queued.single { it.kind == "meal" }
    assertTrue(meal.payload.contains("\"date\":\"2026-08-02\"") && meal.payload.contains("\"meal\":\"makan_siang\""))
    // 750 ml on the 2nd is 3 glasses, 250 ml on the 3rd is one
    val water = store.queued.filter { it.kind == "water" }
    assertEquals(listOf("2026-08-02", "2026-08-03"), water.map { it.key })
    assertEquals(listOf(3, 1), water.map { org.json.JSONObject(it.payload).getInt("glasses") })
    assertEquals(2, summary.waterDaysQueued)
    // the newest height (the USER_HEIGHT record, a second later) wins; age 33 at 2025-06 gives 1992
    assertEquals(mapOf("heightCm" to 172, "weightKg" to 89.2, "sex" to "male", "birthYear" to 1992), summary.profile)
  }

  @Test
  fun aCancelledRunQueuesMealsButNotAPartialDaysWater() {
    val store = FakeStore()
    var calls = 0
    val day = 1_785_603_600_000L
    val health = "[" + healthRecord(drinkPoint(day, 250)) + "," + healthRecord(drinkPoint(day + 1000, 250)) + "]"
    val summary = run(mapOf(healthFile to health), store) { calls++ >= 1 }
    assertTrue(summary.cancelled)
    assertEquals(emptyList<QueuedImport>(), store.queued.filter { it.kind == "water" })
  }

  @Test
  fun cancellingKeepsWhatWasReadSoFar() {
    val store = FakeStore()
    var records = 0
    val summary = run(
      mapOf(
        healthFile to "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "70")) + "," +
          healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + 120_000, t0 + 120_000, "75")) + "]",
      ),
      store,
      cancelled = { records++ >= 1 },
    )
    assertTrue(summary.cancelled)
    assertEquals(listOf(70), store.minutes.map { it.heartRate })
  }

  @Test
  fun largeFilesAreFlushedInChunks() {
    val store = FakeStore()
    // 25 000 distinct minutes of heart rate in one record per 1 000 minutes.
    val records = (0 until 25).joinToString(",", "[", "]") { chunk ->
      healthRecord(
        *Array(1000) { i -> sample("DATA_POINT_DYNAMIC_HEARTRATE", t0 + (chunk * 1000L + i) * 60_000, t0 + (chunk * 1000L + i) * 60_000, "70") },
      )
    }
    val summary = run(mapOf(healthFile to records), store)
    assertEquals(25_000, summary.minutesWritten)
    assertTrue("expected a flush before the end", store.writeCalls >= 2)
  }

  // Encrypted ZIP

  private fun encryptedZip(password: String, files: Map<String, String>): File {
    val file = File.createTempFile("huawei-export", ".zip")
    file.delete()
    tempFiles.add(file)
    val zip = ZipFile(file, password.toCharArray())
    for ((name, text) in files) {
      val params = ZipParameters().apply {
        isEncryptFiles = true
        encryptionMethod = EncryptionMethod.AES
        aesKeyStrength = AesKeyStrength.KEY_STRENGTH_256
        fileNameInZip = name
      }
      zip.addStream(ByteArrayInputStream(text.toByteArray()), params)
    }
    zip.close()
    return file
  }

  @Test
  fun readsAnAesEncryptedZipWithThePassword() {
    val file = encryptedZip(
      "s3cret-Pass",
      mapOf(
        healthFile to "[" + healthRecord(sample("DATA_POINT_DYNAMIC_HEARTRATE", t0, t0, "66")) + "]",
        motionFile to "[${motionRecord()}]",
      ),
    )
    val store = FakeStore()
    Zip4jExportSource.open(file, "s3cret-Pass".toCharArray()).use { source ->
      val summary = HuaweiExportImporter(store, onProgress = {}).run(source)
      assertEquals(2, summary.filesRead)
    }
    assertEquals(66, store.minutes.single().heartRate)
    assertEquals(1, store.workouts.size)
  }

  @Test
  fun aWrongOrMissingPasswordFailsBeforeAnyWork() {
    val file = encryptedZip("right", mapOf(healthFile to "[]"))
    for (password in listOf("wrong", "")) {
      try {
        Zip4jExportSource.open(file, password.toCharArray()).close()
        fail("expected BAD_PASSWORD for '$password'")
      } catch (e: HuaweiImportException) {
        assertEquals(HuaweiImportException.Kind.BAD_PASSWORD, e.kind)
      }
    }
  }

  @Test
  fun aFileThatIsNotAZipIsRejected() {
    val file = File.createTempFile("not-a-zip", ".zip")
    tempFiles.add(file)
    file.writeText("hello")
    try {
      Zip4jExportSource.open(file, "x".toCharArray()).close()
      fail("expected NOT_A_ZIP")
    } catch (e: HuaweiImportException) {
      assertEquals(HuaweiImportException.Kind.NOT_A_ZIP, e.kind)
    }
  }

  @Test
  fun exportKindIsDecidedByTheFolder() {
    assertEquals(HuaweiExportKind.HEALTH_DETAIL, HuaweiExportKind.of("Health detail data & description/a.json"))
    assertEquals(HuaweiExportKind.SPORT_PER_MINUTE, HuaweiExportKind.of("x\\Sport per minute merged data & description\\a.JSON"))
    assertEquals(HuaweiExportKind.MOTION_PATH, HuaweiExportKind.of("Motion path detail data & description/motion path detail data.json"))
    assertNull(HuaweiExportKind.of("Health detail data & description/readme.xlsx"))
    assertNull(HuaweiExportKind.of("User route/plan.json"))
    assertEquals(HuaweiExportKind.MOTION_PATH, HuaweiExportKind.of("motion path detail data.json"))
    assertNull(HuaweiExportKind.of("other/file.json"))
  }
}
