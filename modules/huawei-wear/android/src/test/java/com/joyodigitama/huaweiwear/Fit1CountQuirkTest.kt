package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.util.Collections
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Watch Fit 1 quirk the upstream merge put at risk.
 *
 * A long window comes back with `count = 100` while the watch lists 101 well-formed containers (the Watch Fit 1
 * does exactly this; every listed entry carries its own 0x06/0x07/0x08, or the parser would have thrown). Our fix
 * reads those entries and carries on. Upstream's own behaviour splits the window instead, meets the same stale
 * count in each half, and ends up discarding every workout.
 *
 * The merge of upstream's workout-sync rewrite rewrote this area, so this test pins the behaviour that must
 * survive it: the mismatch is reported, our branch is the one taken, and the answers are not re-asked in halves.
 */
class Fit1CountQuirkTest {

  private class Request(val service: Int, val command: Int, val tlv: HuaweiTLV)

  private class RecordingEvents : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add(message)
    }
  }

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

  private class MemorySink : WorkoutSink {
    val saved = ArrayList<WorkoutRecord>()
    override suspend fun isComplete(start: Long, end: Long) = false
    override suspend fun save(record: WorkoutRecord): Boolean {
      saved.add(record)
      return true
    }
  }

  private fun frame(service: Int, command: Int, body: ByteArray): ByteArray {
    val inner = byteArrayOf(service.toByte(), command.toByte()) + body
    val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
    val crc = CheckSums.getCRC16(head, 0x0000)
    return head + ByteBuffer.allocate(2).putShort(crc.toShort()).array()
  }

  private fun tlvFrame(service: Int, command: Int, tlv: HuaweiTLV) = frame(service, command, tlv.serialize())

  /**
   * `count` says one thing, the container list holds `entries` well-formed workouts.
   *
   * Wire shape (WorkoutCount.Response.parseTlv): the answer's 0x81 container carries the reported count in 0x02,
   * and each listed workout is its own 0x85 sub-container with 0x06 (workout number), 0x07 (data frames) and
   * 0x08 (pace frames) — the parser requires all three.
   */
  private fun countTlv(count: Int, entries: Int): HuaweiTLV {
    val container = HuaweiTLV().put(0x02, count.toShort())
    for (i in 0 until entries) {
      container.put(
        0x85,
        HuaweiTLV()
          .put(0x06, (i + 1).toShort())
          .put(0x07, 1.toShort())
          .put(0x08, 1.toShort()),
      )
    }
    return HuaweiTLV().put(0x81, container)
  }

  /** Totals (0x08) for one workout, so the sync can finish it rather than time out. */
  private fun totalsTlv(): HuaweiTLV {
    val header = ByteBuffer.allocate(30).putInt(1).putShort(0).putInt(0).putInt(1700003600).putShort(3600).putInt(6100).putShort(0).putShort(0).putInt(0).array()
    return HuaweiTLV().put(
      0x81,
      HuaweiTLV()
        .put(0x02, 1.toShort())
        .put(0x03, 0.toShort())
        .put(0x04, header)
        .put(0x05, byteArrayOf(120, 0, 150.toByte())),
    )
  }

  @Test
  fun `a list longer than the count is used rather than split`() = runBlocking {
    val events = RecordingEvents()
    val watch = FakeWatch { req ->
      when (req.command) {
        0x07 -> listOf(tlvFrame(0x17, 0x07, countTlv(100, 101)))
        0x08 -> listOf(tlvFrame(0x17, 0x08, totalsTlv()))
        else -> emptyList()
      }
    }
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session

    try {
      WorkoutSync(session, events).sync(1699999000, 1700500000, MemorySink())
    } catch (e: WearException) {
      // A workout beyond the first still asks for parts this fake watch does not serve; the first one is enough.
      println("  (sync stopped later: ${e.message})")
    }

    val mismatched = events.logs.count { it.contains("does not match") }
    val usedListed = events.logs.count { it.contains("using the") && it.contains("the watch listed") }
    val countRequests = watch.requests.count { it.command == 0x07 }
    println("  mismatch lines=$mismatched  usedListed=$usedListed  WorkoutCount requests=$countRequests")
    events.logs.filter { it.contains("does not match") || it.contains("workouts in") }.take(3).forEach { println("  log: $it") }

    assertTrue("the count mismatch was never reported", mismatched >= 1)
    assertTrue("our fix did not run: the listed entries were not used", usedListed >= 1)
    assertTrue("the window was split ($countRequests count requests); the Fit 1 quirk came back", countRequests == 1)
  }
}
