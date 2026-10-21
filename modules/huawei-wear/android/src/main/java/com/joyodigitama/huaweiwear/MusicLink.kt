// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE):
// service/devices/huawei/AsynchronousResponse.handleMusicControls and requests/SetMusicRequest.convertMusicState.
//
// The decisions the music feature makes, with no Android in sight, so they can be unit tested on the JVM:
// which phone action a watch button means, what play state the watch is told, whether a volume the watch sent is
// usable, and whether a media session has anything worth showing.
package com.joyodigitama.huaweiwear

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl

/** What a watch button asks the phone to do. [WatchMusic] turns these into Android media keys. */
internal enum class MusicAction {
  PLAY,
  PAUSE,
  PREVIOUS,
  NEXT,
  VOLUME_UP,
  VOLUME_DOWN,
}

/** The track to show, already trimmed and with an empty field turned into something displayable. */
internal data class MusicTrack(val song: String, val artist: String, val playState: Byte)

internal object MusicLink {
  /**
   * GB's `handleMusicControls` switch: only the six buttons are mapped. [MusicControl.Control.Button.Unknown] runs
   * nothing, which covers 64 (Huawei Band 4's unnamed button) and 100 (left the music screen) — GB clears
   * `buttonPresent` for those in `parseTlv`, so they never reach the handler as a button at all.
   */
  fun actionOf(button: MusicControl.Control.Button): MusicAction? = when (button) {
    MusicControl.Control.Button.Play -> MusicAction.PLAY
    MusicControl.Control.Button.Pause -> MusicAction.PAUSE
    MusicControl.Control.Button.Previous -> MusicAction.PREVIOUS
    MusicControl.Control.Button.Next -> MusicAction.NEXT
    MusicControl.Control.Button.Volume_up -> MusicAction.VOLUME_UP
    MusicControl.Control.Button.Volume_down -> MusicAction.VOLUME_DOWN
    MusicControl.Control.Button.Unknown -> null
  }

  /**
   * Android's `PlaybackState` codes, which is what GB's `convertMusicState` sends straight through — the watch
   * is not told the equivalent of our own enum. The literals are `PlaybackState.STATE_*`, written out here so this
   * file stays free of Android imports; `MusicLinkTest` pins them against the packet's own constants.
   */
  fun playStateOf(playbackState: Int): Byte = when (playbackState) {
    PLAYBACK_STATE_PLAYING -> MusicControl.PlayState.START
    PLAYBACK_STATE_PAUSED -> MusicControl.PlayState.PAUSE
    PLAYBACK_STATE_STOPPED -> MusicControl.PlayState.STOP
    else -> MusicControl.PlayState.NONE
  }

  /**
   * The volume the watch sent, or null when it is outside what the phone allows. GB refuses rather than
   * clamping, and logs it, so a wrong scale is visible instead of silently wrong.
   */
  fun volumeOf(sent: Int, max: Int, min: Int = 0): Int? = when {
    sent > max -> null
    sent < min -> null
    else -> sent
  }

  /**
   * The track to display, or null when the session has nothing (no metadata, or both fields empty — a player
   * that exposes a session but no title would otherwise blank the watch's screen then show an empty row).
   */
  fun trackOf(song: String?, artist: String?, playbackState: Int): MusicTrack? {
    val title = song?.trim().orEmpty()
    val who = artist?.trim().orEmpty()
    if (title.isEmpty() && who.isEmpty()) return null
    return MusicTrack(
      song = title.ifEmpty { NO_TITLE },
      artist = who,
      playState = playStateOf(playbackState),
    )
  }

  /**
   * Whether a posted notification is a player's media notification, which is a second way to notice that the
   * track or its state changed (players update it on every change, and it already arrives at the app).
   *
   * GB skips these as *forwarded notifications* (`NotificationPolicy`: `CATEGORY_TRANSPORT` -> "media controls"),
   * and that stays: this only reads one as a trigger, it is never sent to the watch as a message. Both signals
   * are checked because a player may set the category, the session extra, or both. The two flags are computed by
   * the caller so this stays free of Android constants.
   */
  fun isMediaNotification(categoryIsTransport: Boolean, hasMediaSessionExtra: Boolean): Boolean =
    categoryIsTransport || hasMediaSessionExtra

  /**
   * What counts as "the watch already knows this". Volume is in the key because the watch's screen shows it and
   * the buttons change it: sending the same track again is skipped, but the same track at a new volume is not.
   */
  fun changeKey(track: MusicTrack, maxVolume: Int, volume: Int): String =
    "${track.artist}|${track.song}|${track.playState}|$volume/$maxVolume"

  /** Shown when the player names the artist but not the track, so the watch never renders an empty song line. */
  const val NO_TITLE = "—"

  // android.media.session.PlaybackState
  private const val PLAYBACK_STATE_STOPPED = 1
  private const val PLAYBACK_STATE_PAUSED = 2
  private const val PLAYBACK_STATE_PLAYING = 3
}
