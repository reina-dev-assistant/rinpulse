package com.joyodigitama.huaweiwear

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Two watches keep two identities (docs/multi-watch.md section 1): auth key, fake MAC, fake Android id and bond flag are per address. */
class DeviceIdentityIndependenceTest {
  private val a = "AA:AA:AA:AA:AA:01"
  private val b = "BB:BB:BB:BB:BB:02"

  private val files = HashMap<String, MemoryPrefs>()
  private val store = DeviceStore { name -> files.getOrPut(name) { MemoryPrefs() } }

  /** What a completed first bind leaves behind. */
  private fun bind(address: String): DeviceIdentity {
    val identity = store.forDevice(address)
    identity.ensureCreated()
    identity.createSecretKey()
    identity.markBonded()
    return identity
  }

  @Test
  fun everyWatchHasItsOwnPreferenceFile() {
    assertEquals("huawei_wear_AAAAAAAAAA01", identityPrefsName(a))
    assertNotEquals(identityPrefsName(a), identityPrefsName(b))
    // the same watch under another spelling is the same file
    assertEquals(identityPrefsName(a), identityPrefsName(a.lowercase()))
    bind(a)
    bind(b)
    assertEquals(setOf(identityPrefsName(a), identityPrefsName(b)), files.keys)
  }

  @Test
  fun twoWatchesHaveIndependentIdentities() {
    val first = bind(a)
    val second = bind(b)
    assertNotEquals(first.authKey!!.toList(), second.authKey!!.toList())
    assertNotEquals(first.macAddress, second.macAddress)
    assertNotEquals(first.androidId, second.androidId)
    assertFalse(first.isFirstConnection)
    assertFalse(second.isFirstConnection)
  }

  @Test
  fun aBondOfOneWatchDoesNotBondTheOther() {
    bind(a)
    assertTrue(store.forDevice(b).isFirstConnection)
    assertNull(store.forDevice(b).authKey)
  }

  @Test
  fun bindingTheSecondWatchLeavesTheFirstOnesStoredKeyAlone() {
    val first = bind(a)
    val key = first.authKey!!.copyOf()
    val mac = first.macAddress
    val androidId = first.androidId
    val before = HashMap(files.getValue(identityPrefsName(a)).values)

    val second = store.forDevice(b)
    second.ensureCreated()
    second.createSecretKey()
    second.authKey = ByteArray(16) { 0x42 }
    second.markBonded()

    val again = store.forDevice(a)
    assertArrayEquals(key, again.authKey)
    assertEquals(mac, again.macAddress)
    assertEquals(androidId, again.androidId)
    assertFalse(again.isFirstConnection)
    assertEquals(before, files.getValue(identityPrefsName(a)).values)
  }

  @Test
  fun forgettingOneWatchLeavesTheOtherUntouched() {
    bind(a)
    val second = bind(b)
    val key = second.authKey!!.copyOf()
    val mac = second.macAddress
    val androidId = second.androidId
    val before = HashMap(files.getValue(identityPrefsName(b)).values)

    store.forget(a)

    val forgotten = store.forDevice(a)
    assertTrue(forgotten.isFirstConnection)
    assertNull(forgotten.authKey)
    assertTrue(files.getValue(identityPrefsName(a)).values.isEmpty())

    val kept = store.forDevice(b)
    assertFalse(kept.isFirstConnection)
    assertArrayEquals(key, kept.authKey)
    assertEquals(mac, kept.macAddress)
    assertEquals(androidId, kept.androidId)
    assertEquals(before, files.getValue(identityPrefsName(b)).values)
  }

  @Test
  fun pairingAForgottenWatchAgainDoesNotTouchTheOther() {
    bind(a)
    val second = bind(b)
    val key = second.authKey!!.copyOf()
    store.forget(a)
    val rebound = bind(a)
    assertFalse(rebound.isFirstConnection)
    assertArrayEquals(key, store.forDevice(b).authKey)
  }

  @Test
  fun theLabIdentityOfOneWatchIsNotTheOthersIdentity() {
    bind(a)
    val lab = store.forLab(b, "t1")
    lab.ensureCreated()
    lab.createSecretKey()
    lab.markBonded()
    assertTrue(store.forDevice(b).isFirstConnection)
    store.adoptLab(b, "t1")
    assertFalse(store.forDevice(b).isFirstConnection)
    assertFalse(store.forDevice(a).isFirstConnection)
  }
}
