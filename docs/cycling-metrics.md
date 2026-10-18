# Cycling metrics

Written 2026-10-18, branch `sensors`. Everything here is JavaScript: no native code, no database migration, ships over the air once the `sensors` branch is in a store build (the branch itself carries native changes, see docs/sensors.md).

Rides now get what running got in `docs/strava.md` ("Workout numbers 1:1 with Strava") and the Kebugaran work: one set of numbers for the header, the analysis, the Strava file and the load, computed from the stored 1 Hz points.

## 1. Audit

"Before" is the ride detail at the start of this work (the generic analysis built for runs: `src/features/workouts/analysis`, 600-step grid). "Now" is `src/features/cycling`. The three data sources:

- **Huawei watch ride.** The protocol delivers, per sample, heart rate, speed (dm/s), cycling cadence (rpm) and cycling power (`protocol/README.md`, data chunk `17/0A`), plus the GPS file. Cadence, speed and power only exist when the bike's sensors are paired with the watch; a Huawei watch has no left/right balance field. Total distance, active time, calories and the watch's own ascent come with the totals (`17/08`).
- **Phone recording** (`features/record`, Bluetooth CSC / power / heart rate sensors): 1 Hz samples with speed (wheel or GPS), cadence, power, heart rate; the power meter's pedal balance is parsed by `gatt.ts` and is now kept (see 4).
- **FIT import** from a bike computer (Garmin Edge, Wahoo ELEMNT, iGPSPORT, COROS, Bryton, Magene): everything a record carries (position, altitude, heart rate, speed, cadence, power, laps) plus the device's session totals, which the app now also reads for pedal balance.

| Figure | Garmin Connect / Edge | COROS | iGPSPORT | Strava | TrainingPeaks | JoyoFit before | JoyoFit now |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Speed unit | km/h | km/h | km/h | km/h | km/h | km/h in the summary, but the chart tab and splits were built on pace first | km/h everywhere on a ride, never pace |
| Avg speed / avg moving speed / overall | all three | avg + moving | avg + moving | moving-time based | from file | one figure: distance over moving time | `avgMs` (timer), `avgMovingMs` (after auto-pause), `avgOverallMs` (elapsed) |
| Max speed | yes | yes | yes | yes (fastest between two fixes) | yes | the watch's | fastest 3 s mean of the 1 Hz speed |
| Moving time | auto-pause by the timer | timer | timer | speed threshold on rides, device pauses respected | file | the running rule (a pause of 30 s or more, else elapsed) | the timer plus a cycling stop threshold of 1.0 m/s (3.6 km/h), never above the timer |
| Distance | device | device | device | device or GPS | file | watch total, GPS path scaled to it | the same; no GPS: wheel sensor, else the flat-road model of the power (indoor) |
| Elevation gain / loss | barometer with its own filter (ascent), DEM options | barometer | barometer | corrected with its elevation basemap | file | 60 s mean + 1 m hysteresis, fitted to Strava walks | 15 s mean + 2.5 m hysteresis, the best of 4 public bike files; `summary.elevationGain` still wins for an imported file |
| Avg / max grade | max grade, avg grade | yes | yes | yes | yes | none | net average, steepest 100 m up and down |
| Splits | 1 km or 1 mi autolap, or any lap | 1 km | 1 km / 5 km | per km / mi | laps | per km | every 5 km (moving speed, HR, power, cadence, climb) |
| Laps | device laps | device | device | device | device | listed (pace-oriented) | the device or FIT laps with km/h, power, HR, cadence |
| Climbs | ClimbPro: 500 m, 3 %, score 1,500, categories 4 to HC (courses); Garmin Connect lists climbs of an activity | climb segments | climbs | climbs with categories (segments) | none | none | ClimbPro rules on the altitude: length, gain, average and maximum grade, time, VAM, power, HR, category |
| Calories | device (power: work) | device | device | device | file | the stored figure | power (kJ, 0.996 kcal per kJ), else the stored figure, else Keytel on heart rate, else MET |
| Cadence | avg excludes zeros, time in zone | avg | avg + zones | avg | zones | avg of the non-zero grid values (zeros were already dropped), no bands, no coasting time | avg and max over pedalling seconds, coasting counted apart, 8 cadence bands |
| Avg / max power | yes | yes | yes | yes | yes | avg and max (grid) | avg (zeros included, as Garmin), max of the 1 Hz samples |
| Normalized power | yes | yes | yes | "weighted average power" | yes | `summary.normalizedPower`, else a 30 s window over the 600-step grid, whose step is 1 s only for the first 10 minutes of a ride and 18 s for a 3 hour one, so only the file's own figure was right on a long ride | 30 s rolling, 4th power, on the 1 Hz series |
| IF / TSS / VI | yes (Edge: with FTP) | yes | yes | no | yes (the source of the definitions) | none | IF, TSS, VI from NP and the FTP set in Settings |
| W/kg | yes | yes | yes | yes (power curve) | yes | none | average, NP and every curve point against the profile weight |
| Power zones | 7 (Coggan) | yes | yes | 7, subscription | 7 | none | Coggan 7 zones from FTP, time in each |
| Power curve / best efforts | yes | yes | yes | yes, subscription | yes | none | 5 s, 1, 5, 20, 60 min plus 10 more points per ride; all-time curve and a record badge from every stored ride |
| L/R balance | yes with dual-sided pedals | yes | yes | no | yes | none | mean left share from a power meter that sends it (phone and FIT); not from a Huawei watch |
| FTP | field test, auto-detect, set by hand | yes | yes | estimate | yes | none | set in Settings, plus a suggestion of 95 % of the best 20 min, never applied by itself |
| HR zones | 5 | 5 | 5 | 5 | 5 or 7 | 5 (percent of max HR) | the same, unchanged |
| Aerobic decoupling | Pw:Hr / Pa:Hr (Connect IQ) | no | no | no | Pw:Hr | none | Pw:Hr (power) or Pa:Hr (speed) on rides with 40 minutes after a warm-up |
| Training load | Training Load / Load Focus | Training Load, EvoLab | training load | Relative Effort | TSS, CTL/ATL/TSB | Edwards TRIMP from heart rate (a power ride without a strap counted for nothing) | TSS-based for a power ride with an FTP, TRIMP otherwise, in the same ACWR / readiness / recovery |
| Indoor ride | speed from the wheel sensor, virtual speed on a trainer | yes | yes | VirtualRide | yes | whatever the file had; no distance without a speed sensor | wheel speed, else the power model; no elevation, no climbs |

The competitor columns are from their published help pages and product behaviour as I know them; except for Garmin ClimbPro (Edge owner's manual, verified 2026-10-18) and Strava's moving time (Strava Support, verified the same day) I did not re-check each cell in this pass.

## 2. What is computed, and from where

All of it is in `src/features/cycling/` and pure (tests run under `bun test`). `analyzeRide` is the entry point; `series.ts` turns the stored points into 1 Hz arrays first, because the generic grid is at most 600 steps wide (a 3 hour ride is 18 s per step) and cannot carry a 30 s rolling mean or a 5 s best effort.

### 1 Hz series (`series.ts`)

- Index `i` is `i` seconds after the start. A second is **covered** when a sample lies within 10 s of it; stretches without are pauses or dropouts. Heart rate, altitude and speed are interpolated over gaps up to 10 s, cadence and power held for up to 3 s.
- **Speed source**: the points' own speed (wheel sensor, or the bike computer's) when at least half of the covered seconds have it; else the cleaned GPS path; else, indoors with power, the flat-road model; the speed of a second is the 3 s mean.
- **Distance** is the speed integrated over the covered seconds and scaled to the recorder's total, as for running (`strava.md`).
- **Auto-pause**: a covered second with a speed under `STOP_SPEED_MS = 1.0` m/s is stopped. Running uses 0.5 m/s. Garmin, Wahoo and iGPSPORT do not publish their thresholds and Strava says only that "a speed threshold" is applied to rides; 1.0 m/s is JoyoFit's own choice, sitting above GPS jitter at a standstill and below any climbing speed. Moving time is capped at the timer (the watch's active time, `movingOf`).
- **Indoor speed without a wheel sensor**: `P x 0.976 = 1/2 rho CdA v^3 + Crr m g v` on the flat, with rho 1.2 kg/m3, CdA 0.35 m2 (hoods position, Martin et al. 1998: 0.32 to 0.40), Crr 0.004, bike 9 kg plus the profile weight. 200 W and 75 kg is about 33 km/h. An estimate and labelled as one.

### Power (`power.ts`)

Definitions of Andrew Coggan and Hunter Allen, *Training and Racing with a Power Meter* (3rd ed., VeloPress 2019), as TrainingPeaks and GoldenCheetah (`NP`, `IsoPower`) publish them:

- **NP** = fourth root of the mean of the fourth powers of the 30 s rolling mean of power; the first value is seconds 1 to 30. Recording pauses are dropped before rolling; seconds the recorder ran with no watts are zeros.
- **IF** = NP / FTP. **TSS** = seconds x NP x IF / (FTP x 3600) x 100 (an hour at FTP is 100). **VI** = NP / average power. **Work** (kJ) = sum of watts over the seconds / 1000.
- **Zones** (share of FTP): z1 under 55 %, z2 55 to 74, z3 75 to 89, z4 90 to 104, z5 105 to 119, z6 120 to 149, z7 150 and over. Time counts every covered second, coasting in z1.
- **Power curve**: best mean power over a continuous stretch of the wall clock for 1, 5, 10, 15, 30 s, 1, 2, 5, 10, 20, 30, 45, 60, 90, 120 min (a stop inside the window counts as zeros). **FTP suggestion**: 0.95 x best 20 min (Allen and Coggan); shown as a suggestion with a button, never written by itself.
- **Calories from power**: work in kJ / 0.24 gross efficiency / 4.184 = 0.996 kcal per kJ (the rule of thumb of "1 kJ is about 1 kcal"; Garmin and TrainingPeaks use it).

### Elevation, grade, climbs (`analyzeRide.ts`, `climbs.ts`)

- **Gain and loss**: a file's own totals (`summary.ascentSource = 'device'`, written by the FIT import from the session's `total_ascent`/`total_descent`, as Garmin and Strava show for a barometric device) are used as they are. Without them (a phone GPS recording, `ascentSource = 'computed'`; a watch without totals) it is computed: a 15 s mean of the altitude, then a 2.5 m hysteresis (`elevationProfile`, now taking the smoothing and the hysteresis as optional arguments; running keeps 60 s and 1 m). A bike covers 100 m in 15 s at 25 km/h, a minute is 400 m. No Strava ride data exists to fit, so the pair is the one with the smallest mean error against the ascent four public bike-computer files carry (section 4). An imported file's own totals still win, as for runs.
- **Grade**: net grade over the ride; steepest ascent and descent over a 100 m stretch of the altitude smoothed over distance (a 15 s mean in time, then 90 m); a grade past 30 % is noise and is clamped. A recording gap of 2 minutes ends a stretch, so a lift home or a paused device cannot make a grade.
- **Climbs** follow Garmin ClimbPro (Edge owner's manual "Climb Categories"; Garmin Technology "ClimbPro"): at least 500 m long, 3 % average grade, a score (length in metres x average grade in percent) of at least 1,500; categories by score above 8,000 (4), 16,000 (3), 32,000 (2), 64,000 (1), 80,000 (HC). ClimbPro reads a planned course; a recorded ride has none, so the climbs are found in the altitude: zigzag of 3 m turning points, ascents cut by a dip of 10 m or less are joined, the flat before and the plateau after are trimmed. Garmin does not publish its own detection; this one is JoyoFit's.

### Cadence and heart rate

- Average and maximum cadence are over pedalling seconds (cadence above 0): coasting is left out, as Garmin does, and counted apart. Bands: coasting, 1 to 59, 60, 70, 80, 90, 100, 110 and over rpm.
- HR zones are the existing ones (percent of maximum heart rate, `hrZones`).
- **Aerobic decoupling** (Joe Friel, *The Cyclist's Training Bible*; TrainingPeaks "Pw:Hr" and "Pa:Hr"): the moving seconds after a 10 minute warm-up, at least 40 minutes, with heart rate on 90 % of them, split in two halves; efficiency factor = NP over average heart rate (Pa:Hr: average speed over heart rate when there is no power); decoupling = (EF1 - EF2) / EF1. Under 5 % is a good aerobic base (Friel).

### Training load (`store.ts`, `load.ts`)

The load model of JoyoFit is Edwards TRIMP from the heart rate in `step_samples` (per day, `listDayHeartLoad`), which feeds strain, ACWR (readiness, Kebugaran) and recovery. A ride already reaches it through its heart rate minutes (the watch's, or a phone recording's or FIT import's own `step_samples` rows). Two gaps, both closed here:

1. A ride with a power meter and **no heart rate** counted for nothing (days without heart rate are rest).
2. A ride scored by power should be scored by power.

So for a ride with power and an FTP the day gets `TSS x 2.4` (TRIMP-equivalent) **in place of** the ride's own heart rate TRIMP. `2.4` is JoyoFit's calibration, not a published constant: an hour at FTP is TSS 100 and, at the heart rate of an hour at threshold (zone 4, 80 to 90 % of maximum), 4 x 60 = 240 TRIMP. The delta `TSS x 2.4 - ride TRIMP` is added to the ride's local day (`rideLoadDeltas`, `applyRideLoad`, applied to the data of Today, Kebugaran and Trends); rides without power or without an FTP, and every run, are left exactly as they were, so nothing is counted twice. Per-ride figures (NP, seconds, TRIMP, the power curve) live in `ride_metrics`, created from JS, rebuilt when `RIDE_ENGINE_REV` changes; at most 4 rides are analysed per screen visit.

### Settings, e-bike mark, export

- **FTP** (Settings, "Bersepeda"): `joyofit.ftpW` in the key-value store, 50 to 600 W. Wheel size is the existing `WheelSection` (Sensor screen), reused.
- **E-bike**: a per-ride switch on the detail, kept in the key-value store by the ride's start (`joyofit.ebike.<start>`), because the watch sync rewrites `summary_json`.
- **FIT export** (`activityFile.ts`): session fields `normalized_power` (also on the lap), `training_stress_score` (x10), `intensity_factor` (x1000), `threshold_power`, `total_work` (J), `left_right_balance` (100ths of a percent), `avg_grade`, `max_pos_grade`, `max_neg_grade`; the average cadence is the pedalling mean, the maximum speed the 3 s mean, the ascent the bike's.
- **Strava `sport_type`**: outdoor `Ride`; indoor (Huawei indoor-cycling types 7 and 141) `VirtualRide` (the `trainer` flag is no longer sent for it); `EBikeRide` for an outdoor ride the person marked (FIT sport stays cycling, sub sport e-bike fitness, so gear matching is unchanged). FIT import of a file with several sessions keeps working as before.
- **Phone recording**: an indoor ride with a power meter and no wheel sensor now records the model speed and distance; the power meter's pedal balance is averaged while pedalling into `summary_json.balanceLeftPct`.

## 3. Tests

| What | Where |
| --- | --- |
| NP, IF, TSS, VI, work, zones, curve, FTP suggestion against hand-computed values and an independent NP implementation; pauses; speeds and times; 5 km splits; laps; elevation, grade, climbs and categories; cadence; decoupling; calories by source; indoor model; load | `src/features/cycling/analyzeRide.test.ts` (33 tests) |
| Per-ride cache, all-time curve and records, load deltas on an in-memory database with a run and rides on the same days (no double counting, power meter without heart rate, run-only day untouched) | `src/features/cycling/store.test.ts` |
| Sport types, session fields decoded with Garmin's SDK, ride through the Strava file and back through the FIT import | `src/features/strava/activityFileRide.test.ts` |
| Pedal balance from FIT records and session | `src/features/fitimport/balance.test.ts` |
| Recorder: indoor model speed, mean balance | `src/features/record/recorder.test.ts` |
| Real bike-computer files (needs `RIDE_FIT_DIR`, skipped otherwise) | `src/features/cycling/golden.test.ts` |

```
bun test ./src/                                   # everything, the golden block skipped
RIDE_FIT_DIR=<folder with the files> bun test src/features/cycling/golden.test.ts
```

### Golden rides

No ride FIT existed on the machine or in the repo (the FIT files in `/tmp` and the test fixtures are walks). Four public rides were downloaded from python-fitparse's test data (`github.com/dtcooper/python-fitparse/tests/files`, which took them from `tormoder/fit`'s test data, both MIT-licensed code). The files themselves are other people's recordings with no licence for redistribution (the Edge 810 + Vector one is DC Rainmaker's 2013 Garmin Vector review ride), so they are **not committed**; the golden tests read them from `RIDE_FIT_DIR`. The devices wrote their own session figures, which are the references:

| File | Device values | JoyoFit |
| --- | --- | --- |
| Garmin Edge 810 + Vector pedals, 41.3 km, 78 min, FTP 315 | avg 276 W, NP 301 W, IF 0.956, TSS 118.7, work 1296 kJ, ascent 514 m | avg 275 W, **NP 301 W**, IF 0.96, **TSS 119**, work 1295 kJ, ascent **514 m (device; computed 422 m, -18 %)**, two 3 km climbs category 4, pedal balance 50.2 % left |
| Wahoo ELEMNT, 78.9 km, timer 13471 s of 23595 s, FTP 220 | NP 157 W, TSS 190, ascent 185 m | timer 13471 s, NP 153 W (-2.4 %), TSS 182 (-4.2 %), ascent **185 m (device; computed 187 m, +1 %)**, moving 12779 s |
| Garmin Edge 500, 92.6 km, timer 10641 s of 12691 s | ascent 541 m | timer 10641 s, avg speed 31.3 km/h, ascent **541 m (device; computed 421 m, -22 %)** |
| COROS Pace 2, 32.1 km mountain ride | ascent 938 m, descent 1231 m | ascent **938 m (device; computed 971 m, +3.5 %)**, 6 climbs (category 3 and 4) |

GoldenCheetah's sample data was not used: its repository has no FIT files with reference outputs that I could find with a license that allows keeping them. So agreement with GoldenCheetah's own numbers is **not** verified; agreement with the devices' own NP/IF/TSS is.

## 4. What is not verified

- **Strava parity for rides.** Strava's moving time and elevation for a ride use a speed threshold and an elevation basemap that Strava does not publish. The 1.0 m/s stop threshold and the 15 s / 2.5 m elevation pair are chosen against bike-computer files, not against Strava rides. An imported file shows the device's ascent. The computed ascent (phone GPS recordings) reads about 20 % below the Edge files' (those barometers count every ripple) and within 4 % of the ELEMNT and COROS ones. A set of the owner's rides with Strava's numbers is what would settle it (the walk method was fitted that way).
- **Strava accepting `VirtualRide` without `trainer`, and `EBikeRide`**, was not uploaded to a live account.
- **A Huawei watch ride with sensors** (speed, cadence, power from a bike sensor paired to the watch): the protocol carries the channels but no recorded ride with them was available; the path is the same points table as the phone's, tested through synthetic and imported data only.
- **A phone recording with a pedal-balance power meter** (needs a device; the Bluetooth module is unverified on hardware, docs/sensors.md section 7). After a crash restore the balance of the seconds before the crash is lost (only the samples are journalled); the figure then covers the rest.
- **The TSS to TRIMP factor 2.4** is a calibration, not measured on anyone's data.
- **GoldenCheetah reference outputs** (see above).
- **Competitor cells** of the audit table (see above).
- **Climb detection** has no reference to compare with beyond the synthetic profiles and the category scores of the four files; Garmin's own detection is unpublished.
- Screenshots come from a web render of the real components (see the commit that adds `docs/screenshots/cycling-ride-detail.png`), not from a phone.
