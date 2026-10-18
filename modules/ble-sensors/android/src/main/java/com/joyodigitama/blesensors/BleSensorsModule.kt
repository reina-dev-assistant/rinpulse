package com.joyodigitama.blesensors

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** `WorkoutSessionOptions` in `BleSensors.types.ts`. */
class WorkoutSessionOptionsRecord : Record {
  @Field var title: String = ""
  @Field var text: String = ""
  @Field var gps: Boolean = false
  @Field var openUrl: String? = null
  @Field var controls: WorkoutControlsRecord? = null
}

/** `WorkoutControls` in `BleSensors.types.ts`. */
class WorkoutControlsRecord : Record {
  @Field var locale: String = "en"
  @Field var paused: String = ""
  @Field var pause: String = ""
  @Field var resume: String = ""
  @Field var lap: String = ""
}

/** `WorkoutSessionState` in `BleSensors.types.ts`. */
class WorkoutSessionStateRecord : Record {
  @Field var movingSec: Int = 0
  @Field var distanceM: Double = 0.0
  @Field var hr: Int? = null
  @Field var paused: Boolean = false
}

/**
 * Expo module implementing `BleSensorsModule.ts`. The work lives in the process-wide [SensorHub] and [WorkoutSession]; this
 * class wires the TS contract to them and forwards their events to JS while the module is alive. Destroying the module does
 * not disconnect sensors or end the workout: a recording may continue across a JS reload.
 */
class BleSensorsModule : Module() {
  private fun context(): Context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private fun hub(): SensorHub = SensorHub.get(context())

  override fun definition() = ModuleDefinition {
    Name("BleSensors")

    Events("onScanResult", "onScanState", "onConnection", "onValue", "onLocation", "onBluetoothState", "onWorkoutAction")

    OnCreate {
      hub().install(this@BleSensorsModule) { name, payload -> sendEvent(name, payload) }
    }

    OnDestroy {
      // The hub may already be gone with the app context; nothing to detach then.
      SensorHub.peek()?.uninstall(this@BleSensorsModule)
    }

    AsyncFunction("bluetoothState") { hub().bluetoothState() }

    AsyncFunction("startScan") { hub().startScan() }

    AsyncFunction("stopScan") { hub().stopScan() }

    AsyncFunction("connect") { id: String -> hub().connect(id) }

    AsyncFunction("disconnect") { id: String -> hub().disconnect(id) }

    AsyncFunction("disconnectAll") { hub().disconnectAll() }

    AsyncFunction("connectionStates") { hub().connectionStates() }

    // Android cannot tell "never asked" from "denied", so undetermined is iOS only.
    AsyncFunction("locationPermission") {
      if (context().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) "granted" else "denied"
    }

    AsyncFunction("startWorkoutSession") Coroutine { options: WorkoutSessionOptionsRecord ->
      val controls = options.controls?.let { RecordingNotificationSpec.Controls(it.locale, it.paused, it.pause, it.resume, it.lap) }
      WorkoutSession.start(context(), options.title, options.text, options.gps, options.openUrl, controls)
    }

    AsyncFunction("updateWorkoutSession") { state: WorkoutSessionStateRecord ->
      WorkoutSession.update(context(), RecordingProgress.Update(state.movingSec * 1000L, state.distanceM, state.hr, state.paused))
    }

    AsyncFunction("endWorkoutSession") { WorkoutSession.end(context()) }

    Function("isWorkoutSessionActive") { WorkoutSession.isActive }
  }
}
