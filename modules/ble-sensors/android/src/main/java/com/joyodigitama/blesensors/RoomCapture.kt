package com.joyodigitama.blesensors

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.io.File

/**
 * Overnight capture of the bedroom thermometer with the app closed: [RoomScanService] keeps a low-power, address-filtered scan running
 * until an end time and appends what it hears to a file ([RoomAdvertLog]); JS reads that file when the app opens. This object is the
 * process-wide side the Expo module talks to: it validates a request, keeps the request in preferences (the service is sticky and
 * reads it back after the system restarted it), starts and stops the service, and hands the file's contents to JS.
 * Android only; iOS has no counterpart (see docs/sleep-insights.md).
 */
internal object RoomCapture {
  private const val PREFS = "joyofit_room_capture"
  private const val LOG_PATH = "room/adverts.log"
  private const val END_REQUEST = 1
  private const val USER_STOP_REQUEST = 2
  private const val USER_STOPPED_AT = "userStoppedAt"
  private val CONFIG_KEYS = listOf("ids", "untilMs", "title", "text", "stopLabel")

  /** The service is in the foreground right now. */
  @Volatile var serviceUp = false

  @Volatile private var log: RoomAdvertLog? = null

  fun log(context: Context): RoomAdvertLog =
    log ?: synchronized(this) { log ?: RoomAdvertLog(File(context.applicationContext.filesDir, LOG_PATH)).also { log = it } }

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun loadConfig(context: Context): RoomCaptureConfig? {
    val p = prefs(context)
    return RoomCaptureConfig.fromMap(
      mapOf("ids" to p.getString("ids", null), "untilMs" to p.getString("untilMs", null), "title" to p.getString("title", null),
        "text" to p.getString("text", null), "stopLabel" to p.getString("stopLabel", null)),
    )
  }

  private fun saveConfig(context: Context, config: RoomCaptureConfig) {
    val editor = prefs(context).edit()
    for ((key, value) in config.toMap()) editor.putString(key, value)
    editor.apply()
  }

  /** Forgets the request; the time of the person's last stop stays (it is not part of the request). */
  fun clearConfig(context: Context) {
    val editor = prefs(context).edit()
    for (key in CONFIG_KEYS) editor.remove(key)
    editor.apply()
  }

  /** The person ended the capture (the Stop button, or `stopRoomCapture`): the app must not start it again by itself tonight. */
  fun markUserStop(context: Context) {
    prefs(context).edit().putString(USER_STOPPED_AT, System.currentTimeMillis().toString()).apply()
  }

  /** The PendingIntent that tells the service to stop at the end time; the same one cancels it. */
  fun endIntent(context: Context): PendingIntent =
    PendingIntent.getService(
      context,
      END_REQUEST,
      Intent(context, RoomScanService::class.java).setAction(RoomScanService.ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  /** The notification's Stop button: like [endIntent], and the stop counts as the person's. */
  fun userStopIntent(context: Context): PendingIntent =
    PendingIntent.getService(
      context,
      USER_STOP_REQUEST,
      Intent(context, RoomScanService::class.java).setAction(RoomScanService.ACTION_STOP_BY_USER),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  fun cancelEnd(context: Context) {
    context.getSystemService(AlarmManager::class.java)?.cancel(endIntent(context))
  }

  /**
   * Starts listening for [ids] (Bluetooth addresses) until [untilMs] (epoch ms, at most 18 h ahead), or replaces a running capture's request.
   * Call it while the app is visible: Android 12 and later refuse to start the foreground service from the background (ERR_SERVICE_NOT_ALLOWED).
   */
  fun start(context: Context, hub: SensorHub, ids: List<String>, untilMs: Long, title: String, text: String, stopLabel: String) {
    val addresses = RoomScanLogic.scanAddresses(ids)
    if (addresses.isEmpty()) throw SensorException(ErrorCodes.INVALID_ARGUMENT, "No Bluetooth address to listen to")
    val end = RoomScanLogic.windowEnd(System.currentTimeMillis(), untilMs) ?: throw SensorException(ErrorCodes.INVALID_ARGUMENT, "The end time is not in the future")
    hub.requireScanReady()
    val types = ForegroundTypes.compute(Build.VERSION.SDK_INT, false, false, hasBluetoothConnect(context))
    if (types == 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      throw SensorException(ErrorCodes.SERVICE_NOT_ALLOWED, "No foreground service type applies: BLUETOOTH_CONNECT is not granted")
    }
    prefs(context).edit().remove(USER_STOPPED_AT).apply()
    saveConfig(context, RoomCaptureConfig(addresses, end, title, text, stopLabel))
    try {
      context.startForegroundService(Intent(context, RoomScanService::class.java))
    } catch (e: RuntimeException) {
      // SecurityException, ForegroundServiceStartNotAllowedException (Android 12+, app not visible) and IllegalStateException.
      clearConfig(context)
      throw SensorException(ErrorCodes.SERVICE_NOT_ALLOWED, "Android refused the room scan service: ${e.message}", e)
    }
  }

  /** Stops the capture at the person's request and forgets its request. What it already heard stays in the file for JS to read. Idempotent. */
  fun stop(context: Context) {
    markUserStop(context)
    cancelEnd(context)
    clearConfig(context)
    context.stopService(Intent(context, RoomScanService::class.java))
  }

  /** `{ active, untilMs, ids, userStoppedAt }` of `RoomCaptureState` in `BleSensors.types.ts`. */
  fun state(context: Context): Map<String, Any?> {
    val config = loadConfig(context)
    val active = serviceUp && config != null && config.untilMs > System.currentTimeMillis()
    val stoppedAt = prefs(context).getString(USER_STOPPED_AT, null)?.toLongOrNull()
    return mapOf(
      "active" to active,
      "untilMs" to if (active) config?.untilMs?.toDouble() else null,
      "ids" to if (active) config?.ids else emptyList<String>(),
      "userStoppedAt" to stoppedAt?.toDouble(),
    )
  }

  /** The kept advertisements as `RoomAdvert` objects of `BleSensors.types.ts`, oldest first. */
  fun adverts(context: Context): List<Map<String, Any?>> =
    log(context).readAll().map { mapOf("id" to it.id, "ts" to it.ts.toDouble(), "uuid" to it.uuid, "hex" to it.hex) }

  fun clearAdverts(context: Context, upToTs: Long) = log(context).removeUpTo(upToTs)

  private fun hasBluetoothConnect(context: Context) =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
}
