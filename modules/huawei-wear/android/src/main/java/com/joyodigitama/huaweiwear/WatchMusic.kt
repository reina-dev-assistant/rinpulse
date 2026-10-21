// Derived from Gadgetbridge (AGPL-3.0-or-later; see NOTICE):
// service/devices/huawei/AsynchronousResponse.handleMusicControls, requests/SetMusicRequest and util/MediaManager.
//
// Remote music control for the watch: the phone reads what is playing, pushes it as MusicInfo (25/02) and answers
// the watch's buttons (25/03) by driving the phone player.
//
// The Watch Fit 1 has no on-board music storage (Huawei's own spec: "Smartphone music control: yes", "On-board
// music storage: no"), so this is the whole feature: the phone plays, the watch shows the track and sends buttons.
//
// Three things have to be true for a track to reach the watch, and all three are easy to get wrong:
//   1. something must *tell us* the phone's playback changed (the MediaSession listener below - the watch asking
//      with `25/01` is a fallback, not the main path), and
//   2. that read is legal (notification access, which the app already has), and
//   3. the watch lists `25/02`.
// Reading the session uses the notification-listener access the app already holds, so nothing new is asked of the
// user and NotificationPolicy keeps skipping CATEGORY_TRANSPORT notifications. The decisions live in [MusicLink],
// which is Android-free and unit tested; this file is only the Android plumbing around it.
package com.joyodigitama.huaweiwear

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.database.ContentObserver
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.service.notification.StatusBarNotification
import android.view.KeyEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.MusicControl

/**
 * The watch's music screen: the phone's track goes out as `25/02`, and the watch's buttons (`25/03`) drive the
 * phone. Works from the background service, without the UI, like the rest of the watch features.
 *
 * While a watch is connected this listens to the phone's Android media sessions, so a track change on the phone is
 * pushed without the watch having to ask. Without that listener nothing would ever be sent on its own: `25/01`
 * only arrives when the wearer opens the watch's music screen, which is why the screen used to stay empty.
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
  private val mediaSessions = appContext.getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager

  /** The notification listener component: what makes the session reads legal without a new permission. */
  private val listenerComponent = ComponentName(appContext, WatchNotificationListener::class.java)

  private var attached: HuaweiSession? = null
  private val subscriptions = ArrayList<AutoCloseable>()

  /** The last track+state+volume sent, so a repeat of the same one is not re-sent (GB notes it gets duplicates). */
  private var lastSent: String? = null

  /** The phone's music volume as last read, so the settings observer only pushes when it really changed. */
  private var lastVolume: Int? = null

  /** Coalesces a burst of change callbacks (metadata and state usually arrive together). */
  private var pending: Job? = null

  private val main = Handler(Looper.getMainLooper())

  /** The sessions being watched, with the callbacks to detach. Rebuilt whenever the active list changes. */
  private val watched = ArrayList<Pair<MediaController, MediaController.Callback>>()

  private var listening = false

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
        listen()
      }
      LinkState.DISCONNECTED -> {
        detach()
        stopListening()
      }
      else -> Unit
    }
  }

  private fun detach() {
    subscriptions.forEach { it.close() }
    subscriptions.clear()
    attached = null
    synchronized(this) { lastSent = null }
  }

  /** The phone-side half: what tells us the music changed. Only while a watch is connected. */
  private fun listen() {
    if (!settings.musicEnabled) {
      log("Music: switched off in the app, the phone's playback is not watched")
      return
    }
    val manager = mediaSessions
    if (manager == null) {
      error("Music: this Android has no media session service, the phone's playback cannot be watched")
      return
    }
    if (listening) return
    listening = true
    main.post {
      try {
        manager.addOnActiveSessionsChangedListener(sessionsChanged, listenerComponent)
        onActiveSessions(manager.getActiveSessions(listenerComponent))
        // Hardware volume buttons and the phone's own slider do not change the session, so watch the setting.
        appContext.contentResolver.registerContentObserver(
          Settings.System.CONTENT_URI,
          true,
          volumeObserver,
        )
      } catch (e: SecurityException) {
        listening = false
        error("Music: notification access is missing, so the phone's playback cannot be read")
      } catch (e: Exception) {
        listening = false
        error("Music: the phone's playback could not be watched: ${e.message}")
      }
    }
  }

  private fun stopListening() {
    if (!listening) return
    listening = false
    pending?.cancel()
    pending = null
    main.post {
      try {
        mediaSessions?.removeOnActiveSessionsChangedListener(sessionsChanged)
        watched.forEach { (controller, callback) -> controller.unregisterCallback(callback) }
        watched.clear()
        appContext.contentResolver.unregisterContentObserver(volumeObserver)
      } catch (e: Exception) {
        error("Music: stopping the playback watch failed: ${e.message}")
      }
    }
  }

  /** A new session appeared or one went away: re-attach to the current list, then push whatever it holds. */
  private fun onActiveSessions(controllers: List<MediaController>?) {
    watched.forEach { (controller, callback) -> controller.unregisterCallback(callback) }
    watched.clear()
    controllers.orEmpty().forEach { controller ->
      val callback = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) = pushSoon()

        override fun onPlaybackStateChanged(state: PlaybackState?) = pushSoon()

        @Suppress("OVERRIDE_DEPRECATION")
        override fun onSessionDestroyed() = pushSoon()
      }
      controller.registerCallback(callback, main)
      watched += controller to callback
    }
    if (watched.isEmpty()) log("Music: the phone has no media session right now")
    pushSoon()
  }

  private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { controllers ->
    onActiveSessions(controllers)
  }

  /** The music volume changed on the phone (slider or hardware keys), which no session callback reports. */
  private val volumeObserver = object : ContentObserver(main) {
    override fun onChange(selfChange: Boolean) {
      if (audio.getStreamVolume(AudioManager.STREAM_MUSIC) != lastVolume) pushSoon()
    }
  }

  /**
   * Called for every posted notification. A media notification is a second, cheap way to notice a track change:
   * players update it when the song or state changes, and it is already arriving here.
   */
  fun onNotification(sbn: StatusBarNotification) {
    if (!settings.musicEnabled) return
    val notification = sbn.notification ?: return
    val isTransport = notification.category == Notification.CATEGORY_TRANSPORT
    val hasSession = notification.extras?.containsKey(Notification.EXTRA_MEDIA_SESSION) == true
    if (!MusicLink.isMediaNotification(isTransport, hasSession)) return
    pushSoon()
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
        ack(MusicControl.CONTROL)
        // GB waits 100 ms for the player to change state before reading it back, so the watch is not told the
        // state it just left. The session listener pushes again if the player takes longer.
        delay(CONTROL_SETTLE_MS)
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

  /**
   * JS `setMusicEnabled`: stored for [push], and turning it on watches the phone and tells the watch what is
   * playing right now instead of waiting for the next track change.
   */
  fun setEnabled(enabled: Boolean) {
    settings.musicEnabled = enabled
    if (!enabled) {
      stopListening()
      return
    }
    listen()
    scope.launch {
      try {
        push(force = true)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        error("Music: pushing the current track after switching it on failed: ${e.message}")
      }
    }
  }

  // Phone -> watch: what is playing

  /** Coalesces the change callbacks that arrive together, so one track change is one packet. */
  private fun pushSoon() {
    if (!settings.musicEnabled) return
    pending?.cancel()
    pending = scope.launch {
      delay(PUSH_SETTLE_MS)
      try {
        push()
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        error("Music: pushing the track failed: ${e.message}")
      }
    }
  }

  /**
   * Pushes the current track and state. [force] skips the "same as last time" check, which `25/01` needs: the
   * watch just opened its screen and has to be told even if nothing changed since the last push.
   */
  suspend fun push(force: Boolean = false) {
    val session = attached ?: return
    if (!settings.musicEnabled) return
    if (!supported()) return
    val maxVolume = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceIn(0, 255)
    val volume = audio.getStreamVolume(AudioManager.STREAM_MUSIC).coerceIn(0, 255)
    lastVolume = volume
    val track = track() ?: run {
      log("Music: nothing is playing on the phone, nothing sent")
      return
    }
    val key = MusicLink.changeKey(track, maxVolume, volume)
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
      maxVolume.toByte(),
      volume.toByte(),
    )
    log("Music: sending \"${track.song}\" by \"${track.artist}\" (state ${track.playState}, volume $volume/$maxVolume)")
    session.send(packet, "MusicInfo 25/02")
  }

  // Android plumbing

  /** The active session's track and state, or null when the phone has nothing to show. */
  private fun track(): MusicTrack? {
    val session = playingSession() ?: return null
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
  private fun playingSession(): MediaController? {
    val manager = mediaSessions ?: return null
    val controllers = try {
      manager.getActiveSessions(listenerComponent)
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
    lastVolume = usable
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

    /** GB waits this long after a button before reading the player back. */
    const val CONTROL_SETTLE_MS = 100L

    /** Metadata and playback state usually change together; one packet is enough. */
    const val PUSH_SETTLE_MS = 150L
  }
}
