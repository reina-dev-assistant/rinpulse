package com.joyodigitama.blesensors

import com.joyodigitama.blesensors.GattStep.Read
import com.joyodigitama.blesensors.GattStep.Subscribe
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SensorProfileTest {
  private val read = SensorProfile.PROPERTY_READ
  private val notify = SensorProfile.PROPERTY_NOTIFY
  private val indicate = SensorProfile.PROPERTY_INDICATE

  @Test
  fun tableMatchesTheSharedContract() {
    assertEquals(
      listOf(
        Triple("180d", "2a37", Mode.NOTIFY),
        Triple("1816", "2a5b", Mode.NOTIFY),
        Triple("1818", "2a63", Mode.NOTIFY),
        Triple("1814", "2a53", Mode.NOTIFY),
        Triple("180f", "2a19", Mode.READ_NOTIFY),
        Triple("180a", "2a29", Mode.READ),
        Triple("180a", "2a24", Mode.READ),
      ),
      SensorProfile.table.map { Triple(it.service, it.characteristic, it.mode) },
    )
    assertEquals(listOf("180d", "1816", "1818", "1814"), SensorProfile.supportedServices)
    assertEquals(listOf("180d", "1816", "1818", "1814", "180f", "180a"), SensorProfile.services)
  }

  @Test
  fun uuidHelpersRoundTripThroughTheBaseUuid() {
    assertEquals("0000180d-0000-1000-8000-00805f9b34fb", SensorProfile.uuid16("180D").toString())
    assertEquals("2a37", SensorProfile.short(SensorProfile.uuid16("2a37")))
    assertEquals("0001", SensorProfile.short(SensorProfile.uuid16("0001")))
    assertEquals("2902", SensorProfile.short(SensorProfile.CLIENT_CONFIG))
    assertNull(SensorProfile.short(java.util.UUID.fromString("0000fe86-0000-1000-8000-00805f9b34fc")))
    assertNull(SensorProfile.short(java.util.UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")))
    // Same low bits and 16-bit slot, but not the base prefix (a 32-bit UUID).
    assertNull(SensorProfile.short(java.util.UUID.fromString("1234180d-0000-1000-8000-00805f9b34fb")))
  }

  @Test
  fun hexIsLowercaseWithoutSeparators() {
    assertEquals("00ff10a5", SensorProfile.toHex(byteArrayOf(0x00, 0xFF.toByte(), 0x10, 0xA5.toByte())))
    assertEquals("", SensorProfile.toHex(byteArrayOf()))
  }

  @Test
  fun heartRateStrapSubscribesReadsBatteryAndDeviceInfo() {
    val found = mapOf(
      "180d" to mapOf("2a37" to notify, "2a38" to read),
      "180f" to mapOf("2a19" to (read or notify)),
      "180a" to mapOf("2a29" to read, "2a24" to read, "2a25" to read),
    )
    assertEquals(
      listOf(
        Subscribe("180d", "2a37", indicate = false),
        Read("180f", "2a19"),
        Subscribe("180f", "2a19", indicate = false),
        Read("180a", "2a29"),
        Read("180a", "2a24"),
      ),
      SensorProfile.plan(found),
    )
  }

  @Test
  fun batteryThatOnlyReadsIsReadButNotSubscribed() {
    val found = mapOf("180d" to mapOf("2a37" to notify), "180f" to mapOf("2a19" to read))
    assertEquals(listOf(Subscribe("180d", "2a37", false), Read("180f", "2a19")), SensorProfile.plan(found))
  }

  @Test
  fun indicateOnlyHeartRateUsesIndications() {
    val found = mapOf("180d" to mapOf("2a37" to indicate))
    assertEquals(listOf(Subscribe("180d", "2a37", indicate = true)), SensorProfile.plan(found))
  }

  @Test
  fun notifyWinsWhenTheCharacteristicOffersBoth() {
    val found = mapOf("180d" to mapOf("2a37" to (notify or indicate)))
    assertEquals(listOf(Subscribe("180d", "2a37", indicate = false)), SensorProfile.plan(found))
  }

  @Test
  fun powerMeterWithSpeedCadenceSubscribesBothInTableOrder() {
    val found = mapOf(
      "1818" to mapOf("2a63" to notify, "2a65" to read, "2a5d" to read),
      "1816" to mapOf("2a5b" to notify, "2a5c" to read),
      "180f" to mapOf("2a19" to (read or notify)),
    )
    assertEquals(
      listOf(
        Subscribe("1816", "2a5b", indicate = false),
        Subscribe("1818", "2a63", indicate = false),
        Read("180f", "2a19"),
        Subscribe("180f", "2a19", indicate = false),
      ),
      SensorProfile.plan(found),
    )
  }

  @Test
  fun characteristicsWithoutTheNeededPropertyAreSkipped() {
    val found = mapOf(
      // A notify characteristic that neither notifies nor indicates.
      "180d" to mapOf("2a37" to read),
      // A read characteristic that cannot be read.
      "180a" to mapOf("2a29" to notify, "2a24" to 0),
      // Read+notify with neither property.
      "180f" to mapOf("2a19" to 0),
    )
    assertTrue(SensorProfile.plan(found).isEmpty())
  }

  @Test
  fun unknownServicesAndCharacteristicsAreIgnored() {
    val found = mapOf("fe86" to mapOf("fe02" to notify), "180d" to mapOf("2a39" to notify))
    assertTrue(SensorProfile.plan(found).isEmpty())
  }

  @Test
  fun emptyDiscoveryHasNoPlan() {
    assertTrue(SensorProfile.plan(emptyMap()).isEmpty())
  }

  @Test
  fun supportedServicesAreFilteredAndOrdered() {
    assertEquals(listOf("180d", "1818"), SensorProfile.supportedIn(setOf("180a", "1818", "180f", "180d")))
    assertTrue(SensorProfile.supportedIn(setOf("180a", "180f")).isEmpty())
  }

  @Test
  fun foregroundTypesFollowPlatformAndPermissions() {
    // Android 10: location only, there is no connected device type yet.
    assertEquals(ForegroundTypes.LOCATION, ForegroundTypes.compute(29, gps = true, fineLocation = true, bluetoothConnect = true))
    assertEquals(0, ForegroundTypes.compute(29, gps = false, fineLocation = true, bluetoothConnect = true))
    // Android 11: connected device needs no runtime permission.
    assertEquals(ForegroundTypes.CONNECTED_DEVICE, ForegroundTypes.compute(30, gps = false, fineLocation = false, bluetoothConnect = false))
    // Android 12+: connected device only with BLUETOOTH_CONNECT.
    assertEquals(
      ForegroundTypes.LOCATION or ForegroundTypes.CONNECTED_DEVICE,
      ForegroundTypes.compute(36, gps = true, fineLocation = true, bluetoothConnect = true),
    )
    assertEquals(ForegroundTypes.LOCATION, ForegroundTypes.compute(36, gps = true, fineLocation = true, bluetoothConnect = false))
    assertEquals(0, ForegroundTypes.compute(36, gps = false, fineLocation = true, bluetoothConnect = false))
    // GPS without the permission never gets the location type.
    assertEquals(ForegroundTypes.CONNECTED_DEVICE, ForegroundTypes.compute(36, gps = true, fineLocation = false, bluetoothConnect = true))
  }
}
