# Strength cloud

JoyoFit keeps its strength data (workouts, routines, folders, custom exercises, rest preferences) on the phone in
`strength_record` (`src/features/strength/store.ts`) and, for JoyoRogo Pro accounts, in JoyoRogo's D1 table of the same name.
Reading is open to every signed-in account; writing needs Pro. The server side is in the joyorogo repo:
`packages/api/src/routers/strength.ts`, `lib/strength-record.ts` (validation, limits), `lib/strength-record-store.ts`
(storage), `packages/db/src/schema/strength.ts`, migration `0043_strength_record`.

## Table

`strength_record (user_id, kind, id, json, updated_at, deleted_at, server_at)`, primary key `(user_id, kind, id)`, index
`(user_id, server_at, kind, id)`, foreign key to `user` with cascade.

- `kind`: `workout | routine | folder | exercise | pref`; `id` is the record id inside its kind (`pref`: the exercise id).
- `json` is the document exactly as the phone stores it (`src/features/strength/types.ts`). The server validates it and stores the
  same string, so keys a newer app adds survive an older server. A record is at most 48 KB, a workout has at most 60 exercises
  with at most 60 sets each, notes at most 2000 characters, ids at most 64.
- `updated_at` / `deleted_at` are the record's own `updatedAt` / `deletedAt` (ms), sent next to the document. A delete is a
  tombstone: the document stays, `deleted_at` is set, so every phone learns of it.
- `server_at` is when the server stored the row. Within one push it strictly increases, and it is always later than anything the
  account already has, so a pull by `(server_at, kind, id)` never skips a row.
- An account holds at most 50 000 records. Over the cap a push stores what fits (updates of existing records always fit).

## Procedures (oRPC, `POST <JoyoRogo>/rpc/<path>`)

| path | input | output |
| --- | --- | --- |
| `strength/status` | none | `{ unlocked: boolean, records: number }` |
| `strength/pull` | `{ since?: number (server_at ms, default 0), limit?: number (1..200, default 200) }` | `{ records: [{ kind, id, json, updatedAt, deletedAt }], cursor: number, hasMore: boolean }` |
| `strength/push` | `{ records: [{ kind, id, json, updatedAt, deletedAt }] }` (at most 100) | `{ status: 'locked' }` (not Pro) or `{ status: 'ok', stored, skipped, rejected: [{ kind, id, reason }] }` |
| `strength/wipe` | none | `{ ok: true }` (deletes the caller's rows; no Pro check) |
| `exercise/upsertJoyofit` | `{ externalId, date, name, durationMin, kcal, type? }` | the `exercise_log` row |
| `exercise/removeJoyofit` | `{ externalId }` | `{ ok: true }` |
| `workout/exportAll` | `{ cursor?, limit? (max 50) }` | see "Import from JoyoRogo's own logger" |

- `pull` is ordered by `(server_at, kind, id)`; `cursor` is the `server_at` of the last record (the `since` asked for when the page
  is empty). `hasMore` says to ask again with `since = cursor`. A page also stops at about 1.5 MB of documents.
- `push`: each record is stored only when its `updatedAt` is at least the stored one (newer wins, equal rewrites); one upsert
  statement decides, so two phones racing cannot both win. `stored` counts rows written, `skipped` rows the account already has in
  a newer version. `rejected` holds records that were not stored: `reason` is `shape`, `id_mismatch`, `not_json`, `too_large` (the
  document can never be stored as sent) or `full` (the account is at its cap). An unknown `kind` or more than 100 records fail the
  whole request (400).

## Phone: `src/cloud/strengthSync.ts`

`syncStrength(db)` returns `'unchanged' | 'uploaded' | 'downloaded' | 'both' | 'local-only'`. The loop itself is
`strengthSyncCore.ts` (injected io, tested in `strengthSyncCore.test.ts`).

1. Account check: the JoyoRogo user id bound by `bindAccount` (`cloud_state.user_id`) is compared with `strength_meta.cloudUser`.
   A different account marks every record dirty, forgets the pull cursor and the energy rows sent, then remembers the new id.
2. Pull from `cloudCursor - 1` (one millisecond of overlap, absorbed by last-write-wins) in pages of 200. Each page goes through
   `applyRemote` (newer replaces, equal clears the dirty flag, older is ignored); pulled workouts get their `workouts` rows
   (`ensureRows`, `reconcileLinks`). The cursor is stored after every page.
3. Push `listDirty` in batches of at most 100 records and about 400 KB. `markUploaded` runs for what was answered, except `full`;
   a record that changed again during the request stays dirty and goes in the next batch. A document rejected as invalid is marked
   uploaded (it will never be accepted as sent) and counted in `strengthRejected`. `full` keeps the records waiting and sets
   `strengthFull`.
4. `{ status: 'locked' }` (not Pro): the records stay dirty, `strengthLocked = 1` is stored, no error. Pull still works, so a
   free account reads what an earlier Pro period uploaded. The next sync asks again, so a fresh purchase is picked up.

Not signed in, a build without cloud, and a 404 (JoyoRogo without the endpoint yet) all give `local-only`; other failures throw
and are logged by the caller (`CloudProvider`). Requests go through `strengthCall` (`strengthHttp.ts`): network errors, 408/425/429
and 5xx are retried with `withRetry`, every other answer is final.

Triggers: `CloudProvider.syncNow` calls it right after `syncCoach` (so on app start, foreground, a local sync and "Sync now",
under the existing "Automatic sync" and "Wi-Fi only" settings), and `afterStrengthSaved` (`src/features/strength/afterSave.ts`)
schedules it two seconds after a save or delete, under the same settings.

Status for screens: `useStrengthCloudStatus()` (`src/cloud/useStrengthCloudStatus.ts`) gives
`{ state: 'synced' | 'local-only' | 'pending' | 'not-signed-in', pending, offline }`; `StrengthCloudLine`
(`src/features/strength/ui/StrengthCloudLine.tsx`) shows it as one caption line. Copy is in namespace `strengthcloud`.

## Burned energy in JoyoRogo's diary (`src/cloud/strengthKcal.ts`, `strengthKcalPlan.ts`)

A strength workout's energy reaches JoyoRogo's `exercise_log` as one row: `source = 'joyofit'`,
`external_id = 'strength:<workout id>'`, `type = 'angkat_beban'`, day = `wibDay(startedAt)`, name `Latihan beban: <name>` or
`Strength: <name>` (the app language), duration in whole minutes (1..1440), kcal rounded (at most 10 000).

- Only for workouts with `kcalSource = 'estimate'` whose `workouts` row is the logger's own (`imported = 1`). A workout merged with
  a watch workout is the watch's: it reaches JoyoRogo through Health Connect / Apple Health like every watch workout. Imported
  JoyoRogo history (`rogo:<id>`) and deleted workouts never have a row.
- `strength_kcal_sent (workout_id, external_id, date, kcal, sent_at)` (created from JS by `ensureKcalSchema`) says what JoyoRogo was
  told. A workout is sent once, sent again when kcal or day change, and the row is removed (`exercise/removeJoyofit`) when the
  workout is deleted or later merged with a watch workout.
- `pushStrengthKcal(db, workout, 'saved' | 'deleted')` runs after a save (`afterStrengthSaved`); `retryStrengthKcal(db)` runs at the
  end of every `syncStrength`: it re-checks every workout in `strength_kcal_sent` and every workout changed in the last 30 days,
  at most 40 requests per pass. Offline or signed out is quiet and retried at the next sync. Not Pro gated (same as Health Connect rows).

## Watch workouts in JoyoRogo's diary (`src/cloud/watchKcal.ts`, `watchKcalPass.ts`, `watchKcalPlan.ts`)

A workout the watch recorded (`workouts.imported = 0`, `complete = 1`, started in the last 30 days) is sent with the same procedure:
`source = 'joyofit'`, `external_id = 'watch:<start, unix seconds>'`, type from the sport (`lari`, `jalan_cepat`, `sepeda`, `berenang`,
`yoga`, `angkat_beban`, `badminton`, `futsal`, else `latihan`), duration `end - start` (the length of the Health Connect session),
kcal = the watch's energy. Without energy nothing is sent. This is independent of Health Connect: before, a watch workout reached
JoyoRogo only through Health Connect / Apple Health, so a JoyoRogo that could not read it (read permission lost after a reinstall; the
auto-sync of JoyoRogo skips silently without it) showed "Bakar 0".

- `watch_kcal_sent (workout_start, account_id, external_id, date, kcal, sent_at)` (created from JS by `ensureWatchKcalSchema`) says what
  JoyoRogo was told and for which account. A workout is sent once per account, again when kcal or day change; a repeat is harmless
  (`watch:<start>` upsert). A deleted workout stays in the diary (like a Health Connect record).
- Gates (`runWatchKcalPass`, tested in `watchKcalPass.test.ts`): the sync is not paused (`isSyncPaused`: an account question is open), the
  phone's data is bound to the signed-in account (`cloud_state.user_id`, after an account switch only once "Gabung" or "Simpan terpisah"
  was chosen), the workout is not marked `detached` ("Simpan terpisah": never sent to the later account), recent, complete, not an import.
  Not Pro gated. Quiet when signed out or when JoyoRogo has no such procedure (404).
- Triggers: after every data change and when the app comes to the foreground (`pushDiary` in `CloudProvider`, under "Automatic sync" and
  "Wi-Fi only"), and inside every `syncNow` (manual too). It does not depend on the Pro cloud sync or on the success of its steps.
  Backfill is the same pass: everything of the last 30 days that was never sent goes at the next trigger, at most 40 requests per pass.
- No double count: JoyoRogo's server (`import-dedupe.ts` `absorbingRow`, used by `exercise.upsertJoyofit` for `watch:` ids and by
  `exercise.add` for `health_connect` / `apple_health`) stores one row for a watch row and a Health Connect / Apple Health import of the same
  day, workout class (Walk = jalan_cepat, Run = lari, Ride = sepeda ...) and length within 2 minutes, in either order. Rows that already
  stand for each other are paired off first.
- Status: Settings, Koneksi, JoyoRogo (`JoyoRogoDiarySection`): last sent, workouts sent, waiting, last error (`cloud_state` keys
  `diary_last_sent_at`, `diary_last_error`, `diary_last_error_at`, written by `diaryNotes.ts` for the strength, phone and watch pushes) and
  "Kirim sekarang".

## What a `joyofit` row does in JoyoRogo's numbers (read, not changed)

Checked in `packages/api/src` of the joyorogo repo:

- `lib/plan.ts` (adaptive TDEE / Burn) filters `source != 'rest'` and `!= 'strava'`: a `joyofit` row counts as burned energy on its day.
- `routers/day.ts` reads every source of the day and week (`ExerciseLogLike` only skips `rest`): counted in the day's exercise kcal
  and the week total.
- `routers/stats.ts` skips only `rest`: counted.
- `routers/group.ts`: the group activity line and the feed skip only `strava`, so a `joyofit` row is shown to group members with its
  name (`Strength: <workout name>`), duration and kcal like a manual row; the daily totals skip `rest` and `strava`.
- `lib/challenge-db.ts` (goal `workouts`): counts rows that are not `rest` / `strava`; only `health_connect` and `apple_health` are
  "verified", so a `joyofit` row counts as an unverified (manual-basis) workout, exactly like a manual row.
- `routers/social.ts` (`createPost` kind `latihan` with an `exercise_log` id) skips only `strava`: a `joyofit` row can be shared.
- `lib/fit-data.ts` (MCP) skips `strava` and `rest`: counted.
- Nothing filters on `source = 'joyofit'` and nothing drops the row. Double counting: the logger's own `workouts` row is
  `imported = 1`, which keeps it out of the Health Connect / Apple Health export; a merged workout is not pushed (and a pushed one
  is taken back at the next sync after a merge); a FIT upload to Strava has `external_id` `joyofit-<start>`, which JoyoRogo's Strava
  import skips (`isJoyofitUpload`). The one overlap left is a person who also types the same session by hand in JoyoRogo.
- `exercise.update` does not guard `joyofit` rows (it only guards JoyoRogo's own strength mirror): an edit made in JoyoRogo stays
  until JoyoFit sends a different kcal or day for that workout.
- The row shows in JoyoRogo's Olahraga list like any activity and can be deleted there; JoyoFit does not send it again until that workout's kcal or day changes.
- JoyoRogo's own strength sessions (`workout_session`) raise the protein target on `routers/day.ts`; a `joyofit` row does not.

## Account wipe and deletion

"Delete cloud data" (`wipeCloudData` in `src/cloud/workoutSync.ts`) also calls `strength/wipe` (`wipeStrengthCloud`): the account's
rows go, nothing on the phone is marked as waiting to upload, and the pull cursor, `strengthLocked`, `strengthFull`,
`strengthRejected` and `strengthOffline` are cleared, so the wiped data does not come straight back. Later changes sync as before.
Energy rows already in JoyoRogo's diary are diary data, not cloud data, and stay. JoyoRogo's own "delete my data" and account
deletion (`lib/privacy.ts`) delete `strength_record` too (the table also cascades from `user`).

## Import from JoyoRogo's own logger

`workout/exportAll` is read-only (any signed-in account, no Pro check, every query filtered by the session user). Sessions come
newest first, 50 a page, keyset on `(date desc, created_at desc, id desc)`; `nextCursor` is opaque (null on the last page).
`{ sessions: [{ id, date, name, startedAt, durationMin, note, createdAt, kcal, sets: [{ id, exerciseId, position, reps, weightKg,
durationSec, rpe, setType, note, supersetGroup }] }], nextCursor }`, plus on the first page `routines`
(`{ id, name, note, exercises, createdAt, updatedAt }`), `customExercises` (`{ id, name, muscle, equipment, type, createdAt }`) and
`total: { sessions, sets }`. Timestamps are ISO strings, `kcal` is the mirror `exercise_log` row's.
