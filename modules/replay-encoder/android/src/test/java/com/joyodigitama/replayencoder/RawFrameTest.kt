package com.joyodigitama.replayencoder

import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class RawFrameTest {
  private fun bytes(text: String) = text.toByteArray(Charsets.US_ASCII)

  private fun assertMalformed(data: ByteArray, length: Int = data.size) {
    try {
      RawFrameHeader.parse(data, length)
      fail("expected ERR_ENCODER_FRAME for '${String(data, Charsets.ISO_8859_1)}'")
    } catch (e: EncoderException) {
      assertEquals(ErrorCodes.FRAME, e.code)
    }
  }

  @Test
  fun parsesTheViewShotHeader() {
    assertEquals(RawFrameHeader(1080, 1920, 10), RawFrameHeader.parse(bytes("1080:1920|")))
  }

  @Test
  fun ignoresThePixelsAfterTheHeader() {
    val file = bytes("2:2|") + ByteArray(16) { 0x7C }
    assertEquals(RawFrameHeader(2, 2, 4), RawFrameHeader.parse(file))
    assertEquals(RawFrameHeader(2, 2, 4), RawFrameHeader.parse(file, 8))
  }

  @Test
  fun theExpectedLengthIsHeaderPlusFourBytesPerPixel() {
    val header = RawFrameHeader.parse(bytes("1080:1920|"))
    assertEquals(1080 * 1920 * 4, header.payloadBytes)
    header.checkFileLength(10L + 1080 * 1920 * 4)
  }

  @Test
  fun aTruncatedOrOversizedFileIsRejected() {
    val header = RawFrameHeader.parse(bytes("4:4|"))
    header.checkFileLength(4L + 64)
    for (length in listOf(4L + 63, 4L + 65, 0L, 4L)) {
      try {
        header.checkFileLength(length)
        fail("expected a rejection for length $length")
      } catch (e: EncoderException) {
        assertEquals(ErrorCodes.FRAME, e.code)
      }
    }
  }

  @Test
  fun malformedHeadersAreRejected() {
    for (text in listOf("", "|", "1080|", "1080:|", ":1920|", "1080:1920", "1080x1920|", "-1:5|", "0:5|", "5:0|", "1 080:1920|", "1080:1920:|", "99999999999:1|", "8193:2|", "8192:8192|")) {
      assertMalformed(bytes(text))
    }
  }

  @Test
  fun aHeaderCutOffByTheReadLengthIsRejected() {
    assertMalformed(bytes("1080:1920|"), 9)
    assertMalformed(bytes("1080:1920|"), 0)
  }

  @Test
  fun aHeaderThatIsTooLongIsRejected() {
    assertMalformed(bytes("123456789012:1|"))
  }
}
