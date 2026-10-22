# Heart-rate zones (Settings > Zona HR)

JoyoFit lets the person choose how heart-rate zones are calculated, edit the five zone limits in bpm, and sends the result to the watch. Every
figure of the app that depends on zones reads the same settings, so the analysis, the strain and the watch's workout screen agree.

The screen is `src/features/hrzones/ui/HrZonesSettings.tsx` (route `/settings/hr-zones`, row "Zona HR" under "Target & tubuh"). The math is
`src/features/hrzones/zones.ts` (pure, tested in `zones.test.ts`), the stored setting and the watch hand-over `settings.ts`, the data suggestion
`suggest.ts`.

## What Huawei Health offers (the model JoyoFit copies)

Evidence: Huawei Health 17.0.8.300, decompiled (`com.huawei.ui.main.stories.settings.activity.heartrate.HeartRateZoneSettingActivity`,
`.fragment.BaseHeartRateZoneFragment`, `.HeartRateSectionActivity`, `com.huawei.hwcommonmodel.fitnessdatatype.HeartRateThresholdConfig`, string
resources `IDS_rate_zone_*`, `IDS_hrr_heart_rate_description`). Notes: `~/re/huawei-health`.

| Huawei Health | What it is |
| --- | --- |
| Four tabs: standing, riding, swimming strokes, other | One zone set per posture (`mPostureType` 1 to 4). The maximum is lowered by 0, 6, 10 and 5 bpm for posture 1 to 4 (`getPostureCalibrationValue`). |
| Calculation method (`mClassifyMethod`) | `0` maximum heart rate percentage, `1` heart rate reserve (HRR) percentage. `HeartRateThresholdConfig` also works out a lactate-threshold set (LTHR: 85 % of the reserve, then 67, 80, 89, 97, 102 % of that; GB `HUAWEI_CALCULATE_METHOD_LTHR` = 3) for the standing posture only. |
| Maximum heart rate | Picker from 100 to 220 (`HEART_RATE_LIMIT`). Default `220 - age` (`HeartRateThresholdConfig` constructor), the age from the Huawei profile. |
| Resting heart rate | 30 to `min(110, max - 15)`; default 60 (`DEFAULT_REST_HEART_RATE`). |
| Zone limits | Five sliders. Default max-HR method: 50, 60, 70, 80, 90 % of the maximum (`mFitnessThreshold`, `mWarmUpThreshold`, `mFatBurnThreshold`, `mAerobicThreshold`, `mAnaerobicThreshold`, each `Math.round`); HRR method: 59, 74, 84, 88, 95 % of `max - rest` plus rest. The lowest limit stops at 30 %. |
| Heart-rate limit alert | A switch (`mIsWarningEnable`, off by default in Huawei Health) and a limit from 100 to 220 (default `220 - age`). |
| Zone names | Max-HR method: warm-up, fat burning, aerobic, anaerobic and a top zone (`IDS_rate_zone_warmup_threshold`, `..._fatburn_threshold_string`, `..._aerobic_threshold`, `..._anaerobic_threshold`, `..._maximum_threshold`). HRR method: aerobic base, aerobic advance, lactic acid, anaerobic base, anaerobic advance (`IDS_rate_zone_hrr_*`; English strings in `resources.arsc`: Basic aerobic, Advanced aerobic, Lactic acid, Basic anaerobic, Advanced anaerobic). |

**What the decompile does not show, and a tester's report fills in.** `HeartRateSectionActivity` has five sliders for either method and the HRR names start at *aerobic base* (59 %): the settings screen has no warm-up row for the reserve method, and `getHrrThresholdString` holds `base|advance|lactic|anaerobic base|anaerobic advance|max`. A runner with a Watch Fit 4 Pro (Salim, 2026-10) reports that, in reserve mode, the watch and Huawei Health's workout views number the zones with a **warm-up first**: Z1 warm-up at 50 to 59 % of the reserve, Z2 aerobic base (59 to 74), Z3 aerobic advance (74 to 84), Z4 lactic acid (84 to 88), Z5 anaerobic base (88 to 95), Z6 anaerobic advance (95 up). That is a report, not something found in the code; the string `Warm-up zone` exists in the resources, and the five limits and their percentages agree with the report. JoyoFit follows it.

## What JoyoFit does

| | |
| --- | --- |
| Methods | `max` (default), `hrr` and `lthr`. |
| Zones | `max`: five zones (warm-up, fat burning, aerobic, anaerobic, extreme). `hrr`: **six** zones, Huawei's names: Pemanasan / Warm-up from 50 % of the reserve plus rest up to the first limit (fixed start, pulled down only if a hand-edited first limit falls under it), then Aerobik dasar, Aerobik lanjutan, Asam laktat, Anaerobik dasar, Anaerobik lanjutan. `HrZones.limits` stays Huawei's five limits (what the steppers edit and what the watch gets); `HrZones.bounds` is the lowest bpm of every zone (five or six) and is what every consumer counts with. |
| Maximum heart rate | Default `220 - age` from the profile's birth year (35 years without one), as before. One tap on "Tanaka" fills `208 - 0.7 x age`. Plain rows with the value and a chevron (the maximum, the resting rate, the LTHR, the alert limit); a tap opens the stepper and the formula chips right under the row, one row open at a time. Editable from 100 to 219 (the watch protocol, like Gadgetbridge, takes values below 220). |
| Resting heart rate | Default 60 (Huawei Health's), 30 to `min(110, max - 15)`; only the HRR method uses it. |
| Zone limits | The zone table is Huawei Health's own layout: the highest zone on top, the boundaries *between* the zones as two boxes side by side (bpm and percent, the percent of the method's own base: max HR, reserve above rest, or LTHR), joined to the zones above and below by a bracket, so each boundary is one pair of boxes and is typed where it is read (a number pad, applied on done or blur; a percent is turned into the lowest whole bpm at or above it). Each limit is kept at least 1 bpm above the zone before it, at least 30, and below the maximum. The maximum (`≥`) on top and the reserve method's warm-up start at the bottom are fixed. Above the table one thin band shows where the zones sit (a segment per zone, as wide as the zone is in bpm, from 30 % of the base) with percent ticks under it (every 10 %, every 20, 25 or 50 when the labels would touch at a large font scale). Changing the method, the maximum or the resting rate derives the limits again, so hand-edited limits never outlive the numbers they were set against. "Kembalikan" returns to the method's limits. The layout maths (boundaries, band, ticks, row sizes) is `src/features/hrzones/layout.ts`, tested in `layout.test.ts`. |
| Limit alert | Switch and limit, shown only when a watch is in use. On by default with the limit at the maximum, which is what JoyoFit sent before this screen existed (Gadgetbridge's defaults). |
| "Hitung dari data" | A suggestion, never applied by itself. Maximum: the highest workout maximum, only when it is above the age formula (a lower one proves nothing: the person may never have gone all out), and a value more than 10 bpm above the next highest is taken for a sensor spike. Resting: the median of the watch's resting heart rate of the last 14 days. |
| Save | "Simpan" applies the draft: stored, told to the account, handed to the watch. "Atur ulang" puts the draft back to the defaults (still needs "Simpan"). |

A limit is the lowest whole bpm at or above the exact value (`ceil`). That is the rule every figure used before the setting existed, so people who
change nothing see no number move; Huawei Health rounds to the nearest bpm instead, so its own defaults can be one bpm lower. The watch gets
JoyoFit's limits as they are, so app and watch agree.

### Where the zones are used

`userHrZones()` / `useHrZones()` (`settings.ts`) return the zones in force; there is no other source of a maximum heart rate.

- Workout analysis (zone time, strain, effort, load, fat and carbohydrate split by zone) and its upload; `analyzeWorkout` takes `zones`.
- Daily strain, Today, Readiness, Trends, Kebugaran (fitness load, energy), the heart-rate day screen (SQL day load takes `zones.limits`), the sleep need.
- Coach: the bpm range of a planned run's zone and the post-workout feedback.
- Live workout screens (zone label and colour), the strength logger's strap chip, the recorder's live view, the bike computer's zone field.
- Cycling: the heart-rate load of a ride without power (`ride_metrics` is emptied on save, so it is worked out again).

**Weights and thresholds that depend on the zone number.** Strain is Edwards' TRIMP, zone number times minutes, so with the reserve method the aerobic base counts 2 (it counted 1 before the warm-up zone existed), the aerobic advance 3 and so on to 6; the maximum method is unchanged. Intensity minutes (WHO 2020 / ACSM 2018, `intensityZones`): maximum method zones 2-3 (60-80 %) moderate and 4-5 vigorous, unchanged; reserve method warm-up and aerobic base (50-74 % of the reserve, about 66-81 % of the maximum for a typical resting rate) moderate and aerobic advance up (74 % of the reserve is about 80 % of the maximum) vigorous. The coach's plan zones 1 to 5 keep their number: zone 2 (easy) is the aerobic base in either method. The sticker templates draw five zones, so the sixth is added to the fifth there.

Not recalculated: workouts already uploaded to JoyoRogo keep the zones they were uploaded with; the workout screen on the phone always works out the
analysis again.

### Account

Preference `hrzones` (`registerSyncedPref` in `src/cloud/syncInventory.ts`): the settings object `{method, maxHr, restingHr, limits, warningEnabled,
warningLimit}`; all defaults is "absent" and is never uploaded. A value pulled from another phone is stored and handed to the watch.

### LTHR method and the lactate threshold test

`lthr`: Friel's running zones as shares of the lactate threshold heart rate: zones 1 to 5 start at 67 % (the start of Huawei Health's own LTHR set), 85, 90, 95 and 100 % of the LTHR; names Pemulihan, Aerobik, Tempo, Sub-ambang, Super-ambang (`src/features/hrzones/zones.ts`). The LTHR is the person's (typed, or taken from the test or the watch with a chip), or Huawei Health's estimate (rest + 85 % of the reserve) while none is set. The watch has no LTHR method over this protocol path, so the zones go as the maximum-HR set carrying the computed limits (`watchConfig`); JS only.

Where the number comes from, never from a personal best (`src/features/lactate/`):

- **Time trial** (`trial.ts`, `ui/LactateTestScreen.tsx`, route `/lactate-test`, entry on Kebugaran): 15 min easy, 30 min alone as hard as can be held evenly, 10 min easy. LTHR = time-weighted mean heart rate of the last 20 minutes of the 30 (the first 10 are left out), threshold pace = distance over the same 20 minutes (speed column, else GPS fixes). The guide (`guide.ts`, `guideStore.ts`) is wall-clock based and schedules three local notifications (effort start, 10 minutes in, effort end); it does not record, the watch or JoyoFit's recorder does, and its effort start is where the analysis looks first, otherwise the hardest 30 minutes of the run (`findEffortStart`), movable by minutes. Checks: blocking when the run ends before the 30 minutes or heart rate covers under 90 % of the measured 20; warnings when the heart rate drifts more than 5 % between the halves, the minute speeds vary more than 12 %, the average is under 78 % of the maximum (too easy) or above it (maximum too low). The result is kept in the kv store (`joyofit.lactateTest`, local to the phone, not synced) and can be applied to the zones in one tap.
- **The watch's own value**: Huawei Health's workout totals carry the extension ids 300010035 `lthrHr` and 300010036 `lthrPace` (`DicDataTypeUtil.NonDictDataTransUtil`). The native part keeps them in the record's `additional` values (separate native commit, needs a store build); `watchLactate` takes the newest workout that has a plausible one. The unit of `lthrPace` is unverified: it is kept only when it is a plausible seconds-per-km figure. **No capture of a watch sending these exists in the notes**; whether a Watch Fit 4 Pro sends them is unknown until a log shows it.
- Kebugaran shows the newer of the two (and the other one beside it).

Not built: a stepped (progressive) test. The time trial needs no lab protocol and one run; a ramp test needs live control of pace and a lactate or ventilatory marker JoyoFit does not have.

## The watch

Native module `huawei-wear`: `setHeartRateZones(config | null)` and `getHeartRateZonesStatus()` (`HuaweiWear.types.ts`). JS sends the zones **as
computed** (`watchConfig()`): method, maximum, resting, the five lowest bpm, alert switch and limit. Needs a store build; an older binary lacks the
function (`hasNative('setHeartRateZones')`) and the app keeps working, the zones then only feed the phone's figures.

Sent: on "Simpan" with a watch connected, at every connect (the stored configuration), after a profile save (the age may have changed), and once at
launch when zones are set. Never changed by the native side on its own.

Protocol (Gadgetbridge `HuaweiHeartRateZonesSpec`, `FitnessData.HeartRateZoneConfigPacket`, `HuaweiP2PTrackService.getHRZonesData`; details in
`protocol/README.md`, "Heart-rate zones"): which way a watch takes zones is decided by what it declares:

| Route | Gate | What goes out |
| --- | --- | --- |
| P2P `hw.unitedevice.track` (type-2 sub-message, TLV tags 0x02 to 0x44) | ExpandCapability `0x36` | All four postures carry the same values (no posture correction), the method byte `0` or `1`, both sets (the one not chosen gets the defaults), LTHR defaults for upright. |
| FitnessData `07/21` | SupportedCommands lists `07/21` | Warning switch and limit, the MHR array, the HRR array and the method. |
| FitnessData `07/13` | SupportedCommands lists `07/13` | Warning switch and limit and one array: JoyoFit puts the **effective** five limits and the maximum there whatever the method, since this packet has no method. |
| none | none of the above | Nothing is sent; the screen says the watch does not take zones. |

With no stored configuration everything stays as it was: Gadgetbridge's defaults for the profile age, posture corrections included.

**Watch support.** There is no device list: each watch declares the route itself, and the connect log prints it (`HR zones: ExpandCapability 0x36
(Track)=..., FitnessData 07/13=..., 07/21=...`). The Gadgetbridge code JoyoFit ports is the evidence that Huawei watches with these capabilities
take the packet. **Not confirmed on any specific watch from JoyoFit's own captures**: the default zones were already sent before this screen, but
the notes hold no log of a watch showing a user-edited zone. Treat the Watch Fit 4 Pro as expected, other models as unknown until a log with
the capability line and a look at the workout screen says otherwise.

## Limits

- One zone set for every sport (the watch's four postures all get it). Huawei Health's per-posture sets are not offered, and neither is its LTHR set (67, 80, 89, 97, 102 %): the LTHR method uses Friel's percentages.
- The warm-up zone of the reserve method is JoyoFit's reading of the tester's report: the watch payload carries only Huawei's five limits, so the warm-up is a phone-side band.
- The suggestion cannot find a true maximum: it only sees what the workouts reached.
- Cached cloud analyses (see above) and the Huawei Health app's own zones are not touched; the watch shows whichever was sent last.

## Tests

`bun test src/features/hrzones` (limits for both methods, monotonic and clamped for every allowed maximum and resting rate, the default limits against
the old percentage rule for every maximum, SQL day load against the JS day strain with custom limits, suggestions); Kotlin
`HeartRateZonesCalcTest` (`bun run test:native`); Swift `HealthSensorsTests` and `WearRuntimeTests` (`bun run test:ios-protocol`).
