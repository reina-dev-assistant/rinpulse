package com.joyodigitama.replayencoder

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecCapabilities
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecList
import android.media.MediaFormat

/** Finds and configures an H.264 encoder that takes CPU-filled YUV 4:2:0 input buffers. */
internal object CodecSupport {
  private const val MIME = MediaFormat.MIMETYPE_VIDEO_AVC
  private const val FLEXIBLE = CodecCapabilities.COLOR_FormatYUV420Flexible

  /** A configured, not yet started encoder and the frame size it was configured with (the request, or that rounded up to 16). */
  class Opened(val codec: MediaCodec, val width: Int, val height: Int)

  private fun avcEncoders(): List<MediaCodecInfo> =
    MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { info ->
      info.isEncoder && info.supportedTypes.any { it.equals(MIME, ignoreCase = true) }
    }

  private fun capabilities(info: MediaCodecInfo): CodecCapabilities? =
    try {
      info.getCapabilitiesForType(MIME)
    } catch (e: IllegalArgumentException) {
      null
    }

  private fun takesFlexibleInput(info: MediaCodecInfo): Boolean = capabilities(info)?.colorFormats?.contains(FLEXIBLE) == true

  /** `EncoderSupport` in `ReplayEncoder.types.ts`. Never throws: a codec list that cannot be read means "not available". */
  fun support(): Map<String, Any> =
    try {
      query()
    } catch (e: Exception) {
      mapOf("available" to false, "h264" to false, "maxWidth" to 0, "maxHeight" to 0)
    }

  private fun query(): Map<String, Any> {
    val encoders = avcEncoders()
    val usable = encoders.filter { takesFlexibleInput(it) }
    var maxWidth = 0
    var maxHeight = 0
    for (info in usable) {
      val video = capabilities(info)?.videoCapabilities ?: continue
      maxWidth = maxOf(maxWidth, video.supportedWidths.upper)
      maxHeight = maxOf(maxHeight, video.supportedHeights.upper)
    }
    return mapOf("available" to usable.isNotEmpty(), "h264" to encoders.isNotEmpty(), "maxWidth" to maxWidth, "maxHeight" to maxHeight)
  }

  /**
   * Configures the first H.264 encoder that accepts the request. Per encoder: the requested size with the High (else Baseline)
   * profile hint, then without hints; only when the encoder reports the requested size as unsupported, the size rounded up to a
   * multiple of 16 the same way. Throws ERR_ENCODER_UNSUPPORTED when none configures.
   */
  fun open(config: EncoderConfig): Opened {
    val candidates = avcEncoders().filter { takesFlexibleInput(it) }
    if (candidates.isEmpty()) throw EncoderException(ErrorCodes.UNSUPPORTED, "No H.264 encoder takes YUV 4:2:0 input on this device")
    var lastError: Throwable? = null

    fun configured(info: MediaCodecInfo, caps: CodecCapabilities, width: Int, height: Int): MediaCodec? {
      val profile = pickProfile(caps)
      for (withHints in if (profile != null) listOf(true, false) else listOf(false)) {
        val codec = try {
          MediaCodec.createByCodecName(info.name)
        } catch (e: Exception) {
          lastError = e
          return null
        }
        try {
          codec.configure(format(config, width, height, caps, if (withHints) profile else null), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
          return codec
        } catch (e: Exception) {
          lastError = e
          try {
            codec.release()
          } catch (ignored: Exception) {
          }
        }
      }
      return null
    }

    for (info in candidates) {
      val caps = capabilities(info) ?: continue
      configured(info, caps, config.width, config.height)?.let { return Opened(it, config.width, config.height) }
      val sizeSupported = try {
        caps.videoCapabilities?.isSizeSupported(config.width, config.height) ?: true
      } catch (e: Exception) {
        true
      }
      if (sizeSupported) continue
      val width = EncoderConfig.alignUp16(config.width)
      val height = EncoderConfig.alignUp16(config.height)
      if (width == config.width && height == config.height) continue
      configured(info, caps, width, height)?.let { return Opened(it, width, height) }
    }
    throw EncoderException(ErrorCodes.UNSUPPORTED, "No H.264 encoder on this device accepts ${config.width}x${config.height}", lastError)
  }

  /** High profile at the encoder's top level when it has one, else Baseline; null when it reports neither. */
  private fun pickProfile(caps: CodecCapabilities): Pair<Int, Int>? {
    val levels = caps.profileLevels ?: return null
    for (profile in intArrayOf(CodecProfileLevel.AVCProfileHigh, CodecProfileLevel.AVCProfileBaseline)) {
      val top = levels.filter { it.profile == profile }.maxOfOrNull { it.level } ?: continue
      return Pair(profile, top)
    }
    return null
  }

  private fun format(config: EncoderConfig, width: Int, height: Int, caps: CodecCapabilities, profile: Pair<Int, Int>?): MediaFormat {
    val format = MediaFormat.createVideoFormat(MIME, width, height)
    format.setInteger(MediaFormat.KEY_COLOR_FORMAT, FLEXIBLE)
    format.setInteger(MediaFormat.KEY_BIT_RATE, config.bitrate)
    format.setInteger(MediaFormat.KEY_FRAME_RATE, config.fps)
    format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    val rate = caps.encoderCapabilities
    if (rate != null) {
      val mode = when {
        rate.isBitrateModeSupported(MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR) -> MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR
        rate.isBitrateModeSupported(MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR) -> MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR
        else -> null
      }
      if (mode != null) format.setInteger(MediaFormat.KEY_BITRATE_MODE, mode)
    }
    if (profile != null) {
      format.setInteger(MediaFormat.KEY_PROFILE, profile.first)
      format.setInteger(MediaFormat.KEY_LEVEL, profile.second)
    }
    return format
  }
}
