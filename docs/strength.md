# Strength training (the logger)

JoyoFit logs strength workouts the way Hevy does, on the same exercise ids as the coach. Everything is JavaScript (ships over the
air, see `docs/ota.md`), except "the watch starts too" (below), which calls the `huawei-wear` module and needs a store build. Code: `src/features/strength/`, routes `src/app/strength/`, copy in the
`strength`, `routines`, `lifts`, `strengthshare` and `strengthcloud` i18n namespaces. The cloud half is `docs/strength-cloud.md`.

## Who owns what

| | owner |
| --- | --- |
| Exercise library data (`src/features/coach/exercises`), plans, `coach_doc`, the coach screens | coach |
| Logger, rest timer, routines, history, analytics, cloud kind `strength_record`, Strava sets, share card, JoyoRogo import | strength |

The two meet at three points:

- **Exercise ids** are `ExerciseDef.id` slugs of the library (never reused). An exercise the person makes is `custom_<base36 ms>` and is stored by the logger (`strength_record` kind `exercise`).
- **Set types**: `normal`, `warmup`, `drop`, `failure`. Warm-up sets never count toward volume, records or muscle load.
- **The session player is the logger's active screen** (one rest timer for the whole app). The coach calls `startStrengthWorkout({ planKey, exercises: PlannedExercise[] })` (`src/features/strength/start.ts`) and reads `listStrengthWorkoutsByPlanKey(db, planKey)` (`store.ts`) to mark a plan session done. The logger never writes `coach_doc`.

## Data

Tables are created from JS (`ensureStrengthSchema`, called by `_layout.tsx`; the native migration list is part of the binary, same
reason as `features/gear/store.ts`):

- `strength_record (kind, id, json, sort_at, plan_key, workout_start, updated_at, deleted_at, dirty)`: one JSON document per record; kinds `workout`, `routine`, `folder`, `exercise` (custom), `pref` (rest timer and last Repetisi / Waktu choice per exercise; a pref with neither is a tombstone). A delete is a row with `deleted_at` (a tombstone, the cloud hears about it). `dirty = 1` marks what still has to be uploaded.
- `strength_exercise_use (workout_id, exercise_id, started_at)`: which workouts contain which exercise, so the inline "previous" of a set is one indexed read.
- `strength_meta (key, value)`: the workout in progress (`draft`, local only until finished), logger settings, sync cursor, import state.

Types are in `types.ts`. The workout in progress (`StrengthDraft`) is saved on every change, so an app kill loses nothing; the stopwatch is derived from `startedAt` and `pausedMs`, the rest timer from an absolute `endsAt`. The rules of a workout in progress (adding sets, ticking, rest timer, supersets, finishing) are pure functions in `draft.ts`.

### Every finished workout is also a `workouts` row

`link.ts` gives each finished strength workout a row in the watch table, so the Workouts tab, the calendar, Gear, the JoyoRogo cloud workouts and the Strava upload need no special case:

- **The watch recorded it too**: a complete, watch-recorded (`imported = 0`) workout of a strength-like sport (Huawei types 134-136, 139, 140, 142, 143, 145-147, 157) whose time span overlaps the logged workout by more than half of the shorter span is the same session. The logger links to it (`workoutStart` = its `start`) and the watch's heart rate, energy and strain stay the workout's. Nothing of the watch row is written. A workout logged before the watch synced moves from its own row to the watch's at the next sync (`reconcileLinks`).
- **Nobody else recorded it**: the workout gets its own row, sport 140 "Strength Training", `imported = 1`, summary `{"kind":"strength","strengthWorkoutId":...}`, energy from the estimate below. `imported = 1` keeps it out of the watch-only exports (Health Connect, Apple Health, automatic Strava: their cursors read `imported = 0` and the native sync owns them); its energy reaches JoyoRogo through `src/cloud/strengthKcal.ts` instead (see `docs/strength-cloud.md`).
- History imported from JoyoRogo (`rogo:<session id>`) has no `workouts` row (`workoutStart = null`); it is history only.

## Numbers (`calc.ts`)

- Counted set: done and not a warm-up. Volume = sum of weight x reps of counted sets (a bodyweight set adds reps, not volume).
- Estimated 1RM (Epley): `w * (1 + reps / 30)`, one rep = the weight, none above 30 reps.
- Records, against everything logged before the workout (an exercise never done before has none): heaviest weight, best 1RM, best set volume, most reps at that load or heavier (needs an earlier set at that load or heavier), longest timed set.
- Time: a set holds `reps` or `seconds`. Totals add the seconds of counted sets (`WorkoutTotals.seconds`); the time record (longest hold) needs an earlier hold of the exercise, so the first hold after counting it in reps starts the record instead of breaking it.
- Muscle load: every counted set adds 1 to the groups of the exercise's primary muscles and 0.5 to the groups of its secondary muscles (12 groups, `MUSCLE_GROUPS`), per week from Monday.

### Energy when the watch did not record it (MET method)

```
sets per hour = counted sets / hours of the stopwatch (pauses excluded)
MET = 3.5 + 2.5 x clamp((sets per hour - 12) / (30 - 12), 0, 1)        light 3.5 .. vigorous 6.0
MET + 0.5 when the average RPE of counted sets is 8.5 or more (at most 6.5)
kcal = MET x 3.5 x weight(kg) x minutes / 200
```

3.5 and 6.0 are the Compendium of Physical Activities values for light-to-moderate and vigorous resistance training; 12 and 30 sets per hour are a slow session with long rests and a circuit. It is the formula JoyoRogo uses for its own quick entries (kcal per minute = MET x 3.5 x kg / 200), so the numbers agree. An estimate, never a measurement; weight comes from Settings > Profile (70 kg when empty).

## Reps or time per exercise

Each exercise of a workout or routine is measured in repetitions or in seconds. `StrengthExercise.timed` / `RoutineExercise.timed` hold the choice (absent = the library's `timed` flag, as in everything saved before the field; `resolveTimed` in `draft.ts` decides, falling back to what the sets hold for an exercise nothing knows any more). The Repetisi / Waktu switch (`ui/MeasureToggle.tsx`) sits in the chip row of the logger's exercise card and in the routine editor's card; `setExerciseTimed` converts the sets (weight and type stay, the other amounts and the ticks go; the screens ask first when a set holds something) and `setTimedPref` saves the choice in the exercise's `pref` record, so the exercise starts that way the next time it is added (`ExercisePref.timed`). A custom exercise picks its default when created. Everything downstream reads the sets, so history, records, share cards and the cloud need no flag.

Time entry (`logFormat.ts`: `secondsFromDigits`, `digitsClock`) works like a kitchen timer on the number pad: "1", "3", "0" read 0:01, 0:13, 1:30. A timed set also has a stopwatch button (`setTimer.ts`, held by `active.tsx`): a tap starts it, a second tap stores the seconds in the set; with `countdownTimed` (Settings > Set berwaktu, on by default) and seconds already in the set (the plan or routine target) it counts down from them and vibrates at zero. It never touches the rest timer.

## Without a watch

The logger never needed one: a phone with no watch (`useWatchPresence()` is `none`, see `src/features/device/presence.ts`) gets the logger's own `workouts` row (`imported = 1`), a MET energy estimate, history, charts, Strava and the JoyoRogo energy push. The logger's row is not watch data, so logging workouts does not turn the watch UI on. Today then shows `TodayNoWatch` (the logger, Coach, library, history, one "Sambungkan jam" row, the JoyoRogo link) instead of the watch's cards; the Workouts tab drops its Sync button and the "connect your watch" notice. A hand-typed run, walk or ride (`/workouts/manual`, `features/workouts/manual.ts`) lands in the same table with a MET estimate and no heart rate or route. When no weight was saved, the summary says the estimate ran on 70 kg and links to Profile.

The first-run guide has a no-watch route (`flow.ts`, `route: 'none'`): welcome, phone, account, pro, cloud, done. The supported watches and the way to request one are in `features/device/watchFamilies.ts` (short list; the full one is fit.joyorogo.com/jam).

## Routes

`/strength` home (start, routines, recent), `/strength/active` the logger (params `routineId`, `planKey`, `planned`, `name`, `repeatWorkoutId`, `editWorkoutId`), `/strength/summary/<id>`, `/strength/routine/<id|new>`, `/strength/history` (list and calendar with the watch workouts), `/strength/exercises`, `/strength/exercise/<id>` (charts, records), `/strength/muscles` (weekly heat map), `/strength/settings`.

## The watch starts too

"Mulai juga di jam" (Settings > Latihan beban, `StrengthSettings.startOnWatch`, on by default): when a workout in progress opens in the
logger and the watch is connected and lists the phone-started workout command (`17/01`), JoyoFit tells the watch to start Strength
training (Huawei sport 140). The stopwatch's pause and resume pause and resume the watch, finishing or discarding stops it. The watch records
heart rate and calories for that window; its workout comes with the next watch sync and `link.ts` joins it to the logged one as for a
workout started on the watch by hand. Code: `watchWorkout.ts` (the session, framework free, `watchWorkout.test.ts`),
`watchWorkoutInstance.ts` (the one instance and the `strength_meta` key `watch_workout`, so an app restart does not start the watch a
second time), `useStrengthWatch.ts`, `ui/WatchSession.tsx` (the "Jam" chip and the notice), native `WatchWorkout.kt` /
`WatchWorkoutControl.swift`, wire in `protocol/README.md`.

- **Only for a fresh workout**: a draft older than 4 hours is a forgotten one and does not start the watch.
- **Not connected**: a notice says so and the watch starts by itself once the link is up; a refusal or a failed start shows the notice with "Coba lagi". Nothing is shown when the setting is off.
- **A watch that cannot do it**: the setting is replaced by one info line (`startOnWatchUnsupported`); a phone with no watch, and a binary without the native functions (`hasNative`), show nothing.
- **An app restart in the middle**: the native side forgets the workout, so the logger cannot stop the watch's any more ("lost" notice); stop it on the watch.
- **Refused on the Fit 4 Pro** (2026-10-21): every `17/01` got code 123002, whatever the sport or payload; the cause is not known. The notice shows the code, and says "not on your wrist" only when the watch itself says so (`2E/03`, read after the refusal; not yet seen on a watch). Not yet seen accepted on any watch, and Huawei says a workout started from Huawei Health is stored in Huawei Health only, so the watch may keep no record to join. Details: `protocol/README.md`.
- **Gated for this phone (2026-10-22)**: with Strength training started **on the watch** (`17/03` reporting it running, `2E/03` saying worn), `17/01` pause, resume and stop from JoyoFit were refused with 123002 as well, with the full payload and with the smallest one. So `17/01` is unusable for every operator: the phone cannot start, pause or stop the watch's workout. JoyoFit remembers the refusal per watch (`strength_meta` key `watch_start_refused` = the watch address, only for a refusal while worn, not for "not on the wrist"): the start is not tried again on that watch, the logger shows one calm line ("Jam ini tidak bisa dimulai dari HP. Mulai Latihan kekuatan di jam, JoyoFit ikut otomatis.") with no retry button, and Settings > Latihan beban replaces the "Mulai juga di jam" switch with the explanation. Evidence: `protocol/README.md`.
- **UNVERIFIED on a watch**: the command is rebuilt from Huawei Health's code, and sport code 140 is the one value Huawei Health itself never sends. It needs a **store build** (native); an OTA bundle on an older binary hides the setting and does nothing.
- Reps are not counted by the watch or the phone: `docs/strength-reps.md`.

## Start on the watch, JoyoFit follows

What works is the other direction. The native `LiveWorkout` already follows a watch workout through `17/03` (operator 1 start, 3 resume = running, 2 pause = paused; no `17/02` notice, `17/11` or GPS request came for an indoor workout in the probe). When it is a strength-type sport (`watchLive.ts`: Huawei 140 Strength training, 145 CrossFit, 146 Functional training, 157 Core training):

- `LiveWorkoutProvider` opens `/strength/watch-pick` instead of the generic `/workout-live`; the Today card says "Latihan beban berjalan di jam" and opens the same; `/workout-live` redirects there.
- `/strength/watch-pick` opens the logger at once when a workout is in progress. Otherwise the quick routine picker comes first, the routine of the last finished workout preselected (`lastUsedRoutineId`); "Tanpa rutinitas" starts an empty workout. The logger is the ordinary one: sets, reps, kg, rest timer.
- The logger's header chip shows the watch's heart rate and elapsed time (`RecordingChip`, from the live workout, dimmed while paused). When the watch ends the workout while the logger is open, a notice asks the person to finish here once the sets are logged; the watch workout joins by overlap after the sync (`link.ts`), as for any watch workout.
- **Open problem: the sport type.** The Fit 4 Pro's `17/03` answer for the probe's strength workout was `81 06 02 01 00 03 01 01`: it has no sport tag (04/06), so `LiveWorkout.sportType` stays null and the routing above cannot tell strength from any other indoor workout on that watch. Until another source for the type is found, the generic live screen has a "Catat sebagai latihan beban" button (shown when the type is null) that opens the picker, and a logger already open shows the watch chip for any workout the watch records. [INFERENCE] whether the type arrives in `17/11` once the report is opened (`17/12 {01: 1}`) was not tested for a strength workout.

## Could a custom course carry the exercise list to the watch? (research only, nothing built)

The only phone-to-watch carrier for a list of steps found in Huawei Health 17.0.8.300 is the P2P course file (`protocol/README.md`, "Training courses": business type 3, `courseInfo.bin` = header + `CourseStorageInfo` { `CombineInfo` repeat groups of `ActionInfo` { `actionId`, measurement type and value (time, distance, calories, heart rate, none), intensity } }). Findings:

- `actionId` names an entry of Huawei's own exercise library, not free text. The ids known to us are the run-course ones (`RD001` warm-up, `RD002` run, `RD003` walk, `RD004` rest, `RD005` cool-down); no id for a strength movement (squat, bench press) was found, and the course editor in Huawei Health takes them from the server-side catalogue. A course can therefore carry "rest" and timed or counted blocks, not the person's own exercise names with kg and reps [INFERENCE].
- A measurement is time, distance, calories or heart rate; there is no reps-with-weight target, so a routine's sets and kg cannot be expressed, at most "N timed steps with rest".
- It is the same family of risk as `17/01`: the file goes over `28/02` with the fitness app's package and fingerprints, and JoyoFit has never seen the watch accept or acknowledge a course (README, "What is missing" 1 to 3). Given that the watch refuses every `17/01` from this phone, a third-party gate there is likely too [INFERENCE].
- Verdict: not worth building for strength. The experiment, if wanted later: send one `RD004` (rest) + one timed step course with the existing experimental course screen and see whether the watch lists it; that tests the gate, not the exercise-list idea.

## Not covered

- The logger does not read heart rate live from the watch; the merge happens after the fact.
- Units are kg only.
