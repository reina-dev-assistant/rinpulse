package com.joyodigitama.blesensors

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class RoomAdvertLogTest {
  @get:Rule val folder = TemporaryFolder()

  private fun log(maxBytes: Long = RoomAdvertLog.DEFAULT_MAX_BYTES) = RoomAdvertLog(File(folder.root, "room/adverts.log"), maxBytes)

  private fun advert(ts: Long, id: String = "A4:C1:38:8D:18:B2", hex: String = "a4c1388d18b200ea37570ba112") = RoomAdvert(id, ts, "181a", hex)

  @Test
  fun codecRoundTripsAndRejectsDamagedLines() {
    val a = advert(1_700_000_000_000L)
    assertEquals(a, RoomAdvertCodec.decode(RoomAdvertCodec.encode(a)))
    assertEquals("A4:C1:38:8D:18:B2|1700000000000|181a|a4c1388d18b200ea37570ba112", RoomAdvertCodec.encode(a))
    for (bad in listOf("", "x", "A4:C1:38:8D:18:B2|1|181a", "nope|1700000000000|181a|aa", "A4:C1:38:8D:18:B2|soon|181a|aa", "A4:C1:38:8D:18:B2|0|181a|aa",
      "A4:C1:38:8D:18:B2|1700000000000|181|aa", "A4:C1:38:8D:18:B2|1700000000000|181a|abc", "A4:C1:38:8D:18:B2|1700000000000|181a|zz", "A4:C1:38:8D:18:B2|1|181a|aa|extra")) {
      assertNull("'$bad'", RoomAdvertCodec.decode(bad))
    }
  }

  @Test
  fun appendedAdvertisementsComeBackOldestFirst() {
    val l = log()
    assertEquals(emptyList<RoomAdvert>(), l.readAll())
    l.append(advert(1_000))
    l.append(advert(2_000, id = "A4:C1:38:00:00:01", hex = "0102"))
    assertEquals(listOf(advert(1_000), advert(2_000, id = "A4:C1:38:00:00:01", hex = "0102")), l.readAll())
    // Reading does not consume.
    assertEquals(2, l.readAll().size)
  }

  @Test
  fun removeUpToDropsWhatJsTookAndKeepsWhatArrivedAfter() {
    val l = log()
    l.append(advert(1_000))
    l.append(advert(2_000))
    l.append(advert(3_000))
    l.removeUpTo(2_000)
    assertEquals(listOf(advert(3_000)), l.readAll())
    l.removeUpTo(3_000)
    assertEquals(emptyList<RoomAdvert>(), l.readAll())
    assertFalse(File(folder.root, "room/adverts.log").exists())
    l.removeUpTo(1) // nothing there: no error
  }

  @Test
  fun garbageLinesAreIgnoredOnReadAndDroppedOnRemove() {
    val file = File(folder.root, "room/adverts.log")
    file.parentFile!!.mkdirs()
    file.writeText("torn line\n" + RoomAdvertCodec.encode(advert(5_000)) + "\n")
    val l = RoomAdvertLog(file)
    assertEquals(listOf(advert(5_000)), l.readAll())
    l.removeUpTo(1_000)
    assertEquals("${RoomAdvertCodec.encode(advert(5_000))}\n", file.readText())
  }

  @Test
  fun pastTheSizeCapTheOldestHalfGoes() {
    val oneLine = RoomAdvertCodec.encode(advert(1_000)).length + 1L
    val l = log(maxBytes = oneLine * 4)
    for (i in 1..4) l.append(advert(i * 1_000L))
    assertEquals(4, l.readAll().size)
    l.append(advert(5_000))
    // 4 lines held, the 5th would pass the cap: the oldest 2 go, then the new one joins.
    assertEquals(listOf(3_000L, 4_000L, 5_000L), l.readAll().map { it.ts })
  }

  @Test
  fun clearEmptiesTheLog() {
    val l = log()
    l.append(advert(1_000))
    l.clear()
    assertEquals(emptyList<RoomAdvert>(), l.readAll())
  }
}
