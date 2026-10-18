package com.joyodigitama.replayencoder

import android.graphics.ImageFormat
import android.media.Image
import android.media.MediaCodec
import android.media.MediaMuxer
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer

/** What `finish` returns: the file, its size, the frame count and the duration the frame rate implies. */
internal class EncodedVideo(val path: String, val bytes: Long, val frames: Long, val durationMs: Long)

/**
 * One MP4 being written: a MediaCodec H.264 encoder fed with CPU-filled YUV 4:2:0 buffers, a MediaMuxer started on the codec's
 * output format. Every method runs on the session's single executor thread, one frame in memory at a time; only [abort] may be
 * called from elsewhere, and it only sets a flag the polling loops check.
 */
internal class VideoSession private constructor(
  private val config: EncoderConfig,
  private val canvasWidth: Int,
  private val canvasHeight: Int,
  private val codec: MediaCodec,
  private val muxer: MediaMuxer,
  private val file: File,
) {
  private val sequencer = FrameSequencer()
  private val loader = FrameLoader(canvasWidth, canvasHeight, config.width, config.height)
  private val info = MediaCodec.BufferInfo()
  private val lumaRow = ByteArray(canvasWidth)
  private val chromaU = ByteArray(canvasWidth / 2)
  private val chromaV = ByteArray(canvasWidth / 2)
  private var track = -1
  private var muxerStarted = false
  private var released = false

  @Volatile
  private var aborted = false

  /** Makes the polling loops give up with ERR_ENCODER_STATE. Safe from any thread. */
  fun abort() {
    aborted = true
  }

  /**
   * Encodes the frame in [frame] as frame number [index]. Returns once the codec holds it in an input buffer, after draining
   * whatever output was ready. Throws ERR_ENCODER_FRAME for a bad index or file without touching the codec.
   */
  fun append(frame: File, index: Long) {
    checkAlive()
    sequencer.check(index)
    loader.load(frame)
    val slot = dequeueInput()
    val image = codec.getInputImage(slot)
    if (image == null || image.format != ImageFormat.YUV_420_888) {
      throw EncoderException(ErrorCodes.UNSUPPORTED, "The encoder gives no YUV 4:2:0 input image")
    }
    fill(image)
    codec.queueInputBuffer(slot, 0, canvasWidth * canvasHeight * 3 / 2, FrameClock.ptsUs(index, config.fps), 0)
    sequencer.advance()
    drain(endOfStream = false)
  }

  /** Signals end of stream, drains the codec, writes the MP4 trailer and releases everything. */
  fun finish(): EncodedVideo {
    checkAlive()
    val frames = sequencer.expected
    if (frames == 0L) throw EncoderException(ErrorCodes.STATE, "No frame was appended")
    val slot = dequeueInput()
    codec.queueInputBuffer(slot, 0, 0, FrameClock.ptsUs(frames, config.fps), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    drain(endOfStream = true)
    if (!muxerStarted) throw EncoderException(ErrorCodes.IO, "The encoder produced no output")
    muxer.stop()
    muxerStarted = false
    release(deleteFile = false)
    return EncodedVideo(file.absolutePath, file.length(), frames, FrameClock.durationMs(frames, config.fps))
  }

  /** Stops the codec and the muxer and frees the frame buffers. Idempotent; [deleteFile] removes the partial output. */
  fun release(deleteFile: Boolean) {
    if (!released) {
      released = true
      try {
        codec.stop()
      } catch (ignored: Exception) {
      }
      try {
        codec.release()
      } catch (ignored: Exception) {
      }
      try {
        if (muxerStarted) muxer.stop()
      } catch (ignored: Exception) {
      }
      try {
        muxer.release()
      } catch (ignored: Exception) {
      }
      muxerStarted = false
      loader.release()
    }
    if (deleteFile) file.delete()
  }

  private fun checkAlive() {
    if (aborted || released) throw EncoderException(ErrorCodes.STATE, "The encoder session was cancelled")
  }

  /** Waits for a free input buffer, draining output meanwhile; that wait is the back-pressure. */
  private fun dequeueInput(): Int {
    val deadline = System.nanoTime() + STALL_NS
    while (true) {
      checkAlive()
      val slot = codec.dequeueInputBuffer(POLL_US)
      if (slot >= 0) return slot
      drain(endOfStream = false)
      if (System.nanoTime() > deadline) throw EncoderException(ErrorCodes.IO, "The encoder stopped taking frames")
    }
  }

  /** Moves ready output into the muxer. With [endOfStream] it blocks until the codec reports the end of the stream. */
  private fun drain(endOfStream: Boolean) {
    var deadline = System.nanoTime() + STALL_NS
    while (true) {
      checkAlive()
      val slot = codec.dequeueOutputBuffer(info, if (endOfStream) POLL_US else 0)
      when {
        slot == MediaCodec.INFO_TRY_AGAIN_LATER -> {
          if (!endOfStream) return
          if (System.nanoTime() > deadline) throw EncoderException(ErrorCodes.IO, "The encoder did not finish")
        }
        slot == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          if (muxerStarted) throw EncoderException(ErrorCodes.IO, "The encoder changed its output format twice")
          track = muxer.addTrack(codec.outputFormat)
          muxer.start()
          muxerStarted = true
        }
        slot >= 0 -> {
          deadline = System.nanoTime() + STALL_NS
          val buffer = codec.getOutputBuffer(slot)
          val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (!isConfig && info.size > 0) {
            if (!muxerStarted || buffer == null) throw EncoderException(ErrorCodes.IO, "The encoder produced a sample before its format")
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            muxer.writeSampleData(track, buffer, info)
          }
          codec.releaseOutputBuffer(slot, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
      }
    }
  }

  /** Writes [rgba][FrameLoader.rgba] into the Y, U and V planes of [image], honouring their row and pixel strides. */
  private fun fill(image: Image) {
    if (image.width < canvasWidth || image.height < canvasHeight) {
      throw EncoderException(ErrorCodes.UNSUPPORTED, "The encoder input image is ${image.width}x${image.height}, smaller than ${canvasWidth}x$canvasHeight")
    }
    val rgba = loader.rgba
    val rowBytes = canvasWidth * RawFrameHeader.BYTES_PER_PIXEL
    val planes = image.planes
    val y = planes[0]
    for (row in 0 until canvasHeight) {
      Yuv.lumaRow(rgba, row * rowBytes, canvasWidth, lumaRow)
      store(y.buffer, row * y.rowStride, y.pixelStride, lumaRow, canvasWidth)
    }
    val u = planes[1]
    val v = planes[2]
    for (row in 0 until canvasHeight / 2) {
      Yuv.chromaRow(rgba, row * 2 * rowBytes, rowBytes, canvasWidth, chromaU, chromaV)
      store(u.buffer, row * u.rowStride, u.pixelStride, chromaU, canvasWidth / 2)
      store(v.buffer, row * v.rowStride, v.pixelStride, chromaV, canvasWidth / 2)
    }
  }

  /**
   * Writes [count] bytes of [row] at [start] with [pixelStride] bytes between samples. A stride of 1 is one bulk copy; a larger
   * one (interleaved chroma, where the other plane owns the bytes in between) writes sample by sample so it never clobbers them.
   */
  private fun store(target: ByteBuffer, start: Int, pixelStride: Int, row: ByteArray, count: Int) {
    if (pixelStride == 1) {
      target.position(start)
      target.put(row, 0, count)
    } else {
      var at = start
      for (x in 0 until count) {
        target.put(at, row[x])
        at += pixelStride
      }
    }
  }

  companion object {
    private const val POLL_US = 10_000L
    private const val STALL_NS = 10_000_000_000L

    /** Creates the output file, the encoder and the muxer, and starts the encoder. */
    fun open(config: EncoderConfig, file: File): VideoSession {
      val parent = file.parentFile
      if (parent != null && !parent.isDirectory && !parent.mkdirs() && !parent.isDirectory) {
        throw EncoderException(ErrorCodes.IO, "Cannot create the directory ${parent.path}")
      }
      if (file.exists() && !file.delete()) throw EncoderException(ErrorCodes.IO, "Cannot replace ${file.path}")
      val opened = CodecSupport.open(config)
      var muxer: MediaMuxer? = null
      try {
        muxer = MediaMuxer(file.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        opened.codec.start()
        return VideoSession(config, opened.width, opened.height, opened.codec, muxer, file)
      } catch (e: IOException) {
        cleanUp(opened.codec, muxer, file)
        throw EncoderException(ErrorCodes.IO, "Cannot open ${file.path}: ${e.message}", e)
      } catch (e: Exception) {
        cleanUp(opened.codec, muxer, file)
        throw EncoderException(ErrorCodes.UNSUPPORTED, "The H.264 encoder did not start: ${e.message}", e)
      }
    }

    private fun cleanUp(codec: MediaCodec, muxer: MediaMuxer?, file: File) {
      try {
        codec.release()
      } catch (ignored: Exception) {
      }
      try {
        muxer?.release()
      } catch (ignored: Exception) {
      }
      file.delete()
    }
  }
}
