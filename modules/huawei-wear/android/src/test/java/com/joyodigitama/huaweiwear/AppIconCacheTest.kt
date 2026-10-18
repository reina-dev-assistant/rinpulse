package com.joyodigitama.huaweiwear

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppIconCacheTest {
  private fun cache() = AppIconCache(Files.createTempDirectory("icons").toFile().also { it.deleteOnExit() })

  @Test
  fun nameCarriesPackageAndVersion() {
    assertEquals("com.chat@1700.png", AppIconCache.fileName("com.chat", 1700))
    assertNotEquals(AppIconCache.fileName("com.chat", 1), AppIconCache.fileName("com.chat", 2))
    assertNotEquals(AppIconCache.fileName("com.a", 1), AppIconCache.fileName("com.b", 1))
  }

  @Test
  fun unsafeCharactersNeverEscapeTheDirectory() {
    val name = AppIconCache.fileName("../x/y", 5)
    assertFalse(name.contains("/"))
    assertTrue(cache().fileFor("../x/y", 5).parentFile.name.startsWith("icons"))
  }

  @Test
  fun missUntilStoredThenHit() {
    val c = cache()
    assertNull(c.cached("com.chat", 1))
    val file = c.store("com.chat", 1) { it.writeBytes(byteArrayOf(1, 2, 3)); true }
    assertEquals(file, c.cached("com.chat", 1))
  }

  @Test
  fun failedOrEmptyWriteLeavesNothing() {
    val c = cache()
    assertNull(c.store("com.chat", 1) { false })
    assertNull(c.store("com.chat", 1) { it.writeBytes(ByteArray(0)); true })
    assertNull(c.store("com.chat", 1) { throw IllegalStateException("boom") })
    assertNull(c.cached("com.chat", 1))
    assertEquals(0, c.fileFor("com.chat", 1).parentFile.listFiles()?.size ?: 0)
  }

  @Test
  fun emptyFileCountsAsMissing() {
    val c = cache()
    c.fileFor("com.chat", 1).also { it.parentFile.mkdirs() }.writeBytes(ByteArray(0))
    assertNull(c.cached("com.chat", 1))
  }

  @Test
  fun newVersionReplacesOldOnlyForSamePackage() {
    val c = cache()
    c.store("com.chat", 1) { it.writeBytes(byteArrayOf(1)); true }
    c.store("com.chat2", 1) { it.writeBytes(byteArrayOf(1)); true }
    c.store("com.chat", 2) { it.writeBytes(byteArrayOf(1)); true }
    assertNull(c.cached("com.chat", 1))
    assertTrue(c.cached("com.chat", 2) != null)
    assertTrue(c.cached("com.chat2", 1) != null)
  }
}
