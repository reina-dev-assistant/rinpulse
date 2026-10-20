package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.util.Collections
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Band 11 Pro on Android 14+: the newest step frames are longer than the 512 bytes the stack accepts per notification, so the
 * watch's reply never arrives. The pull must keep what arrived and go on instead of failing the whole sync.
 */
class ActivitySyncTest {
  private class RecordingEvents : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
  }

  /** Answers 07/0c (sleep count) with 0, 07/0a (step count) with [stepFrames] and 07/0b with frame `n` unless `n` is in [lost]. */
  private class FakeWatch(private val stepFrames: Int, private val lost: (Int) -> Boolean, private val reply: (Int) -> ByteArray) : FrameSink {
    lateinit var session: HuaweiSession
    val stepRequests: MutableList<Int> = Collections.synchronizedList(ArrayList())

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        val service = f[4].toInt() and 0xFF
        val command = f[5].toInt() and 0xFF
        val tlv = HuaweiTLV().parse(f, 6, f.size - 8).also { if (it.contains(0x7C)) it.decrypt(session.params) }
        when {
          service == 0x07 && command == 0x0C -> session.onData(count(0x0C, 0))
          service == 0x07 && command == 0x0A -> session.onData(count(0x0A, stepFrames))
          service == 0x07 && command == 0x0B -> {
            val index = tlv.getObject(0x81).getShort(0x02).toInt()
            stepRequests.add(index)
            if (!lost(index)) session.onData(reply(index))
          }
        }
      }
    }

    private fun count(command: Int, n: Int) = frame(0x07, command, HuaweiTLV().put(0x81, HuaweiTLV().put(0x02, n.toShort())))
  }

  private companion object {
    const val FROM = 1_699_000_000L
    const val TO = 1_700_000_000L

    fun frame(service: Int, command: Int, tlv: HuaweiTLV): ByteArray {
      val inner = byteArrayOf(service.toByte(), command.toByte()) + tlv.serialize()
      val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
      val crc = CheckSums.getCRC16(head, 0x0000)
      return head + ByteBuffer.allocate(2).putShort(crc.toShort()).array()
    }

    /** One step frame holding one minute with `steps` steps (feature bitmap 0x02, a 16-bit value). */
    fun stepFrame(number: Int, steps: Int): ByteArray = frame(
      0x07,
      0x0B,
      HuaweiTLV().put(
        0x81,
        HuaweiTLV()
          .put(0x02, number.toShort())
          .put(0x03, (TO - 3_600 + number * 60).toInt())
          .put(0x84, HuaweiTLV().put(0x05, 0.toByte()).put(0x06, byteArrayOf(0x02, (steps shr 8).toByte(), steps.toByte()))),
      ),
    )
  }

  private fun run(watch: FakeWatch): Pair<SyncResult, RecordingEvents> {
    val events = RecordingEvents()
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    val result = runBlocking { ActivitySync(session, events, dataTimeoutMs = 40).sync(FROM, TO) }
    return result to events
  }

  @After
  fun resetCaps() = DeviceCaps.reset()

  @Test
  fun framesTheWatchNeverAnswersEndTheStepPullWithoutFailingIt() {
    val watch = FakeWatch(stepFrames = 8, lost = { it >= 1 }, reply = { stepFrame(it, 10 + it) })
    val (result, events) = run(watch)

    assertEquals(listOf(10), result.samples.map { it.steps })
    // Frame 0 answered, then three unanswered frames in a row end the pull; frames 4..7 are not requested.
    assertEquals(listOf(0, 1, 2, 3), watch.stepRequests)
    assertTrue(events.logs.any { it.contains("3 frames in a row got no answer; stopping the step pull") })
  }

  @Test
  fun anUnansweredFrameBetweenAnsweredOnesIsSkippedAndTheRestStillArrives() {
    val watch = FakeWatch(stepFrames = 4, lost = { it == 1 }, reply = { stepFrame(it, 10 + it) })
    val (result, events) = run(watch)

    assertEquals(listOf(10, 12, 13), result.samples.map { it.steps })
    assertEquals(listOf(0, 1, 2, 3), watch.stepRequests)
    assertTrue(events.logs.any { it.contains("StepData 2/4") && it.contains("skipping this frame") })
  }
}
