// The music buttons, end to end from the wire: a real 25/03 frame built byte by byte, fed through HuaweiSession
// the way the transport feeds it, and asserted to arrive as a typed MusicControl.Control carrying the button.
//
// This is the test the first version was missing. The packet layer and the parsing were unit tested, and the
// buttons still did nothing on a real watch, because `HuaweiPacket.parse` had no `case MusicControl.id`: the frame
// arrived as a bare HuaweiPacket, the cast in the handler failed, and nothing ran. Only a frame through the
// session shows that, which is exactly how Hilmi hit it.
package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.util.Collections
import kotlinx.coroutines.runBlocking
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MusicControlWireTest {
  private class NullSink : FrameSink {
    override suspend fun write(frames: List<ByteArray>) = Unit
  }

  private class RecordingEvents : WearEvents {
    val logs: MutableList<Pair<LogDirection, String>> = Collections.synchronizedList(ArrayList())
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add(direction to message)
    }
  }

  /**
   * A complete frame for an unsliced packet, the way HuaweiSessionTest builds one. [body] starts with the service
   * and command bytes, so the parse path is the same as on the wire.
   */
  private fun frame(body: ByteArray): ByteArray {
    val head = ByteBuffer.allocate(4 + body.size)
      .put(0x5A.toByte())
      .putShort((body.size + 1).toShort())
      .put(0x00)
      .put(body)
      .array()
    val crc = CheckSums.getCRC16(head, 0x0000)
    return ByteBuffer.allocate(head.size + 2).put(head).putShort(crc.toShort()).array()
  }

  /** `25/03 Control` with a button byte, unencrypted as GB reads it. */
  private fun buttonFrame(raw: Int): ByteArray =
    frame(byteArrayOf(MusicControl.id, MusicControl.CONTROL) + HuaweiTLV().put(0x01, byteArrayOf(raw.toByte())).serialize())

  /** `25/03 Control` with an absolute volume in tag 02. */
  private fun volumeFrame(level: Int): ByteArray =
    frame(byteArrayOf(MusicControl.id, MusicControl.CONTROL) + HuaweiTLV().put(0x02, byteArrayOf(level.toByte())).serialize())

  /** `25/01 MusicStatus` carrying the success code. */
  private fun statusFrame(status: Int): ByteArray =
    frame(byteArrayOf(MusicControl.id, MusicControl.MUSIC_STATUS) + HuaweiTLV().put(0x7F, status).serialize())

  private fun session(events: WearEvents) =
    HuaweiSession(NullSink(), events).also { it.params.setSecretKey(ByteArray(16)) }

  /** Subscribes the way WatchMusic.onLinkState does, then feeds [bytes]. */
  private fun deliver(events: WearEvents, bytes: ByteArray, subscribe: (HuaweiSession, (HuaweiPacket) -> Unit) -> Unit) {
    val session = session(events)
    val latch = CountDownLatch(1)
    subscribe(session) { latch.countDown() }
    session.onData(bytes)
    assertTrue("the handler must be called for this frame", latch.await(2, TimeUnit.SECONDS))
  }

  @Test
  fun `a button frame arrives as a typed Control carrying the button`() {
    val events = RecordingEvents()
    var seen: MusicControl.Control? = null
    deliver(events, buttonFrame(4)) { session, done ->
      session.subscribe(MusicControl.id, MusicControl.CONTROL, "music control") {
        it.parseTlv()
        seen = it as? MusicControl.Control
        done(it)
      }
    }
    // Without the case in HuaweiPacket.parse this is a bare HuaweiPacket and the cast is null - the exact failure
    // that made every button log "cannot be cast to MusicControl$Control" on the watch.
    assertNotNull("25/03 must be parsed as MusicControl.Control, not a bare packet", seen)
    assertEquals(MusicControl.Control.Button.Next, seen!!.button)
    assertTrue(seen!!.buttonPresent)
  }

  @Test
  fun `every mapped button survives the wire`() {
    listOf(
      1 to MusicControl.Control.Button.Play,
      2 to MusicControl.Control.Button.Pause,
      3 to MusicControl.Control.Button.Previous,
      4 to MusicControl.Control.Button.Next,
      5 to MusicControl.Control.Button.Volume_up,
      6 to MusicControl.Control.Button.Volume_down,
    ).forEach { (raw, expected) ->
      var seen: MusicControl.Control? = null
      deliver(RecordingEvents(), buttonFrame(raw)) { session, done ->
        session.subscribe(MusicControl.id, MusicControl.CONTROL, "music control") {
          it.parseTlv()
          seen = it as? MusicControl.Control
          done(it)
        }
      }
      assertEquals("raw $raw", expected, seen?.button)
      // Every button that arrives must also be an action the link knows how to run.
      assertTrue("raw $raw must map to an action", MusicLink.actionOf(expected) != null)
    }
  }

  @Test
  fun `a volume frame arrives with the level and no button`() {
    var seen: MusicControl.Control? = null
    deliver(RecordingEvents(), volumeFrame(9)) { session, done ->
      session.subscribe(MusicControl.id, MusicControl.CONTROL, "music control") {
        it.parseTlv()
        seen = it as? MusicControl.Control
        done(it)
      }
    }
    assertNotNull(seen)
    assertTrue("volume must be present", seen!!.volumePresent)
    assertEquals(9, seen!!.volume)
    assertTrue("a volume packet carries no button", !seen!!.buttonPresent)
  }

  @Test
  fun `leaving the music screen arrives with no button to run`() {
    // Raw 100: GB clears buttonPresent, so the handler has nothing to act on and no action is run.
    var seen: MusicControl.Control? = null
    deliver(RecordingEvents(), buttonFrame(100)) { session, done ->
      session.subscribe(MusicControl.id, MusicControl.CONTROL, "music control") {
        it.parseTlv()
        seen = it as? MusicControl.Control
        done(it)
      }
    }
    assertNotNull(seen)
    assertTrue("100 must not look like a button press", !seen!!.buttonPresent)
  }

  @Test
  fun `a status frame arrives as a typed MusicStatus`() {
    var seen: MusicControl.MusicStatus? = null
    deliver(RecordingEvents(), statusFrame(MusicControl.successValue)) { session, done ->
      session.subscribe(MusicControl.id, MusicControl.MUSIC_STATUS, "music status") {
        it.parseTlv()
        seen = it as? MusicControl.MusicStatus
        done(it)
      }
    }
    assertNotNull("25/01 must be parsed as MusicControl.MusicStatus", seen)
    assertEquals(MusicControl.successValue, seen!!.status)
  }

  @Test
  fun `an unlisted 25 command still arrives as a bare packet instead of failing`() {
    // 0x0E is in the watch's advertised 25 commands but is not one we implement: the session must still dispatch
    // it (so it shows in the log) rather than throwing while parsing.
    val events = RecordingEvents()
    val bytes = frame(byteArrayOf(MusicControl.id, 0x0E, 0x01, 0x01, 0x00))
    val session = session(events)
    session.onData(bytes)
    val dispatched = events.logs.any { it.second.contains("asynchronous") || it.second.contains("25") }
    assertTrue("the frame must be logged rather than dropped: ${events.logs}", dispatched)
  }
}
