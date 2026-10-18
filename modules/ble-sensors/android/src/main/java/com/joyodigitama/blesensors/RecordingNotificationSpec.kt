package com.joyodigitama.blesensors

import android.app.Notification
import android.app.NotificationManager
import android.os.Build
import java.util.Locale

/**
 * Everything the recording notification is made of, decided without Android objects so plain JVM tests can pin it down; [RecordingNotification]
 * only copies a [Spec] into a `Notification.Builder`.
 */
internal object RecordingNotificationSpec {
  /** A channel's importance cannot change once created, so the earlier LOW channel was left and `v2` made. */
  const val CHANNEL_ID = "recording_v2"
  const val LEGACY_CHANNEL_ID = "workout_recording"
  const val CHANNEL_NAME = "Workout recording"

  /** DEFAULT is what shows on the lock screen like a fitness tracker's; it never makes a sound because the channel has none (see [Channel]). */
  const val CHANNEL_IMPORTANCE = NotificationManager.IMPORTANCE_DEFAULT
  const val LOCKSCREEN_VISIBILITY = Notification.VISIBILITY_PUBLIC

  /** What the channel is created with: no sound, no vibration, no badge, visible on the lock screen. */
  data class Channel(val importance: Int, val lockscreenVisibility: Int, val sound: Boolean, val vibration: Boolean, val badge: Boolean)

  val channel = Channel(CHANNEL_IMPORTANCE, LOCKSCREEN_VISIBILITY, sound = false, vibration = false, badge = false)

  private const val ACTION_PREFIX = "com.joyodigitama.blesensors.CONTROL_"
  private const val SEPARATOR = " · "

  enum class Control(val wire: String) {
    PAUSE("pause"),
    RESUME("resume"),
    LAP("lap");

    /** The intent action of the notification button, handled by [RecordingService]. */
    val action: String get() = ACTION_PREFIX + wire

    companion object {
      fun fromAction(action: String?): Control? = values().firstOrNull { it.action == action }
    }
  }

  /** The texts of the controls, from JS (the app's language); without them the notification has no buttons. */
  class Controls(val locale: String, val paused: String, val pause: String, val resume: String, val lap: String)

  class Action(val control: Control, val title: String)

  class Spec(
    val channelId: String,
    val title: String,
    val text: String,
    val category: String,
    val visibility: Int,
    val ongoing: Boolean,
    val onlyAlertOnce: Boolean,
    /** The time shown is a chronometer counting from [chronometerBase] (ms, wall clock); null: nothing counts (paused or no clock yet). */
    val chronometerBase: Long?,
    val actions: List<Action>,
  )

  fun spec(title: String, startText: String, progress: RecordingProgress, nowMs: Long, controls: Controls?, sdk: Int): Spec {
    val category = if (sdk >= Build.VERSION_CODES.S) Notification.CATEGORY_WORKOUT else Notification.CATEGORY_SERVICE
    if (!progress.hasProgress) {
      return Spec(CHANNEL_ID, title, startText, category, LOCKSCREEN_VISIBILITY, true, true, null, emptyList())
    }
    val elapsedMs = progress.elapsedMs(nowMs)
    val locale = Locale.forLanguageTag(controls?.locale ?: "en")
    val parts = ArrayList<String>(4)
    if (!progress.running) {
      controls?.paused?.let(parts::add)
      parts.add(formatElapsed(elapsedMs / 1000))
    }
    formatDistance(progress.distanceM, locale)?.let(parts::add)
    progress.hr?.let { parts.add("$it bpm") }
    val text = if (parts.isEmpty()) startText else parts.joinToString(SEPARATOR)
    val actions = when {
      controls == null -> emptyList()
      progress.running -> listOf(Action(Control.PAUSE, controls.pause), Action(Control.LAP, controls.lap))
      else -> listOf(Action(Control.RESUME, controls.resume))
    }
    return Spec(
      CHANNEL_ID, title, text, category, LOCKSCREEN_VISIBILITY, true, true,
      if (progress.running) nowMs - elapsedMs else null, actions,
    )
  }

  /** `1:05:09` or `42:10`, as the app's `formatElapsed`. */
  fun formatElapsed(totalSec: Long): String {
    val sec = totalSec.coerceAtLeast(0)
    val h = sec / 3600
    val m = (sec % 3600) / 60
    val s = sec % 60
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s) else String.format(Locale.ROOT, "%d:%02d", m, s)
  }

  /** Under 10 m nothing is shown yet, as in the app. */
  fun formatDistance(meters: Double, locale: Locale): String? =
    if (meters >= 10.0) String.format(locale, "%.2f km", meters / 1000.0) else null
}
