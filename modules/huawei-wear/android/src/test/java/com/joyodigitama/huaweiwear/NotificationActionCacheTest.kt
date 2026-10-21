package com.joyodigitama.huaweiwear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationActionCacheTest {
  @Test
  fun cacheStoresAndRetrievesByKeyAndId() {
    val cache = NotificationActionCache(maxEntries = 5)

    val action = CachedReplyAction(
      key = "0|com.whatsapp|42|null|10001",
      notificationId = 42,
      packageName = "com.whatsapp",
    )

    cache.store(action)

    // Lookup by exact primary key
    val byKey = cache.find("0|com.whatsapp|42|null|10001")
    assertNotNull(byKey)
    assertEquals("0|com.whatsapp|42|null|10001", byKey?.key)
    assertEquals(42, byKey?.notificationId)
    assertEquals("com.whatsapp", byKey?.packageName)

    // Lookup by exact integer notificationId parameter
    val byId = cache.find("", notificationId = 42)
    assertNotNull(byId)
    assertEquals("com.whatsapp", byId?.packageName)

    // Lookup by wrong key without matching notificationId returns null
    val byParam = cache.find("unknown_key", notificationId = 999)
    assertNull(byParam)
  }

  @Test
  fun nonMatchingKeyReturnsNullWithoutFuzzyGuessing() {
    val cache = NotificationActionCache(maxEntries = 5)

    val action = CachedReplyAction(
      key = "0|com.telegram|100||0",
      notificationId = 100,
      packageName = "com.telegram",
    )

    cache.store(action)

    // Partial substring or package fragment without exact key MUST return null (zero guessing)
    assertNull(cache.find("com.telegram"))
    assertNull(cache.find("telegram"))
    assertNull(cache.find("0|com.telegram"))
  }

  @Test
  fun cacheEvictsEldestWhenExceedingCapacity() {
    val cache = NotificationActionCache(maxEntries = 2)

    val a1 = CachedReplyAction(key = "key1", notificationId = 1, packageName = "p1")
    val a2 = CachedReplyAction(key = "key2", notificationId = 2, packageName = "p2")
    val a3 = CachedReplyAction(key = "key3", notificationId = 3, packageName = "p3")

    cache.store(a1)
    cache.store(a2)
    cache.store(a3)

    // a1 should be evicted because maxEntries = 2
    assertNull(cache.find("key1"))
    assertNotNull(cache.find("key2"))
    assertNotNull(cache.find("key3"))
  }

  @Test
  fun removeDeletesFromCache() {
    val cache = NotificationActionCache(maxEntries = 5)
    val action = CachedReplyAction(key = "test_key", notificationId = 99, packageName = "test")

    cache.store(action)
    assertNotNull(cache.find("test_key"))

    cache.remove("test_key")
    assertNull(cache.find("test_key"))
  }

  @Test
  fun expiredActionsAreCleanedUp() {
    val cache = NotificationActionCache(maxEntries = 5)
    val expiredTime = System.currentTimeMillis() - 7200_000L // 2 hours ago

    val expiredAction = CachedReplyAction(
      key = "old_key",
      notificationId = 77,
      packageName = "old",
      timestamp = expiredTime,
    )

    cache.store(expiredAction)

    // Searching should trigger cleanExpired and return null
    assertNull(cache.find("old_key"))
  }

  @Test
  fun emptyKeyWithMultipleEntriesDoesNotFalseMatch() {
    val cache = NotificationActionCache(maxEntries = 5)
    val a1 = CachedReplyAction(key = "0|com.whatsapp|1||0", notificationId = 1, packageName = "whatsapp")
    val a2 = CachedReplyAction(key = "0|com.telegram|2||0", notificationId = 2, packageName = "telegram")

    cache.store(a1)
    cache.store(a2)

    // Empty or whitespace-only key with 2 items must NOT fuzzy-match the first item
    assertNull(cache.find(""))
    assertNull(cache.find("   "))
  }

  @Test
  fun subIdMatchesWhenKeyIsBlank() {
    val cache = NotificationActionCache(maxEntries = 5)
    val a1 = CachedReplyAction(key = "0|com.whatsapp|1||0", notificationId = 1, packageName = "whatsapp")
    val a2 = CachedReplyAction(key = "0|com.telegram|2||0", notificationId = 2, packageName = "telegram")

    cache.store(a1)
    cache.store(a2)

    // Even if key is blank, passing notificationId parameter retrieves the exact target
    val found = cache.find("", notificationId = 2)
    assertNotNull(found)
    assertEquals("telegram", found?.packageName)
  }

  @Test
  fun blankKeyWithoutIdReturnsNullWithoutGuessing() {
    val cache = NotificationActionCache(maxEntries = 5)
    val single = CachedReplyAction(key = "0|com.whatsapp|1||0", notificationId = 1, packageName = "whatsapp")

    cache.store(single)

    // Even if only 1 entry exists in cache, blank or unknown key without matching ID MUST return null
    assertNull(cache.find(""))
    assertNull(cache.find("   "))
    assertNull(cache.find("unknown_key"))
  }

  @Test
  fun concurrentStressTestDoesNotThrow() {
    val cache = NotificationActionCache(maxEntries = 20)
    val threads = (1..8).map { threadIdx ->
      Thread {
        for (i in 1..100) {
          val id = threadIdx * 1000 + i
          val action = CachedReplyAction(
            key = "key_$id",
            notificationId = id,
            packageName = "pkg_$threadIdx",
          )
          cache.store(action)
          cache.find("key_$id", notificationId = id)
        }
      }
    }

    threads.forEach { it.start() }
    threads.forEach { it.join() }

    // Cache capacity must strictly obey maxEntries = 20
    assertEquals(20, cache.size)
    var count = 0
    for (threadIdx in 1..8) {
      for (i in 1..100) {
        val id = threadIdx * 1000 + i
        if (cache.find("key_$id") != null) count++
      }
    }
    assertEquals(20, count)
  }

  @Test
  fun restoringKeyWithNewIdRemovesOldIdFromMapping() {
    val cache = NotificationActionCache(maxEntries = 5)
    val key = "0|com.whatsapp|chat1||0"

    val a1 = CachedReplyAction(key = key, notificationId = 10, packageName = "com.whatsapp")
    cache.store(a1)

    assertEquals("com.whatsapp", cache.find("", notificationId = 10)?.packageName)

    // Chat updates: new notification arrives with same primary key but new notification ID
    val a2 = CachedReplyAction(key = key, notificationId = 20, packageName = "com.whatsapp")
    cache.store(a2)

    // New ID must resolve to the action
    val byNewId = cache.find("", notificationId = 20)
    assertNotNull(byNewId)
    assertEquals(20, byNewId?.notificationId)

    // Old ID must be removed from idToKey, returning null
    assertNull(cache.find("", notificationId = 10))
  }

  @Test(expected = IllegalStateException::class)
  fun sendReplyThrowsWhenMissingPendingIntent() {
    val action = CachedReplyAction(
      key = "test_key",
      notificationId = 1,
      packageName = "test",
      actionIntent = null,
    )
    val context = android.content.ContextWrapper(null)
    NotificationActionCache.sendReply(context, action, "test")
  }
}
