// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE):
// service/devices/huawei/AsynchronousResponse.handleMusicControls, requests/SetMusicRequest and util/MediaManager.
//
// Remote music control for the watch: the phone reads what is playing, pushes it as MusicInfo (25/02) and answers
// the watch's buttons (25/03) by driving the phone player.
//
// The Watch Fit 1 has no on-board music storage (Huawei's own spec: "Smartphone music control: yes", "On-board
// music storage: no"), so this is the whole feature: the phone plays, the watch shows the track and sends buttons.
//
// Reading the session uses the notification-listener access the app already holds, so nothing new is asked of the
// user and NotificationPolicy keeps skipping CATEGORY_TRANSPORT notifications. The decisions live in [MusicLink],
// which is Android-free and unit tested; this file is only the Android plumbing around it.
package com.joyodigitama.huaweiwear

import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.os.SystemClock
import android.view.KeyEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl

/**
 * The watch's music screen: the phone's track goes out as `25/02`, and the watch's buttons (`25/03`) drive the
 * phone. Works from the background service, without the UI, like the rest of the watch features.
 */
internal class WatchMusic(
  context: Context,
  private val settings: PhoneFeatureSettings,
  private val link: WearLink,
  private val events: WearEvents,
  private val scope: CoroutineScope,
) {
  private val appContext = context.applicationContext
  private val audio = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private var attached: HuaweiSession? = null
  private val subscriptions = ArrayList<AutoCloseable>()

  /** The last track+state sent, so a repeat of the same one is not re-sent (GB notes it gets duplicates). */
  private var lastSent: String? = null

  private fun log(message: String) = events.log(LogDirection.INFO, null, null, null, message)

  private fun error(message: String) = events.log(LogDirection.ERROR, null, null, null, message)

  /** The watch lists `25/02` when it can show the phone's track. */
  private fun supported(): Boolean =
    DeviceCaps.supports(MusicControl.id.toInt(), MusicControl.MUSIC_INFO.toInt())

  // Link lifecycle

  @Synchronized
  fun onLinkState(state: LinkState) {
    when (state) {
      LinkState.CONNECTED, LinkState.SYNCING -> {
        val session = link.handle()?.session ?: return
        if (session === attached) return
        detach()
        attached = session
        subscriptions += session.subscribe(MusicControl.id, MusicControl.MUSIC_STATUS, "music status") { onStatus(it) }
        subscriptions += session.subscribe(MusicControl.id, MusicControl.CONTROL, "music control") { onControl(it) }
        log(
          "Music: the watch ${if (supported()) "lists" else "does not list"} 25/02 (showing the track); " +
            "listening for 25/01 (asked) and 25/03 (buttons)",
        )
      }
      LinkState.DISCONNECTED -> detach()
      else -> Unit
    }
  }

  private fun detach() {
    subscriptions.forEach { it.close() }
    subscriptions.clear()
    attached = null
    synchronized(this) { lastSent = null }
  }

  // Watch -> phone: the watch wants the track, or a button was pressed

  /** `25/01`: the watch opened its music screen. Answer with the status GB sends, then push the track. */
  private fun onStatus(packet: HuaweiPacket) {
    val status = try {
      packet.parseTlv()
      (packet as MusicControl.MusicStatus).status
    } catch (e: Exception) {
      error("Music: could not parse the watch's status request: ${e.message}")
      return
    }
    if (status != -1 && status != MusicControl.successValue) {
      log("Music: the watch asked for the track with status 0x%08x, answering anyway".format(status))
    } else {
      log("Music: the watch asked for the current track")
    }
    scope.launch {
      try {
        ack(MusicControl.MUSIC_STATUS)
        push(force = true)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        error("Music: answering the watch's track request failed: ${e.message}")
      }
    }
  }

  private fun onControl(packet: HuaweiPacket) {
    val control = try {
      packet.parseTlv()
      packet as MusicControl.Control
    } catch (e: Exception) {
      error("Music: could not parse the watch's button packet: ${e.message}")
      return
    }
    val button = control.button
    val volume = if (control.volumePresent) control.volume else null
    scope.launch {
      try {
        // 25/03 is not encrypted. The volume tag is an absolute level on the same scale as MusicInfo's tag 05.
        if (volume != null) setVolume(volume)
        if (button != null) runButton(button)
        // Whatever changed, tell the watch the new state afterwards (GB waits 100 ms for the player first).
        ack(MusicControl.CONTROL)
        push(force = true)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        error("Music: acting on the watch's button failed: ${e.message}")
      }
    }
  }

  private fun runButton(button: MusicControl.Control.Button) {
    val action = MusicLink.actionOf(button)
    if (action == null) {
      log("Music: unnamed button ${button.raw} from the watch, ignored")
      return
    }
    log("Music: ${button.name} from the watch")
    sendMediaKey(keyCodeOf(action))
  }

  /** Acknowledges the packet the way GB's `SetMusicStatusRequest` does: `7f` = success on the same command id. */
  private suspend fun ack(commandId: Byte) {
    val session = attached ?: return
    try {
      val request = MusicControl.StatusRequest(session.params, commandId)
      session.send(request, "MusicStatus ${"%02x".format(commandId)}")
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      error("Music: the status for 25/${"%02x".format(commandId)} was not sent: ${e.message}")
    }
  }

  // Phone -> watch: what is playing

  /**
   * Pushes the current track and state. [force] skips the "same as last time" check, which `25/01` needs: the
   * watch just opened its screen and has to be told even if nothing changed since the last push.
   */
  suspend fun push(force: Boolean = false) {
    val session = attached ?: return
    if (!settings.musicEnabled) return
    if (!supported()) return
    val track = track() ?: run {
      log("Music: nothing is playing on the phone, nothing sent")
      return
    }
    val key = "${track.artist}|${track.song}|${track.playState}"
    if (force) {
      synchronized(this) { lastSent = key }
    } else {
      synchronized(this) {
        if (lastSent == key) return
        lastSent = key
      }
    }
    val packet = MusicControl.MusicInfo(
      session.params,
      track.artist,
      track.song,
      track.playState,
      audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceIn(0, 255).toByte(),
      audio.getStreamVolume(AudioManager.STREAM_MUSIC).coerceIn(0, 255).toByte(),
    )
    log("Music: sending \"${track.song}\" by \"${track.artist}\" (state ${track.playState})")
    session.send(packet, "MusicInfo 25/02")
  }

  // Android plumbing

  /** The active session's track and state, or null when the phone has nothing to show. */
  private fun track(): MusicTrack? {
    val session = activeSession() ?: return null
    val metadata = session.metadata
    val state = session.playbackState?.state ?: PLAYBACK_STATE_NONE
    return MusicLink.trackOf(
      metadata?.getString(MediaMetadata.METADATA_KEY_TITLE),
      metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST),
      state,
    )
  }

  /**
   * The session to read: a playing one when there is one, otherwise the most recent. Both reads are legal because
   * the app holds notification-listener access (the same grant that lets [WatchNotificationListener] see posts).
   */
  private fun activeSession(): MediaController? {
    val manager = appContext.getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager ?: return null
    val listener = ComponentName(appContext, WatchNotificationListener::class.java)
    val controllers = try {
      manager.getActiveSessions(listener)
    } catch (e: SecurityException) {
      error("Music: notification access is missing, the phone's playback cannot be read")
      return null
    }
    if (controllers.isEmpty()) return null
    return controllers.firstOrNull { it.playbackState?.state == PLAYBACK_STATE_PLAYING } ?: controllers.first()
  }

  private fun setVolume(level: Int) {
    val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    val usable = MusicLink.volumeOf(level, max, minVolume())
    if (usable == null) {
      error("Music: the watch sent volume $level outside the phone's ${minVolume()}..$max, ignored")
      return
    }
    log("Music: volume set to $usable of $max by the watch")
    audio.setStreamVolume(AudioManager.STREAM_MUSIC, usable, 0)
  }

  /** `AudioManager.getStreamMinVolume` needs API 28; older devices have none, so 0. */
  private fun minVolume(): Int =
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
      audio.getStreamMinVolume(AudioManager.STREAM_MUSIC)
    } else {
      0
    }

  /** Android wants a media key as a down event and an up event. */
  private fun sendMediaKey(keyCode: Int) {
    val now = SystemClock.uptimeMillis()
    audio.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0))
    audio.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0))
  }

  private fun keyCodeOf(action: MusicAction): Int = when (action) {
    MusicAction.PLAY -> KeyEvent.KEYCODE_MEDIA_PLAY
    MusicAction.PAUSE -> KeyEvent.KEYCODE_MEDIA_PAUSE
    MusicAction.PREVIOUS -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
    MusicAction.NEXT -> KeyEvent.KEYCODE_MEDIA_NEXT
    MusicAction.VOLUME_UP -> KeyEvent.KEYCODE_VOLUME_UP
    MusicAction.VOLUME_DOWN -> KeyEvent.KEYCODE_VOLUME_DOWN
  }

  private companion object {
    /** `android.media.session.PlaybackState.STATE_NONE`. */
    const val PLAYBACK_STATE_NONE = 0

    /** `android.media.session.PlaybackState.STATE_PLAYING`. */
    const val PLAYBACK_STATE_PLAYING = 3
  }
}
