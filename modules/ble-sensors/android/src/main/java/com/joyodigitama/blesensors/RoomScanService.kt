package com.joyodigitama.blesensors

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log

/**
 * The bedtime-window scan of the bedroom thermometer (see [RoomCapture]). A foreground service of type connectedDevice keeps the process
 * alive overnight with an ongoing notification; inside it one low-power scan filtered by the sensors' addresses (the filter runs in the
 * Bluetooth controller, so it works with the screen off) delivers results in batches [RoomScanLogic.REPORT_DELAY_MS] apart. Each
 * kept advertisement (one per sensor per 5 minutes) goes to a file for JS to decode when the app opens: the service holds no JS and no
 * wake lock. It ends at the requested time (an inexact alarm, plus a check on every batch) or on the notification's Stop button.
 *
 * Sticky: when the system kills the process overnight it restarts the service, which reads its request back from preferences and carries on
 * while the end time is still ahead.
 */
@SuppressLint("MissingPermission")
class RoomScanService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var callback: ScanCallback? = null
  private var config: RoomCaptureConfig? = null
  private val throttle = RoomAdvertThrottle()
  private val miThrottle = MiBeaconThrottle()
  private var retryAttempt = 0
  private var receiverRegistered = false

  private val retry = Runnable { beginScan() }

  private val radio = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
      when (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)) {
        // The controller drops the scan with the radio; start it again when the radio is back.
        BluetoothAdapter.STATE_OFF -> {
          callback = null
          handler.removeCallbacks(retry)
        }
        BluetoothAdapter.STATE_ON -> beginScan()
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action
    if (action == ACTION_STOP || action == ACTION_STOP_BY_USER) {
      if (action == ACTION_STOP_BY_USER) RoomCapture.markUserStop(this)
      finish()
      return START_NOT_STICKY
    }
    val now = System.currentTimeMillis()
    val request = RoomCapture.loadConfig(this)?.takeIf { RoomScanLogic.windowEnd(now, it.untilMs) != null }
    // Android wants startForeground after startForegroundService even when the service is about to stop.
    if (!enterForeground(request)) {
      finish()
      return START_NOT_STICKY
    }
    if (request == null) {
      finish()
      return START_NOT_STICKY
    }
    config = request
    throttle.clear()
    miThrottle.clear()
    retryAttempt = 0
    registerRadioReceiver()
    getSystemService(AlarmManager::class.java)?.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, request.untilMs, RoomCapture.endIntent(this))
    beginScan()
    return START_STICKY
  }

  override fun onDestroy() {
    endScan()
    handler.removeCallbacks(retry)
    if (receiverRegistered) {
      receiverRegistered = false
      try {
        unregisterReceiver(radio)
      } catch (e: IllegalArgumentException) {
        // Never registered.
      }
    }
    RoomCapture.serviceUp = false
    super.onDestroy()
  }

  /** Ends the capture: no scan, no alarm, no request to resume, no notification. */
  private fun finish() {
    RoomCapture.cancelEnd(this)
    RoomCapture.clearConfig(this)
    config = null
    endScan()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun enterForeground(request: RoomCaptureConfig?): Boolean {
    val notification = RoomNotification.build(this, request?.title.orEmpty(), request?.text.orEmpty(), request?.stopLabel.orEmpty())
    val types = ForegroundTypes.compute(
      Build.VERSION.SDK_INT,
      false,
      false,
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED,
    )
    return try {
      if (types != 0) startForeground(RoomNotification.ID, notification, types) else startForeground(RoomNotification.ID, notification)
      RoomCapture.serviceUp = true
      true
    } catch (e: RuntimeException) {
      // SecurityException (the type's permission is missing) and ForegroundServiceStartNotAllowedException (a restart from the background).
      Log.w(TAG, "Room scan could not enter the foreground: ${e.message}")
      false
    }
  }

  private fun registerRadioReceiver() {
    if (receiverRegistered) return
    val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
    // A system broadcast: delivered to a receiver that is not exported.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(radio, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(radio, filter)
    }
    receiverRegistered = true
  }

  private fun beginScan() {
    handler.removeCallbacks(retry)
    val request = config ?: return
    endScan()
    val scanner = getSystemService(BluetoothManager::class.java)?.adapter?.takeIf { it.state == BluetoothAdapter.STATE_ON }?.bluetoothLeScanner
    // Radio off: the receiver starts the scan when it comes back.
    if (scanner == null) return
    val filters = request.ids.map { ScanFilter.Builder().setDeviceAddress(it).build() }
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
      .setReportDelay(RoomScanLogic.REPORT_DELAY_MS)
      .build()
    val next = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) = keep(listOf(result))

      override fun onBatchScanResults(results: MutableList<ScanResult>) = keep(results)

      override fun onScanFailed(errorCode: Int) {
        if (callback !== this) return
        Log.w(TAG, "Room scan failed, error $errorCode")
        callback = null
        handler.postDelayed(retry, Backoff.nextDelayMs(retryAttempt++))
      }
    }
    try {
      scanner.startScan(filters, settings, next)
      callback = next
      retryAttempt = 0
    } catch (e: SecurityException) {
      Log.w(TAG, "Room scan: scan permission was taken away: ${e.message}")
      finish()
    } catch (e: IllegalStateException) {
      // Bluetooth turned off between the check and the call: the receiver restarts the scan.
      Log.w(TAG, "Room scan: ${e.message}")
    }
  }

  private fun endScan() {
    val current = callback ?: return
    callback = null
    try {
      getSystemService(BluetoothManager::class.java)?.adapter?.bluetoothLeScanner?.stopScan(current)
    } catch (e: SecurityException) {
      Log.w(TAG, "Room scan stop: ${e.message}")
    } catch (e: IllegalStateException) {
      // Bluetooth turned off meanwhile: the scan is gone already.
    }
  }

  /** Writes the advertisements worth keeping to the file, oldest first, and ends the capture when its time is up. */
  private fun keep(results: List<ScanResult>) {
    val request = config ?: return
    val nowMs = System.currentTimeMillis()
    val nowElapsed = SystemClock.elapsedRealtimeNanos()
    val log = RoomCapture.log(this)
    for (result in results.sortedBy { it.timestampNanos }) {
      val address = result.device.address.uppercase()
      if (address !in request.ids) continue
      val serviceData = HashMap<String, String>()
      result.scanRecord?.serviceData?.forEach { (uuid, bytes) -> serviceData[ScaleLogic.normalize(uuid.uuid)] = SensorProfile.toHex(bytes) }
      val (uuid, hex) = RoomScanLogic.pickServiceData(serviceData) ?: continue
      val heardAt = RoomScanLogic.heardAtMs(nowMs, nowElapsed, result.timestampNanos)
      val keep = if (uuid == RoomScanLogic.SERVICE_MIBEACON) miThrottle.shouldKeep(address, heardAt, hex) else throttle.shouldKeep(address, heardAt)
      if (!keep) continue
      try {
        log.append(RoomAdvert(address, heardAt, uuid, hex))
      } catch (e: java.io.IOException) {
        Log.w(TAG, "Room scan could not write an advertisement: ${e.message}")
      }
    }
    if (nowMs >= request.untilMs) finish()
  }

  companion object {
    private const val TAG = "BleSensors"

    /** The action of the end-time alarm. */
    const val ACTION_STOP = "com.joyodigitama.blesensors.ROOM_SCAN_STOP"

    /** The action of the notification's Stop button: the same stop, remembered as the person's. */
    const val ACTION_STOP_BY_USER = "com.joyodigitama.blesensors.ROOM_SCAN_STOP_BY_USER"
  }
}

/** The ongoing notification of [RoomScanService]: the text JS gave, a Stop button, a tap that opens the app. */
internal object RoomNotification {
  const val ID = 4708
  const val CHANNEL_ID = "room_capture"
  const val CHANNEL_NAME = "Room thermometer"

  fun build(context: Context, title: String, text: String, stopLabel: String): Notification {
    val manager = context.getSystemService(NotificationManager::class.java)
    manager?.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
        setSound(null, null)
        enableVibration(false)
      },
    )
    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(RecordingNotification.smallIcon(context))
      .setContentTitle(title.ifEmpty { "JoyoFit" })
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_SERVICE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    if (stopLabel.isNotEmpty()) {
      builder.addAction(Notification.Action.Builder(Icon.createWithResource(context, android.R.drawable.ic_menu_close_clear_cancel), stopLabel, RoomCapture.userStopIntent(context)).build())
    }
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { open ->
      builder.setContentIntent(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }
    return builder.build()
  }
}
