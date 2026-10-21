# Counting reps in the strength logger: feasibility

Written 2026-10-21 after a request (user abdalailisro, Huawei Band 11 Pro): the watch records heart rate during a strength session, but
nobody counts the reps; the logger takes them by hand (the `+` / `-` and the number field of a set). **Nothing here is implemented.** This
note says what exists, what does not, and what each way would cost.

## 1. Does the watch protocol give reps or raw motion?

No. What was checked:

- **The workout record** (`17/07`, `17/08`, `17/0A`, `17/0C`, `17/0E`, `17/14`, `17/16`, see `protocol/README.md`): totals, per-sample heart
  rate, speed, cadence, power, pace blocks, swim segments, SpO2, sections. Gadgetbridge's parser (`Workout.java`, `HuaweiWorkoutGbParser`)
  has no set or repetition field, and the record JoyoFit stores for a strength workout (sport 140) is a heart-rate trace and totals only.
- **The live stream** (`17/11` report, `37/03` points, `LiveWorkout.kt`): the allow-list of 53 dictionary ids in Huawei Health 17.0.8.300
  (`olk.c`, `/home/dzul/re/huawei-health/LIVE_WORKOUT_PROTOCOL.md`) is duration, heart rate and zone, distance, calories, speed, pace, step
  rate, steps, cycling cadence, altitude, rise and descent, training effect, state. No repetitions, no sets, no acceleration.
- **A raw sensor or "motion" service**: Gadgetbridge's Huawei code has none, and neither does JoyoFit. The only motion-like service in the
  Huawei Health notes is the run-posture link (`17/0F`, `17/10`, `17/13` on the AW70 only, and dictionary `300001`: contact time, vertical
  oscillation, ...), which is running biomechanics, not a sample stream, and is gated on ExpandCapability 175.
- **Huawei Health's own strings**: `repetitions` / `getRepetitions` exist, but only next to Health Connect's `ExerciseCompletionGoal` and
  the training-course UI (planned actions), not in anything the watch sends. Whether a newer watch counts reps in its own strength mode and
  keeps them in the record is **unknown**; no packet that carries them was found (a watch capture of a counted set would settle it).
  Health Connect does have a segment type for repetitions (`reps` in `ExerciseSegment`), so a count that existed could be written there.

Verdict: the watch cannot supply reps with what the protocol exposes today. Heart rate and calories come from the watch (this is what the
"Mulai juga di jam" feature records); reps would have to come from somewhere else.

## 2. Phone-side detection

`expo-sensors` is **not** in `package.json` (checked 2026-10-21), so there is no motion sensor access in JoyoFit today. The strap and step
counter code (`modules/ble-sensors`, `WorkoutSteps.kt` / `WorkoutSteps.swift`) is the nearest thing. Expo SDK 57's `Accelerometer`
(`expo-sensors`) reports g per axis with `setUpdateInterval`; on Android 12+ the system caps a sensor at 200 Hz unless
`HIGH_SAMPLING_RATE_SENSORS` is declared (docs.expo.dev/versions/v57.0.0/sdk/accelerometer). Adding the package or a sensor read to
`ble-sensors` is a native change: **store build, never OTA** (`docs/ota.md`).

What is realistic:

| Where the phone is | Exercises it can count | Verdict |
| --- | --- | --- |
| Trouser pocket | squat, lunge, deadlift, hip thrust, calf raise, jump (the hip moves up and down) | Workable for lower body only. A curl, press or row barely moves the pocket. |
| Armband on the working arm | curls, presses, raises, rows, triceps work | Best signal for free weights, but few people own a phone armband; phone screen unreachable between sets. |
| Phone on the floor or bench | nothing useful | No. |
| Phone in hand (a rep counted from the screen) | none | No: the hand is busy. |

Published accuracy is for a dedicated arm-worn inertial sensor (RecoFit, Morris et al., CHI 2014: 114 participants, 146 sessions,
counts accurate to +-1 repetition 93% of the time, exercise recognition 96-99%). A phone in a pocket is a weaker sensor than that, so
expect worse, and the exercise must be known (the logger knows it: the person picked it).

### Options

| Option | What it is | Effort | Needs store build | Risk |
| --- | --- | --- | --- | --- |
| A. Keep manual entry | Today. Make the rep field faster (steppers, last-set copy) | done | no | none |
| B. Phone accelerometer, per set | Sensor sampled at 25-50 Hz while a set is open (the person taps "Mulai set" and "Selesai"); low-pass, project on the dominant axis (PCA), count peaks above an adaptive threshold; the count pre-fills the rep field, which stays editable | spike 3-4 days to record labelled sets and tune; counter and UI about 1 week; validation against hand counts another week | yes (`expo-sensors`, or `SensorManager` / `CMMotionManager` inside `ble-sensors`, whose Android foreground service already keeps a workout alive with the screen off) | Pocket quality varies by phone and clothes; iOS Core Motion stops when the app is suspended unless a background mode keeps it running (what `ble-sensors` holds on iOS during a strap session was not checked); battery |
| C. Automatic set detection (RecoFit style) | B plus finding the set boundaries and the exercise by itself | 4-8 weeks, a labelled data set of our own (Microsoft's RecoFit set, 200+ people with accelerometer and gyroscope, is public but arm-worn) | yes | High: false sets, needs a model; do B first |
| D. A strap or band that streams motion | Some BLE straps (Polar H10's accelerometer stream, in Polar's documented SDK, not a standard GATT profile) could give an on-body signal | A vendor-specific stream per device, about 1 week per device after B exists | yes | Not checked in this repo [INFERENCE]; worth it only if users own such a strap |
| E. Watch counts reps | Needs the watch to send them | blocked: no protocol field found (section 1) | n/a | n/a |

Recommendation: B for lower-body exercises first, behind a switch ("Hitung repetisi dari ponsel (percobaan)"), the count only ever a
suggestion in the rep field. Do not start before a capture shows whether the Band 11 Pro stores reps itself (E would beat all of them).

## Sources

- Gadgetbridge Huawei packets (`Workout.java`, `HuaweiWorkoutGbParser`), as ported into `modules/huawei-wear`.
- Huawei Health 17.0.8.300 reverse-engineering notes, `LIVE_WORKOUT_PROTOCOL.md` (live allow-list, run posture, legacy `17/xx` packets).
- Expo SDK 57 Accelerometer: https://docs.expo.dev/versions/v57.0.0/sdk/accelerometer/
- Morris, Saponas, Guillory, Kelner, "RecoFit: Using a Wearable Sensor to Find, Recognize, and Count Repetitive Exercises", CHI 2014:
  https://www.microsoft.com/en-us/research/publication/recofit-using-wearable-sensor-find-recognize-count-repetitive-exercises/
