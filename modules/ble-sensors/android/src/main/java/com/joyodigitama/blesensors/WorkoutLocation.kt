package com.joyodigitama.blesensors

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.Build
import android.os.Looper

/**
 * Location fixes of a recorded workout, about once a second. Android 12 and newer: the system's fused provider at high accuracy (the
 * framework API, so no Play services dependency; with Google Play services it is Google's fused provider), which hands out a Wi-Fi/cell
 * position within a second or two and moves on to GNSS accuracy as satellites lock, so the first fix comes much sooner than from the
 * raw GPS provider alone. Older versions, and devices without a fused provider: the GPS provider. A last known location is never
 * delivered: a stale fix must not enter a workout.
 */
@SuppressLint("MissingPermission")
internal class WorkoutLocation(
  private val context: Context,
  private val hub: SensorHub,
  /** Every fix also goes here, in the service's process, so the notification can count the distance without JS. */
  private val onFix: (lat: Double, lon: Double, tsMs: Long, accuracyM: Double?) -> Unit,
) {
  private var listener: LocationListener? = null

  /** Throws [SensorException] with ERR_LOCATION_PERMISSION when the fine location permission is gone or the device has no GPS. */
  @Synchronized
  fun start() {
    if (listener != null) return
    val manager = context.getSystemService(LocationManager::class.java)
    val fused = manager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && LocationManager.FUSED_PROVIDER in manager.allProviders
    if (manager == null || (!fused && LocationManager.GPS_PROVIDER !in manager.allProviders)) {
      throw SensorException(ErrorCodes.LOCATION_PERMISSION, "This device has no GPS provider")
    }
    // Before Android 11 the other callbacks are abstract; a lambda would crash there when the provider changes.
    val l = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        hub.emit("onLocation", payload(location))
        onFix(location.latitude, location.longitude, location.time, if (location.hasAccuracy()) location.accuracy.toDouble() else null)
      }

      override fun onProviderEnabled(provider: String) {}

      override fun onProviderDisabled(provider: String) {}

      @Deprecated("Never called on Android 12 and newer")
      override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
    }
    try {
      if (fused) {
        val request = LocationRequest.Builder(UPDATE_INTERVAL_MS).setQuality(LocationRequest.QUALITY_HIGH_ACCURACY).build()
        manager.requestLocationUpdates(LocationManager.FUSED_PROVIDER, request, context.mainExecutor, l)
      } else {
        manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, UPDATE_INTERVAL_MS, 0f, l, Looper.getMainLooper())
      }
    } catch (e: SecurityException) {
      throw SensorException(ErrorCodes.LOCATION_PERMISSION, "Precise location permission is not granted", e)
    }
    listener = l
  }

  @Synchronized
  fun stop() {
    val l = listener ?: return
    listener = null
    context.getSystemService(LocationManager::class.java)?.removeUpdates(l)
  }

  private fun payload(location: Location): Map<String, Any?> = mapOf(
    "ts" to location.time.toDouble(),
    "lat" to location.latitude,
    "lon" to location.longitude,
    "alt" to if (location.hasAltitude()) location.altitude else null,
    "accuracy" to if (location.hasAccuracy()) location.accuracy.toDouble() else null,
    "speed" to if (location.hasSpeed()) location.speed.toDouble() else null,
    "bearing" to if (location.hasBearing()) location.bearing.toDouble() else null,
  )

  private companion object {
    const val UPDATE_INTERVAL_MS = 1000L
  }
}
