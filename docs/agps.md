# Satellite data (A-GPS) for the watch

The Huawei Watch Fit 4 Pro (and the rest of the family) shows a warning that its GNSS data has expired and says it needs Huawei Health.
That is the watch's satellite assistance data (ephemeris / almanac). Without it GPS fixes get slow. This page records what the protocol is,
what JoyoFit can and cannot do about it, why, and what is implemented.

**Short version.** JoyoFit answers the watch's request, serves the public Broadcom LTO file when (and only when) the watch asks for that
kind, declines every other kind, and shows honestly what happened. It cannot clear the warning on a watch that asks for Huawei's own data:
that data is prepared by Huawei's app from Huawei servers, with formats nobody has fully documented, and the watch does not check what it
is given.

Code (Android): `modules/huawei-wear/android/.../Ephemeris.kt` (exchange, status, update now), `EphemerisDownload.kt` (HTTP, cache),
`AgpsSource.kt` (where the data comes from), `AgpsPolicy.kt` (schedule, validation), `AgpsStore.kt` (persisted state),
`AgpsModuleApi.kt` (JS API). Code (iOS, `modules/huawei-wear/ios`): `Ephemeris.swift` (`AgpsExchange`, `EphemerisLink`), `AgpsSource.swift` (source,
HTTP, Caches copy), `AgpsStore.swift`, `AgpsReachability.swift`, and in `HuaweiProtocol/Sources/HuaweiProtocol`: `AgpsWire.swift` (`AgpsPolicy`,
`AgpsMessages`) and `Packet+FileChunk.swift` (the `1C/05` frames). UI: `src/features/device/AgpsSection.tsx`, `agps.ts`. **The Watch tab row is hidden** unless the watch's last ask was download version 0 (`agpsVisible`: `lastAskAt > 0` and `lastAskVersion === 0`); a Fit 4 Pro asks for version 3 and sees no row (owner decision, 2026-10-18). Native code is unchanged and still answers state 4. Wire details:
`protocol/README.md`, section "AGPS / ephemeris".

## How it works on the wire

- Service `0x1F` (ephemeris) with the file service `0x1C` carries it. **The watch drives**: it sends `1F/01` op 1 ("I need data", no useful
  content, like a permission check); the phone answers `100000` (or `100007` without network) and asks `1F/02` for the watch's parameters; the
  watch answers with a download **version**, a **tag list** and URLs; the phone says `1F/03` ready (3) / failed (4) / unsupported (5); the
  watch then pulls the files over `1C/01..06` (file list, consult, file info, data request, frames, done), one request after the other.
- The update is started by the user **on the watch**: Settings > Workout settings > Location Services > Satellite updates > Update
  ([Huawei support](https://consumer.huawei.com/eg-en/support/content/en-gb16056995), lists the Watch Fit 4 Pro; it also says devices after the
  Watch 4 series can update through a Wi-Fi network or eSIM, and that data should be refreshed every 1 to 2 days).
- Gadgetbridge does **not download anything**: `HuaweiEphemerisManager` reads a user-supplied `ephemeris.zip` copied out of Huawei Health.
  Its maintainer's summary ([issue 3928](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/3928)): the phone cannot push data unasked;
  Huawei Health downloads from Huawei servers (some URLs need authorization) and converts the answers into proprietary binary files with a
  short time to live; every requested file is required; there is no way to skip a request; the watch does not validate the files, and wrong
  data bootlooped his watch and wedged its GPS (hard reset or firmware update to recover).
- Service `0x18` (`GpsAndTime`, `SendGpsDataRequest`) is something else: the phone's *location* streamed to the watch during a workout. The Fit 4
  Pro asks for it about every 20 s while an outdoor workout runs (`LiveWorkout.gpsPing`). It is what speeds up the first fix without any
  satellite file (Gadgetbridge reports 1 to 2 minutes instead of 10 or more).

## What kinds the watch asks for

| Download version | Tags | Source | JoyoFit |
|---|---|---|---|
| 0 | none (URLs in the consult) | Broadcom LTO file, `https://gllto.glpals.com/7day/v6/latest/lto.dat` | served, only when the watch asks for version 0 |
| 1 to 3 | `HW_AGNSS` (`HW_AGNSS_RTCM_33`), `HW_PGNSS_*` (GPS, GLONASS, GALILEO, BDS, QZS, EXTRA, `HW_PGNSS_PRED`, `HW_PGNSS_TRANS`), `MTK_EPO_*`, `HW_RSMC_*`, `HW_PRECSION_ION` | Huawei servers and MediaTek EPO, converted by Huawei Health | declined: state 4 "failed", outcome `unsupported`; nothing else is ever offered instead |

For a Watch GT4 the captured sequence is `HW_AGNSS_RTCM_33`, then `HW_PGNSS_*`, then `MTK_EPO_*` (Gadgetbridge issue 3928). Which set the Fit 4 Pro
asks for is **not yet observed**: the watch never asked on its own while JoyoFit watched, and answers the phone-started question with error
118001 (see "Device findings"). JoyoFit logs the consult (version, tag names) to the status row and the full tag to logcat (tag `JoyoFit`, `AGPS:`)
the first time it asks.

Format notes from the community (Me7c7, MIT, <https://codeberg.org/Me7c7/HDataResearch/src/branch/main/pgnss>): `HW_AGNSS_RTCM_33` is RTCM 3.x
ephemeris messages 1019 (GPS), 1020 (GLONASS), 1042 (BeiDou), 1046 (Galileo I/NAV), CRC-24Q; `HW_PGNSS_GPS` is a 72-slot header of
`{time, offset, size}` with 2564-byte blocks of 80-byte ephemeris records, built from `HiEE.dat` (JSON with base64 values, Huawei server);
`MTK_EPO_*` is 72-byte records per satellite with an XOR checksum. His attempt to match the PGNSS data with public ephemeris failed.

## Why Huawei's servers are not used

No document gives third-party apps permission to call the endpoints behind Huawei Health's satellite data (`geo-dra.platform.hicloud.com`, the config
server). They are not documented APIs. The only terms found are Huawei's [Agreement on Use of Huawei APIs](https://developer.huawei.com/consumer/en/doc/app/10129)
(2.4 access only by the documented means and without masking identity, 4.1c no reverse engineering, 5.4 no scraping or caching) and the
[Health Kit agreement](https://developer.huawei.com/consumer/en/doc/app/70941808), which covers the official Health Kit only. Gadgetbridge's maintainer
says some URLs need authorization and that he is unsure he may share them. Decision (owner, 2026-10-18): not used. An earlier build carried an
off-by-default switch for `HW_AGNSS`; it was removed with this decision, because serving a kind the watch does not validate is a risk to the watch
as well, and `LEGAL.md` and the Play data-safety text stay true as they are.

## The Broadcom LTO file (what is served)

- Public, plain GET, no account, no key, no app identification. Behind Cloudflare / CloudFront; answers `200`, `binary/octet-stream`.
- Measured 2026-10-18: **115 749 bytes**, starts `FF CA DE 00`, `Last-Modified` a few hours earlier (regenerated several times a day),
  `cache-control: max-age=240`. It predicts **7 days** ahead (`/7day/`).
- Terms: Broadcom publishes none on the endpoint and it is not a documented public API. JoyoFit treats it as best-effort. The phone sends no
  location, no ID, no app name; the server sees the IP address (declared in `docs/play-store.md` and `LEGAL.md`). Risk: Broadcom can change or
  close it without notice; the result is a logged, retried download, never a broken watch.
- It is the data of Broadcom-GPS watches. Offering it to a watch that asked for another kind is **never done**: the watch does not validate it.

## Open alternatives that were checked

| Source | Finding |
|---|---|
| Broadcast ephemeris, BKG (`https://igs.bkg.bund.de/root_ftp/IGS/BRDC/`) | Anonymous, public daily multi-GNSS RINEX navigation files (e.g. `BRDC00WRD_R_20262910000_01D_MN.rnx.gz`). Could be re-encoded to RTCM 1019/1020/1042/1046 = only the `HW_AGNSS_RTCM_33` part. |
| Broadcast ephemeris, NASA CDDIS | Needs an Earthdata login (HTTP 401). |
| MediaTek EPO (`wpepodownload.mediatek.com`, `vendor` / `project` / `device_id` query) | Vendor service, no public terms found; a GET with dummy values answered 403 on 2026-10-18. |
| u-blox AssistNow | UBX-MGA for u-blox receivers; free tier needs a token. Not this watch's chip. |
| Galileo GSC almanac | Almanac only; no ephemeris, wrong format. |
| Google SUPL | Network assistance protocol, no public terms, no file interface. |

### Future, lab-only option (not implemented)

A generator for `HW_AGNSS_RTCM_33` from the BKG broadcast ephemeris is technically possible (RTCM encoding of four message types, about two days with
tests). It would still leave `HW_PGNSS_*` (Huawei's predicted ephemeris, partly unknown fields, orbit prediction needed) and `MTK_EPO_*`, and the watch
asks for all of them in sequence. Only revisit it as a lab switch on a watch that can be factory-reset, never on a daily watch, and only with the
owner's explicit decision.

## What is implemented

| What | Value |
|---|---|
| Broadcom file size accepted | 16 KiB to 1 MiB, header `FF CA DE` |
| Validity shown | 7 days from the server's `Last-Modified` |
| Phone copy reused for | 6 h (`AgpsPolicy.CACHE_FRESH_MS`) |
| Offered to the watch again after | 24 h (`DELIVER_EVERY_MS`) |
| Download retry after failures | 1 min, 5 min, 15 min, 1 h, then every 6 h; reset by a success or by "Perbarui sekarang" |

When data is sent:

1. **When the watch asks** (`1F/01` op 1): the exchange above, answered from the phone copy when it is under 6 h old.
2. **Kept ready**: every completed sync, app or background (Android `WearRuntime.syncComplete` -> `EphemerisLink.onSyncCycle`; iOS
   `WearRuntime.handleSyncComplete` -> `EphemerisLink.onSyncCycle`), refreshes the phone copy when
   it is missing or 6 h old, with the retry schedule, so the watch's next ask is answered at once. Only while the watch has not asked for another kind.
3. **"Perbarui sekarang"** (Watch tab, Data satelit): downloads fresh data; with a watch connected it also asks the watch for its parameters
   (`1F/02`, phone-started) and carries on if the watch answers. The Fit 4 Pro answers `7f=118001` ("no request open"), so the row then says
   the watch has to start the update itself, and the data stays ready on the phone.
4. **Before a phone-started outdoor workout**: a workout recorded by the phone uses the phone's GPS, not the watch's; the watch's own data does not
   matter there. Workouts started on the watch trigger the watch's own ask (item 1) and receive the phone's GPS (service `0x18`).

Watch safety rules:

- A file is validated before it is offered (size bounds, LTO header). A bad download is never cached and never sent.
- Every watch request is bounded: data per answer (1 MiB), frames per answer (65 535, at least one byte each), offsets and names checked; anything
  else is answered `100001` and ends that transfer.
- A transfer that goes silent for 30 s is dropped and recorded as a timeout; a "ready" nobody collects within 60 s is dropped; the download has a
  120 s timeout. Cancelling in the app, or a failed download, tells the watch "failed" (state 4); a lost connection drops everything.
- Only the services `1F` and `1C` of the already authenticated session are used; nothing touches pairing, bonding or keys.
- A delivery is recorded only when the watch closed the transfer after every byte had been sent.

The status row (Watch tab) shows last delivery, size, the phone copy, the kinds the watch last asked for (tag names only), the outcome in words,
and, when the watch asked for a kind JoyoFit cannot provide, what to do instead: the watch's own Wi-Fi update if available (Settings > Workout
settings > Location Services > Satellite updates), and that outdoor workouts get the phone's GPS.

## Device findings (Fit 4 Pro, Seiya-B29F, firmware 6.1.0.117)

- 2026-10-18, build 1470889 (run 39120670776): after connect the log shows `AGPS: ready`; the watch listed none of `1F/01..03`, `1C/01`, `1C/04` in
  SupportedCommands, but that list also omits services that work (`0x28`, `0x37`), so it is not authoritative.
- The watch sent no `1F/01` by itself during workouts or in the minutes watched. A phone-started `1F/02` was answered `7f 0001CCF1` (118001), no `0x81`
  container: the watch implements the service and has no request open.
- The Broadcom file downloaded and was cached (115 749 bytes, 113 KB in the row).
- Pending: the consult (version and tag names) after the user starts the update on the watch.

## iOS

The Swift port mirrors the Kotlin code one to one: `AgpsExchange` (an actor; the watch's messages go through one inbox and are handled in order,
the download runs on its own task), `EphemerisLink` (a `LinkObserver` that `WearRuntime` attaches to every new session, poked after every
completed sync), `AgpsStore` (UserDefaults suite `joyofit_agps`), `NetworkAgpsSource`, `AgpsPolicy` and `AgpsMessages`. The constants, outcome
strings, wire bytes and safety rules are the Android ones, and the Swift tests (`AgpsTests`, `AgpsExchangeTests`, in
`ModuleLogicTests`) are ports of `AgpsTest` and `AgpsExchangeTest` with the same cases and spec bytes. JS API: `getAgps`, `refreshAgps`,
`cancelAgps` on the Swift module; the Watch tab row shows on iOS wherever `HuaweiWear.getAgps` exists.

Differences, all forced by the platform:

- **Network**: `URLSession` with an ephemeral configuration, no cookies, credentials or cache, https only, bodies capped while they arrive (a
  delegate cancels the request once the cap is passed), 30 s without data and 120 s overall. URLSession's default `User-Agent` names the app, so
  it is replaced by the plain `CFNetwork`; no other identifying header is sent. The Android `HttpURLConnection` sends only its platform agent.
- **Copy on the phone**: the `Caches/agps` directory (iOS may empty it; that costs a refetch), pruned after a day, aged by the file's
  modification time.
- **Online check**: `NWPathMonitor` instead of `ConnectivityManager`.
- **Watch address**: the stored file name the watch is told (`sha256(address) + name`) is built from the peripheral identifier iOS gives the
  app, since iOS never exposes the watch's Bluetooth address. The watch only stores the file under the name it is given.
- **Console log**: the full consult tag and URLs go to the unified log (category `JoyoFit`, line `AGPS: consult tag=...`), never to the support log.
- **Background**: the prefetch after a sync runs on the process's own task. An iOS background sync that ends the app's run time may suspend it
  mid-download; the next sync tries again (the download timeout and the retry schedule are unchanged).
- **Not verified on a device**: like the Android side, UNVERIFIED on the Fit 4 Pro until a device run; "Device findings" is the place for it.

### Observed on the watch's own ask (2026-10-18 22:06 to 22:07, build 1471119, master 375f052)

Settings > Workout settings > Location Services > Satellite updates > Update ended with "Update timed out. Open Huawei Health and check the internet connection".
Logcat (tag `JoyoFit`), repeated four times, about 20 s apart (22:06:29, 22:06:51, 22:07:01, 22:07:20):

- `RX svc=1f cmd=01 ... AGPS: watch asks for ephemeris data: op 1`, answered `100000` and `1F/02` sent; the watch answered the consult in 0.07 to 0.15 s.
- `consult answer: download version 3, tag 67 chars (HW_PGNSS_PRED), 0 urls`; full tag `com.huawei.higeo_dataModule_PGNSSConfig?type=HW_EEV2/HW_PGNSS_PRED;`.
- JoyoFit sent `1F/03` state 4 (failed); the watch acked `7f=000186A0` (100000). No `1C` request followed.

So the Fit 4 Pro asks for version 3 / `HW_PGNSS_PRED` (Huawei's predicted ephemeris, Huawei servers only), never version 0 (Broadcom LTO). There is no handler,
parse or timing fault: the phone answered within milliseconds each time. The watch's "timed out" text is its wording for an update that ended without data.
Nothing in the policy (Broadcom LTO only, no Huawei servers) can satisfy this kind, so there is no code fix; the decline is the intended behaviour.

**Consequence for the UI (owner decision, 2026-10-18):** the "Data satelit" row in Watch is not shown for this watch, since it can only ever be declined. It appears if a watch asks for version 0. There is no other entry point (no setting, help text or onboarding step mentions it). The "what to do instead" help text was removed with it.
