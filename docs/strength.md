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
- **Refused on the Fit 4 Pro while it was off the wrist** (2026-10-21): every `17/01` got code 123002, whatever the sport or payload; the watch said "not worn" (`01/3D` = 2). The notice then says so ("not on your wrist", with the code); with a worn or unknown state it shows the code. Not yet seen accepted on any watch, and Huawei says a workout started from Huawei Health is stored in Huawei Health only, so the watch may keep no record to join. Details: `protocol/README.md`.
- **UNVERIFIED on a watch**: the command is rebuilt from Huawei Health's code, and sport code 140 is the one value Huawei Health itself never sends. It needs a **store build** (native); an OTA bundle on an older binary hides the setting and does nothing.
- Reps are not counted by the watch or the phone: `docs/strength-reps.md`.

## Not covered

- The logger does not read heart rate live from the watch; the merge happens after the fact.
- Units are kg only.
