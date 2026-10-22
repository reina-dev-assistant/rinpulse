package com.joyodigitama.huaweiwear

import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.nio.file.Files
import java.sql.DriverManager
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Runs the importer over a real, already extracted Huawei export, on the shipped schema through sqlite-jdbc, twice (the
 * second run must add nothing). Skipped unless `HUAWEI_EXPORT_DIR` names the extracted folder; `HUAWEI_HARNESS_OUT` is a file
 * for the report (counts only, no values). Nothing of the export is copied into the repository.
 */
class HuaweiRealExportHarnessTest {
  private class DirSource(private val root: File) : HuaweiExportSource {
    private val files = root.walkTopDown().filter { it.isFile }.toList()

    override fun entries() = files.map { HuaweiExportEntry(it.relativeTo(root).path, it.length()) }

    override fun open(entry: HuaweiExportEntry): InputStream = FileInputStream(File(root, entry.name))
  }

  @Test
  fun importsTheRealExportTwice() {
    val dir = System.getenv("HUAWEI_EXPORT_DIR")
    assumeTrue(dir != null && File(dir).isDirectory)
    val out = System.getenv("HUAWEI_HARNESS_OUT")?.let { File(it) }
    val tmp = Files.createTempDirectory("huawei-harness").toFile()
    val dbFile = File(tmp, "joyofit.db")
    val jdbc = DriverManager.getConnection("jdbc:sqlite:${dbFile.path}")
    jdbc.createStatement().use { it.execute("PRAGMA synchronous = OFF") }
    val db = WearDatabase(dbFile.path, JdbcSqlConnection(jdbc))
    try {
      val migrations = JSONArray(File("../schema/joyofit-db-migrations.json").readText())
      for (i in 0 until migrations.length()) {
        val statements = migrations.getJSONArray(i)
        for (j in 0 until statements.length()) db.execSQL(statements.getString(j))
      }
      val report = JSONObject()
      for (run in 1..2) {
        val started = System.currentTimeMillis()
        val summary = HuaweiExportImporter(SqliteHuaweiImportStore { db }, onProgress = {}).run(DirSource(File(dir!!)))
        report.put("run$run", JSONObject(summary.toJs()).put("seconds", (System.currentTimeMillis() - started) / 1000))
      }
      val tables = JSONObject()
      fun count(name: String, sql: String) = jdbc.createStatement().use { s -> s.executeQuery(sql).use { it.next(); tables.put(name, it.getLong(1)) } }
      count("step_samples", "SELECT COUNT(*) FROM step_samples")
      count("step_samples_with_hr", "SELECT COUNT(*) FROM step_samples WHERE heart_rate IS NOT NULL")
      count("step_samples_with_spo2", "SELECT COUNT(*) FROM step_samples WHERE spo2 IS NOT NULL")
      count("step_samples_with_resting", "SELECT COUNT(*) FROM step_samples WHERE resting_heart_rate IS NOT NULL")
      count("step_samples_with_steps", "SELECT COUNT(*) FROM step_samples WHERE steps > 0")
      count("step_samples_with_calories", "SELECT COUNT(*) FROM step_samples WHERE calories > 0")
      count("steps_total", "SELECT COALESCE(SUM(steps),0) FROM step_samples")
      count("calories_total_cal", "SELECT COALESCE(SUM(calories),0) FROM step_samples")
      count("sleep_segments", "SELECT COUNT(*) FROM sleep_segments")
      count("sleep_scores", "SELECT COUNT(*) FROM sleep_scores")
      count("workouts", "SELECT COUNT(*) FROM workouts")
      count("workouts_with_points", "SELECT COUNT(DISTINCT workout_id) FROM workout_points")
      count("workout_points", "SELECT COUNT(*) FROM workout_points")
      count("workouts_with_gps", "SELECT COUNT(DISTINCT workout_id) FROM workout_points WHERE lat IS NOT NULL")
      count("workout_distance_m", "SELECT COALESCE(SUM(distance),0) FROM workouts")
      count("workout_kcal", "SELECT COALESCE(SUM(calories),0) FROM workouts")
      count("scale_reading", "SELECT COUNT(*) FROM scale_reading")
      count("scale_reading_with_body", "SELECT COUNT(*) FROM scale_reading WHERE reported IS NOT NULL")
      count("queue_meals", "SELECT COUNT(*) FROM rogo_import_queue WHERE kind = 'meal'")
      count("queue_water_days", "SELECT COUNT(*) FROM rogo_import_queue WHERE kind = 'water'")
      count("queue_glasses", "SELECT COALESCE(SUM(json_extract(payload, '$.glasses')),0) FROM rogo_import_queue WHERE kind = 'water'")
      count("scale_reading_pending", "SELECT COUNT(*) FROM scale_reading WHERE rogo_state = 'pending'")
      for (type in listOf("emotion", "hrv", "sleep_apnea", "skin_temperature", "arterial_stiffness", "arrhythmia")) {
        count("health_metrics_$type", "SELECT COUNT(*) FROM health_metrics WHERE type = '$type'")
      }
      report.put("tables", tables)
      out?.writeText(report.toString(2))
    } finally {
      db.close()
      tmp.deleteRecursively()
    }
  }
}
