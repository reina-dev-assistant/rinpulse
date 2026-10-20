package com.joyodigitama.blesensors

import java.io.File

/** One line per [RoomAdvert]: `ID|TS|UUID|HEX`. Every field is free of `|` and newlines by construction. */
internal object RoomAdvertCodec {
  private val HEX = Regex("^[0-9a-f]*$")

  fun encode(advert: RoomAdvert): String = "${advert.id}|${advert.ts}|${advert.uuid}|${advert.hex}"

  /** Null for a line that is not one (a torn write, a file from another version). */
  fun decode(line: String): RoomAdvert? {
    val parts = line.split('|')
    if (parts.size != 4) return null
    val id = parts[0]
    val ts = parts[1].toLongOrNull() ?: return null
    val uuid = parts[2]
    val hex = parts[3]
    if (!RoomScanLogic.isAddress(id) || ts <= 0 || uuid.length != 4 || !HEX.matches(uuid) || hex.length % 2 != 0 || !HEX.matches(hex)) return null
    return RoomAdvert(id, ts, uuid, hex)
  }
}

/**
 * The advertisements the overnight scan kept while no JS was listening, in a plain file in the app's private storage. JS reads them when
 * the app opens ([readAll]), stores what it decodes and then removes what it took ([removeUpTo]); until that succeeds nothing is lost.
 * The file stays small (one line per sensor per 5 minutes) but is capped at [maxBytes]: past it the oldest half goes.
 * Thread safe: the scan callback appends, the module thread reads and removes.
 */
internal class RoomAdvertLog(private val file: File, private val maxBytes: Long = DEFAULT_MAX_BYTES) {
  private val lock = Any()

  fun append(advert: RoomAdvert) = synchronized(lock) {
    val line = RoomAdvertCodec.encode(advert) + "\n"
    file.parentFile?.mkdirs()
    if (file.exists() && file.length() + line.length > maxBytes) rewrite(readLines().let { it.subList(it.size / 2, it.size) })
    file.appendText(line)
  }

  /** Every readable advertisement, oldest first. */
  fun readAll(): List<RoomAdvert> = synchronized(lock) { readLines().mapNotNull(RoomAdvertCodec::decode) }

  /** Removes the advertisements heard at [ts] or earlier, and any line that does not parse. */
  fun removeUpTo(ts: Long) = synchronized(lock) {
    if (!file.exists()) return@synchronized
    rewrite(readLines().filter { line -> RoomAdvertCodec.decode(line)?.let { it.ts > ts } ?: false })
  }

  fun clear() = synchronized(lock) { file.delete(); Unit }

  private fun readLines(): List<String> = if (file.exists()) file.readLines().filter { it.isNotEmpty() } else emptyList()

  private fun rewrite(lines: List<String>) {
    if (lines.isEmpty()) {
      file.delete()
      return
    }
    val scratch = File(file.parentFile, file.name + ".tmp")
    scratch.writeText(lines.joinToString("\n", postfix = "\n"))
    if (!scratch.renameTo(file)) {
      file.writeText(scratch.readText())
      scratch.delete()
    }
  }

  companion object {
    const val DEFAULT_MAX_BYTES = 256L * 1024
  }
}
