package com.joyodigitama.blesensors

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

/**
 * The phone side of a recorded workout: the [RecordingService] that keeps the process alive, a partial wake lock, and the GPS
 * fixes (plus the phone's step counter when asked). Process-wide like [SensorHub], because the service and the recording outlive the JS runtime. Android may refuse the
 * service (see [SessionPolicy]); the fixes and the wake lock then run without it and `start` reports ERR_SERVICE_NOT_ALLOWED once they do.
 */
internal object WorkoutSession {
  private const val TAG = "BleSensors"
  private const val WAKE_LOCK_TAG = "joyofit:recording"
  private const val START_TIMEOUT_MS = 10_000L

  /** How often the service re-posts the notification by itself (the distance); the clock needs no update, it is a chronometer. */
  private const val REFRESH_MS = 15_000L

  private val lock = Any()

  @Volatile var isActive = false
    private set

  private var title = ""
  private var text = ""
  private var gps = false
  private var openUrl: String? = null
  private var controls: RecordingNotificationSpec.Controls? = null
  private val progress = RecordingProgress()
  private var appContext: Context? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var location: WorkoutLocation? = null
  private var steps: WorkoutSteps? = null

  /** Completed by the service once `startForeground` succeeded or was refused. */
  @Volatile private var pending: CompletableDeferred<Unit>? = null

  /** The service is in the foreground right now; only then is there a notification to update and a service whose end ends the session. */
  @Volatile private var serviceUp = false

  private val handler by lazy { Handler(Looper.getMainLooper()) }

  private val refresh = Runnable {
    appContext?.let { notifyNow(it) }
    scheduleRefresh()
  }

  fun gps(): Boolean = synchronized(lock) { gps }

  /** The notification for the session as it is right now. */
  fun notification(context: Context): Notification = synchronized(lock) {
    val spec = RecordingNotificationSpec.spec(title, text, progress, System.currentTimeMillis(), controls, Build.VERSION.SDK_INT)
    RecordingNotification.build(context, spec, openUrl)
  }

  /**
   * Starts the session, or updates the options of a running one. Returns when the service is in the foreground and GPS runs. When Android
   * refuses the service, GPS and the wake lock start anyway and the call then throws ERR_SERVICE_NOT_ALLOWED.
   */
  suspend fun start(context: Context, title: String, text: String, gps: Boolean, openUrl: String?, controls: RecordingNotificationSpec.Controls?, steps: Boolean = false) {
    if (gps && !hasFineLocation(context)) {
      throw SensorException(ErrorCodes.LOCATION_PERMISSION, "Precise location permission is not granted")
    }
    val types = ForegroundTypes.compute(Build.VERSION.SDK_INT, gps, hasFineLocation(context), hasBluetoothConnect(context))

    val ready = CompletableDeferred<Unit>()
    val wasActive = synchronized(lock) {
      this.title = title
      this.text = text
      this.gps = gps
      this.openUrl = openUrl
      this.controls = controls
      this.appContext = context.applicationContext
      if (!isActive) progress.reset()
      pending = ready
      isActive.also {
        isActive = true
        acquireWakeLock(context)
      }
    }
    var serviceError: SensorException? = null
    if (types == 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      serviceError = SensorException(ErrorCodes.SERVICE_NOT_ALLOWED, "No foreground service type applies: the workout has no GPS and BLUETOOTH_CONNECT is not granted")
    } else {
      try {
        // startForegroundService itself throws when Android 12+ does not allow a start from the background.
        context.startForegroundService(Intent(context, RecordingService::class.java))
        withTimeout(START_TIMEOUT_MS) { ready.await() }
      } catch (e: TimeoutCancellationException) {
        serviceError = SensorException(ErrorCodes.SERVICE_NOT_ALLOWED, "The recording service did not start in time", e)
      } catch (e: CancellationException) {
        abort(context, wasActive)
        throw e
      } catch (e: SensorException) {
        serviceError = e
      } catch (e: RuntimeException) {
        // SecurityException, ForegroundServiceStartNotAllowedException and IllegalStateException all end here.
        serviceError = SensorException(ErrorCodes.SERVICE_NOT_ALLOWED, "Android refused the recording service: ${e.message}", e)
      }
    }
    if (serviceError != null) Log.w(TAG, "running without the foreground service: ${serviceError.message}")
    val plan = SessionPolicy.afterServiceStart(gps, serviceError == null)

    val hub = SensorHub.get(context)
    try {
      synchronized(lock) {
        if (plan.gps) {
          (location ?: WorkoutLocation(context, hub, ::onFix).also { location = it }).start()
        } else {
          location?.stop()
        }
        if (!plan.wakeLock) releaseWakeLock()
        if (steps) {
          (this.steps ?: WorkoutSteps(context, hub).also { this.steps = it }).start()
        } else {
          this.steps?.stop()
        }
      }
    } catch (e: SensorException) {
      abort(context, wasActive)
      throw e
    }
    if (plan.reportNoService) serviceError?.let { throw it }
  }

  /** JS reports the recorder's numbers: the clock, distance and heart rate the notification counts on from here. */
  fun update(context: Context, state: RecordingProgress.Update) {
    synchronized(lock) {
      progress.apply(state, System.currentTimeMillis())
      if (!isActive || !serviceUp) return
    }
    notifyNow(context)
    scheduleRefresh()
  }

  /** A button of the notification was pressed; JS owns the recorder and acts on it. */
  fun control(control: RecordingNotificationSpec.Control) {
    SensorHub.peek()?.emit("onWorkoutAction", mapOf("action" to control.wire))
  }

  private fun onFix(lat: Double, lon: Double, tsMs: Long, accuracyM: Double?) {
    synchronized(lock) { progress.onFix(lat, lon, tsMs, accuracyM) }
  }

  private fun notifyNow(context: Context) {
    if (!isActive || !serviceUp) return
    context.getSystemService(NotificationManager::class.java)?.notify(RecordingNotification.ID, notification(context))
  }

  /** Re-posts every [REFRESH_MS] while the clock runs, whether or not JS gets to report: the distance comes from the fixes the service sees. */
  private fun scheduleRefresh() {
    handler.removeCallbacks(refresh)
    val again = synchronized(lock) { isActive && serviceUp && progress.running }
    if (again) handler.postDelayed(refresh, REFRESH_MS)
  }

  /** Stops GPS, the service and the wake lock. Idempotent. */
  fun end(context: Context) {
    synchronized(lock) {
      isActive = false
      serviceUp = false
      location?.stop()
      location = null
      steps?.stop()
      steps = null
      releaseWakeLock()
    }
    handler.removeCallbacks(refresh)
    context.stopService(Intent(context, RecordingService::class.java))
  }

  fun serviceStarted() {
    serviceUp = true
    pending?.complete(Unit)
    scheduleRefresh()
  }

  fun serviceFailed(error: RuntimeException) {
    Log.w(TAG, "startForeground failed: ${error.message}")
    serviceUp = false
    pending?.completeExceptionally(SensorException(ErrorCodes.SERVICE_NOT_ALLOWED, "Android refused the foreground service: ${error.message}", error))
  }

  /** The service went away. When it was the one keeping the session in the foreground the session ends with it; a refused one leaves GPS and the wake lock running. */
  fun serviceDestroyed(context: Context) {
    if (serviceUp) end(context)
  }

  /** A failed update must not take a healthy running session down with it. */
  private fun abort(context: Context, wasActive: Boolean) {
    if (!wasActive) end(context)
  }

  @SuppressLint("WakelockTimeout")
  private fun acquireWakeLock(context: Context) {
    if (wakeLock?.isHeld == true) return
    val manager = context.getSystemService(PowerManager::class.java) ?: return
    wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseWakeLock() {
    val held = wakeLock
    wakeLock = null
    if (held?.isHeld == true) held.release()
  }

  private fun hasFineLocation(context: Context) =
    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  private fun hasBluetoothConnect(context: Context) =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S || context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
}
