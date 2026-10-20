# More than one watch (Garmin Connect / Huawei Health style)

Written 2026-10-18. Branch `multi-watch`. **This feature changes native code and the shared database schema (migration 14), so it changes the OTA fingerprint** (docs/ota.md): it ships with the next store build, never over the air, and an OTA published from a tree that contains it reaches no installed binary. It lives on its own branch for that reason.

A person can keep several watches in JoyoFit: a Watch Fit 4 for daily wear plus a GT for running, a spare, or a family member's band. One watch is **active** (the one the phone is linked to), one is **primary** (the one that owns all-day data), and every stored row says which watch it came from.

## 1. Investigation

### Can two Huawei watches be bonded to one phone?

Yes. The bond that matters is the app-level one, and it is already per watch:

- Android: `DeviceStore.forDevice(address)` keeps the HiChain auth key, the fake `FF:FF:FF:xx:xx:xx` MAC, the fake Android id and the `bonded` flag in one private SharedPreferences file per address (`huawei_wear_<ADDRESS>`). iOS: `DeviceStore.swift` keeps the same four items in the Keychain under `<ADDRESS>|<key>`. Binding a second watch writes a second set; the first set is never read or written. `forget(address)` clears one set only.
- The watch keeps one credential (for this phone). That is why a first bind needs the user's consent (`BindConsent`, `BindConfirmDialog`): it replaces the *watch's* current phone pairing, not another watch's.
- The system Bluetooth bond list (`bondedDevices()`) already lists every bonded Huawei/Honor watch.

So pairing a second watch cannot damage the first one's keys: the Seiya-B29F pairing survives. Tests: `MultiWatchTests` (Swift, two watches in one `MemorySecretStore`: binding B leaves A's key, `forget(A)` leaves B), `DeviceIdentityIndependenceTest` (Kotlin, per-address preference files with the same checks).

### Can the app hold two links at once?

At the protocol level yes: Android can open several RFCOMM sockets to different Bluetooth Classic devices, and CoreBluetooth can hold several `CBPeripheral` connections. Gadgetbridge does it: `DeviceCommunicationService` keeps one `DeviceSupport` per connected device, and each Huawei watch gets its own `HuaweiSupportProvider`, session and key set. (Not verifiable in the trimmed `/tmp/gb` checkout, which only holds the Huawei driver; stated from Gadgetbridge's architecture.)

JoyoFit's architecture does not: `WearRuntime` owns **one** `WearLink` (`current`, `connect` answers `ERR_BUSY` "Already connected with X; disconnect before connecting again"), and about twenty controllers are built on that one link (notifications, weather, live heart rate, live workout, watch faces, P2P, Find my watch, DataSync, family upload, the foreground service notification). Two simultaneous links would also forward every notification and call to both wrists, answer "Find my phone" twice, and need a second copy of each controller. Huawei Health itself is documented for one phone at a time per watch ("Managing dual phones" is the watch to two *phones* case); we found no Huawei document that describes two watches linked to one Health app at once, so how it treats a second watch is [UNVERIFIED]. Garmin Connect and Coros model it as: many devices on the account, one connected at a time per phone for most features, data merged by a primary device.

**Recommendation (implemented): one active link at a time, quick switching, merge by rule.**

- Switching = disconnect the current link, connect the other (`WatchProvider.switchTo`). Works on every binary, because the keys are per watch.
- Background sync of the watch that is not active: Android only, opt-in per watch (`device.bg_sync`). After the active watch's own sync cycle the foreground service **visits** a due watch: it leaves the active link, connects, syncs, disconnects and goes back to the active watch. A visit never changes which watch background mode follows (`connect(..., remember = false)`), never starts a first bind, is skipped while a workout, live heart rate, an HRV measurement or any operation on the link is running, and a connect from the app ends it. A watch is due when it neither synced nor was tried for `max(4 x sync interval, 120 min)`; a failed visit (watch out of reach) is retried only after that. While a visit runs, the link events report the visited watch as connected for the length of the visit (some tens of seconds), so the Watch tab shows it as the linked watch until the active watch reconnects. iOS has no visit: iOS suspends the app, and CoreBluetooth restoration is wired for one peripheral (`BleCentral.restoreIdentifier`); iOS syncs the watch you switch to.
- Everything else (watch faces, alarms, notifications, find watch, battery) acts on the active watch, as today.

### Where the single-watch assumption sat in storage

| Thing | Before | Now |
| --- | --- | --- |
| Auth/session keys | per address (Android prefs, iOS Keychain) | unchanged |
| `device` row | address, name, model, version, `last_sync` | + `alias`, `is_primary`, `added_at`, `tracks_health`, `bg_sync` |
| `WearSettings.watchAddress/watchName` | the one background watch | unchanged: the *active* watch; every connect from the app makes the watch the background watch (a visit does not) |
| Sync window of steps/sleep | `device.last_sync` per address | unchanged, except the first sync after the link moved to the watch from another one: from 0 (section 7) |
| Sync window of **workouts** | `MAX(end)` of all workouts | per watch (`WorkoutStore.syncStart(address)`), else the second watch would never download anything older than the first watch's newest workout |
| Sync window of health metrics, night HRV | `MAX(last_ts)` / `MAX(end)` of all rows | per watch |
| Rows | **no device id**: `step_samples` PK `timestamp`, `sleep_segments` PK `(start, type)`, `workouts.start UNIQUE`; an upsert of watch B overwrote watch A's row | `device` column on `step_samples`, `sleep_segments`, `sleep_scores`, `workouts`, `health_metrics`, `hrv_readings`, plus the rules below |
| Cloud (JoyoRogo) | merged timeline by timestamp | unchanged: it holds the merged result, not device ids |
| Health Connect, Today, trends, family summary | read the tables | unchanged: the tables are the merged timeline |

## 2. Schema: migration 14 (index 13 of `joyofit-db-migrations.json`)

Additive, apart from dropping and re-creating the three `*_rev_update` triggers around the backfill so the attribution does not push every stored row back into the cloud upload queue (tests: `src/db/migrations.test.ts`).

- `device`: `alias TEXT`, `is_primary INTEGER NOT NULL DEFAULT 0`, `added_at INTEGER`, `tracks_health INTEGER NOT NULL DEFAULT 1`, `bg_sync INTEGER NOT NULL DEFAULT 0`.
- `device TEXT` (a `device.address`, NULL = unknown source) on `step_samples`, `sleep_segments`, `sleep_scores`, `workouts`, `health_metrics`, `hrv_readings`.
- `workout_shadow (device, start, end, kept_start)`: workouts a watch recorded that were not stored because another watch's copy of the same session was kept (section 3). It stops the sync from downloading them again.
- Triggers that implement the merge rules for the all-day tables (section 3), so JS, Kotlin and Swift writers cannot disagree.

**Existing single-watch users.** If `device` holds exactly one row, every stored watch row (`imported = 0` for the tables that have the flag) is attributed to it and that watch becomes primary. Imported rows (Huawei export, FIT) stay `NULL`. A phone that already has two `device` rows (it was switched between watches before this release) cannot be split reliably: its rows stay `NULL`, the most recently synced watch becomes primary, and from then on every new row is attributed. A phone with no `device` row (import only) migrates with no primary; the first watch it connects becomes primary (`upsertDevice`). `NULL` rows never block a write and are overwritten by any watch, which is what happened before.

## 3. Merge rules

`P` = the primary watch (`device.is_primary = 1`; at most one, and none is possible: then all watches are equal). Rules are enforced at write time, so every reader stays as it was and sees one merged timeline. A row stays attributed to the watch that won it.

| Data | Rule | Enforced by |
| --- | --- | --- |
| Steps, calories, distance, heart rate, SpO2, resting HR (`step_samples`, one row per minute) | The primary owns a minute. Another watch fills minutes nobody has, but never overwrites another watch's minute. An **empty** minute (0 steps, 0 kcal, 0 m, no HR/SpO2/RHR) does not claim the minute: a watch in a drawer does not hide what the other recorded, and an empty minute never replaces data. Among watches that are not primary, the first writer keeps the minute. A watch rewrites its own rows. | trigger `step_samples_device_guard` (BEFORE UPDATE, `RAISE(IGNORE)`) |
| Sleep segments and sleep scores | One watch per stretch of the night. A non-primary watch's segment is skipped when a row of another watch overlaps it. The primary's insert deletes the other watches' overlapping rows. Rows of one watch never remove each other. | triggers `sleep_segments_claim_*`, `sleep_scores_claim_*` |
| Night HRV (`hrv_readings`, `source = 'night'`) | Same as sleep. Spot HRV is a measurement the user starts on the connected watch: always stored, attributed to it. | triggers `hrv_readings_claim_*` |
| Health metrics (`health_metrics`, one value per type and time) | The primary wins a `(type, ts)`; for two other watches the first writer wins. | trigger `health_metrics_device_guard` |
| Workouts | **From any watch.** A session recorded by two watches (overlap of at least half of the shorter one, different watch) is stored once: the copy with a GPS track wins, else the primary's, else the one stored first. The loser is dropped (not stored) and noted in `workout_shadow`; if the new copy wins, the stored one is deleted with its points and noted instead. | native `WorkoutStore` (needs the points) |
| Watch with `tracks_health = 0` (a family member's band, a guest watch) | Its steps, sleep, workouts and health metrics are not stored at all; connecting, battery, faces, alarms and find-watch work. | native, `syncActivity` |
| Imported rows (`NULL` device) | Lose to every watch. | the triggers' `NULL` branches |

Consequences, by design:

- Setting another watch as primary changes who wins **from the next write**. Rows already stored keep their attribution. To let the new primary take the nights it recorded, use Sync full history on it (it pulls everything the watch still holds again; the primary's rows replace the other watch's overlapping ones).
- A dropped duplicate is not recoverable from JoyoFit (the watch still holds it until it rolls off). Sleep rows deleted because the primary arrived later were already uploaded to the cloud if the cloud was on; the cloud copy is not retracted (the cloud never learned about deletions of re-derived sleep either). A restored phone may therefore show two overlapping stretches for such a night.
- Removing a watch forgets its keys and its `device` row but **keeps its data** (rows keep the address; the UI shows "Removed watch"). Pairing it again re-attaches them.
- Per-watch watch-side settings (heart-rate alerts, notification switch, profile) are one set for the phone and are pushed to whichever watch connects.

## 4. What is where

| Piece | Files |
| --- | --- |
| Migration | `modules/huawei-wear/schema/joyofit-db-migrations.json` (14th entry), `ios/WearMigrations.swift` (generated), `src/db/migrations.test.ts`, `src/db/multiWatch.test.ts` (the merge rules run on the shipped schema) |
| Android writers | `WatchSql.kt` (every statement), `WatchDb.kt`, `SyncStore.kt` (`upsertDevice`, `save`), `WorkoutStore.kt` + `WorkoutDuplicates.kt`, `HealthMetricsStore.kt`, `NightHrv.kt`, `HrvSpot.kt`, `WearLink.kt` (`tracks_health` gate, `connect(remember)`), `BackgroundController.kt` + `WatchVisit.kt` (visits) |
| iOS writers | the Swift twins: `SyncStore.swift`, `WorkoutStore.swift`, `HealthMetricsStore.swift`, `HrvSpot.swift`, `WearLink.swift` (`tracks_health` gate). The iOS link has no night-HRV phase, so only the schema rule applies there |
| JS | `src/features/device/watches.ts` (device list queries), `useWatchList.ts`, `src/state/WatchProvider.tsx` (`watches`, `switchTo`, `removeWatch`), `WatchesSection.tsx` ("Your watches" in the Watch tab), `BondedRow.tsx` (Connect becomes "Switch here" while another watch is connected), `useWorkoutSource.ts` (workout detail shows the watch) |
| Tests | `bun test ./src/` (migration, merge rules, watch list); Android `cd android && lowprio ./gradlew :huawei-wear:testDebugUnitTest` (`MultiWatchSqlTest` runs every store statement against the shipped schema through `org.xerial:sqlite-jdbc`, a test-only dependency; `WatchVisitTest`, `WorkoutDuplicatesTest`, `DeviceIdentityIndependenceTest`); iOS `cd modules/huawei-wear/ios/ModuleLogicTests && swift test` (`MultiWatchTests`) |

## 5. Next store build

Native and schema, so: Play and App Store builds only. After installing, an existing phone migrates on first start (JS and native both run the 14th entry; whichever opens the database first applies it).

## 6. Not verified

- The UI was type-checked, linted and covered by the data-layer tests, but not run on a phone or an emulator (the owner's phone was busy with another test, no emulators here).
- The Android store statements ran on `sqlite-jdbc`, not on Android's own SQLite; the background visit, `connect(remember = false)` and the `tracks_health` gate are compiled and unit-tested only for their decision logic, they need a phone with two watches. The Swift `tracks_health` gate is tested at the store function, not through a connected `WearLink`.
- How Huawei Health itself treats two watches on one phone is not documented in anything we could read (section 1).
- Not done: separate people. A family member's band can be paired and used for faces, alarms and battery with `tracks_health` off, but JoyoFit has one profile; per-person data would be a different feature.
- Section 7 (borrowed band): the Kotlin backfill logic and its marks run on the JVM (`SwitchBackfillTest`), the TypeScript data-layer scenarios on the shipped schema (`watchSwitch.test.ts`). The chain connect, mark, sync through a live `WearLink` was not run (it needs a phone with two watches), and the Swift twin (`WearSettings.noteConnect`, `WearLink.runSync`) was written to mirror the Kotlin and not compiled or run here (no Swift toolchain on the Linux machine). The Today ring rule was not looked at on a phone. Whether a Huawei band keeps seven days or more of step history is the watch's own limit, not measured here.

## 7. Someone else's watch on your phone (a borrowed band)

Reported 2026-10-20: the owner of a Huawei watch connected his wife's Band 10 and his steps "went back to zero". His phone was not looked at, so there are two ways this reads as zero, one per kind of build:

1. **A build with the merge rules (migration 14 and later).** His stored minutes are safe: a non-primary watch only fills minutes nobody has, and an empty minute never replaces data (section 3). What changed is what Today showed. Today draws the day from `WatchProvider.totals`, the day counter the last sync of this app session reported (`FitnessTotals`, the watch's own number), and only falls back to the sum of the stored minutes when there is none. That counter belongs to the watch that ran the sync, so linking the band put the band's counter (its wearer's day, near zero in a drawer) on the ring while the owner's rows were intact.
2. **A build before migration 14.** `step_samples` had no watch on it and its key was the minute, so the band's first sync (a new watch pulls everything it holds) overwrote every minute it sent, empty ones included, in the owner's days. That data is gone from the phone; it only exists on the owner's watch until it rolls off (the first sync pulls the last 7 days, `docs/watch-reference.md`; the real retention shows in the `History: summary oldest step sample` log line). Other copies exist only if the person switched them on: steps and sleep upload to JoyoRogo only when signed in with the cloud unlocked (`src/cloud/uploader.ts`; `healthRestore.ts` brings back what was uploaded), and Health Connect holds per-minute step records only when its export was on (`HealthConnectExporter.kt`; JoyoFit never reads them back). Workout cloud sync carries workouts, not all-day steps.

**The ring (all runtimes with migration 14, JS only).** `ownTotalsOf` (`src/features/device/watchDayTotals.ts`): a phone with one watch row keeps showing the watch counter, as before. With several watches, the counter is used only when exactly one of them stores health data and the counter is that watch's (a guest band with `tracks_health` off reports zeros and is ignored). When two or more store health data the day is the sum of the stored minutes, the merged timeline of section 3. The totals carry the address of the watch that reported them (`WatchTotals.address`). No new binary is needed.

**Backfill on a switch (native, needs a new build).** `device.last_sync` is one cursor per watch, so a watch that comes back after another one was linked only asks for what is newer than its own last sync; whatever the other watch wrote over its minutes in the meantime is never asked for again. Now a connect the person makes (the one that becomes the remembered watch, never a background visit or the reconnect of the watch already followed) to a watch other than the remembered one marks the new watch (`SwitchBackfill`, `WearSettings.switchBackfill`; Swift: `WearSettings.noteConnect`). The next activity sync of a marked watch starts at 0, like a first sync or Sync full history, for steps and sleep (slices as in `syncSlices`; workouts and night HRV keep their own windows), and the mark is cleared once those slices were stored; a failed sync leaves it. Forgetting a watch clears its mark. Each switch therefore costs one pull of what the watch still holds; the rows are upserts and the merge rules above decide each minute.

What gets back on the owner's phone, by the state it is in:

- Rows the owner's watch wrote and the band could not touch (migration 14 builds): nothing to restore.
- Minutes an older build overwrote and migration 14 left without a watch (a phone with two `device` rows when it migrated): the owner's full pull replaces them, a row without a watch loses to every watch. The migration also makes the watch synced last primary, which is the band when it synced after the owner's watch: **Make primary** on the owner's watch (Watch tab, Your watches) before the band is linked again, or the band, as primary, takes minutes back.
- Days the watch no longer holds (older than its retention) cannot come back from JoyoFit.
- Remove and pair again (what a person tries first): removing the primary hands the primary to the watch synced most recently, so the owner's watch comes back as a non-primary watch and its row has no `last_sync`, which pulls everything by itself (`watchSwitch.test.ts`, "re-paired"). Make it primary again afterwards, or the band, as primary, keeps the minutes it fills.

Tests: Kotlin `SwitchBackfillTest` (the mark and the window rule, then the restore and the band's later sync on the shipped schema), Swift `SettingsAndIdentityTests.testSwitchBackfill…` and `MultiWatchTests.testAFullPullOfTheOwnersWatch…`.
