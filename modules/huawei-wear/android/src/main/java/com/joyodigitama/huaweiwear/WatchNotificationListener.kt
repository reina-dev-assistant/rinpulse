package com.joyodigitama.huaweiwear

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Receives every posted notification once the user grants notification access and hands it to the
 * [NotificationForwarder]. The system binds this service on its own, so forwarding works while the
 * app UI is closed as long as the link is up.
 */
class WatchNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val runtime = WearRuntime.get(this)
    // The player's media notification is the cheapest "the track changed" signal there is, and the session
    // callbacks miss players that only update their notification. Never forwarded, only read as a trigger.
    runtime.music.onNotification(sbn)
    // Call notifications (VoIP) ring the watch as calls and are never forwarded as ordinary notifications.
    if (runtime.voipCalls.onPosted(sbn)) return
    runtime.forwarder.onPosted(sbn)
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification) {
    val runtime = WearRuntime.get(this)
    runtime.voipCalls.onRemoved(sbn)
    runtime.forwarder.onRemoved(sbn)
  }
}
