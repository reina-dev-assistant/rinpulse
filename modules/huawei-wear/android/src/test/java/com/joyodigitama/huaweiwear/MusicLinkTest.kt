// Covers the decisions the music feature makes from the wire, against the values Gadgetbridge uses. A wrong
// mapping is silent on a real watch (a button that does nothing, a track that never appears), so the mapping is
// pinned here instead: GB's AsynchronousResponse.handleMusicControls switch, its MusicControl.Button enum, and
// SetMusicRequest.convertMusicState passing Android's PlaybackState codes through.
package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MusicLinkTest {
  // The buttons the watch sends (25/03, unencrypted, tag 01 = the raw byte)

  @Test
  fun `each watch button maps to the action Gadgetbridge runs`() {
    val expected = mapOf(
      MusicControl.Control.Button.Play to MusicAction.PLAY,
      MusicControl.Control.Button.Pause to MusicAction.PAUSE,
      MusicControl.Control.Button.Previous to MusicAction.PREVIOUS,
      MusicControl.Control.Button.Next to MusicAction.NEXT,
      MusicControl.Control.Button.Volume_up to MusicAction.VOLUME_UP,
      MusicControl.Control.Button.Volume_down to MusicAction.VOLUME_DOWN,
    )
    expected.forEach { (button, action) ->
      assertEquals("button $button", action, MusicLink.actionOf(button))
    }
  }

  @Test
  fun `an unnamed button runs nothing and reports itself as unknown`() {
    assertNull(MusicLink.actionOf(MusicControl.Control.Button.Unknown))
    // GB's catch-all: 64 (Huawei Band 4) and 100 (left the music screen) both land here.
    assertEquals(MusicControl.Control.Button.Unknown, MusicControl.Control.Button.of(64))
    assertEquals(MusicControl.Control.Button.Unknown, MusicControl.Control.Button.of(100))
  }

  @Test
  fun `button raw values are Gadgetbridge's`() {
    assertEquals(1, MusicControl.Control.Button.Play.raw)
    assertEquals(2, MusicControl.Control.Button.Pause.raw)
    assertEquals(3, MusicControl.Control.Button.Previous.raw)
    assertEquals(4, MusicControl.Control.Button.Next.raw)
    assertEquals(5, MusicControl.Control.Button.Volume_up.raw)
    assertEquals(6, MusicControl.Control.Button.Volume_down.raw)
    assertEquals(64, MusicControl.Control.Button.Unknown.raw)
  }

  @Test
  fun `leaving the music screen arrives without a button, the way Gadgetbridge reads it`() {
    // GB sets buttonPresent = false for 100 and 64 in parseTlv, so the handler sees no button and runs nothing.
    listOf(100, 64).forEach { raw ->
      val control = MusicControl.Control(PARAMS)
      control.tlv = HuaweiTLV().put(0x01, byteArrayOf(raw.toByte()))
      control.parseTlv()
      assertFalse("raw $raw must not look like a button press", control.buttonPresent)
      assertNull("raw $raw must not carry an action", MusicLink.actionOf(control.button))
    }
  }

  @Test
  fun `an unmapped raw byte parses as Unknown, not as a wrong button`() {
    // The Fit 1's list is the one we can see; a watch that sends something else must not fire a random action.
    assertEquals(MusicControl.Control.Button.Unknown, MusicControl.Control.Button.of(7))
    assertEquals(MusicControl.Control.Button.Unknown, MusicControl.Control.Button.of(0))
    assertEquals(MusicControl.Control.Button.Unknown, MusicControl.Control.Button.of(255))
    assertEquals(MusicControl.Control.Button.Play, MusicControl.Control.Button.of(1))
  }

  // Parsing the packet the watch sends

  @Test
  fun `a play button packet parses from the wire tags`() {
    val control = MusicControl.Control(PARAMS)
    control.tlv = HuaweiTLV().put(0x01, byteArrayOf(0x01))
    control.parseTlv()
    assertTrue(control.buttonPresent)
    assertEquals(MusicControl.Control.Button.Play, control.button)
    assertFalse("no volume in this packet", control.volumePresent)
  }

  @Test
  fun `only the lowest byte of a multi-byte button tag is read`() {
    // GB: "Only grab the lowest byte". A varint-encoded button must not become a huge raw value.
    val control = MusicControl.Control(PARAMS)
    control.tlv = HuaweiTLV().put(0x01, byteArrayOf(0x00, 0x04))
    control.parseTlv()
    assertEquals(MusicControl.Control.Button.Next, control.button)
  }

  @Test
  fun `a volume packet parses, and a button-less packet has no button`() {
    val control = MusicControl.Control(PARAMS)
    control.tlv = HuaweiTLV().put(0x02, byteArrayOf(0x0B))
    control.parseTlv()
    assertNull("a volume-only packet runs no button", control.button)
    assertFalse(control.buttonPresent)
    assertTrue(control.volumePresent)
    assertEquals(11, control.volume)
  }

  // The state sent to the watch (25/02, tag 03)

  @Test
  fun `play states are Android's PlaybackState codes, which is what Gadgetbridge sends`() {
    // GB passes PlaybackState.STATE_* straight through, so these are those values, not an enum ordinal.
    assertEquals(3, MusicLink.playStateOf(3).toInt()) // STATE_PLAYING
    assertEquals(2, MusicLink.playStateOf(2).toInt()) // STATE_PAUSED
    assertEquals(1, MusicLink.playStateOf(1).toInt()) // STATE_STOPPED
    assertEquals(0, MusicLink.playStateOf(0).toInt()) // STATE_NONE
    assertEquals(MusicControl.PlayState.START, MusicLink.playStateOf(3))
    assertEquals(MusicControl.PlayState.PAUSE, MusicLink.playStateOf(2))
    assertEquals(MusicControl.PlayState.STOP, MusicLink.playStateOf(1))
    assertEquals(MusicControl.PlayState.NONE, MusicLink.playStateOf(0))
  }

  @Test
  fun `a state the watch has no word for is sent as none`() {
    // e.g. buffering (6), skipping (10), error (7): the watch shows nothing rather than a wrong glyph.
    listOf(4, 6, 7, 10, 11).forEach { assertEquals("state $it", MusicControl.PlayState.NONE, MusicLink.playStateOf(it)) }
  }

  @Test
  fun `the track is trimmed and an unnamed track still gets a title`() {
    val track = MusicLink.trackOf("  Lagu  ", "  Artis  ", 3)
    assertEquals("Lagu", track?.song)
    assertEquals("Artis", track?.artist)

    val unnamed = MusicLink.trackOf("", "Artis", 3)
    assertEquals("the watch never renders an empty song line", MusicLink.NO_TITLE, unnamed?.song)
    assertEquals("Artis", unnamed?.artist)
  }

  @Test
  fun `a session with nothing named is not pushed at all`() {
    // A player can expose a session with no metadata; pushing that would blank the watch's screen.
    assertNull(MusicLink.trackOf(null, null, 3))
    assertNull(MusicLink.trackOf("", "", 3))
    assertNull(MusicLink.trackOf("   ", "  ", 3))
  }

  @Test
  fun `the track carries the play state it was read with`() {
    assertEquals(MusicControl.PlayState.PAUSE, MusicLink.trackOf("Lagu", "Artis", 2)?.playState)
  }

  // Volume the watch sent (25/03, tag 02)

  @Test
  fun `a volume within the phone's range is applied as sent`() {
    assertEquals(7, MusicLink.volumeOf(7, max = 15))
    assertEquals(0, MusicLink.volumeOf(0, max = 15))
    assertEquals(15, MusicLink.volumeOf(15, max = 15))
  }

  @Test
  fun `a volume outside the phone's range is refused, not clamped`() {
    // GB refuses and logs rather than clamping, so a wrong scale is visible instead of silently wrong.
    assertNull(MusicLink.volumeOf(16, max = 15))
    assertNull(MusicLink.volumeOf(-1, max = 15))
    assertNull(MusicLink.volumeOf(200, max = 15))
  }

  // The wire layout of what goes out (25/02)

  @Test
  fun `MusicInfo carries artist, song, state and both volumes in Gadgetbridge's tags`() {
    val packet = MusicControl.MusicInfo(PARAMS, "Artis", "Lagu", MusicControl.PlayState.START, 15, 7)
    val tlv = packet.tlv
    assertEquals("tag 01 artist", "Artis", tlv.getString(0x01))
    assertEquals("tag 02 song", "Lagu", tlv.getString(0x02))
    assertEquals("tag 03 state", MusicControl.PlayState.START, tlv.getByte(0x03))
    assertEquals("tag 04 max volume", 15, tlv.getByte(0x04).toInt())
    assertEquals("tag 05 current volume", 7, tlv.getByte(0x05).toInt())
  }

  @Test
  fun `MusicInfo goes out on service 25 command 02 and is complete`() {
    val packet = MusicControl.MusicInfo(PARAMS, "A", "L", MusicControl.PlayState.PAUSE, 15, 3)
    assertEquals(MusicControl.id, packet.serviceId)
    assertEquals(MusicControl.MUSIC_INFO, packet.commandId)
    assertTrue("must be complete to be sent", packet.complete)
  }

  @Test
  fun `the status we answer with is 7f equals success on the same command id`() {
    // GB's SetMusicStatusRequest(MusicControl.MUSIC_STATUS, successValue) and (CONTROL, successValue).
    val forStatus = MusicControl.StatusRequest(PARAMS, MusicControl.MUSIC_STATUS)
    assertEquals(MusicControl.MUSIC_STATUS, forStatus.commandId)
    assertEquals(MusicControl.successValue, forStatus.tlv.getInteger(0x7F).toInt())

    val forControl = MusicControl.StatusRequest(PARAMS, MusicControl.CONTROL)
    assertEquals(MusicControl.CONTROL, forControl.commandId)
    assertTrue("the ack must be complete to go out", forControl.complete)
  }

  @Test
  fun `success is Gadgetbridge's successValue`() {
    assertEquals(0x000186A0, MusicControl.successValue)
  }

  @Test
  fun `the watch asking for the track parses its status tag`() {
    val asked = MusicControl.MusicStatus(PARAMS)
    asked.tlv = HuaweiTLV().put(0x7F, MusicControl.successValue)
    asked.parseTlv()
    assertEquals(MusicControl.successValue, asked.status)

    val nothing = MusicControl.MusicStatus(PARAMS)
    nothing.tlv = HuaweiTLV()
    nothing.parseTlv()
    assertEquals("no tag means no code, not a rejection", -1, nothing.status)
  }

  @Test
  fun `a MusicInfo answer is only accepted with the 4-byte success tag`() {
    val ok = MusicControl.MusicInfo.Response(PARAMS)
    ok.tlv = HuaweiTLV().put(0x7F, MusicControl.successValue)
    ok.parseTlv()
    assertTrue(ok.ok)

    val refused = MusicControl.MusicInfo.Response(PARAMS)
    refused.tlv = HuaweiTLV().put(0x7F, 0x000186A4)
    refused.parseTlv()
    assertTrue("a refusal must not look like success", !refused.ok)
  }

  // What counts as a change worth sending

  @Test
  fun `a media notification is recognised by either signal`() {
    // Spotify sets both; other players set only one. Either one is enough to look at the session again.
    assertTrue(MusicLink.isMediaNotification(categoryIsTransport = true, hasMediaSessionExtra = true))
    assertTrue("category only", MusicLink.isMediaNotification(categoryIsTransport = true, hasMediaSessionExtra = false))
    assertTrue("extra only", MusicLink.isMediaNotification(categoryIsTransport = false, hasMediaSessionExtra = true))
    assertFalse("an ordinary notification is not a trigger", MusicLink.isMediaNotification(categoryIsTransport = false, hasMediaSessionExtra = false))
  }

  @Test
  fun `the same track at a new volume is a change, the same one is not`() {
    // The watch shows the volume and its buttons change it, so volume is part of "already known" - but a repeat
    // of the same track at the same volume must stay a no-op (the callbacks fire in bursts).
    val track = MusicLink.trackOf("Lagu", "Artis", 3)!!
    val key = MusicLink.changeKey(track, maxVolume = 15, volume = 7)
    assertEquals(key, MusicLink.changeKey(track, 15, 7))
    assertFalse("a new volume is a change", key == MusicLink.changeKey(track, 15, 8))
    assertFalse("a new state is a change", key == MusicLink.changeKey(track.copy(playState = 2), 15, 7))
    assertFalse("a new track is a change", key == MusicLink.changeKey(track.copy(song = "Lain"), 15, 7))
  }

  private companion object {
    val PARAMS = nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket.ParamsProvider()
  }
}
