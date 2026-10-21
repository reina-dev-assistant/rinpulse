package com.joyodigitama.huaweiwear

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Collections
import kotlinx.coroutines.runBlocking
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkoutSyncTest {
  private class Request(val service: Int, val command: Int, val tlv: HuaweiTLV)

  private class RecordingEvents : WearEvents {
    val logs: MutableList<String> = Collections.synchronizedList(ArrayList())
    override fun syncComplete(summary: SyncSummary) = Unit
    override fun state(state: LinkState, error: String?) = Unit
    override fun battery(level: Int) = Unit
    override fun log(direction: LogDirection, serviceId: Int?, commandId: Int?, hex: String?, message: String) {
      logs.add("${direction.wire}: $message")
    }
  }

  private class FakeWatch(private val respond: (Request) -> List<ByteArray>) : FrameSink {
    lateinit var session: HuaweiSession
    val requests: MutableList<Request> = Collections.synchronizedList(ArrayList())

    override suspend fun write(frames: List<ByteArray>) {
      for (f in frames) {
        val tlv = HuaweiTLV().parse(f, 6, f.size - 8).also { if (it.contains(0x7C)) it.decrypt(session.params) }
        val request = Request(f[4].toInt() and 0xFF, f[5].toInt() and 0xFF, tlv)
        requests.add(request)
        for (response in respond(request)) session.onData(response)
      }
    }
  }

  private class MemorySink(val storedComplete: Set<Pair<Long, Long>> = emptySet()) : WorkoutSink {
    val saved = ArrayList<WorkoutRecord>()
    override suspend fun isComplete(start: Long, end: Long) = (start to end) in storedComplete
    override suspend fun save(record: WorkoutRecord): Boolean {
      saved.add(record)
      return true
    }
  }

  private fun frame(service: Int, command: Int, body: ByteArray): ByteArray {
    val inner = byteArrayOf(service.toByte(), command.toByte()) + body
    val head = ByteBuffer.allocate(4 + inner.size).put(0x5A.toByte()).putShort((inner.size + 1).toShort()).put(0).put(inner).array()
    val crc = CheckSums.getCRC16(head, 0x0000)
    return head + ByteBuffer.allocate(2).putShort(crc.toShort()).array()
  }

  private fun tlvFrame(service: Int, command: Int, tlv: HuaweiTLV) = frame(service, command, tlv.serialize())

  private fun setup(respond: (Request) -> List<ByteArray>): Triple<FakeWatch, HuaweiSession, RecordingEvents> {
    val events = RecordingEvents()
    val watch = FakeWatch(respond)
    val session = HuaweiSession(watch, events).also { it.params.setSecretKey(ByteArray(16)) }
    watch.session = session
    DeviceCaps.gpsNewSync = true
    return Triple(watch, session, events)
  }

  @After
  fun resetCaps() = DeviceCaps.reset()

  private val start = 1_700_000_000
  private val end = start + 600

  /** A GPS file in GB's layout: 0x20 trim bytes, type 0x03 (altitude), start values, then 19-byte records. */
  private fun gpsFile(): ByteArray {
    val buf = ByteBuffer.allocate(70 + 3 * 19).order(ByteOrder.LITTLE_ENDIAN)
    buf.position(0x20)
    buf.put(0x03)
    buf.putInt(start)
    buf.putDouble(106.8) // longitude, degrees
    buf.putDouble(-6.2) // latitude, degrees
    buf.putDouble(10.0)
    buf.position(70)
    repeat(3) {
      buf.putShort(1) // time delta
      buf.putShort(0)
      buf.putFloat(0f)
      buf.putFloat(0f)
      buf.put(0)
      buf.put(0)
      buf.put(0) // pause
      buf.putShort((12 + it).toShort()) // altitude
      buf.putShort(0)
    }
    return buf.array()
  }

  private fun totalsTlv(): HuaweiTLV = HuaweiTLV().put(
    0x81,
    HuaweiTLV()
      .put(0x02, 5.toShort())
      .put(0x03, 1.toByte())
      .put(0x04, start)
      .put(0x05, end)
      .put(0x06, 321) // calories
      .put(0x07, 5000) // distance
      .put(0x08, 6100) // steps
      .put(0x09, 640) // total time
      .put(0x12, 600) // duration
      .put(0x14, 1.toByte()), // running
  )

  private fun countTlv(trajectories: Int?, dataFrames: Int = 1): HuaweiTLV {
    val entry = HuaweiTLV().put(0x06, 5.toShort()).put(0x07, dataFrames.toShort()).put(0x08, 1.toShort())
    if (trajectories != null) entry.put(0x0e, trajectories.toByte())
    return HuaweiTLV().put(0x81, HuaweiTLV().put(0x02, 1.toShort()).put(0x85, entry))
  }

  /** Frame [number] holds three 5 s samples; frame 0 is 120, 0 and 150 bpm, later frames start 15 s per frame later. */
  private fun dataTlv(number: Int = 0): HuaweiTLV {
    val header = ByteBuffer.allocate(14).putShort(5).putShort(number.toShort()).putInt(start + 15 * number).put(5).putShort(3).put(1).putShort(0x0001).array()
    return HuaweiTLV().put(
      0x81,
      HuaweiTLV().put(0x02, 5.toShort()).put(0x03, number.toShort()).put(0x04, header).put(0x05, byteArrayOf(120, 0, 150.toByte())),
    )
  }

  private fun paceTlv(): HuaweiTLV = HuaweiTLV().put(
    0x81,
    HuaweiTLV()
      .put(0x02, 5.toShort())
      .put(0x08, 0.toShort())
      .put(0x83, HuaweiTLV().put(0x04, 1.toShort()).put(0x05, 0.toByte()).put(0x06, 330)),
  )

  private fun respondTo(
    r: Request,
    trajectories: Int?,
    gps: ByteArray?,
    dataFrames: Int = 1,
    lostData: (Int) -> Boolean = { false },
  ): List<ByteArray> = when (r.service) {
    0x17 -> when (r.command) {
      0x07 -> listOf(tlvFrame(0x17, 0x07, countTlv(trajectories, dataFrames)))
      0x08 -> listOf(tlvFrame(0x17, 0x08, totalsTlv()))
      0x0a -> {
        val frame = r.tlv.getObject(0x81).getShort(0x03).toInt()
        if (lostData(frame)) emptyList() else listOf(tlvFrame(0x17, 0x0a, dataTlv(frame)))
      }
      0x0c -> listOf(tlvFrame(0x17, 0x0c, paceTlv()))
      else -> emptyList()
    }
    0x2c -> when (r.command) {
      0x01 -> listOf(
        tlvFrame(
          0x2c,
          0x01,
          HuaweiTLV().put(0x01, "5_gps.bin").put(0x02, 0x11.toByte()).put(0x03, 9.toByte()).put(0x04, gps?.size ?: 0),
        ),
      )
      0x03 -> listOf(
        tlvFrame(0x2c, 0x03, HuaweiTLV().put(0x01, 9.toByte()).put(0x02, 5.toByte()).put(0x03, 3.toShort()).put(0x04, 1000).put(0x05, true)),
      )
      0x04 -> {
        val offset = r.tlv.getInteger(0x02)
        val size = r.tlv.getInteger(0x03)
        val chunk = gps!!.copyOfRange(offset, offset + size)
        listOf(frame(0x2c, 0x05, byteArrayOf(9) + ByteBuffer.allocate(4).putInt(offset).array() + byteArrayOf(0) + chunk))
      }
      else -> emptyList()
    }
    else -> emptyList()
  }

  @Test
  fun syncsWorkoutWithHeartRateSplitsAndGpsTrack() = runBlocking {
    val gps = gpsFile()
    val (watch, session, events) = setup { respondTo(it, trajectories = 1, gps = gps) }
    val sink = MemorySink()
    val sync = WorkoutSync(session, events)

    sync.sync(start - 1000, end + 1000, sink)

    assertEquals(1, sync.saved)
    val record = sink.saved.single()
    assertTrue(record.complete)
    assertEquals(5, record.number)
    assertEquals(start.toLong(), record.start)
    assertEquals(end.toLong(), record.end)
    assertEquals(1, record.sportType)
    assertEquals("Running", record.sportName)
    assertEquals(600, record.duration)
    assertEquals(5000, record.distance)
    assertEquals(321, record.calories)
    assertEquals(6100, record.steps)
    // The heart-rate sample of 0 is not a reading.
    assertEquals(135, record.avgHr)
    assertEquals(150, record.maxHr)

    val hrPoints = record.points.filter { it.hr != null }
    assertEquals(listOf(start.toLong(), start + 10L), hrPoints.map { it.ts })
    // GB drops a final record that leaves no bytes after it, so three records give two points.
    val route = record.points.filter { it.lat != null }
    assertEquals(2, route.size)
    assertEquals(-6.2, route[0].lat!!, 0.001)
    assertEquals(106.8, route[0].lon!!, 0.001)

    val summary = JSONObject(record.summaryJson)
    assertEquals("RUNNING", summary.getString("kind"))
    assertEquals("ok", summary.getString("gps"))
    assertEquals(330, summary.getJSONArray("paceBlocks").getJSONObject(0).getInt("pace"))
    assertEquals(330, summary.getInt("paceAvgSecPerKm"))
    assertEquals(1000.0 / (5000.0 / 600), summary.getDouble("avgPaceSecPerKm"), 0.001)
    assertFalse(summary.getBoolean("missingData"))

    // The GPS file was fetched by name over service 2C, then completed.
    val init = watch.requests.first { it.service == 0x2c && it.command == 0x01 }
    assertEquals("5_gps.bin", init.tlv.getString(0x01))
    assertEquals(0x11, init.tlv.getByte(0x02).toInt())
    assertEquals(0x06, watch.requests.last { it.service == 0x2c }.command)
  }

  @Test
  fun watchReportingNoTrajectoryDataSkipsTheGpsDownload() = runBlocking {
    val (watch, session, events) = setup { respondTo(it, trajectories = 0, gps = null) }
    val sink = MemorySink()

    WorkoutSync(session, events).sync(start - 1000, end + 1000, sink)

    val record = sink.saved.single()
    assertTrue(record.complete)
    assertEquals(0, watch.requests.count { it.service == 0x2c })
    assertEquals("none", JSONObject(record.summaryJson).getString("gps"))
    assertTrue(record.points.all { it.lat == null })
  }

  @Test
  fun emptyGpsFileLeavesTheWorkoutWithoutRoute() = runBlocking {
    val (_, session, events) = setup { respondTo(it, trajectories = null, gps = null) }
    val sink = MemorySink()

    WorkoutSync(session, events).sync(start - 1000, end + 1000, sink)

    val record = sink.saved.single()
    assertTrue(record.complete)
    assertEquals("empty", JSONObject(record.summaryJson).getString("gps"))
  }

  @Test
  fun alreadyStoredWorkoutIsNotDownloadedAgain() = runBlocking {
    val (watch, session, events) = setup { respondTo(it, trajectories = 1, gps = gpsFile()) }
    val sink = MemorySink(setOf(start.toLong() to end.toLong()))

    WorkoutSync(session, events).sync(start - 1000, end + 1000, sink)

    assertTrue(sink.saved.isEmpty())
    assertEquals(0, watch.requests.count { it.command == 0x0a })
    assertNull(watch.requests.firstOrNull { it.service == 0x2c })
  }

  @Test
  fun countWithoutContainerMeansNoWorkouts() = runBlocking {
    val (_, session, events) = setup { r ->
      if (r.service == 0x17 && r.command == 0x07) listOf(tlvFrame(0x17, 0x07, HuaweiTLV().put(0x01, 1.toByte()))) else emptyList()
    }
    val sink = MemorySink()

    WorkoutSync(session, events).sync(start, end, sink)

    assertTrue(sink.saved.isEmpty())
    assertNotNull(events.logs.firstOrNull { it.contains("nothing to sync") })
  }
  @Test
  fun oldSyncDownloadsTheGpsFileFromTheWorkoutFileList() = runBlocking {
    val gps = gpsFile()
    lateinit var params: nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket.ParamsProvider
    val (watch, session, events) = setup { r ->
      if (r.service != 0x0a) return@setup respondTo(r, trajectories = null, gps = null)
      when (r.command) {
        0x01 -> listOf(tlvFrame(0x0a, 0x01, HuaweiTLV().put(0x8b, HuaweiTLV().put(0x8c, HuaweiTLV().put(0x0d, "5_pdr.bin;5_gps.bin")))))
        0x02 -> listOf(
          tlvFrame(0x0a, 0x02, HuaweiTLV().put(0x01, "v1").put(0x02, true).put(0x03, 100.toShort()).put(0x04, 1000.toShort()).put(0x05, 5.toShort())),
        )
        0x03 -> listOf(tlvFrame(0x0a, 0x03, HuaweiTLV().put(0x02, gps.size)))
        0x04 -> {
          val offset = r.tlv.getInteger(0x02)
          val size = r.tlv.getInteger(0x03)
          gps.copyOfRange(offset, offset + size).toList().chunked(60).mapIndexed { number, bytes ->
            frame(0x0a, 0x05, HuaweiTLV.encryptRaw(params, byteArrayOf(number.toByte()) + bytes.toByteArray()).serialize())
          }
        }
        else -> emptyList()
      }
    }
    params = session.params
    DeviceCaps.gpsNewSync = false
    val sink = MemorySink()

    WorkoutSync(session, events).sync(start - 1000, end + 1000, sink)

    val record = sink.saved.single()
    assertEquals("ok", JSONObject(record.summaryJson).getString("gps"))
    assertEquals(2, record.points.count { it.lat != null })
    val init = watch.requests.first { it.service == 0x0a && it.command == 0x01 }
    assertEquals(2, init.tlv.getByte(0x02).toInt())
    assertEquals(5, init.tlv.getObject(0x86).getObject(0x88).getShort(0x09).toInt())
    val parameters = watch.requests.first { it.service == 0x0a && it.command == 0x02 }.tlv
    assertEquals(2, parameters.getByte(0x06).toInt())
    assertEquals(3, parameters.getByte(0x07).toInt())
    assertEquals("5_gps.bin", watch.requests.first { it.service == 0x0a && it.command == 0x03 }.tlv.getString(0x01))
  }

  /** Frames the stack dropped (a reply over 512 bytes on Android 14+) are never answered: the rest of the workout must still come. */
  @Test
  fun lostDataFramesAreSkippedAndPaceAndTheRestStillSync() = runBlocking {
    val (watch, session, events) = setup { respondTo(it, trajectories = 0, gps = null, dataFrames = 5, lostData = { true }) }
    val sink = MemorySink()
    val sync = WorkoutSync(session, events, requestTimeoutMs = 150)

    sync.sync(start - 1000, end + 1000, sink)

    val record = sink.saved.single()
    assertTrue(record.complete)
    assertEquals(1, sync.saved)
    // Three lost frames in a row end the data part; frames 3 and 4 are never asked for.
    assertEquals(listOf(0, 1, 2), watch.requests.filter { it.command == 0x0a }.map { it.tlv.getObject(0x81).getShort(0x03).toInt() })
    assertTrue(record.points.none { it.hr != null })
    val summary = JSONObject(record.summaryJson)
    assertTrue(summary.getBoolean("missingData"))
    assertEquals(330, summary.getJSONArray("paceBlocks").getJSONObject(0).getInt("pace"))
    // The watch answered the check after the losses, so the link is alive.
    assertEquals(2, watch.requests.count { it.command == 0x08 })
    assertNotNull(events.logs.firstOrNull { it.contains("3 frames in a row got no answer") })
  }

  @Test
  fun answeredFramesAroundALostOneAreKept() = runBlocking {
    val (_, session, events) = setup { respondTo(it, trajectories = 0, gps = null, dataFrames = 3, lostData = { n -> n == 0 }) }
    val sink = MemorySink()

    WorkoutSync(session, events, requestTimeoutMs = 150).sync(start - 1000, end + 1000, sink)

    val record = sink.saved.single()
    assertTrue(record.complete)
    // Frames 1 and 2 arrived (the 0 bpm sample of each is no reading); frame 0 is the gap.
    assertEquals(listOf(start + 15L, start + 25L, start + 30L, start + 40L), record.points.filter { it.hr != null }.map { it.ts })
    assertTrue(JSONObject(record.summaryJson).getBoolean("missingData"))
  }

  @Test
  fun noAnswerToTheLinkCheckMeansTheLinkIsGoneAndTheWorkoutStaysIncomplete() = runBlocking {
    var totals = 0
    val (_, session, events) = setup { r ->
      if (r.service == 0x17 && r.command == 0x08 && ++totals > 1) emptyList()
      else respondTo(r, trajectories = 0, gps = null, dataFrames = 2, lostData = { true })
    }
    val sink = MemorySink()

    val error = runCatching { WorkoutSync(session, events, requestTimeoutMs = 150).sync(start - 1000, end + 1000, sink) }.exceptionOrNull()

    assertTrue(error is WearException && error.errorCode == ErrorCodes.TIMEOUT)
    assertFalse(sink.saved.single().complete)
  }
}
