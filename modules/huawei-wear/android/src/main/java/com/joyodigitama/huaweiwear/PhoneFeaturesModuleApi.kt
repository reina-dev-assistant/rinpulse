package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder
import kotlinx.coroutines.launch

/**
 * The find-my-watch / find-my-phone / calls / alarms part of the `HuaweiWear` module
 * (`findWatch` ... `setAlarms` in `HuaweiWearModule.ts`). Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.phoneFeaturesApi(runtime: () -> WearRuntime) {
  AsyncFunction("findWatch") Coroutine { start: Boolean ->
    runtime().features.findWatch(start)
  }

  Function("getPhoneFeatures") {
    runtime().features.status()
  }

  AsyncFunction("setFindPhoneEnabled") { enabled: Boolean ->
    val features = runtime().features
    features.settings.findPhoneEnabled = enabled
    // Switching it off while ringing must also silence the phone.
    if (!enabled) {
      features.stopFindPhone("Find my phone switched off")
    }
    Unit
  }

  AsyncFunction("setCallsEnabled") { enabled: Boolean ->
    runtime().features.settings.callsEnabled = enabled
  }

  AsyncFunction("setCallControlEnabled") { enabled: Boolean ->
    runtime().features.settings.callControlEnabled = enabled
  }

  AsyncFunction("setMusicEnabled") { enabled: Boolean ->
    val music = runtime().music
    music.settings.musicEnabled = enabled
    // Turning it on tells the watch what is playing right now instead of waiting for the next change.
    if (enabled) {
      runtime().scope.launch {
        try {
          music.push(force = true)
        } catch (e: Exception) {
          // Nothing to do: the next track change will try again.
        }
      }
    }
  }

  Function("getAlarms") {
    runtime().features.cachedAlarms().toJs()
  }

  AsyncFunction("refreshAlarms") Coroutine { ->
    runtime().features.refreshAlarms().toJs()
  }

  AsyncFunction("setAlarms") Coroutine { alarms: WatchAlarmsRecord ->
    runtime().features.setAlarms(alarms.toData()).toJs()
  }
}
