package com.joyodigitama.blesensors

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.os.Build
import android.util.Log

/**
 * The connection to one sensor, kept alive until [stop]: connect, discover, run the [SensorProfile] plan, stream values, and on
 * any loss reconnect with [Backoff]. Everything here runs on the hub thread: the GATT client is created with the hub's handler,
 * so its callbacks arrive there too and no state needs a lock.
 */
@SuppressLint("MissingPermission")
internal class SensorLink(private val hub: SensorHub, val address: String) {
  /** One GATT client. Callbacks of a client that is no longer [session] are dropped, except the disconnect that finishes its close. */
  private inner class Session(val autoConnect: Boolean) {
    var gatt: BluetoothGatt? = null
    var closing = false
    var closed = false
    var steps: List<GattStep> = emptyList()
    var index = 0
    var supported: List<String> = emptyList()
    var inFlight = false

    val callback = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) =
        onConnectionState(this@Session, g, status, newState)

      override fun onServicesDiscovered(g: BluetoothGatt, status: Int) = onServices(this@Session, g, status)

      override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) =
        onDescriptorWritten(this@Session, g, descriptor, status)

      // Android 12 and older call this one; 13 and newer call the one with the value.
      @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
      override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) =
        onRead(this@Session, characteristic, characteristic.value, status)

      override fun onCharacteristicRead(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) =
        onRead(this@Session, characteristic, value, status)

      @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
      override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic) =
        onNotification(this@Session, characteristic, characteristic.value)

      override fun onCharacteristicChanged(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) =
        onNotification(this@Session, characteristic, value)
    }
  }

  private var session: Session? = null
  private var stopped = false

  /** Consecutive failures since the last successful connect: the index into [Backoff]. */
  private var failures = 0

  /** The last event emitted for this sensor; what `connectionStates` reports. */
  var lastEvent: Map<String, Any?> = event("disconnected", emptyList(), null)
    private set

  private val connectRunnable = Runnable { attempt() }
  private var timeoutReason = ""
  private val timeoutRunnable = Runnable {
    val s = session ?: return@Runnable
    fail(s, "$timeoutReason timed out", linkDown = false)
  }

  val isDisconnected: Boolean get() = lastEvent["state"] == "disconnected"

  fun start() = attempt()

  /** `connect` of an id that is already desired. */
  fun reemit() = hub.emit("onConnection", lastEvent)

  /** The user dropped the sensor: tear down gracefully, tell JS once, never reconnect. */
  fun stop() {
    stopped = true
    hub.handler.removeCallbacks(connectRunnable)
    disarm()
    session?.let { release(it, linkDown = false) }
    session = null
    publish("disconnected", emptyList(), null)
  }

  /** Bluetooth went off: the controller drops every link by itself, so the clients are closed at once and nothing is retried. */
  fun radioLost() {
    hub.handler.removeCallbacks(connectRunnable)
    disarm()
    session?.let { release(it, linkDown = true) }
    session = null
    if (!isDisconnected) publish("disconnected", emptyList(), "Bluetooth turned off")
  }

  /** Bluetooth came back: start over with the shortest delay. */
  fun radioRestored() {
    if (stopped) return
    hub.handler.removeCallbacks(connectRunnable)
    failures = 0
    hub.handler.postDelayed(connectRunnable, RADIO_SETTLE_MS)
  }

  private fun attempt() {
    if (stopped || session != null || !hub.radioOn()) return
    publish("connecting", emptyList(), null)
    val s = Session(autoConnect = failures > 0)
    session = s
    try {
      val client = hub.device(address).connectGatt(
        hub.context,
        s.autoConnect,
        s.callback,
        BluetoothDevice.TRANSPORT_LE,
        BluetoothDevice.PHY_LE_1M_MASK,
        hub.handler,
      )
      s.gatt = client
      if (client == null) {
        fail(s, "Android did not create a GATT client", linkDown = true)
        return
      }
    } catch (e: SecurityException) {
      fail(s, "BLUETOOTH_CONNECT permission denied", linkDown = true)
      return
    } catch (e: RuntimeException) {
      fail(s, "connectGatt failed: ${e.message}", linkDown = true)
      return
    }
    log("GATT connect, autoConnect ${s.autoConnect}")
    arm(if (s.autoConnect) AUTO_CONNECT_TIMEOUT_MS else CONNECT_TIMEOUT_MS, "connecting")
  }

  private fun onConnectionState(s: Session, g: BluetoothGatt, status: Int, newState: Int) {
    if (s.closing) {
      if (newState == BluetoothProfile.STATE_DISCONNECTED) close(s)
      return
    }
    if (s !== session) return
    log("GATT state ${stateText(newState)}, ${statusText(status)}")
    if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
      arm(DISCOVERY_TIMEOUT_MS, "service discovery")
      val started = try {
        g.discoverServices()
      } catch (e: SecurityException) {
        false
      }
      if (!started) fail(s, "Android refused to start service discovery", linkDown = false)
    } else {
      fail(s, "Link ended: ${statusText(status)}", linkDown = newState == BluetoothProfile.STATE_DISCONNECTED)
    }
  }

  private fun onServices(s: Session, g: BluetoothGatt, status: Int) {
    if (s !== session || s.closing) return
    if (status != BluetoothGatt.GATT_SUCCESS) {
      fail(s, "Service discovery failed: ${statusText(status)}", linkDown = false)
      return
    }
    val found = HashMap<String, HashMap<String, Int>>()
    for (service in g.services) {
      val serviceId = SensorProfile.short(service.uuid) ?: continue
      if (serviceId !in SensorProfile.services) continue
      val characteristics = found.getOrPut(serviceId) { HashMap() }
      for (characteristic in service.characteristics) {
        val id = SensorProfile.short(characteristic.uuid) ?: continue
        characteristics[id] = (characteristics[id] ?: 0) or characteristic.properties
      }
    }
    s.supported = SensorProfile.supportedIn(found.keys)
    if (s.supported.isEmpty()) {
      fail(s, "no supported service", linkDown = false)
      return
    }
    s.steps = SensorProfile.plan(found)
    log("GATT services ${found.keys}, plan ${s.steps.size} steps")
    s.index = 0
    runSteps(s)
  }

  /** Starts the next step that can be started and returns; its callback calls this again. Steps the sensor refuses are skipped. */
  private fun runSteps(s: Session) {
    val g = s.gatt ?: return
    try {
      while (s.index < s.steps.size) {
        val step = s.steps[s.index]
        if (start(g, step)) {
          s.inFlight = true
          arm(OPERATION_TIMEOUT_MS, "${step.javaClass.simpleName} ${step.service}/${step.characteristic}")
          return
        }
        s.index++
      }
    } catch (e: SecurityException) {
      fail(s, "BLUETOOTH_CONNECT permission denied", linkDown = false)
      return
    }
    complete(s)
  }

  private fun start(g: BluetoothGatt, step: GattStep): Boolean {
    val characteristic = g.getService(SensorProfile.uuid16(step.service))?.getCharacteristic(SensorProfile.uuid16(step.characteristic))
    if (characteristic == null) {
      log("skip ${step.service}/${step.characteristic}: not found")
      return false
    }
    return when (step) {
      is GattStep.Read -> g.readCharacteristic(characteristic).also { if (!it) log("skip read ${step.service}/${step.characteristic}: refused") }
      is GattStep.Subscribe -> subscribe(g, characteristic, step)
    }
  }

  @Suppress("DEPRECATION")
  private fun subscribe(g: BluetoothGatt, characteristic: BluetoothGattCharacteristic, step: GattStep.Subscribe): Boolean {
    val cccd = characteristic.getDescriptor(SensorProfile.CLIENT_CONFIG)
    if (cccd == null) {
      log("skip subscribe ${step.service}/${step.characteristic}: no client configuration descriptor")
      return false
    }
    if (!g.setCharacteristicNotification(characteristic, true)) {
      log("skip subscribe ${step.service}/${step.characteristic}: Android refused to enable it locally")
      return false
    }
    val value = if (step.indicate) BluetoothGattDescriptor.ENABLE_INDICATION_VALUE else BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
    val started = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      g.writeDescriptor(cccd, value) == BluetoothStatusCodes.SUCCESS
    } else {
      cccd.value = value
      g.writeDescriptor(cccd)
    }
    if (!started) {
      g.setCharacteristicNotification(characteristic, false)
      log("skip subscribe ${step.service}/${step.characteristic}: descriptor write refused")
    }
    return started
  }

  private fun onDescriptorWritten(s: Session, g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
    if (s !== session || s.closing || !s.inFlight) return
    if (status != BluetoothGatt.GATT_SUCCESS) {
      val characteristic = descriptor.characteristic
      log("subscribe ${SensorProfile.short(characteristic.uuid)} refused: ${statusText(status)}")
      try {
        g.setCharacteristicNotification(characteristic, false)
      } catch (ignored: SecurityException) {
        // Permission revoked: the next step fails the link.
      }
    }
    advance(s)
  }

  private fun onRead(s: Session, characteristic: BluetoothGattCharacteristic, value: ByteArray?, status: Int) {
    val ts = System.currentTimeMillis()
    if (s !== session || s.closing || !s.inFlight) return
    if (status == BluetoothGatt.GATT_SUCCESS && value != null) {
      emitValue(characteristic, value, ts)
    } else {
      log("read ${SensorProfile.short(characteristic.uuid)} failed: ${statusText(status)}")
    }
    advance(s)
  }

  private fun onNotification(s: Session, characteristic: BluetoothGattCharacteristic, value: ByteArray?) {
    val ts = System.currentTimeMillis()
    if (s !== session || s.closing || value == null) return
    emitValue(characteristic, value, ts)
  }

  private fun emitValue(characteristic: BluetoothGattCharacteristic, value: ByteArray, ts: Long) {
    val service = SensorProfile.short(characteristic.service.uuid) ?: return
    val id = SensorProfile.short(characteristic.uuid) ?: return
    hub.emit(
      "onValue",
      mapOf(
        "id" to address,
        "ts" to ts.toDouble(),
        "service" to service,
        "characteristic" to id,
        "value" to SensorProfile.toHex(value),
      ),
    )
  }

  private fun advance(s: Session) {
    disarm()
    s.inFlight = false
    s.index++
    runSteps(s)
  }

  private fun complete(s: Session) {
    disarm()
    failures = 0
    publish("connected", s.supported, null)
  }

  /** The session ended (or has to end) with [reason]: release the client, tell JS, and plan the next attempt. */
  private fun fail(s: Session, reason: String, linkDown: Boolean) {
    if (s !== session) return
    disarm()
    release(s, linkDown)
    session = null
    log("link failed: $reason")
    publish("disconnected", emptyList(), reason)
    if (stopped || !hub.radioOn()) return
    hub.handler.postDelayed(connectRunnable, Backoff.nextDelayMs(failures))
    failures++
  }

  /**
   * Frees the GATT client. With the link still up it asks for a disconnect and closes when Android confirms (closing right away
   * can leave the connection open on some stacks), with a timeout in case the confirmation never comes.
   */
  private fun release(s: Session, linkDown: Boolean) {
    s.closing = true
    val g = s.gatt
    if (g == null || linkDown) {
      close(s)
      return
    }
    try {
      g.disconnect()
      hub.handler.postDelayed({ close(s) }, CLOSE_GRACE_MS)
    } catch (e: SecurityException) {
      close(s)
    }
  }

  private fun close(s: Session) {
    if (s.closed) return
    s.closed = true
    try {
      s.gatt?.close()
    } catch (ignored: SecurityException) {
      // BLUETOOTH_CONNECT was revoked: the system drops the link with the client.
    }
  }

  private fun arm(ms: Long, reason: String) {
    hub.handler.removeCallbacks(timeoutRunnable)
    timeoutReason = reason
    hub.handler.postDelayed(timeoutRunnable, ms)
  }

  private fun disarm() = hub.handler.removeCallbacks(timeoutRunnable)

  private fun publish(state: String, services: List<String>, error: String?) {
    lastEvent = event(state, services, error)
    hub.emit("onConnection", lastEvent)
  }

  private fun event(state: String, services: List<String>, error: String?): Map<String, Any?> =
    mapOf("id" to address, "state" to state, "services" to services, "error" to error)

  private fun log(message: String) = Log.i(TAG, "$address: $message")

  private companion object {
    const val TAG = "BleSensors"

    /** Direct connects fail by themselves after about 30 s (status 133); autoConnect waits for the sensor as long as we let it. */
    const val CONNECT_TIMEOUT_MS = 35_000L
    const val AUTO_CONNECT_TIMEOUT_MS = 90_000L
    const val DISCOVERY_TIMEOUT_MS = 15_000L
    const val OPERATION_TIMEOUT_MS = 10_000L
    const val CLOSE_GRACE_MS = 2_000L

    /** Lets the Bluetooth stack finish starting before the first reconnect. */
    const val RADIO_SETTLE_MS = 1_000L

    fun stateText(state: Int): String = when (state) {
      BluetoothProfile.STATE_CONNECTED -> "CONNECTED"
      BluetoothProfile.STATE_DISCONNECTED -> "DISCONNECTED"
      BluetoothProfile.STATE_CONNECTING -> "CONNECTING"
      BluetoothProfile.STATE_DISCONNECTING -> "DISCONNECTING"
      else -> "state $state"
    }

    fun statusText(status: Int): String {
      val meaning = when (status) {
        BluetoothGatt.GATT_SUCCESS -> "success"
        8 -> "connection timeout"
        19 -> "the sensor ended the connection"
        22 -> "the phone ended the connection"
        62 -> "connection failed to establish"
        133 -> "generic GATT error"
        else -> null
      }
      return if (meaning != null) "GATT status $status ($meaning)" else "GATT status $status"
    }
  }
}
