package com.joyodigitama.blesensors

/** What a workout session keeps running once it is known whether Android accepted the foreground service. */
internal object SessionPolicy {
  /**
   * @property gps location updates run when the workout records GPS. The service only keeps the process alive, so a refusal must not take the fixes with it.
   * @property wakeLock the partial wake lock is held either way: it is the only thing that keeps the CPU on without the service.
   * @property notification the ongoing notification belongs to the service; without it there is nothing to update.
   * @property reportNoService the start still ends with ERR_SERVICE_NOT_ALLOWED, after everything above runs, so the app warns that the
   *   recording may stop with the screen locked instead of recording silently without it.
   */
  data class Plan(val gps: Boolean, val wakeLock: Boolean, val notification: Boolean, val reportNoService: Boolean)

  fun afterServiceStart(gps: Boolean, serviceStarted: Boolean): Plan =
    Plan(gps = gps, wakeLock = true, notification = serviceStarted, reportNoService = !serviceStarted)
}
