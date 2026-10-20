package com.joyodigitama.blesensors

/** One thermometer advertisement kept by the overnight scan: the sensor, when it was heard (epoch ms) and its service data as lowercase hex. */
internal data class RoomAdvert(val id: String, val ts: Long, val uuid: String, val hex: String)

/**
 * The pure part of the overnight bedroom-thermometer scan (RoomScanService.kt, RoomCapture.kt): which advertisements are worth keeping,
 * the 5-minute throttle, the time an advertisement was heard and the capture window. No Android types, so it runs as a JVM unit test.
 * Nothing here decodes a reading: the bytes go to JS as they came and `src/features/sensors/thermometerAdvert.ts` is the only decoder.
 */
internal object RoomScanLogic {
  /** Service data UUIDs of the thermometer formats (ATC1441 and PVVX custom under the first, BTHome v2 under the second); 4 lowercase hex digits as [ScaleLogic.normalize] writes them. */
  const val SERVICE_ENVIRONMENT = "181a"
  const val SERVICE_BTHOME = "fcd2"

  /** One advertisement per sensor per this long is kept; the sensor itself advertises every few seconds. */
  const val SAMPLE_INTERVAL_MS = 5 * 60_000L

  /** The scan hands results over in batches this far apart, so the processor sleeps between them. */
  const val REPORT_DELAY_MS = 2 * 60_000L

  /** The longest a capture runs from the moment it starts, whatever end time JS asks for. */
  const val MAX_WINDOW_MS = 18 * 3_600_000L

  /** The service data of an advertisement to keep: the environmental one first, else BTHome; null when it has neither. [serviceData] maps normalised UUID to lowercase hex. */
  fun pickServiceData(serviceData: Map<String, String>): Pair<String, String>? {
    for (uuid in listOf(SERVICE_ENVIRONMENT, SERVICE_BTHOME)) {
      val hex = serviceData[uuid]
      if (hex != null) return uuid to hex
    }
    return null
  }

  /** The address as the radio reports it. */
  fun normalizeAddress(id: String): String = id.trim().uppercase()

  private val ADDRESS = Regex("^([0-9A-F]{2}:){5}[0-9A-F]{2}$")

  /** `AA:BB:CC:DD:EE:FF` only (upper case after [normalizeAddress]). */
  fun isAddress(id: String): Boolean = ADDRESS.matches(id)

  /** The addresses to scan for, normalised, de-duplicated and in order; anything that is not an address is dropped. */
  fun scanAddresses(ids: List<String>): List<String> = ids.map { normalizeAddress(it) }.filter { isAddress(it) }.distinct()

  /**
   * When an advertisement was heard, in epoch ms. A scan result carries only the elapsed-realtime clock (`timestampNanos`) of its arrival;
   * a batch delivered minutes later is placed by how long before [nowElapsedNanos] that was.
   */
  fun heardAtMs(nowMs: Long, nowElapsedNanos: Long, resultElapsedNanos: Long): Long =
    nowMs - (nowElapsedNanos - resultElapsedNanos).coerceAtLeast(0L) / 1_000_000L

  /** The end of a capture asked to run until [untilMs]: null when that is not in the future, else capped at [MAX_WINDOW_MS] from [nowMs]. */
  fun windowEnd(nowMs: Long, untilMs: Long): Long? = if (untilMs <= nowMs) null else minOf(untilMs, nowMs + MAX_WINDOW_MS)
}

/**
 * Keeps one advertisement per sensor per [intervalMs]. Time is the advertisement's own, so a batch that arrives late is thinned the same
 * way a live stream would be; an advertisement older than the last kept one is kept (a batch is not always in order).
 */
internal class RoomAdvertThrottle(private val intervalMs: Long = RoomScanLogic.SAMPLE_INTERVAL_MS) {
  private val lastKept = HashMap<String, Long>()

  fun shouldKeep(id: String, ts: Long): Boolean {
    val last = lastKept[id]
    if (last != null && ts >= last && ts - last < intervalMs) return false
    lastKept[id] = ts
    return true
  }

  fun clear() = lastKept.clear()
}

/** What the capture was asked to do, kept across a restart of the process (the service is sticky) in the form [toMap] / [fromMap] give. */
internal data class RoomCaptureConfig(val ids: List<String>, val untilMs: Long, val title: String, val text: String, val stopLabel: String) {
  fun toMap(): Map<String, String> =
    mapOf("ids" to ids.joinToString(","), "untilMs" to untilMs.toString(), "title" to title, "text" to text, "stopLabel" to stopLabel)

  companion object {
    /** Null when anything needed is missing or unreadable, or when no address is left. */
    fun fromMap(map: Map<String, String?>): RoomCaptureConfig? {
      val ids = RoomScanLogic.scanAddresses(map["ids"]?.split(",").orEmpty())
      val untilMs = map["untilMs"]?.toLongOrNull() ?: return null
      if (ids.isEmpty()) return null
      return RoomCaptureConfig(ids, untilMs, map["title"].orEmpty(), map["text"].orEmpty(), map["stopLabel"].orEmpty())
    }
  }
}
