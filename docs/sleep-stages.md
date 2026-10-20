# Sleep stages the watch does not send

The Watch Fit 1 never sends sleep stages over Bluetooth. Every path that could carry them is
closed on the watch side, and that is a property of the watch, not of this app:

| Path | Gate | Watch Fit 1 |
|------|------|-------------|
| Dictionary sleep (`sequence_data`, dict 700013) | `ExpandCapability(143)` | capability is 3 bytes, bit 143 is out of range → off |
| Sleep frames (`type` per segment) | FitnessData `commands07` containing `0x0D` | not in the command list |
| `sleep_state.bin` | always present | says *when* you slept, never in which stage |

`TruSleep: gates:` in the in-app log shows all of it for a connected watch. Gadgetbridge reached the
same dead end and documents it for the Fit 3 in [issue 3829](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/3829):
with TruSleep on, "all sleep show up as light sleep"; the only alternatives offered there are *no sleep
data* or *only the start and end time of your sleep*. Huawei Health shows stages because it works them
out on the phone from the raw night — Huawei has never published that algorithm.

## What this app does instead

`sleep_data.bin` is the raw night the watch does send. It holds the accelerometer, sampled **every 60
seconds, 24 h a day**, two axes as activity bytes (`0x00` still … `0xff` moving). `SleepSync` already
downloaded and parsed that file; before this change it only logged the result and threw it away, exactly
like Gadgetbridge does ("not analysed yet").

`EstimatedSleepStages.kt` now feeds it to a stage estimator:

1. **`SleepStageEstimator`** — ported unchanged from Gadgetbridge at upstream `94e29b935e5e945e`
   (`app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/sleep/`, written by Manuel Marcatili as a
   port of OpenVitals, AGPL-3.0-or-later; see NOTICE). Sleep and wake come from actigraphy practice
   (Cole-Kripke weights, Webster rescoring); stages come from heart rate against its own slow baseline, its
   variability and time-of-night priors. It is pure and deterministic. Gadgetbridge runs the same estimator
   for Huami bands (`HuamiEstimatedSleepSessionProvider`) and, in PR #7102, is generalising it for every
   watch whose vendor does staging on the phone.
2. **`EstimatedSleepStages`** (this project) — the Huawei adapter: ACC seconds become the estimator's
   per-minute `SleepMinute`s, and the heart rate of the same sync (`step_samples.heart_rate`) is joined in.
   The raw axis byte has no published unit, so `ACC_PER_MOVEMENT` turns it into a movement count and
   `calibrate` then places the stream's own median on the one the estimator's constants were fitted on
   (2.23 counts, the median of its Venu SQ night) — the unit cancels out instead of being guessed.
   Three things about this watch's file had to be handled before the estimate was right (all measured,
   see below): it covers **24 h a day**, its raw unit is unknown, and it carries a reading only every
   second or third minute.
   - **The day.** A quiet minute at a desk scores exactly like a quiet minute in bed, so a whole day of
     the file is one long "night". On the device this came out as **177 h of sleep** from a 55-hour file.
     The watch's own judged-asleep ranges (`sleep_state.bin`) are therefore what bounds the estimate
     (`within`), the same way Huawei stages sleep inside them and nothing else.
   - **The density.** A minute with no reading counts as *not worn*, which is never sleep, so too sparse a
     stream cannot hold the 150 sleep minutes a night needs, and the estimate came back empty on the
     device. `fillGaps` carries a reading across gaps of up to five minutes and leaves longer ones (watch
     off the wrist) as the holes they are.
3. **Storage** — the estimate is written to `sleep_segments` under raw kind `0x5657`
   (`RAW_ESTIMATED`), which no watch ever sends, with the usual `light` / `deep` / `rem` / `awake` names.
   No schema change: `stage` already exists.

## What wins over what

Real stages always outrank the estimate, in either order:

- The estimate is never written over a window that already carries a stage
  (`EstimatedSleepStages.withEstimatedStages`), so a watch that stages sleep itself, and an imported Huawei
  export, both keep their numbers.
- The Huawei export importer deletes estimated rows for a window the export states real stages for, so an
  import arriving *after* a sync still wins.
- The watch's own judged-asleep ranges (`sleep_state.bin`) are kept alongside the estimates; they are
  stage-less, so the reader drops them where real stages sit next to them (`withoutStrayUnstaged`).

## Read this as an estimate

These are **estimates from a heuristic without ground truth**, not Huawei's numbers. The estimator's own
documentation says as much, and Gadgetbridge shipped it saying "not verified on a watch yet", with its
constants fitted on three nights of one Venu SQ. What can be expected: the shape of a night (when you fell
asleep, when you woke, roughly where deep and REM fell) — not Huawei's exact segmentation, and a
segment or two will be wrong. The Sleep screen labels an estimated night as such
(`sleep.stageEstimate`), and the app never claims the numbers are the watch's.

The best ground truth available for tuning is the Huawei Health app, which shows Huawei's own stages for
the same night. `TruSleep: stage estimate …` in the in-app log says how much the estimate had to work with
for each sync: minutes, the share of the span they cover, and how many carried a heart rate. Heart rate is
*not* what decides whether a night is found (measured: dropping it entirely still yields the same nights);
the density of the stream is, which is why it is in that line.

## How the two thresholds were measured

The `Venu SQ fixture` in the estimator's own test is a real night with a known answer, so it was replayed
through the adapter's preprocessing to pick the two numbers rather than guess them:

- **Density.** Thinning that fixture to one reading every second minute makes the estimator report no night
  at all; a zero-order hold recovers it. Replayed at 25% a hold of 3 recovers the night, and the Fit 1's own
  file measured 41% (1370 readings over 3333 minutes). The shipped hold is **5**: it covers the 41% case with
  margin and stays far below the estimator's own 45-minute break, so a stretch the watch really was off the
  wrist is never bridged into sleep.
- **Bounding.** Replaying a 24-hour stream through the adapter comes back as **24 h of claimed sleep** at
  every movement level tried, including a still one — the day is indistinguishable from a quiet night, which
  is why the watch's own ranges are required rather than optional.
- **Scale.** Multiplying the same fixture's movement by 8 also produces no night. Anchoring the stream's
  median on the fixture's median recovers the original three nights at every scale tried, from ×0.25 to
  ×16, which is why calibration is by percentile and not by a fixed divisor.

Both probes are throwaway JVM programs (`ScaleProbe`, `FillProbe`, `GapProbe`, `DayProbe`, `E2E` under
`/tmp/rincheck`), not part of the repo: they exist to justify the constants, and the live behaviour is
covered by the tests below.

## Tests

- `modules/huawei-wear/android/src/test/java/com/joyodigitama/huaweiwear/EstimatedSleepStagesTest.kt` —
  the adapter: axis summing, minute flooring, the heart-rate join, a plausible night coming out as one
  staged night, a full day bounded down to the watch's own sleep range, real stages winning.
- Gadgetbridge's own `SleepStageEstimatorTest.kt` (18 tests, including a real four-day fixture) passes
  unchanged against the ported estimator; that is the check that the port is faithful.
- `src/features/sleep/nights.test.ts` — the `estimated` flag reaching the UI, and a night with a mix of
  watch stages and estimates not being called an estimate.
