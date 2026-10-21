package com.joyodigitama.huaweiwear

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class QuickRepliesTest {
  /** An update and a query answer differ only in the command value (7002 vs 7001): the last byte of tag 01. */
  private fun asQueryAnswer(update: ByteArray) = update.copyOf().also { it[5] = 0x59 }

  @Test
  fun queryIsTagOneWithCommand7001() {
    // tag 01, length 4, 7001 = 0x00001B59
    assertArrayEquals("0104 00001b59".replace(" ", "").hexToBytes(), QuickRepliesPacket.query())
  }

  @Test
  fun updateNestsOneObjectPerReplyInOrder() {
    val bytes = QuickRepliesPacket.update(listOf("OK", "Otw"))
    // 01 04 00001b5a | 82 0e { 83 04 { 04 02 "OK" } 83 05 { 04 03 "Otw" } }
    assertArrayEquals("0104 00001b5a 82 0d 83 04 04024f4b 83 05 0403 4f7477".replace(" ", "").hexToBytes(), bytes)
  }

  @Test
  fun updateEncodesUtf8() {
    val bytes = QuickRepliesPacket.update(listOf("Sip 👍"))
    assertEquals(listOf("Sip 👍"), QuickRepliesPacket.parseQuery(asQueryAnswer(bytes)))
  }

  @Test
  fun parseQuerySkipsEmptySlotsAndRejectsOtherCommands() {
    val answer = QuickRepliesPacket.update(listOf("Oke", "", "Siap"))
    assertEquals(listOf("Oke", "Siap"), QuickRepliesPacket.parseQuery(asQueryAnswer(answer)))
    assertNull(QuickRepliesPacket.parseQuery(QuickRepliesPacket.update(listOf("Oke"))))
  }

  @Test
  fun problemEnforcesCountLengthAndSingleLine() {
    assertNull(QuickRepliesPacket.problem(listOf("Otw")))
    assertNotNull(QuickRepliesPacket.problem(emptyList()))
    assertNull(QuickRepliesPacket.problem(List(QuickRepliesPacket.SLOTS) { "a$it" }))
    assertNotNull(QuickRepliesPacket.problem(List(QuickRepliesPacket.SLOTS + 1) { "a$it" }))
    assertNull(QuickRepliesPacket.problem(listOf("x".repeat(QuickRepliesPacket.MAX_LENGTH))))
    assertNotNull(QuickRepliesPacket.problem(listOf("x".repeat(QuickRepliesPacket.MAX_LENGTH + 1))))
    assertNotNull(QuickRepliesPacket.problem(listOf("  ")))
    assertNotNull(QuickRepliesPacket.problem(listOf("a\nb")))
  }

  @Test
  fun fingerprintChangesWithContentAndOrder() {
    val a = QuickRepliesPacket.fingerprint(listOf("Oke", "Siap"))
    assertEquals(a, QuickRepliesPacket.fingerprint(listOf("Oke", "Siap")))
    assertNotEquals(a, QuickRepliesPacket.fingerprint(listOf("Siap", "Oke")))
    assertNotEquals(a, QuickRepliesPacket.fingerprint(listOf("Oke")))
  }
}
