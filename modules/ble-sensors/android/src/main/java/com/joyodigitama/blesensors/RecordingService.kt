package com.joyodigitama.blesensors

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.IBinder

/**
 * Keeps the process alive while a workout is recorded: a foreground service with an ongoing notification. The work (sensor links,
 * GPS) happens elsewhere; this only holds the process in the foreground. [WorkoutSession] starts and stops it and owns the wake lock.
 */
class RecordingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // A notification button: tell JS (it owns the recorder) and leave the service as it is.
    RecordingNotificationSpec.Control.fromAction(intent?.action)?.let { control ->
      if (WorkoutSession.isActive) WorkoutSession.control(control) else stopSelf()
      return START_NOT_STICKY
    }
    val notification = WorkoutSession.notification(this)
    val types = ForegroundTypes.compute(
      Build.VERSION.SDK_INT,
      WorkoutSession.gps(),
      checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED,
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
        checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED,
    )
    try {
      if (types != 0) startForeground(RecordingNotification.ID, notification, types) else startForeground(RecordingNotification.ID, notification)
      WorkoutSession.serviceStarted()
      // The session ended while this start was queued: Android still wants startForeground before the stop.
      if (!WorkoutSession.isActive) stopSelf()
    } catch (e: RuntimeException) {
      // SecurityException (missing permission for the type), ForegroundServiceStartNotAllowedException, IllegalStateException.
      // The session carries on without this service (GPS, wake lock), so only the service stops, not the session.
      WorkoutSession.serviceFailed(e)
      stopSelf()
    }
    // A session cannot survive the process: the JS state it belongs to is gone with it.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    WorkoutSession.serviceDestroyed(this)
    super.onDestroy()
  }
}

internal object RecordingNotification {
  const val ID = 4707

  /** Copies the [RecordingNotificationSpec] into a notification: tap opens `openUrl`, buttons go back to [RecordingService]. */
  fun build(context: Context, spec: RecordingNotificationSpec.Spec, openUrl: String?): Notification {
    ensureChannel(context)
    val builder = Notification.Builder(context, spec.channelId)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(spec.title)
      .setContentText(spec.text)
      .setOngoing(spec.ongoing)
      .setOnlyAlertOnce(spec.onlyAlertOnce)
      .setVisibility(spec.visibility)
      .setCategory(spec.category)
    val base = spec.chronometerBase
    if (base != null) {
      builder.setWhen(base).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(false)
    } else {
      builder.setShowWhen(false).setUsesChronometer(false)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    for (action in spec.actions) {
      val intent = Intent(context, RecordingService::class.java).setAction(action.control.action)
      val pending = PendingIntent.getService(context, action.control.ordinal + 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      builder.addAction(Notification.Action.Builder(Icon.createWithResource(context, actionIcon(action.control)), action.title, pending).build())
    }
    contentIntent(context, openUrl)?.let { open ->
      builder.setContentIntent(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    return builder.build()
  }

  private fun ensureChannel(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val spec = RecordingNotificationSpec.channel
    manager.createNotificationChannel(
      NotificationChannel(RecordingNotificationSpec.CHANNEL_ID, RecordingNotificationSpec.CHANNEL_NAME, spec.importance).apply {
        lockscreenVisibility = spec.lockscreenVisibility
        setShowBadge(spec.badge)
        if (!spec.sound) setSound(null, null)
        enableVibration(spec.vibration)
      },
    )
    // The LOW channel of earlier builds: its importance cannot be raised, and a leftover would keep showing in the app's settings.
    manager.deleteNotificationChannel(RecordingNotificationSpec.LEGACY_CHANNEL_ID)
  }

  private fun actionIcon(control: RecordingNotificationSpec.Control): Int = when (control) {
    RecordingNotificationSpec.Control.PAUSE -> android.R.drawable.ic_media_pause
    RecordingNotificationSpec.Control.RESUME -> android.R.drawable.ic_media_play
    RecordingNotificationSpec.Control.LAP -> android.R.drawable.ic_menu_add
  }

  /**
   * What a tap opens: the app's own link (`openUrl`, see [NotificationTarget]) so it lands on the live screen whatever screen was last open,
   * else the launcher activity, which resumes the last screen. The link needs an activity of this app that handles it; without one the launcher is used.
   */
  private fun contentIntent(context: Context, openUrl: String?): Intent? {
    NotificationTarget.viewUrl(openUrl)?.let { url ->
      val view = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (context.packageManager.resolveActivity(view, 0) != null) return view
    }
    return context.packageManager.getLaunchIntentForPackage(context.packageName)
  }

  /** The status bar icon lives in another module (huawei-wear's `ic_stat_joyofit`); the app icon is the fallback. */
  private fun smallIcon(context: Context): Int {
    val statIcon = context.resources.getIdentifier("ic_stat_joyofit", "drawable", context.packageName)
    if (statIcon != 0) return statIcon
    val appIcon = context.applicationInfo.icon
    return if (appIcon != 0) appIcon else android.R.drawable.ic_dialog_info
  }
}
