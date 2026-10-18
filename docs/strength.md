# Strength training (the logger)

JoyoFit logs strength workouts the way Hevy does, on the same exercise ids as the coach. Everything is JavaScript (ships over the
air, see `docs/ota.md`); there is no native module. Code: `src/features/strength/`, routes `src/app/strength/`, copy in the
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

- `strength_record (kind, id, json, sort_at, plan_key, workout_start, updated_at, deleted_at, dirty)`: one JSON document per record; kinds `workout`, `routine`, `folder`, `exercise` (custom), `pref` (rest timer per exercise). A delete is a row with `deleted_at` (a tombstone, the cloud hears about it). `dirty = 1` marks what still has to be uploaded.
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
- Muscle load: every counted set adds 1 to the groups of the exercise's primary muscles and 0.5 to the groups of its secondary muscles (12 groups, `MUSCLE_GROUPS`), per week from Monday.

### Energy when the watch did not record it (MET method)

```
sets per hour = counted sets / hours of the stopwatch (pauses excluded)
MET = 3.5 + 2.5 x clamp((sets per hour - 12) / (30 - 12), 0, 1)        light 3.5 .. vigorous 6.0
MET + 0.5 when the average RPE of counted sets is 8.5 or more (at most 6.5)
kcal = MET x 3.5 x weight(kg) x minutes / 200
```

3.5 and 6.0 are the Compendium of Physical Activities values for light-to-moderate and vigorous resistance training; 12 and 30 sets per hour are a slow session with long rests and a circuit. It is the formula JoyoRogo uses for its own quick entries (kcal per minute = MET x 3.5 x kg / 200), so the numbers agree. An estimate, never a measurement; weight comes from Settings > Profile (70 kg when empty).

## Without a watch

The logger never needed one: a phone with no watch (`useWatchPresence()` is `none`, see `src/features/device/presence.ts`) gets the logger's own `workouts` row (`imported = 1`), a MET energy estimate, history, charts, Strava and the JoyoRogo energy push. The logger's row is not watch data, so logging workouts does not turn the watch UI on. Today then shows `TodayNoWatch` (the logger, Coach, library, history, one "Sambungkan jam" row, the JoyoRogo link) instead of the watch's cards; the Workouts tab drops its Sync button and the "connect your watch" notice. A hand-typed run, walk or ride (`/workouts/manual`, `features/workouts/manual.ts`) lands in the same table with a MET estimate and no heart rate or route. When no weight was saved, the summary says the estimate ran on 70 kg and links to Profile.

The first-run guide has a no-watch route (`flow.ts`, `route: 'none'`): welcome, phone, account, pro, cloud, done. The supported watches and the way to request one are in `features/device/watchFamilies.ts` (short list; the full one is fit.joyorogo.com/jam).

## Routes

`/strength` home (start, routines, recent), `/strength/active` the logger (params `routineId`, `planKey`, `planned`, `name`, `repeatWorkoutId`, `editWorkoutId`), `/strength/summary/<id>`, `/strength/routine/<id|new>`, `/strength/history` (list and calendar with the watch workouts), `/strength/exercises`, `/strength/exercise/<id>` (charts, records), `/strength/muscles` (weekly heat map), `/strength/settings`.

## Not covered

- The logger does not read heart rate live from the watch; the merge happens after the fact.
- Units are kg only.
