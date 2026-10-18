package com.joyodigitama.huaweiwear

/** Outcome codes of the last satellite-data attempt; the same strings are read by `AgpsOutcome` in `HuaweiWearExtras.types.ts`. */
internal object AgpsOutcome {
  const val NONE = "none"

  /** The watch pulled the whole file and closed the transfer. */
  const val DELIVERED = "delivered"

  /** Downloaded to the phone while no watch was connected; it goes out when the watch asks. */
  const val STORED = "stored"

  /** The watch did not answer the phone's question, or never came to fetch what was ready. */
  const val WATCH_SILENT = "watch_silent"
  const val NO_NETWORK = "no_network"
  const val DOWNLOAD_FAILED = "download_failed"
  const val INVALID_FILE = "invalid_file"

  /** The watch asked for a kind of data this app cannot and must not make (only the watch maker's own app prepares it). */
  const val UNSUPPORTED = "unsupported"
  const val WATCH_REFUSED = "watch_refused"
  const val TIMEOUT = "timeout"
  const val CANCELLED = "cancelled"
  const val BUSY = "busy"
  const val LINK_LOST = "link_lost"
}

/**
 * The rules of the satellite-data (A-GPS / ephemeris) job that need no Android: how long data is kept, when a
 * refresh is due, the retry schedule, and what a file must look like before it is allowed near the watch.
 */
internal object AgpsPolicy {
  /** The Broadcom LTO file predicts seven days ahead; the watch warns when its copy is older than that. */
  const val VALID_MS = 7L * 24 * 60 * 60 * 1000

  /** A download younger than this is reused for the watch's repeated requests instead of fetching again. */
  const val CACHE_FRESH_MS = 6L * 60 * 60 * 1000

  /** Data is offered to the watch again once its last delivery is this old, well inside [VALID_MS]. */
  const val DELIVER_EVERY_MS = 24L * 60 * 60 * 1000

  /** Wait after the 1st, 2nd, ... failed download; the last step repeats. Reset by a success or by the user. */
  private val RETRY_STEPS_MS = longArrayOf(60_000L, 5 * 60_000L, 15 * 60_000L, 60 * 60_000L, 6 * 60 * 60_000L)

  fun retryDelayMs(failures: Int): Long =
    if (failures <= 0) 0L else RETRY_STEPS_MS[minOf(failures, RETRY_STEPS_MS.size) - 1]

  /** When the next automatic attempt may start after [failures] failures, the last at [lastFailureMs]; 0 when nothing waits. */
  fun retryAtMs(lastFailureMs: Long, failures: Int): Long = if (failures <= 0) 0L else lastFailureMs + retryDelayMs(failures)

  /** The phone-side copy is missing or old, and no retry wait is running. */
  fun prefetchDue(cachedAtMs: Long, nowMs: Long, retryAtMs: Long): Boolean =
    nowMs >= retryAtMs && (cachedAtMs <= 0L || nowMs - cachedAtMs >= CACHE_FRESH_MS)

  /** The watch has not been given data for a day (or ever): worth offering it again. */
  fun deliveryDue(deliveredAtMs: Long, nowMs: Long): Boolean = deliveredAtMs <= 0L || nowMs - deliveredAtMs >= DELIVER_EVERY_MS

  /** When the data the watch holds stops being good; 0 when it was never delivered. */
  fun expiresAtMs(dataTimeMs: Long): Long = if (dataTimeMs <= 0L) 0L else dataTimeMs + VALID_MS

  /** Broadcom LTO size bounds: the real file is about 115 KB; anything far outside is not that file. */
  const val LTO_MIN_BYTES = 16 * 1024
  const val LTO_MAX_BYTES = 1024 * 1024

  /** Most data one 1C/04 answer may carry, whatever the watch asks for. */
  const val MAX_DATA_PER_REQUEST = 1024 * 1024

  /** Most frames one data answer may be cut into. */
  const val MAX_FRAMES = 65_535

  /** A transfer that is silent this long is dropped and counted as failed, so the watch is not left waiting on a dead phone. */
  const val TRANSFER_STALL_MS = 30_000L

  /** After "ready" is announced the watch has this long to come and fetch. */
  const val PULL_WAIT_MS = 60_000L

  /** The Broadcom LTO file starts with these three bytes (checked on the public file, 115749 bytes, 2026-10-18). */
  private val LTO_MAGIC = byteArrayOf(0xFF.toByte(), 0xCA.toByte(), 0xDE.toByte())

  /** Why [data] is not fit to send as the Broadcom LTO file, or null when it is. */
  fun validateLto(data: ByteArray): String? = when {
    data.size < LTO_MIN_BYTES -> "file too small (${data.size} bytes)"
    data.size > LTO_MAX_BYTES -> "file too large (${data.size} bytes)"
    !data.copyOfRange(0, LTO_MAGIC.size).contentEquals(LTO_MAGIC) -> "not an LTO file (unexpected header)"
    else -> null
  }

  /** Frames needed to send [size] bytes in frames of [frameSize]; null when that is not a sane transfer. */
  fun frameCount(size: Int, frameSize: Int): Int? {
    if (size <= 0 || frameSize <= 0) return null
    val count = (size + frameSize - 1) / frameSize
    return if (count > MAX_FRAMES) null else count
  }
}
