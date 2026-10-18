package com.joyodigitama.blesensors

/** The foreground service types of the recording service; the values are the ServiceInfo.FOREGROUND_SERVICE_TYPE_* constants. */
internal object ForegroundTypes {
  const val LOCATION = 8 // API 29
  const val CONNECTED_DEVICE = 16 // API 30

  private const val R = 30
  private const val S = 31

  /**
   * Location when the workout records GPS and has precise location; connected device whenever the platform knows the type (API 30)
   * and, from Android 12 on, BLUETOOTH_CONNECT is granted (Android 14 refuses the type without it). 0 means no type applies.
   */
  fun compute(sdk: Int, gps: Boolean, fineLocation: Boolean, bluetoothConnect: Boolean): Int {
    var types = 0
    if (gps && fineLocation) types = types or LOCATION
    if (sdk >= R && (sdk < S || bluetoothConnect)) types = types or CONNECTED_DEVICE
    return types
  }
}
