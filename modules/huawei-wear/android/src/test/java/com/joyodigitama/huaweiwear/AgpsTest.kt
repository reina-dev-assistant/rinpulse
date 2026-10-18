package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The pure parts of the satellite-data job: schedule, validation, the bytes the phone sends, the store and the source rules. */
class AgpsTest {
  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  private fun lto(size: Int = 115_749) = ByteArray(size) { (it * 31).toByte() }.also {
    it[0] = 0xFF.toByte()
    it[1] = 0xCA.toByte()
    it[2] = 0xDE.toByte()
  }

  // Policy

  @Test
  fun retryWaitsGrowThenStayAtSixHours() {
    val minute = 60_000L
    assertEquals(0L, AgpsPolicy.retryDelayMs(0))
    assertEquals(1 * minute, AgpsPolicy.retryDelayMs(1))
    assertEquals(5 * minute, AgpsPolicy.retryDelayMs(2))
    assertEquals(15 * minute, AgpsPolicy.retryDelayMs(3))
    assertEquals(60 * minute, AgpsPolicy.retryDelayMs(4))
    assertEquals(360 * minute, AgpsPolicy.retryDelayMs(5))
    assertEquals(360 * minute, AgpsPolicy.retryDelayMs(50))
    assertEquals(10_000L + 5 * minute, AgpsPolicy.retryAtMs(10_000L, 2))
    assertEquals(0L, AgpsPolicy.retryAtMs(10_000L, 0))
  }

  @Test
  fun prefetchIsDueWhenTheCopyIsMissingOrSixHoursOldAndNoRetryWaits() {
    val hour = 60 * 60_000L
    val now = 100 * hour
    assertTrue(AgpsPolicy.prefetchDue(0L, now, 0L))
    assertFalse(AgpsPolicy.prefetchDue(now - 5 * hour, now, 0L))
    assertTrue(AgpsPolicy.prefetchDue(now - 6 * hour, now, 0L))
    assertFalse("a retry wait blocks it", AgpsPolicy.prefetchDue(0L, now, now + 1))
    assertTrue(AgpsPolicy.prefetchDue(0L, now, now))
  }

  @Test
  fun deliveryIsDueAfterADay() {
    val hour = 60 * 60_000L
    val now = 1_000 * hour
    assertTrue(AgpsPolicy.deliveryDue(0L, now))
    assertFalse(AgpsPolicy.deliveryDue(now - 23 * hour, now))
    assertTrue(AgpsPolicy.deliveryDue(now - 24 * hour, now))
    assertEquals(now + 7 * 24 * hour, AgpsPolicy.expiresAtMs(now))
    assertEquals(0L, AgpsPolicy.expiresAtMs(0L))
  }

  @Test
  fun aGoodLtoFilePasses() {
    assertNull(AgpsPolicy.validateLto(lto()))
    assertNull(AgpsPolicy.validateLto(lto(AgpsPolicy.LTO_MIN_BYTES)))
    assertNull(AgpsPolicy.validateLto(lto(AgpsPolicy.LTO_MAX_BYTES)))
  }

  @Test
  fun ltoFilesOutsideTheBoundsOrWithAnotherHeaderAreRefused() {
    assertNotNull(AgpsPolicy.validateLto(lto(AgpsPolicy.LTO_MIN_BYTES - 1)))
    assertNotNull(AgpsPolicy.validateLto(lto(AgpsPolicy.LTO_MAX_BYTES + 1)))
    assertNotNull(AgpsPolicy.validateLto(lto().also { it[2] = 0 }))
    val page = "<html>".toByteArray() + ByteArray(40_000)
    assertTrue(AgpsPolicy.validateLto(page)!!.contains("header"))
    assertNotNull(AgpsPolicy.validateLto(ByteArray(0)))
  }

  @Test
  fun frameCountRoundsUpAndRefusesAbsurdTransfers() {
    assertEquals(1, AgpsPolicy.frameCount(1, 100))
    assertEquals(1, AgpsPolicy.frameCount(100, 100))
    assertEquals(2, AgpsPolicy.frameCount(101, 100))
    assertEquals(1158, AgpsPolicy.frameCount(115_749, 100))
    assertNull(AgpsPolicy.frameCount(0, 100))
    assertNull(AgpsPolicy.frameCount(100, 0))
    assertNull("one byte per frame of a megabyte", AgpsPolicy.frameCount(1024 * 1024, 1))
    assertEquals(AgpsPolicy.MAX_FRAMES, AgpsPolicy.frameCount(AgpsPolicy.MAX_FRAMES, 1))
  }

  // The bytes the phone sends

  @Test
  fun operatorAndRefusalAnswersCarryTheWireCodes() {
    assertEquals("7f04000186a0", hex(AgpsMessages.operatorAnswer(AgpsMessages.CODE_OK).serialize()))
    assertEquals("7f04000186a7", hex(AgpsMessages.operatorAnswer(AgpsMessages.CODE_NO_NETWORK).serialize()))
    assertEquals("7f04000186a1", hex(AgpsMessages.refused().serialize()))
    assertEquals("7f04000186a0", hex(AgpsMessages.accepted().serialize()))
  }

  @Test
  fun parameterConsultIsAnEmptyContainer() {
    assertEquals("8100", hex(AgpsMessages.parameterConsult().serialize()))
  }

  @Test
  fun progressAnswerEchoesTheWatchTimeAndTheState() {
    val answer = AgpsMessages.progressAnswer(byteArrayOf(0, 0, 1, 2), AgpsMessages.STATE_READY)
    assertEquals("810c020102030400000102040103", hex(answer.serialize()))
  }

  @Test
  fun fileStatusIsOneByte() {
    assertEquals("010103", hex(AgpsMessages.fileStatus(AgpsMessages.STATE_READY).serialize()))
    assertEquals("010104", hex(AgpsMessages.fileStatus(AgpsMessages.STATE_FAILED).serialize()))
    assertEquals("010105", hex(AgpsMessages.fileStatus(AgpsMessages.STATE_UNSUPPORTED).serialize()))
  }

  @Test
  fun fileListJoinsNamesWithSemicolons() {
    assertEquals("010361" + "3b62", hex(AgpsMessages.fileList(listOf("a", "b")).serialize()))
    assertEquals("010f" + hex("gpslocation.dat".toByteArray()), hex(AgpsMessages.fileList(listOf("gpslocation.dat")).serialize()))
  }

  @Test
  fun fileInfoCarriesSizeAndCrc() {
    // 115749 = 0x0001C425 as i32; the CRC as i16.
    assertEquals("020400" + "01c425" + "03021234", hex(AgpsMessages.fileInfo(115_749, 0x1234).serialize()))
    val data = lto(1000)
    val crc = CheckSums.getCRC16(data, 0x0000)
    val tlv = HuaweiTLV().parse(AgpsMessages.fileInfo(data.size, crc).serialize())
    assertEquals(1000, tlv.getInteger(0x02))
    assertEquals(crc.toShort(), tlv.getShort(0x03))
  }

  @Test
  fun dataAnswerCarriesTheStoredNameAndOffset() {
    val answer = AgpsMessages.dataAnswer("ab", 4096)
    assertEquals("7f04000186a0" + "020261" + "62" + "0304" + "00001000", hex(answer.serialize()))
  }

  @Test
  fun storedNameIsTheDigestOfTheAddressWithoutColons() {
    // SHA-256 of "AABBCCDDEEFF" (GB getHexDigest), checked against the digest of the colon-less text.
    val digest = java.security.MessageDigest.getInstance("SHA-256").digest("AABBCCDDEEFF".toByteArray()).joinToString("") { "%02x".format(it) }
    assertEquals(digest, EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF"))
    assertEquals(64, EphemerisNet.addressDigest("AA:BB:CC:DD:EE:FF").length)
  }

  @Test
  fun theConsultAnswerIsParsedIntoVersionTagAndUrls() {
    val body = HuaweiTLV().put(0x04, 5).put(0x05, 3.toByte()).put(0x06, "a/b/HW_AGNSS;x/HW_PGNSS_PRED")
    val consult = AgpsMessages.parseConsult(HuaweiTLV().put(0x81, body))!!
    assertEquals(3, consult.version)
    assertEquals("a/b/HW_AGNSS;x/HW_PGNSS_PRED", consult.tag)
    assertEquals("only the names, never the paths", "HW_AGNSS,HW_PGNSS_PRED", consult.tagNames)
    assertNull(AgpsMessages.parseConsult(HuaweiTLV().put(0x7F, 100001)))
    assertNull(AgpsMessages.parseConsult(null))
  }

  // Frames

  @Test
  fun dataFramesAreIndexedAndCutAtTheTransferSize() {
    val params = HuaweiPacket.ParamsProvider().also { it.setTransactionsCrypted(false) }
    val data = ByteArray(250) { it.toByte() }
    val frames = AgpsChunkPacket(params, data, 100.toShort(), 3).serialize()
    assertEquals(3, frames.size)
    var rebuilt = ByteArray(0)
    for ((index, f) in frames.withIndex()) {
      // 5A, length (2), 00, service 1C, command 05, index, data..., CRC16 (2)
      assertEquals(0x5A, f[0].toInt() and 0xFF)
      assertEquals(0x1C, f[4].toInt())
      assertEquals(0x05, f[5].toInt())
      assertEquals(index, f[6].toInt())
      rebuilt += f.copyOfRange(7, f.size - 2)
      val crc = CheckSums.getCRC16(f.copyOfRange(0, f.size - 2), 0x0000)
      assertEquals(crc.toShort(), java.nio.ByteBuffer.wrap(f, f.size - 2, 2).short)
    }
    assertArrayEquals(data, rebuilt)
    assertEquals(100, frames[0].size - 9)
    assertEquals(50, frames[2].size - 9)
  }

  // The store

  @Test
  fun theStoreStartsEmpty() {
    val store = AgpsStore(MemoryPrefs())
    assertEquals(0L, store.cachedAtMs)
    assertEquals(-1, store.lastAskVersion)
    assertEquals(AgpsOutcome.NONE, store.lastOutcome)
    assertEquals(0L, store.retryAtMs())
  }

  @Test
  fun failuresAccumulateIntoTheRetryWaitAndASuccessOrTheUserClearsThem() {
    val store = AgpsStore(MemoryPrefs())
    store.recordOutcome(1_000L, AgpsOutcome.DOWNLOAD_FAILED, "HTTP 503", true)
    assertEquals(1, store.failures)
    assertEquals(1_000L + 60_000L, store.retryAtMs())
    store.recordOutcome(2_000L, AgpsOutcome.DOWNLOAD_FAILED, "HTTP 503", true)
    assertEquals(2, store.failures)
    assertEquals(2_000L + 5 * 60_000L, store.retryAtMs())
    store.recordOutcome(3_000L, AgpsOutcome.WATCH_SILENT, "no answer", false)
    assertEquals("a silent watch is not a download failure", 2, store.failures)
    assertEquals(AgpsOutcome.WATCH_SILENT, store.lastOutcome)
    store.clearRetry()
    assertEquals(0L, store.retryAtMs())
    store.recordOutcome(4_000L, AgpsOutcome.DOWNLOAD_FAILED, "x", true)
    store.recordDownloaded(5_000L, 4_500L, 1234, AgpsSources.BROADCOM)
    assertEquals(0, store.failures)
    assertEquals(1234, store.cachedSize)
    assertEquals(4_500L, store.cachedDataMs)
  }

  @Test
  fun aDeliveryIsRememberedPerWatchAndCountsAsTheOutcome() {
    val store = AgpsStore(MemoryPrefs())
    store.recordDelivered(9_000L, 8_000L, 115_749, AgpsSources.BROADCOM, "AA:BB:CC:DD:EE:FF")
    assertEquals(9_000L, store.deliveredAtMs)
    assertEquals(115_749, store.deliveredSize)
    assertEquals("AA:BB:CC:DD:EE:FF", store.deliveredAddress)
    assertEquals(AgpsOutcome.DELIVERED, store.lastOutcome)
    assertEquals("", store.lastError)
  }

  @Test
  fun theAskKeepsTagNamesOnlyAndIsCapped() {
    val store = AgpsStore(MemoryPrefs())
    store.recordAsk(7L, 3, "x".repeat(500))
    assertEquals(120, store.lastAskTags.length)
    assertEquals(3, store.lastAskVersion)
    assertEquals(7L, store.lastAskMs)
  }

  // The source

  private class MemoryCache : AgpsCache {
    val entries = HashMap<String, ByteArray>()
    var ageOk = true
    override fun read(url: String, maxAgeMs: Long): ByteArray? = if (ageOk) entries[url] else null
    override fun write(url: String, data: ByteArray) {
      entries[url] = data
    }
    override fun delete(url: String) {
      entries.remove(url)
    }
  }

  private val ltoUrl = EphemerisNet.LTO_HOST + EphemerisNet.LTO_PATH

  private fun source(cache: AgpsCache, store: AgpsStore, online: Boolean = true) =
    NetworkAgpsSource(cache, store, log = { }, isOnline = { online }, nowMs = { 50_000L })

  @Test
  fun versionZeroServesAGoodCachedFileAndMarksItAsCached() {
    val cache = MemoryCache().also { it.entries[ltoUrl] = lto() }
    val store = AgpsStore(MemoryPrefs()).also { it.recordDownloaded(40_000L, 39_000L, 115_749, AgpsSources.BROADCOM) }
    val fetch = source(cache, store).fetch(AgpsConsult.DEFAULT, force = false)
    assertTrue(fetch.ok)
    assertTrue(fetch.fromCache)
    assertEquals(AgpsSources.BROADCOM, fetch.source)
    assertEquals(39_000L, fetch.dataTimeMs)
    assertEquals(setOf(AgpsSources.LTO_FILE), fetch.files.keys)
  }

  @Test
  fun aBrokenCachedFileIsDroppedAndOfflineThenSaysSo() {
    val cache = MemoryCache().also { it.entries[ltoUrl] = ByteArray(100) }
    val fetch = source(cache, AgpsStore(MemoryPrefs()), online = false).fetch(AgpsConsult.DEFAULT, force = false)
    assertFalse(fetch.ok)
    assertEquals(AgpsOutcome.NO_NETWORK, fetch.outcome)
    assertTrue("the bad copy is gone", cache.entries.isEmpty())
  }

  @Test
  fun forceSkipsTheCacheAndOfflineReportsNoNetwork() {
    val cache = MemoryCache().also { it.entries[ltoUrl] = lto() }
    val fetch = source(cache, AgpsStore(MemoryPrefs()), online = false).fetch(AgpsConsult.DEFAULT, force = true)
    assertEquals(AgpsOutcome.NO_NETWORK, fetch.outcome)
  }

  @Test
  fun versionsOneToThreeAreDeclinedAsUnsupportedWithoutTouchingTheNetworkOrTheCache() {
    val cache = MemoryCache().also { it.entries[ltoUrl] = lto() }
    val store = AgpsStore(MemoryPrefs())
    for (version in 1..3) {
      val fetch = source(cache, store).fetch(AgpsConsult(version, "p/q/HW_AGNSS;x/HW_PGNSS_PRED", emptyList()), force = false)
      assertFalse("the Broadcom file is never offered to a watch that asked for another kind", fetch.ok)
      assertEquals(AgpsOutcome.UNSUPPORTED, fetch.outcome)
      assertTrue(fetch.message.contains("HW_AGNSS,HW_PGNSS_PRED"))
      assertFalse("paths are not echoed", fetch.message.contains("p/q"))
    }
  }

  @Test
  fun unknownVersionsAreUnsupported() {
    val fetch = source(MemoryCache(), AgpsStore(MemoryPrefs())).fetch(AgpsConsult(9, "", emptyList()), false)
    assertEquals(AgpsOutcome.UNSUPPORTED, fetch.outcome)
  }
}
