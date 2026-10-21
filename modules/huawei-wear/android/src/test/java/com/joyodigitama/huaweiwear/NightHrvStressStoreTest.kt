package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The stress-score path: the watch's own score used to be parsed and thrown away, which is why the Stress / emotion
 * card stayed empty on a watch that sets no ExpandCapability 206. These tests pin what must now reach `health_metrics`.
 *
 * They run against `RecordingWatchDb`, so they assert the statement and its arguments — not a database.
 */
class NightHrvStressStoreTest {

  private fun db() = RecordingWatchDb()

  @Test
  fun theNightsScoreGoesToTheEmotionCard() {
    val db = db()
    val night = NightSpan(1_000_000, 1_020_000, listOf(TimeSpan(1_000_000, 1_020_000)))

    NightHrvStore.saveStress(db, "AA:BB:CC:DD:EE:FF", night, score = 62.4, level = 2.0, records = 16)

    val stmt = db.executed().single()
    val sql = stmt.first
    val args = stmt.second
    assertTrue("must target health_metrics", sql.contains("INSERT INTO health_metrics"))
    // (type, ts, last_ts, value, values_json, device)
    assertEquals(NightHrv.STRESS_TYPE, args[0])
    assertEquals("emotion", args[0])
    assertEquals(night.end, args[1])
    assertEquals(night.end, args[2])
    assertEquals(62.4, args[3] as Double, 1e-9)
    val json = args[4] as String
    assertTrue(json, json.contains("\"score\":62.40"))
    assertTrue(json, json.contains("\"level\":2.00"))
    assertTrue(json, json.contains("\"records\":16"))
    assertTrue(json, json.contains("\"source\":\"${NightHrv.STRESS_SOURCE}\""))
    assertEquals("AA:BB:CC:DD:EE:FF", args[5])
  }

  /** No level from the watch must give JSON `null`, not the string "null" nor a crash. */
  @Test
  fun aMissingLevelIsJsonNull() {
    val db = db()
    NightHrvStore.saveStress(db, "AA:BB", NightSpan(1, 2, listOf(TimeSpan(1, 2))), score = 30.0, level = null, records = 3)

    val json = db.executed().single().second[4] as String
    assertTrue(json, json.contains("\"level\":null"))
  }

  /**
   * Re-deriving the same night must overwrite its own row, not stack one per sync: the statement is an upsert on
   * `(type, ts)` and the timestamp is the night's end, so the same night lands on the same row.
   */
  @Test
  fun theSameNightUpsertsInsteadOfStacking() {
    val db = db()
    val night = NightSpan(5_000, 9_000, listOf(TimeSpan(5_000, 9_000)))
    NightHrvStore.saveStress(db, "AA:BB", night, score = 40.0, level = 1.0, records = 10)
    NightHrvStore.saveStress(db, "AA:BB", night, score = 44.0, level = 1.0, records = 12)

    val rows = db.executed()
    assertEquals(2, rows.size)
    assertTrue(rows[0].first.contains("ON CONFLICT(type, ts) DO UPDATE"))
    // Same key both times: the second write replaces the first.
    assertEquals(rows[0].second[1], rows[1].second[1])
    assertEquals(44.0, rows[1].second[3] as Double, 1e-9)
  }

  /**
   * The score and the RMSSD are independent: a night can carry one without the other. `summarize` must not merge them,
   * or a scored-but-unusable-RMSSD night would lose its score (and vice versa).
   */
  @Test
  fun aScoreWithoutAUsableRmssdStillCounts() {
    val t = 100_000L
    val night = NightSpan(t, t + 4 * 3600, listOf(TimeSpan(t, t + 4 * 3600)))
    // rmssd 250 is outside the watch's accepted 0..200, so it is not usable — but the score is there.
    val records = NightHrv.parse(
      recordBytes(start = (t + 3600).toInt(), end = (t + 3660).toInt(), rmssd = 250f, medianNni = 900f, score = 55),
    )!!.records
    val s = NightHrv.summarize(night, records)
    assertNull("a 250 ms RMSSD is not usable", s.rmssdMean)
    assertEquals(1, s.scoreRecords.size)
    assertEquals(55.0, s.scoreMean!!, 1e-9)
  }

  /** The reverse: a usable RMSSD with no score from the watch stores HRV only. */
  @Test
  fun aUsableRmssdWithoutAScoreStoresNoStress() {
    val t = 100_000L
    val night = NightSpan(t, t + 4 * 3600, listOf(TimeSpan(t, t + 4 * 3600)))
    val records = NightHrv.parse(
      recordBytes(start = (t + 3600).toInt(), end = (t + 3660).toInt(), rmssd = 48f, medianNni = 900f, score = 0),
    )!!.records
    val s = NightHrv.summarize(night, records)
    assertEquals(48.0, s.rmssdMean!!, 1e-9)
    assertTrue(s.scoreRecords.isEmpty())
    assertNull(s.scoreMean)
  }

  /** One 66 byte `rrisqi_data.bin` record, the layout GB's `parseRri` reads. */
  private fun recordBytes(start: Int, end: Int, rmssd: Float, medianNni: Float, score: Int): ByteArray {
    val b = java.nio.ByteBuffer.allocate(66)
    b.putInt(start).putInt(end).putInt(1)
    b.put(score.toByte()).put(1).put(0).put(0).put(0).put(0)
    val features = FloatArray(12)
    features[0] = 20f
    features[1] = 4.5f
    features[4] = rmssd
    features[5] = medianNni
    for (f in features) b.putFloat(f)
    return file(3, b.array())
  }

  private fun file(version: Int, vararg records: ByteArray): ByteArray {
    val body = records.fold(ByteArray(0)) { acc, r -> acc + r }
    val header = java.nio.ByteBuffer.allocate(NightHrv.HEADER_BYTES)
    header.putLong((NightHrv.HEADER_BYTES + body.size).toLong()).putShort(0x0f).putShort(version.toShort())
    return header.array() + body
  }
}
