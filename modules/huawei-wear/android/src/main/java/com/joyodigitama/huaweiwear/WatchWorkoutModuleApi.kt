package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * The phone-started watch workout part of the `HuaweiWear` module (`getWatchWorkout` ... `stopWatchWorkout` in `HuaweiWearModule.ts`),
 * kept out of [HuaweiWearModule]. Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.watchWorkoutApi(runtime: () -> WearRuntime) {
  Function("getWatchWorkout") {
    runtime().watchWorkout.status()
  }

  AsyncFunction("startWatchWorkout") Coroutine { sport: Int ->
    runtime().watchWorkout.start(sport).toJs()
  }

  AsyncFunction("pauseWatchWorkout") Coroutine { ->
    runtime().watchWorkout.pause().toJs()
  }

  AsyncFunction("resumeWatchWorkout") Coroutine { ->
    runtime().watchWorkout.resume().toJs()
  }

  AsyncFunction("stopWatchWorkout") Coroutine { ->
    runtime().watchWorkout.stop().toJs()
  }
}
