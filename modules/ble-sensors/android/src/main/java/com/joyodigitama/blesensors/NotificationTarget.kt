package com.joyodigitama.blesensors

/**
 * Where tapping the recording notification goes. JS passes the link of the live screen (`openUrl` in `WorkoutSessionOptions`, `LIVE_URL` in
 * `src/features/record/liveRoute.ts`); the notification opens it as a VIEW intent for this app, so the tap lands on the same screen as back
 * from the live screen. Pure string logic, so it runs in plain JVM tests (Intent and Uri do not).
 */
internal object NotificationTarget {
  /** The scheme of the app (`scheme` in app.json); a link of any other scheme is never opened from the notification. */
  const val SCHEME = "joyofit"

  /** The link to open, or null when there is none or it is not one of the app's own: the notification then opens the launcher activity as before. */
  fun viewUrl(openUrl: String?): String? {
    val url = openUrl?.trim()
    if (url.isNullOrEmpty()) return null
    val prefix = "$SCHEME://"
    if (url.length <= prefix.length || !url.startsWith(prefix, ignoreCase = true)) return null
    return url
  }
}
