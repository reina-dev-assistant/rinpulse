# In-app update prompt (Android, Google Play installs)

Written 2026-10-17. A banner (`src/features/updates/UpdateBanner.tsx`, mounted in `src/app/_layout.tsx`, logic in `src/features/updates/useAppUpdate.ts`) tells people who installed JoyoFit from Google Play that a newer build is waiting.

## Who gets it

Decided once at start from the installer package name (`react-native-device-info` `getInstallerPackageName`):

| Install | Result |
| --- | --- |
| Play Store, any track (internal, closed, open, production) | Play In-App Updates, **flexible** flow |
| Sideloaded APK (`scripts/build-release.sh` without `--play`) | nothing: JoyoFit has no public APK and no self-updater, so there is no manifest to compare with |
| iOS | nothing: TestFlight already notifies; App Store installs are skipped on purpose |

## Behaviour

- Checks on every cold start and when the app returns to the foreground, throttled to once per 6 h (`CHECK_THROTTLE_MS`).
- Banner "New version available" with **Update** / **Later**. "Later" hides it for 24 h (`DISMISS_MS`, persisted in SecureStore key `joyofit_update_dismissed_at`).
- **Update** opens Play's own confirm dialog; once accepted Play downloads in the background (progress bar in the banner). When the download finishes the banner becomes **Restart to update**, which calls `completeUpdate()` and relaunches into the new version. Declining Play's dialog counts as "Later".
- If the app is killed after accepting, the next start sees Play's `DEVELOPER_TRIGGERED` state and shows **Restart to update** right away; a status event flips it back to the progress bar if bytes are still arriving.
- Pure rules (throttle, dismiss window, version compare, installer check) are in `src/features/updates/updatePolicy.ts`; `bun test ./src/` covers them.

## Module choice

`sp-react-native-in-app-updates@2.0.0` plus `react-native-device-info@15.0.2` for the installer name (sp imports device-info on Android, so it must be linked anyway; `overrides` in `package.json` pins a single copy because sp depends on 10.3.0).

- 2.0.0 (July 2026) ships a codegen TurboModule spec, so it targets the new architecture that RN 0.86 (Expo SDK 57) requires. It autolinks without a config plugin (checked with `expo-modules-autolinking react-native-config --platform android`).
- It exposes what the flexible flow needs: download status events with byte counts, and a separate `installUpdate()` for the restart.
- `expo-in-app-updates@0.12.0` was rejected: its native module calls `completeUpdate()` the moment the download finishes (the app restarts without the user pressing "Restart to update") and it reports no download progress.
- Both libraries are loaded lazily (`play.android.ts`): a dev client built before they were added just gets no prompt instead of crashing at start.

## Testing after the next build

In-App Updates only works for builds **installed by Google Play**, and only when Play has a **higher versionCode on the same track** that the tester can get. `expo run:android` and `adb install` builds are never offered an update (their installer is not `com.android.vending`, so the Play path never starts).

1. Build two Play bundles with `scripts/build-release.sh --play`; versionCode is minutes since 2024-01-01 (`plugins/with-version-code.js`), so the second is always higher.
2. Upload build A and build B to the same track (internal testing is fastest). Install **A from the Play Store** on a tester device and open it once.
3. Release B on that track and wait until the Play Store shows "Update" for JoyoFit (reopen the Play Store page for JoyoFit to refresh its cache).
4. Open A. Expect "New version available". Tap **Update**, accept Play's dialog, watch the progress bar, then tap **Restart to update**. The app relaunches as B.
5. Tap **Later** instead: the banner must stay away for 24 h, even after killing and reopening the app (clear the app's storage to reset).
6. Fastest loop, internal app sharing (Google's procedure: <https://developer.android.com/guide/playcore/in-app-updates/test>): install A from an **internal app sharing link**; upload B (higher versionCode) as a new internal sharing link; open B's link on the device but **do not install** from the Play page; open JoyoFit from the launcher. The update is then offered. `inAppUpdatePriority` is not supported there (JoyoFit does not use it).

Google's troubleshooting list: the Play account on the device must have installed the app from Play at least once, application ID and signing key must match the Play version, and the installed versionCode must be lower than the update's.

`adb logcat | grep -i "InAppUpdates\|AppUpdate"` shows the Play Core side.

## Limits

- Flexible flow only. Immediate updates and update priority are not used.
- On a cold start with an accepted-but-unfinished update the banner shows "Restart to update" first (Play exposes no downloaded flag outside its status events). Tapping it while bytes are still downloading does nothing until the download completes.

## Over-the-air JS updates

Binary updates (above) are one channel; JS-only fixes also arrive through EAS Update (`expo-updates`, `docs/ota.md`). They download in the background and apply on the next cold start; once one is downloaded, the banner shows "Update ready to install" with **Restart to update**, and Settings, About has a "Quick updates" block. The OTA banner wins over the Play and APK prompts, and the same 6 h foreground throttle applies.

A server-controlled **minimum build** (full-screen "Update dulu" wall, "Ada versi baru" banner, cold-start OTA refresh) sits on top of all of this: see `docs/force-update.md`.
