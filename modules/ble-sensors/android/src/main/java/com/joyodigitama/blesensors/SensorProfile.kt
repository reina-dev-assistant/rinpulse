package com.joyodigitama.blesensors

import java.util.UUID

/** One GATT operation of the connect plan; the link runs them one at a time. */
internal sealed class GattStep {
  abstract val service: String
  abstract val characteristic: String

  /** Enables notifications, or indications when the characteristic offers only those. */
  data class Subscribe(override val service: String, override val characteristic: String, val indicate: Boolean) : GattStep()

  data class Read(override val service: String, override val characteristic: String) : GattStep()
}

internal enum class Mode { NOTIFY, READ, READ_NOTIFY }

internal data class ProfileEntry(val service: String, val characteristic: String, val mode: Mode)

/**
 * What the module talks to on a sensor. The same table lives in BleSensors.types.ts (`SENSOR_CHARACTERISTICS`) and
 * SensorProfile.swift; keep the three in step. Services and characteristics are 16-bit assigned numbers as 4 lowercase hex digits.
 */
internal object SensorProfile {
  const val PROPERTY_READ = 0x02
  const val PROPERTY_NOTIFY = 0x10
  const val PROPERTY_INDICATE = 0x20

  /** The services a sensor must offer at least one of; also what the scan filters on. */
  val supportedServices = listOf("180d", "1816", "1818", "1814")

  val table = listOf(
    ProfileEntry("180d", "2a37", Mode.NOTIFY),
    ProfileEntry("1816", "2a5b", Mode.NOTIFY),
    ProfileEntry("1818", "2a63", Mode.NOTIFY),
    ProfileEntry("1814", "2a53", Mode.NOTIFY),
    ProfileEntry("180f", "2a19", Mode.READ_NOTIFY),
    ProfileEntry("180a", "2a29", Mode.READ),
    ProfileEntry("180a", "2a24", Mode.READ),
  )

  /** The services GATT discovery looks at: everything the table mentions. */
  val services: List<String> = table.map { it.service }.distinct()

  /** Client Characteristic Configuration descriptor. */
  val CLIENT_CONFIG: UUID = uuid16("2902")

  private const val BASE_LEAST = -0x7fffff7fa064cb05L // 8000-00805f9b34fb
  private const val SHORT_MASK = 0xFFFFL shl 32

  fun uuid16(hex: String): UUID {
    require(hex.length == 4) { "16-bit UUID needs 4 hex digits: $hex" }
    return UUID.fromString("0000${hex.lowercase()}-0000-1000-8000-00805f9b34fb")
  }

  /** The 4-digit form of a UUID built on the Bluetooth base UUID, null for any other (vendor) UUID. */
  fun short(uuid: UUID): String? {
    if (uuid.leastSignificantBits != BASE_LEAST) return null
    if ((uuid.mostSignificantBits and SHORT_MASK.inv()) != 0x1000L) return null
    return ((uuid.mostSignificantBits ushr 32) and 0xFFFFL).toString(16).padStart(4, '0')
  }

  /** The supported services among [serviceIds], in table order. */
  fun supportedIn(serviceIds: Collection<String>): List<String> = supportedServices.filter { it in serviceIds }

  /**
   * The operations to run after discovery, in table order. [found] maps service to characteristic to the GATT property bitmask
   * Android reports. A characteristic the sensor lacks, or that lacks the property its mode needs, is skipped; a notify
   * characteristic with only the indicate property is subscribed with indications; read+notify reads first, then subscribes.
   */
  fun plan(found: Map<String, Map<String, Int>>): List<GattStep> {
    val steps = mutableListOf<GattStep>()
    for (entry in table) {
      val properties = found[entry.service]?.get(entry.characteristic) ?: continue
      val canRead = properties and PROPERTY_READ != 0
      val canNotify = properties and PROPERTY_NOTIFY != 0
      val canIndicate = properties and PROPERTY_INDICATE != 0
      if (entry.mode != Mode.NOTIFY && canRead) steps += GattStep.Read(entry.service, entry.characteristic)
      if (entry.mode != Mode.READ && (canNotify || canIndicate)) {
        steps += GattStep.Subscribe(entry.service, entry.characteristic, indicate = !canNotify)
      }
    }
    return steps
  }

  fun toHex(bytes: ByteArray): String {
    val out = StringBuilder(bytes.size * 2)
    for (b in bytes) {
      val v = b.toInt() and 0xFF
      out.append(HEX[v ushr 4]).append(HEX[v and 0x0F])
    }
    return out.toString()
  }

  private const val HEX = "0123456789abcdef"
}
