package com.joyodigitama.huaweiwear

import android.content.SharedPreferences

/** [SharedPreferences] held in a map, for the JVM: the android.jar stubs do nothing. */
internal class MemoryPrefs : SharedPreferences {
  val values = HashMap<String, Any?>()

  private inner class Edit : SharedPreferences.Editor {
    private val pending = HashMap<String, Any?>()
    private var clear = false

    override fun putString(key: String, value: String?) = apply { pending[key] = value }
    override fun putStringSet(key: String, values: MutableSet<String>?) = apply { pending[key] = values }
    override fun putInt(key: String, value: Int) = apply { pending[key] = value }
    override fun putLong(key: String, value: Long) = apply { pending[key] = value }
    override fun putFloat(key: String, value: Float) = apply { pending[key] = value }
    override fun putBoolean(key: String, value: Boolean) = apply { pending[key] = value }
    override fun remove(key: String) = apply { pending[key] = null }
    override fun clear() = apply { clear = true }
    override fun commit(): Boolean {
      apply()
      return true
    }

    override fun apply() {
      if (clear) values.clear()
      for ((key, value) in pending) if (value == null) values.remove(key) else values[key] = value
    }
  }

  override fun getAll(): MutableMap<String, *> = values
  override fun getString(key: String, defValue: String?) = values[key] as String? ?: defValue
  override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? = defValues
  override fun getInt(key: String, defValue: Int) = values[key] as Int? ?: defValue
  override fun getLong(key: String, defValue: Long) = values[key] as Long? ?: defValue
  override fun getFloat(key: String, defValue: Float) = values[key] as Float? ?: defValue
  override fun getBoolean(key: String, defValue: Boolean) = values[key] as Boolean? ?: defValue
  override fun contains(key: String) = values.containsKey(key)
  override fun edit(): SharedPreferences.Editor = Edit()
  override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
  override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
}
