package com.joyodigitama.huaweiwear

import java.util.Locale
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.LocaleConfig
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The language the watch is told (SetLanguageSetting, service 0C): Huawei Health's `xx-YY` with Java's legacy language codes, the app's
 * pinned language over the phone's, the script only for watches with ExpandCapability 57.
 */
class WatchLocaleTest {
  @After
  fun resetCaps() = DeviceCaps.reset()

  private fun tag(locale: Locale, scriptCapable: Boolean = false) = WatchLocale.tag(locale, scriptCapable)

  private fun resolve(pinned: String?, phone: Locale, scriptCapable: Boolean = false) = WatchLocale.resolve(pinned, phone, scriptCapable)

  // The phone's language

  @Test
  fun indonesianIsTheLegacyInNotId() {
    // Huawei Health's CommonUtil.c(Locale): "id" -> "in". Android reports "in" itself; a JVM 17 reports "id".
    assertEquals("in-ID", tag(Locale.forLanguageTag("id-ID")))
    assertEquals("in-ID", tag(Locale("in", "ID")))
  }

  @Test
  fun hebrewAndYiddishAreLegacyToo() {
    assertEquals("iw-IL", tag(Locale.forLanguageTag("he-IL")))
    assertEquals("ji-US", tag(Locale.forLanguageTag("yi-US")))
  }

  @Test
  fun englishKeepsItsCountry() {
    assertEquals("en-US", tag(Locale.forLanguageTag("en-US")))
    assertEquals("en-GB", tag(Locale.forLanguageTag("en-GB")))
    assertEquals("en-ID", tag(Locale.forLanguageTag("en-ID")))
  }

  @Test
  fun aLanguageWithoutCountryGetsItsUsualOne() {
    assertEquals("in-ID", tag(Locale("id")))
    assertEquals("en-US", tag(Locale("en")))
    assertEquals("zh-CN", tag(Locale("zh")))
    // The generic fallback, as Gadgetbridge has it: the language, upper case.
    assertEquals("fr-FR", tag(Locale("fr")))
  }

  @Test
  fun anEmptyLanguageIsEnglish() {
    assertEquals("en-US", tag(Locale.ROOT))
  }

  @Test
  fun traditionalChineseOutsideTaiwanAndHongKongIsChtWithoutTheScriptCapability() {
    val singapore = Locale.Builder().setLanguage("zh").setRegion("SG").setScript("Hant").build()
    assertEquals("zh-CHT", tag(singapore))
    assertEquals("zh-TW", tag(Locale.Builder().setLanguage("zh").setRegion("TW").setScript("Hant").build()))
    assertEquals("zh-HK", tag(Locale.Builder().setLanguage("zh").setRegion("HK").setScript("Hant").build()))
    assertEquals("zh-CN", tag(Locale.Builder().setLanguage("zh").setRegion("CN").setScript("Hans").build()))
    assertEquals("zh-CN", tag(Locale.forLanguageTag("zh-CN")))
    // With the capability the script is its own tag and the language tag stays plain.
    assertEquals("zh-SG", tag(singapore, scriptCapable = true))
  }

  // The app's pinned language over the phone's

  @Test
  fun followingThePhoneUsesThePhonesLanguage() {
    assertEquals(WatchLocale.Setting("in-ID", null), resolve(null, Locale.forLanguageTag("id-ID")))
    assertEquals(WatchLocale.Setting("en-US", null), resolve(null, Locale.forLanguageTag("en-US")))
    assertEquals(WatchLocale.Setting("in-ID", null), resolve("  ", Locale.forLanguageTag("id-ID")))
  }

  @Test
  fun aPinnedAppLanguageBeatsThePhone() {
    assertEquals("in-ID", resolve("id", Locale.forLanguageTag("en-US")).tag)
    assertEquals("en-US", resolve("en", Locale.forLanguageTag("id-ID")).tag)
  }

  @Test
  fun aPinnedTagCanCarryACountryAndUnderscores() {
    assertEquals("en-GB", resolve("en-GB", Locale.forLanguageTag("id-ID")).tag)
    assertEquals("in-ID", resolve("id_ID", Locale.forLanguageTag("en-US")).tag)
  }

  @Test
  fun aPinnedTagThatIsNotALanguageFallsBackToThePhone() {
    assertEquals("in-ID", resolve("und", Locale.forLanguageTag("id-ID")).tag)
    assertEquals("en-US", resolve("!!", Locale.forLanguageTag("en-US")).tag)
  }

  // The script

  @Test
  fun theScriptIsSentOnlyWithTheCapability() {
    val latin = Locale.Builder().setLanguage("id").setRegion("ID").setScript("Latn").build()
    assertNull(resolve(null, latin, scriptCapable = false).script)
    assertEquals("Latn", resolve(null, latin, scriptCapable = true).script)
    // No script on the locale: nothing to send, with or without the capability.
    assertNull(resolve(null, Locale.forLanguageTag("id-ID"), scriptCapable = true).script)
  }

  @Test
  fun theScriptCapabilityIsExpandCapability57() {
    assertEquals(57, WatchLocale.SCRIPT_CAPABILITY)
  }

  // The request

  @Test
  fun theWatchMustListServiceZeroCCommandOne() {
    DeviceCaps.reset()
    assertFalse(LanguageSender.supported())
    DeviceCaps.supportedCommands = mapOf(0x0C to byteArrayOf(0x01))
    assertTrue(LanguageSender.supported())
    DeviceCaps.supportedCommands = mapOf(0x0C to byteArrayOf(0x02))
    assertFalse(LanguageSender.supported())
  }

  @Test
  fun requestIsServiceZeroCCommandOne() {
    val params = HuaweiPacket.ParamsProvider().also { it.setSecretKey(ByteArray(16)) }
    val frames = LocaleConfig.SetLanguageSetting(params, "in-ID".toByteArray(), LocaleConfig.MeasurementSystem.metric, null).serialize()
    assertEquals(1, frames.size)
    assertEquals(0x5A.toByte(), frames[0][0])
    assertEquals(0x0C.toByte(), frames[0][4])
    assertEquals(0x01.toByte(), frames[0][5])
  }
}
