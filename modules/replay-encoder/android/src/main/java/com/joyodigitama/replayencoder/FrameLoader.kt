package com.joyodigitama.replayencoder

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer

/**
 * Turns a frame file into the one RGBA buffer ([rgba], R, G, B, A byte order, opaque) the encoder reads, sized for the codec
 * canvas. The content area is `contentWidth` x `contentHeight` in the top-left corner; a larger codec canvas (the 16-aligned
 * retry) is padded with black. Everything is reused from frame to frame: one decode bitmap, one canvas bitmap, one byte array.
 * Single-threaded: only the session's executor calls it.
 */
internal class FrameLoader(
  private val canvasWidth: Int,
  private val canvasHeight: Int,
  private val contentWidth: Int,
  private val contentHeight: Int,
) {
  val rgba = ByteArray(canvasWidth * canvasHeight * RawFrameHeader.BYTES_PER_PIXEL)

  private val rgbaBuffer = ByteBuffer.wrap(rgba)
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  private var decoded: Bitmap? = null
  private var canvasBitmap: Bitmap? = null
  private var canvas: Canvas? = null
  private var rawScratch: ByteArray? = null

  /** Reads [file] into [rgba]. Throws ERR_ENCODER_FRAME when the file is missing or cannot be decoded. */
  fun load(file: File) {
    if (!file.isFile) throw EncoderException(ErrorCodes.FRAME, "Frame file not found: ${file.path}")
    try {
      if (file.name.endsWith(".raw", ignoreCase = true)) loadRaw(file) else loadEncoded(file)
    } catch (e: EncoderException) {
      throw e
    } catch (e: IOException) {
      throw EncoderException(ErrorCodes.FRAME, "Cannot read frame ${file.name}: ${e.message}", e)
    } catch (e: OutOfMemoryError) {
      throw EncoderException(ErrorCodes.IO, "Out of memory decoding frame ${file.name}", e)
    }
  }

  fun release() {
    decoded?.recycle()
    canvasBitmap?.recycle()
    decoded = null
    canvasBitmap = null
    canvas = null
    rawScratch = null
  }

  private fun loadRaw(file: File) {
    RandomAccessFile(file, "r").use { raf ->
      val length = raf.length()
      val head = ByteArray(minOf(RawFrameHeader.MAX_HEADER_BYTES.toLong(), length).toInt())
      raf.readFully(head)
      val header = RawFrameHeader.parse(head)
      header.checkFileLength(length)
      raf.seek(header.payloadOffset.toLong())
      if (header.width == canvasWidth && header.height == canvasHeight && canvasWidth == contentWidth && canvasHeight == contentHeight) {
        raf.readFully(rgba, 0, header.payloadBytes)
        return
      }
      val scratch = rawScratch?.takeIf { it.size >= header.payloadBytes } ?: ByteArray(header.payloadBytes).also { rawScratch = it }
      raf.readFully(scratch, 0, header.payloadBytes)
      val bitmap = Bitmap.createBitmap(header.width, header.height, Bitmap.Config.ARGB_8888)
      try {
        bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(scratch, 0, header.payloadBytes))
        compose(bitmap)
      } finally {
        bitmap.recycle()
      }
    }
  }

  private fun loadEncoded(file: File) {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw EncoderException(ErrorCodes.FRAME, "Not a PNG, JPEG or WEBP image: ${file.name}")
    }
    val sample = FitRect.sampleSize(bounds.outWidth, bounds.outHeight, contentWidth, contentHeight)
    val options = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inMutable = true
      inScaled = false
    }
    val needed = ((bounds.outWidth + sample - 1) / sample).toLong() * ((bounds.outHeight + sample - 1) / sample) * RawFrameHeader.BYTES_PER_PIXEL
    val reusable = decoded?.takeIf { !it.isRecycled && it.isMutable && it.allocationByteCount >= needed }
    var bitmap: Bitmap? = null
    if (reusable != null) {
      options.inBitmap = reusable
      bitmap = try {
        BitmapFactory.decodeFile(file.path, options)
      } catch (e: IllegalArgumentException) {
        null
      }
      if (bitmap == null) options.inBitmap = null
    }
    if (bitmap == null) bitmap = BitmapFactory.decodeFile(file.path, options)
    if (bitmap == null) throw EncoderException(ErrorCodes.FRAME, "Cannot decode frame ${file.name}")
    if (bitmap !== decoded) decoded?.recycle()
    decoded = bitmap
    compose(bitmap)
  }

  /** Copies [bitmap] into [rgba]: straight when it already is the canvas size, else scaled to fill the content area over black. */
  private fun compose(bitmap: Bitmap) {
    val exact = bitmap.width == canvasWidth && bitmap.height == canvasHeight && canvasWidth == contentWidth && canvasHeight == contentHeight
    if (exact && bitmap.config == Bitmap.Config.ARGB_8888 && bitmap.rowBytes == canvasWidth * RawFrameHeader.BYTES_PER_PIXEL) {
      rgbaBuffer.rewind()
      bitmap.copyPixelsToBuffer(rgbaBuffer)
      return
    }
    val target = canvasBitmap ?: Bitmap.createBitmap(canvasWidth, canvasHeight, Bitmap.Config.ARGB_8888).also {
      canvasBitmap = it
      canvas = Canvas(it)
    }
    val surface = canvas!!
    surface.drawColor(Color.BLACK)
    val fit = FitRect.fit(bitmap.width, bitmap.height, contentWidth, contentHeight, FitRect.Mode.COVER)
    surface.save()
    surface.clipRect(0, 0, contentWidth, contentHeight)
    surface.drawBitmap(bitmap, null, Rect(fit.left, fit.top, fit.left + fit.width, fit.top + fit.height), paint)
    surface.restore()
    rgbaBuffer.rewind()
    target.copyPixelsToBuffer(rgbaBuffer)
  }
}
