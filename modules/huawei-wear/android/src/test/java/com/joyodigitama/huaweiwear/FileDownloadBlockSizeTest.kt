package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.util.Collections
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The block-size cap on file downloads, using the GPS file as the case.
 *
 * Android 14 and newer ask for ATT MTU 517 whatever the app requests, the watch then answers file data in
 * notifications of MTU - 3 (514 bytes), and the stack discards anything longer than one ATT attribute value
 * (512, `gatt_cl.cc GATT_MAX_ATTR_LEN`). The watch offers blocks of its own (2200 for sleep, more for a GPS
 * file), so asking for a full block means the answer is thrown away and the download times out with no data.
 * The Watch Fit 1 is exactly this case: an LE model with built-in GPS, whose workouts show "Jam tidak
 * menyediakan file GPS" because the track never arrives.
 */
class FileDownloadBlockSizeTest {
  private class Request(val service: Int, val command: Int, val tlv: HuaweiTLV)

  private class RecordingEvents : WearEvents {
    override fun syncComplete(summary: SyncSummary) = Unit
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
  }

  /** A watch that answers each written (unencrypted, unsliced) request synchronously. */
  private class FakeWatch(private val respond: (Request) -> List<ByteArray>) : FrameSink {
    lateinit var session: HuaweiSession
    val requests: MutableList<Request> = Collections.synchronizedList(ArrayList())

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        val tlv = HuaweiTLV().parse(f, 6, f.size - 8).also { if (it.contains(0x7C)) it.decrypt(session.params) }
        val request = Request(f[4].toInt() and 0xFF, f[5].toInt() and 0xFF, tlv)
        requests.add(request)
        for (response in respond(request)) session.onData(response)
      }
    }
  }

  private fun frame(service: Int, command: Int, body: ByteArray): ByteArray {
    val inner = byteArrayOf(service.toByte(), command.toByte()) + body
    val head = ByteBuffer.allocate(4 + inner.size)
      .put(0x5A.toByte())
      .putShort((inner.size + 1).toShort())
      .put(0)
      .put(inner)
      .array()
    val crc = CheckSums.getCRC16(head, 0x0000)
    return head + ByteBuffer.allocate(2).putShort(crc.toShort()).array()
  }

  private fun tlvFrame(service: Int, command: Int, tlv: HuaweiTLV) = frame(service, command, tlv.serialize())

  private fun setup(respond: (Request) -> List<ByteArray>): Triple<FakeWatch, HuaweiSession, RecordingEvents> {
    val events = RecordingEvents()
    val watch = FakeWatch(respond)
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    return Triple(watch, session, events)
  }

  // The block size cap: Android 14+ drops a notification longer than one ATT attribute value

  /**
   * A GPS file over the old sync, the case the Watch Fit 1 takes. The watch offers 2200-byte blocks and pushes each
   * block as packets numbered from 0; every request must ask for a block small enough that the watch's answer fits one
   * ATT notification, because Android 14 and newer discards anything longer (gatt_cl.cc GATT_MAX_ATTR_LEN). The file's
   * own size is unchanged, so the download still yields all of it.
   */
  @Test
  fun oldSyncGpsDownloadAsksForBlocksThatFitOneNotification() = runBlocking {
    val file = ByteArray(1500) { (it % 251).toByte() }
    val (watch, session, events) = setup { r ->
      when (r.command) {
        0x01 -> listOf(
          tlvFrame(
            0x0a,
            0x01,
            HuaweiTLV().put(0x8b, HuaweiTLV().put(0x8c, HuaweiTLV().put(0x0d, "5_gps.bin;5_pdr.bin"))),
          ),
        )
        0x02 -> listOf(
          tlvFrame(0x0a, 0x02, HuaweiTLV().put(0x01, "v1").put(0x02, true).put(0x03, 220.toShort()).put(0x04, 2200.toShort()).put(0x05, 10.toShort())),
        )
        0x03 -> listOf(tlvFrame(0x0a, 0x03, HuaweiTLV().put(0x02, file.size)))
        0x04 -> {
          val offset = r.tlv.getInteger(0x02)
          val size = r.tlv.getInteger(0x03)
          val part = file.copyOfRange(offset, offset + size)
          part.toList().chunked(10).mapIndexed { number, bytes ->
            frame(0x0a, 0x05, byteArrayOf(number.toByte()) + bytes.toByteArray())
          }
        }
        else -> emptyList()
      }
    }
    val downloader = FileDownloader(session, events)

    val data = downloader.download(FileRequest.workoutGps(false, 5.toShort()))

    assertArrayEquals(file, data)
    val blocks = watch.requests.filter { it.command == 0x04 }
    // The watch offered 2200; asking for that would come back as a notification Android throws away.
    assertTrue(
      "a block of ${blocks.first().tlv.getInteger(0x03)} bytes can never arrive",
      blocks.all { it.tlv.getInteger(0x03) <= 480 },
    )
    // The file is still read end to end, in pieces that each fit.
    assertEquals(0, blocks.first().tlv.getInteger(0x02))
    assertEquals(file.size, blocks.sumOf { it.tlv.getInteger(0x03) })
    assertTrue(events.logs.any { it.contains("device offers 2200-byte blocks, asking for 480") })
  }

  @Test
  fun newSyncBlockRequestIsAlsoCapped() = runBlocking {
    val file = ByteArray(1200) { it.toByte() }
    val fileId = 0x11
    val (watch, session, _) = setup { r ->
      when (r.command) {
        0x01 -> listOf(
          tlvFrame(0x2c, 0x01, HuaweiTLV().put(0x01, "7_gps.bin").put(0x02, 0x11.toByte()).put(0x03, fileId.toByte()).put(0x04, file.size)),
        )
        0x03 -> listOf(
          tlvFrame(0x2c, 0x03, HuaweiTLV().put(0x01, fileId.toByte()).put(0x02, 10.toByte()).put(0x03, 200.toShort()).put(0x04, 4096).put(0x05, true)),
        )
        0x04 -> {
          val offset = r.tlv.getInteger(0x02)
          val size = r.tlv.getInteger(0x03)
          (offset until offset + size step 10).map { pos ->
            val chunk = file.copyOfRange(pos, minOf(pos + 10, offset + size))
            frame(0x2c, 0x05, byteArrayOf(fileId.toByte()) + ByteBuffer.allocate(4).putInt(pos).array() + byteArrayOf(0) + chunk)
          }
        }
        else -> emptyList()
      }
    }

    val data = FileDownloader(session, RecordingEvents()).download(FileRequest.workoutGps(true, 7.toShort()))

    assertArrayEquals(file, data)
    val blocks = watch.requests.filter { it.command == 0x04 }
    assertTrue("the watch offered 4096", blocks.all { it.tlv.getInteger(0x03) <= 480 })
    assertEquals(file.size, blocks.sumOf { it.tlv.getInteger(0x03) })
  }

  @Test
  fun blocksUnderTheCapAreAskedForAsOffered() {
    // A watch that already offers small blocks is left alone: the cap only lowers what is asked for.
    assertEquals(220, FileDownloader.blockCap(220))
    assertEquals(480, FileDownloader.blockCap(2200))
    assertEquals(480, FileDownloader.blockCap(480))
  }
}
