package com.joyodigitama.huaweiwear

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * Satellite data (A-GPS / ephemeris) of the `HuaweiWear` module (`getAgps` ... `cancelAgps` in `HuaweiWearModule.ts`).
 * Call once from the module definition.
 */
internal fun ModuleDefinitionBuilder.agpsApi(runtime: () -> WearRuntime) {
  Function("getAgps") {
    runtime().ephemeris.status()
  }

  AsyncFunction("refreshAgps") Coroutine { ->
    runtime().ephemeris.refreshNow()
  }

  AsyncFunction("cancelAgps") Coroutine { ->
    runtime().ephemeris.cancel()
  }
}
