# Coach (Pro)

Written 2026-10-18. A daily suggestion, running and strength plans, an exercise library and an "Tanya coach" chat. All of it is JS (ships over the air, `docs/ota.md`), none of it is medical advice, and the daily suggestion, the plans and the feedback are **rules, not a model**: every number below is a constant in the code and is covered by `src/features/coach/coach.test.ts`.

| Part | Code |
| --- | --- |
| Synced document and storage | `doc.ts`, `store.ts` (`coach_doc`), `merge.ts`, `syncDoc.ts`, `sync.ts`; JoyoRogo `coach.getDoc` / `coach.putDoc` |
| Body signals | `signals.ts` (reads `FitnessData`: the same functions Readiness, Kebugaran and Energi Tubuh use) |
| Daily suggestion | `suggest.ts`, `format.ts`, `ui/CoachTodayCard.tsx`, `ui/SuggestionBlock.tsx` |
| Plans | `plans/run.ts`, `plans/generate.ts`, `plans/adapt.ts`, `progress.ts`, `actions.ts`, `src/app/coach/` |
| Matching to watch workouts | `match.ts`, `useCoach.ts` (runs after each sync) |
| Post-workout feedback | `feedback.ts`, `pace.ts`, `ui/CoachFeedbackSection.tsx` (workout detail) |
| Access | `useCoachAccess.ts`: JoyoRogo Pro (`watchWorkout.status.unlocked`), the last answer is kept for offline |

## Daily suggestion

Fatigue points from the signals that exist; a signal that is missing adds nothing.

| Signal | Points |
| --- | --- |
| Readiness Run down / Strained / Primed | +3 / +2 / -1 |
| "How does your body feel today?" (only while the watch gives no readiness): worn out / tired / fresh | +4 / +2 / -1 |
| HRV status low | +2 |
| Training status overreaching (acute:chronic load over 1.5) | +3 |
| Last night under 6 h / under 7 h | +2 / +1 |
| Sleep debt over 7 nights, 3 h or more / 90 min or more | +2 / +1 |
| Yesterday's strain 15 or more / 12 or more | +2 / +1 |
| Yesterday and the day before both 12 or more | +1 |
| Watch recovery time left over 24 h / over 12 h | +2 / +1 |
| Active (strain 8 or more) on each of the last 5 days | +3 |

Bands: **6 or more** exhausted, **4 to 5** tired, **2 to 3** fair, **0 to 1** fresh.

| State | Suggestion |
| --- | --- |
| Already trained today (a workout of 20 minutes or more) | "Sudah latihan hari ini" |
| Plan finished | "Rencanamu sudah selesai" |
| Exhausted | Rest |
| Today has a plan session, tired | A run: the same time at 70 % (at most 40 min) as an easy run in zone 2. Strength: active rest, 20 min |
| Today has a plan session, fair | The session at 85 % |
| Today has a plan session after a hard day (yesterday's strain 14 or more) and it is a hard run | An easy run at 70 % |
| Today has a plan session, fresh | The session as written |
| Plan session of today already done | "Sesi hari ini sudah selesai" |
| Plan rest day, a session of this week was missed, fresh, yesterday not hard | Catch up the missed session |
| Plan rest day otherwise | "Hari ini jadwal istirahat" |
| No plan, tired | Active rest: a 30 minute walk in zone 1 |
| No plan, fair or fresh | An easy run in zone 2 (30 or 40 minutes; a walk when walking, riding or strength is what you do most; a strength session of 30 or 40 minutes for strength people) |

The reasons shown are the signals that raised the total, biggest first. With no data at all the card says it is a general suggestion (a strength session for someone who lifts, an easy run otherwise).

### Without a watch

Nothing in Coach needs a watch. With no readiness (no watch, or no night of data yet) the Coach card and screen ask "How does your body feel today?" (fresh, normal, tired, worn out; `feel.ts`, `ui/FeelPicker.tsx`). The answer is kept on the phone for the calendar day (`useFeel.ts`, never synced) and counts as the watch's readiness word in the table above; the watch's own readiness always wins. The chat snapshot sends it as `readiness`. Training-load signals (strain, active streak, recovery time) stay empty without heart-rate data, so the weekly adaptation only reacts to done-against-planned counts.

## Plans

The plan document stores the person's choices (`goal`, `level`, `daysPerWeek`, `weekdays`, `startDay`, `weeks`), the weekly adaptations and what was done. **Sessions are never stored**: `generatePlan` rebuilds them, so two phones with the same document show the same plan. The first week starts on the Monday of the week the plan was made; sessions before the day it was made are greyed and never counted as missed.

Running (`plans/run.ts`, constants at the top, one recipe per goal and level):

- Goals: 5K (8 weeks), 10K (10 weeks, 12 for a beginner), half marathon (12 weeks, 14 for a beginner), regular running 3x a week (8 weeks). 3 to 5 sessions a week, 3 for regular running.
- Slots in order: easy, quality, (recovery), (easy), long; the long run is on the last chosen weekday.
- Volume grows linearly from the first week's minutes to the peak, rounded to 5 minutes. Every fourth week is a cut-back at 80 %. Race goals end with a taper week at 60 % whose last session is the distance itself.
- Beginners start with walk/run (a 5 minute brisk walk, then alternating run and walk, 1 min run / 2 min walk x 8 up to 3 x 8 min run) and move to continuous running after 6 weeks (5K, regular running 4); a beginner 10K or half starts further into the table, 4 weeks.
- Quality alternates tempo (steady, zone 3 to 4) and intervals (3 min hard in zone 4, 2 min easy jog, 3 to 8 reps) from the intermediate level; beginners and intermediate regular runners have an easy run in that slot.
- Easy and long runs: zone 2 (60 to 70 % of the maximum heart rate, the app's zones). Recovery runs: zone 1 to 2, at most 30 minutes.
- Pace targets (shown on the session and used in the feedback) are shares of your threshold pace (`analysis/zones.ts`, from your GPS runs of the last 90 days): easy and long 1.14 to 1.29, recovery 1.29 to 1.6, tempo 1.06 to 1.14, intervals 0.94 to 1.0. No threshold, no pace target: only the zone.

### Weekly adaptation

On the first look at a new week the plan decides what share of that week's volume to keep (`WeekAdjust.scalePct`). The first matching rule wins:

1. Overreaching (load ratio over 1.5): 75 %.
2. Fewer than half of last week's sessions done: 80 %.
3. Low recovery now (HRV low, readiness Run down, or Strained with 3 h or more sleep debt): 85 %.
4. Every session done and the load productive or maintaining: 10 points back toward 100 %.
5. Otherwise not lower than 90 %, not higher than 100 %.

Weeks that passed while the app was closed are decided from completion only (rules 2, 4, 5). The decision is stored in the plan, so every phone shows the same volume.

### Matching to watch workouts

After each sync (`useCoach`), a workout belongs to the open plan session that is of the same kind (a run for running sessions, a walk or a run for walk/run and recovery, a strength-type workout for strength), lasted at least 50 % of the planned minutes (60 % walk/run; a race 90 % of its distance; strength 15 minutes) and falls from one day before to two days after the session's day. Oldest workout first, the nearest free session by day. Done by hand or skipped sessions are left alone; taking a mark back keeps a tombstone (`cleared`) so the undo wins over the cloud copy and the workout is not matched again.

### Feedback on the workout detail

For a workout matched to a running session (`feedback.ts`): duration within 15 % of the plan; heart-rate zones by session type (easy and long: under 15 % above zone 2 is fine, 35 % or more is too hard; tempo: 45 % or more in zones 3 to 4, 20 % or more in zone 5 is too hard; intervals: at least 60 % of the planned hard time in zones 4 to 5; walk/run: flags 40 % or more above zone 3); average pace against the target band (more than 3 % faster or 5 % slower than the band's edges); distance for a race (95 %). The overall line picks, in order: too hard, short, long, too easy (hard sessions only), on target.

## Cloud

The document is one JSON per account in JoyoRogo (`coach_doc`, optimistic `rev`, same pattern as the gear document): `coach.getDoc` is open to every signed-in account, `coach.putDoc` needs Pro and answers `locked` otherwise (the app then keeps changes on the phone). A merge keeps the newer plan (`planUpdatedAt`; ending a plan is `plan: null` with a new time) and merges finished sessions and strength logs per key, the later mark winning. Progress of a plan that is no longer the active one is dropped. Synced from the cloud sync loop (`CloudProvider`), and after every change the person makes. Server side: the joyorogo repo, `docs/coach.md`.

## Not medical advice

The suggestion, the plans and the chat are general training guidance. Every Coach screen shows the disclaimer line (`coach:disclaimer`). The chat (phase 3) sends injury and symptom messages to the "see a professional" answer without calling the model, and is conservative in Hamil mode.

## Native / next store build

Everything above is JS. Tables (`coach_doc`) are created from JS like the gear tables; fold them into `joyofit-db-migrations.json` at the next native build.
