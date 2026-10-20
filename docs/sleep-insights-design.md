# Sleep insights (design)

Written 2026-10-20, revised the same day after the owner's decision: **the feature lives in JoyoRogo**. Design only, no code. JoyoRogo lines the watch's night up with what it already knows about the day (caffeine, alcohol, dinner, workouts) and tells the person, in plain Indonesian or English, what seems to go with better or worse nights. JoyoFit's part is to send per-night sleep detail, with consent, and later bedroom temperature and humidity. Never medical advice.

Decided by the owner: placement in JoyoRogo; **free = general tips and progress, Pro = personal findings** (and the Pro AI reflection).

## 0. Owner decisions (final) and how the MVP differs from the sections below

The sections below are the original design; where they disagree with this list, **this list wins**. Shipped behavior is described in JoyoRogo `docs/sleep-insights.md` and, for the phone side, in `docs/sleep-insights.md` here.

1. JoyoRogo: migration `0054_sleep_insights` (`sleep_night`, `sleep_insight_pref`, `sleep_insight_cache`, plus `food_log.eaten_at`), router `sleepInsights`, wipe additions; caffeine/alcohol rules moved from `maternal.ts` to `lib/intake.ts`. `food_log.eaten_at` with a "jam makan" picker (native and web); time factors use it, else the log time when it fits the meal.
2. One server switch (`sleep_insight_pref.enabled`) editable from both apps; 90 nights; turning off deletes.
3. Free: Umum tips and progress, plus the teaser "N pola ditemukan, buka dengan Pro". Pro: personal findings.
4. Evening workouts reuse `watch_workout` with the age-based max HR (220 - age); JoyoFit sends no workout data. A late workout counts as exposure only when vigorous (average HR at 80 % of max); a lighter or HR-less late workout drops the night. No backup, no workout factor. (So `workouts_json` from section 6 does not exist.)
5. Hamil/Menyusui: no personal caffeine card and no caffeine or alcohol tip. Ramadan pauses dinner and caffeine. **Alcohol is a general tip only: there is no personal alcohol factor**, so night HRV is not an outcome in the MVP (the HRV column is still stored).
6. Free days default Saturday and Sunday, with a setting.
7. The weekly reflection may carry at most one sleep fact per week (`SLEEP_FACTOR`, Pro and consent only); only the unfavourable direction becomes a fact; the validator blocks causal and overclaiming words.
8. Notifications: later.
9. Stage-less watches are supported (duration and awake time outcomes only).
10. Room sensor: the Xiaomi LYWSD03MMC is **in scope** and shipped as the last step: JoyoFit decodes pvvx/ATC (0x181A) and BTHome v2 (0xFCD2) adverts (stock firmware is encrypted and unreadable), pairs it in Settings, captures overnight through an Android foreground service (needs a store build; iOS and old binaries scan only while the app is open), keeps raw samples on the phone and pushes only per-night aggregates (mean/min/max temperature and humidity). JoyoRogo adds the `temperature` and `humidity` factors (the person's own warmest / most humid third of nights against the rest, outcome awake minutes) and a general room tip. An air purifier (PM2.5, air quality) is later: `sleep_night.pm25_mean` is reserved as a nullable column and further nullable columns fit without a redesign.

Known simplifications against the text below: the dinner calorie tertile is not computed (dinner is the 3 h gap only); the Beranda "Tidur" tile line is not added; `alignsWithResearch`-style notes are not rendered; permutation p-values (stratified by work/free night, Benjamini-Hochberg) stand in for "the interval excludes 0".

## 1. What exists today (read from both repos)

| Need | Where | Fact that shapes the design |
| --- | --- | --- |
| Night, stages, wake, HRV, HR, workouts | JoyoFit `src/features/sleep/nights.ts` (`buildNights`), `sleep_segments`, `sleep_scores`, `hrv_readings`, `step_samples` (minute HR, SpO2), `workouts` | All raw detail is on the phone (and in JoyoFit's own cloud for Pro, a separate D1 that JoyoRogo does not read). Stage-less watches (Watch Fit 2) only give approximate sleep (`cleanSleep.ts`). Night HRV is Android-only (`nightHrv.ts`). |
| What JoyoRogo gets today | `src/cloud/rogo.ts` `pushScores` -> `fitness/upsertScores`; JoyoRogo `fitness_score`, `pickNightSleep` (commit `0ffb35a`) | **Hours per day** (night plus naps) and, for today only, resting HR and HRV. No onset, wake, stages or awake time. A server-side insight is blind without a new push. |
| Workouts in JoyoRogo | `watch_workout` (start, elapsed, avg/max HR; Pro cloud backup, documents in R2) | Time and rough intensity exist for Pro accounts who back up workouts. Not guaranteed for everyone, so the night payload carries its own (section 6). |
| Food | `food_log`: `date`, `meal` (sarapan, makan_siang, makan_malam, snack), `name`, kcal, macros, `grams?`, `createdAt` | **No caffeine, alcohol or eaten-at field.** `createdAt` is when it was *logged*; `food.add` takes no time. TKPI 2019 (`lib/tkpi2019-data.ts`) has energy, protein, fat, carbs, fiber only, so nutrient-based caffeine is impossible. |
| Caffeine / alcohol by name | `lib/maternal.ts`: `caffeineMgFor` (7 regex rules, fixed mg per serving, "rough on purpose": coffee 80, espresso 95, tea 40, energy drink 80, cola 35, matcha 70) and the `alcohol` flag regex | Feasible by name, server side, bilingual. The alcohol regex also matches `tape|tapai` (a food): the sleep module needs its own exclusion. Today wired only to Hamil / Menyusui. |
| Pro gate | `premiumUnlocked` (coach, weekly reflection `ai: "locked"`, `ReflectionLockedError`) | Reuse as is. |
| AI reflection | commit `9c71507`, `docs/weekly-recap-ai.md`: deterministic facts -> rule selection -> template text for all; Pro gets Workers AI text; validator accepts only numbers it was given; `week_reflection` cache | Sleep insights become one more fact family (section 9). No cron: text is written on first view. |
| Infra | Workers cron `*/5`; D1 migrations in `packages/db/src/migrations` (0053 is the latest on `origin/main`); `lib/privacy.ts` `deleteAllUserData`; push pipeline `notify()` (0052); `/privasi` page, native `profil/privasi.tsx` | Everything needed to add tables, a wipe, a consent screen and a notification exists. |
| Surfaces | native `app/tidur.tsx` (7-night bars, manual log), web `_auth/tidur.tsx`, Beranda "Tidur" tile, `rekap` | Insights attach to Tidur and Rekap. |

## 2. Evidence base (caps how strongly each factor may be worded)

| Factor | What the literature supports | Prior |
| --- | --- | --- |
| Caffeine | Mean plasma half-life about 5 h, range 1.5 to 9.5 h ([IOM, NBK223808](https://www.ncbi.nlm.nih.gov/books/NBK223808/)). 400 mg 6 h before bed cut measured sleep by about 1.1 to 1.2 h, unnoticed in the diary; n = 12 ([Drake 2013](https://pubmed.ncbi.nlm.nih.gov/24235903/)). | High |
| Alcohol | Shorter latency and a more consolidated first half, but more disruption in the second half, delayed first REM and lower REM share at moderate/high doses ([Ebrahim 2013](https://pubmed.ncbi.nlm.nih.gov/23347102/)). In 4,098 wearable users, same-day alcohol lowered HRV-derived recovery in the first 3 h of sleep by 9, 24, 39 points (low, moderate, high) ([Pietilä 2018](https://mental.jmir.org/2018/1/e23)). | High |
| Late / heavy dinner | Mixed. Observational: food near sleep goes with worse sleep ([Crispim 2011](https://pubmed.ncbi.nlm.nih.gov/22171206), n = 52). Crossover lab: dinner 1 h vs 5 h before bed changed no conventional stage ([Duan 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8131073/), n = 20). | Low |
| Evening exercise | Meta-analysis of 23 studies: no harm overall; latency, total sleep and efficiency may suffer after **vigorous** exercise ending 1 h or less before bed; moderators fragile ([Stutz 2019](https://pubmed.ncbi.nlm.nih.gov/30374942/)). | Low |
| Regularity, social jetlag | Day-to-day consistency of sleep timing was a stronger predictor of mortality than duration in 60,977 people (observational; the app never talks about mortality) ([Windred 2024](https://pubmed.ncbi.nlm.nih.gov/37738616/)); free-day vs work-day shift of mid-sleep is "social jetlag" ([Wittmann 2006](https://pubmed.ncbi.nlm.nih.gov/16687322/)). | Medium |
| Room temperature, humidity | Heat raises wakefulness and lowers slow-wave and REM sleep; humid heat adds load; bedding and clothing change it, so no single threshold ([Okamoto-Mizuno 2012](https://pubmed.ncbi.nlm.nih.gov/22738673)). | High, personal bands |

## 3. What the person sees (Indonesian, "kamu")

**Umum** (free; a literature tip tied to the person's own logged times; nothing statistical):
- "Kopi terakhirmu kemarin dicatat jam 16.40, sekitar 6 jam sebelum kamu biasanya tidur. Kafein rata-rata butuh sekitar 5 jam untuk berkurang separuh, tapi tiap orang beda (1,5 sampai 9,5 jam)."
- "Jam tidurmu bergeser lebih dari 1 jam antar hari minggu ini. Jam tidur yang konsisten biasanya lebih membantu daripada mengejar durasi."
- Progress, not findings: "Butuh 4 malam lagi dengan kopi sore untuk membandingkan malammu." Free accounts also see the last night's stats and the 7-night regularity.

**Milikmu** (Pro; a pattern in the person's own nights, only past the gate in section 4):
- "Di 9 malam setelah kamu minum kopi dalam 8 jam sebelum tidur, kamu tidur rata-rata 34 menit lebih pendek dibanding 17 malam tanpa kopi itu. Mungkin ada hubungannya, tapi 26 malam belum cukup untuk yakin."
- "Di 6 malam dengan minuman beralkohol di catatanmu, HRV tidurmu rata-rata 11 ms lebih rendah dan kamu lebih sering terbangun. Ini sejalan dengan riset umum."
- "Makan malam kurang dari 3 jam sebelum tidur muncul di 8 malam; detak istirahat malammu tidak berbeda jelas (selisih 1 bpm). Belum terlihat pengaruhnya di datamu."
- "Di malam dengan kamar di atas 29 C (10 malam), tidur nyenyakmu rata-rata 14 menit lebih sedikit." (later)

Each card: one sentence, "n malam vs n malam", a confidence word, "Lihat malamnya" (a dot per night, newest first), "Sumber", dismiss. Footer on every card: kebiasaan umum, bukan saran medis. A free account sees, in place of Milikmu, a locked row with the **number** of findings and the Pro upsell (no content), like `ai: "locked"` in the reflection.

## 4. When an insight may appear (anti-noise rules)

All numbers are constants in one file with unit tests, like Coach and the recap facts.

1. **Umum and descriptive cards**: at least 3 recent nights; food tips need at least one item logged in the window; regularity needs 5 of the last 7 nights; social jetlag 4 work-day and 2 free-day nights in 28 days.
2. **Milikmu (correlation)**, all of:
   - at least **14 main nights** (naps excluded) in the last 42 days, the same 14 as JoyoFit's HRV baseline;
   - per factor at least **5 exposed and 5 unexposed** nights; a factor that never varies shows progress, not a finding;
   - **unexposed means logged**: a night counts only if the 24 h before onset have 2 or more meals or 800 kcal or more logged. Incomplete nights are dropped from both groups, never counted as "no coffee";
   - **unknown time drops the night**: an item whose log time does not fit its meal (a breakfast logged at 21:00, a back-filled day, `createdAt` on another WIB day than `date`) has unknown time, and a night with an unknown-time caffeine, alcohol or dinner item is dropped from that factor;
   - effect at least **0.5 of the person's own night-to-night SD** of the outcome, and a permutation interval **stratified by work/free night** (alcohol clusters on weekends, so an unstratified test would read social jetlag as alcohol) that excludes 0: 90 % for "mungkin" (14 to 27 nights); 95 % plus the same sign in both halves of the window for "cenderung" (28 nights or more). Seeded by user and window, so a card never flickers between reads;
   - **fixed outcome per factor**, at most about 8 tests, Benjamini-Hochberg across them: caffeine -> total sleep; alcohol -> night HRV; dinner and evening workout -> awake minutes; regularity -> total sleep; temperature -> deep sleep or awake minutes. No hunting through every pair.
3. **Wording**: describe, do not explain ("di malam ... rata-rata ... dibanding ..."); never "menyebabkan", never a diagnosis, no SpO2 or apnea talk, no doses or supplements. Low-prior factors (dinner, evening workout) never rise above "mungkin". Stage outcomes only when `has_stages`; a stage-less watch gets duration, awake time, HRV and heart rate. A finding appears at the strict gate and leaves at a looser one (no flicker). At most 3 cards, one new personal finding per day.
4. **Context pauses**: Hamil / Menyusui: no personal caffeine or alcohol card (the existing flag notes stay as they are). Ramadan mode: dinner and caffeine factors pause (sahur and iftar shift every meal time). Social jetlag uses free days from a setting (default Saturday and Sunday).

Exposure definitions (initial, tunable): **caffeine** = sum of mg x 0.5^(hours before onset / 5) over the 24 h before onset, exposed at 25 mg or more (about one coffee 8 h before); **alcohol** = any alcohol item in the 8 h before onset (`tape|tapai` excluded; `brem` included); **dinner** = gap from the last makan_malam item to onset under 3 h (a project heuristic, not from a study), with its kcal as a tertile of the person's own dinners (no calorie-goal talk); **evening workout** = 20 min or more ending within 3 h of onset, vigorous when the average is 80 % of the person's max HR or more.

## 5. Data flow, consent, privacy

```
watch -> JoyoFit phone (builds one row per night) -- sleepInsights.upsertNights (opt-in) -->
JoyoRogo D1: sleep_night + food_log (+ later env columns)
   -> compute on read (Worker), memoised -> sleepInsights.get -> Tidur (native + web), Rekap facts -> AI text (Pro)
```

**What leaves the phone, only after opt-in**, per night: onset and wake (UTC ms plus the phone's UTC offset), asleep and awake seconds, awakenings, stage totals when the watch has stages, the watch's own score, night HRV and night resting HR, naps (start, end), and up to 3 workouts that ended in the 8 h before onset (start, end, average HR, share of the person's max HR, sport kind). Caffeine and alcohol are *derived* in JoyoRogo from the food log it already holds, so no new food data moves. Not sent: minute-level HR or SpO2, GPS, routes, food names to the model, anything for nights before consent. SpO2 is **not collected**: no factor uses it, and a column that nothing reads should not exist; it can be added later as a nullable column with its own consent line.

- **Opt-in, one switch, one source of truth**: `sleep_insight_pref.enabled` on the server. It can be turned on from JoyoRogo (Profil > Privasi, Tidur) or JoyoFit (Settings > JoyoRogo); JoyoFit reads `sleepInsights.status` at launch and pushes only when it is on. `upsertNights` refuses (`consent_required`) without it, so a buggy client cannot upload. The consent text names the fields above, the 90-night retention and the delete path, and is versioned (`consent_version`); a changed list needs a new yes.
- **Turning it off deletes**: `sleepInsights.setConsent({ enabled: false })` removes `sleep_night`, the cache and the dismissals at once. JoyoRogo's "Hapus semua data" (`lib/privacy.ts` `deleteAllUserData`) and account deletion (FK cascade) cover the new tables; add them to the wipe list and its test.
- **Retention**: 90 nights, trimmed on every write. Derived results are caches and are rebuilt, never the source.
- **Not shared**: not in groups (`shareFitness` / `shareFood`), the feed, family monitoring, or the MCP connector in the MVP. The AI model only ever sees a fact's numbers, never a night or a food name (section 9). Strava-imported rows stay out, as in the reflection.
- **Copy to update before release**: JoyoRogo `/privasi` (new section: what, why, retention, delete) and `profil/privasi` on native and web (the switch and a delete button); `docs/mcp-connector.md` "What is in the cloud"; JoyoFit `LEGAL.md` (the "does not collect your health data on a server of ours" line gains the exception) and the site `Privasi.tsx`; App Store privacy label and Play Data safety (sleep and heart-rate data, linked to the account, app functionality, not tracking) [Play Console treatment of user-initiated upload to confirm, INFERENCE]. Log lines on both sides carry counts only, because Atur reports upload the whole log (`docs/atur-reports.md`).

## 6. Data model and API (JoyoRogo)

Migration `0054` (next free number at merge time), Drizzle schema `packages/db/src/schema/sleep-night.ts`, copied to `migrations-deploy` by `db:generate`.

| Table | Key | Fields |
| --- | --- | --- |
| `sleep_night` | user, `wake_date` | `onset_ms`, `wake_ms`, `tz_offset_min`, `asleep_s`, `awake_s`, `awakenings`, `has_stages`, `deep_s?`, `rem_s?`, `light_s?`, `watch_score?`, `hrv_ms?`, `rhr_bpm?`, `naps_json` (at most 4 pairs), `workouts_json` (at most 3), `engine_rev`, `updated_at`. One main night per wake date (the longest session; the rest are naps). Later nullable env columns: `temp_c_mean`, `temp_c_p90`, `rh_pct_mean`, `rh_pct_p90`, `env_samples`, `env_source` |
| `sleep_insight_pref` | user | `enabled`, `consent_version`, `consented_at`, `free_days_mask`, `dismissed_json` |
| `sleep_insight_cache` | user, factor | `signature` (hash of the night rows and the food rows in the window), `result_json`, `computed_at` |

`wake_date` is the phone's local day, the key `fitness_score` already uses, so the two join by date; windows for food and workouts use absolute timestamps and never date strings. `has_stages` and the stage columns are null for a stage-less watch.

oRPC router `sleepInsights` (the existing `sleep` router stays the manual log):
- `status` -> `{ enabled, consentVersion, nights, latestWakeDate }`; open to every signed-in account.
- `setConsent({ enabled, version })` -> enabling stores consent; disabling deletes (above).
- `upsertNights({ nights: [..14] })` -> `consent_required` unless enabled; validates like `upsertScores` (onset before wake, 1 to 20 h, asleep at most in-bed, ranges for HR 25..220, HRV 1..500, wake date within 90 days and at most one day ahead); a batch repeating a date: last wins; each night is a full snapshot and replaces the row; trims anything older than 90 nights. A new procedure, not an extension of `upsertScores`: that one is open to all, keyed by day, "null keeps stored", and feeds the MCP; this one is consent-gated and snapshot-based. `upsertScores` is untouched, and `pickNightSleep` keeps reading `sleep_log` and `fitness_score` so the Beranda tile, Tidur and MCP never disagree with each other; insights read only `sleep_night`.
- `get({ locale })` -> `{ cards[], progress[], personal: "ready" | "locked" | "needs_nights" }`, text rendered server side from `packages/i18n/src/locales/{id,en}/sleepInsights.json` like `reflection.json`; `personal: "locked"` for free accounts (cards stripped to a count). `dismiss({ id })`.

**JoyoFit side**: a `useSleepNightsPush` hook modelled on `useRogoScoresPush` (debounce, "accepted payload" dedupe, 404/405 backoff for an older JoyoRogo), nights built from the same `buildNights` as the Sleep screen, the last 14 nights on each change and a 90-night backfill in 14-night calls when consent is first given; plus the switch in Settings > JoyoRogo. All JS: ships over the air (`docs/ota.md`).

## 7. Where the computation runs

**Server, on read, memoised**, no cron. A request loads at most 42 `sleep_night` rows, the 43 days of `food_log` around them (name, kcal, `createdAt`, meal) and builds exposures; the stats are a few thousand permutations over about 8 tests, which is milliseconds of CPU [INFERENCE: measure in the first spike against the Worker CPU limit]. The result is cached per factor under a signature of its inputs and recomputed only when a night or a food row in the window changed, so most reads cost two indexed selects. Why not the others: **on the phone** has no food history (JoyoRogo holds it) and JoyoRogo's own native app has no watch data; **cron `*/5`** would compute for every account whether or not anyone opens Tidur, the same reason the reflection has no Monday cron. A once-a-day precompute for opted-in Pro accounts is only worth adding to drive a notification (later). Pure functions in `packages/api/src/lib/sleep-insights/` (features, exposure, stats, factors, text) with in-memory D1 tests like `recap-reflection.test.ts`; the caffeine and alcohol rules move out of `maternal.ts` into a shared `intake-flags.ts` so Hamil mode and the insight read one table.

## 8. Where it shows

- **JoyoRogo native and web, Tidur** (`apps/native/app/tidur.tsx`, `apps/web/src/routes/_auth/tidur.tsx`): a "Wawasan tidur" section under the 7-night bars. Not enabled: one card explaining it and the switch ("butuh data malam dari jam tangan lewat JoyoFit"). Enabled: up to 3 cards, progress rows, a detail sheet (dots per night). The Beranda "Tidur" tile gains one line when a fresh finding exists.
- **Rekap**: through the reflection (section 9). **Notifications**: later, one `sleep` category in `notify()` ("Ada pola baru di tidurmu"), at most weekly, inside the existing quiet hours.
- **JoyoFit**: only the consent switch and a link to Tidur in JoyoRogo; the Sleep screen is unchanged. **Coach** (JoyoFit) is untouched.

## 9. AI weekly reflection tie-in

The reflection validator (`validateRecapText`) accepts a number only if the model was given it, in any locale format, and rejects forbidden terms, markdown, emoji and wrong language; the model gets only the selected facts (`code`, `numbers`, fixed `observation`, `advice`), never free text. The design follows that exactly:

- One new fact code `SLEEP_FACTOR` with variants `caffeine | alcohol | dinner | workout | regularity | room` in the existing **sleep** domain, role focus (or win for a better-than-usual regularity). Params are the numbers a card already shows (exposed nights, other nights, minutes or ms difference), rounded as written, plus a fixed confidence variant (`maybe` / `leaning`). It enters selection only for a Pro account with consent and at least a passing "mungkin" finding, at most one per week (the strongest that is new since last week), after the existing safety ordering, so a `RUN_INTENSITY` alert still wins.
- The template and the AI text say it the same way as the card; the observation string is fixed per `(code, variant)` in `reflection.json`, so the model cannot add an effect size or a cause.
- Validator addition for these facts: reject causal verbs ("menyebabkan", "karena kopi", "causes", "because of") and any claim beyond "mungkin / cenderung"; the existing forbidden-terms and number checks apply unchanged. `selectionSignature` includes the new fact so the text is rewritten only when the finding changes; the cache, retry and 4-runs-per-week cap are unchanged. No night, time, food name or HRV series reaches the prompt. Hamil / Menyusui and Ramadan follow section 4.
- Tests: the fixture week gains a consent-on variant; boundary tests for each variant; a validator test that a causal sentence about caffeine is refused.

## 10. Bedroom sensor (shipped last; see section 0, item 10)

The sensor is read by **JoyoFit** (the BLE module is there; JoyoRogo's native app has none). JoyoFit keeps raw 5-minute samples (`env_sample`: sensor id, ts, temp, RH, battery) on the phone and sends only per-night aggregates into the nullable `sleep_night` env columns of section 6, so room data never leaves as a series. A *factor registry* (id, per-night extractor, primary outcome, prior, copy keys) is the only thing the stats engine knows: temperature and humidity are two new registry rows, a nullable-column migration and the card copy, with no engine change. Bands are personal (hottest third of the person's own nights against the rest, from their 75th percentile), because the literature gives no universal threshold and tropical bedrooms are warm.

- **Scale**: unlikely to be a room sensor; JoyoFit's scale recorder will show what it advertises when it arrives. The model is the same either way.
- **Xiaomi LYWSD03MMC**: the practical route is the community firmware, flashed from a browser ([pvvx/ATC_MiThermometer](https://github.com/pvvx/ATC_MiThermometer)), which advertises on service UUID `0x181A` in selectable formats; decoding is TypeScript on the advertisement event the scale module already produces:

| Format | Service-data layout | Resolution |
| --- | --- | --- |
| ATC1441 | MAC (6, big-endian), temperature int16 BE, humidity u8, battery % u8, battery mV u16 BE, counter u8 | 0.1 C, 1 % |
| PVVX custom | MAC (6, little-endian), temperature int16 LE, humidity u16 LE, battery mV u16 LE, battery % u8, counter u8, flags u8 | 0.01 C, 0.01 % |
| BTHome v2 | self-describing objects | per object |

  The MAC is in the payload (useful on iOS, where the scan id is a UUID); `counter` dedupes repeats. Units sold since 2025-03 (B1.5/B1.6) are not recommended by the firmware author and firmware 2.1.1 needs Mi Home registration, so check the hardware version before buying. I could not confirm here whether stock firmware advertises readings in the clear [INFERENCE: it does not].
- **Overnight capture with the app closed is the real risk** [INFERENCE: background scanning is throttled on both platforms; needs a spike]. Options: (a) foreground scan only, (b) a foreground service like the workout recorder, (c) read the firmware's flash log in the morning (20,000 records, 10 minute step by default; needs a GATT reader, a store build). The spike picks one. Pairing reuses JoyoFit's `sensor` table with a new kind.

## 11. MVP vs later (superseded by section 0 where it differs)

**MVP**: JoyoRogo migration 0054 and the `sleepInsights` router; the stats engine and registry with caffeine, alcohol, dinner, evening workout and regularity; Tidur section on native and web; consent switch on both apps; `SLEEP_FACTOR` in the reflection; JoyoFit `useSleepNightsPush` and switch; privacy copy and wipe; id/en copy; tests next to the code. Build order: server tables and wipe, engine with fixtures, router, JoyoFit push, UI, reflection, privacy copy, then roll out to the owner's account first. **Later**: `food_log.eaten_at` and a "jam makan" picker; notifications; MCP tool `get_sleep_insights` under `recovery:read`; room sensor and its factors; naps as a factor; SpO2 and skin temperature as context only; hours-only users (Health Connect, manual log) for duration-only findings; iOS night HRV.

## 12. Open questions for the owner (answered, see section 0)

1. JoyoRogo changes: OK to add migration 0054 (three tables, a `sleepInsights` router, wipe additions) and to move the caffeine/alcohol rules out of `maternal.ts` into a shared module? Separately, should `food_log` get an optional `eaten_at` plus a "jam makan" picker in the logging UI? Without it every time-based claim rests on log time, and late-logged items drop their night from the factor.
2. Consent: one switch stored on the server and editable from either app, with 90 nights of retention and delete-on-off. Right shape, and is 90 nights acceptable (60 is possible, 42 is the minimum the gate needs)?
3. What may a free account see of Pro findings: only "2 pola ditemukan, buka dengan Pro" (my default), or nothing at all?
4. Evening workouts: JoyoFit sends start, end, average HR and the share of the person's own max HR (new copy of data that Pro accounts may already back up as `watch_workout`). Fine, or reuse `watch_workout` with an age-based max HR and accept that free or no-backup accounts get no workout factor?
5. Hamil / Menyusui (no personal caffeine or alcohol card) and Ramadan (dinner and caffeine factors paused): confirm both. Also, should alcohol cards exist at all for you, or only the Umum tip? (`tape|tapai` is excluded and `brem` included in my default.)
6. Free days default to Saturday and Sunday with a setting for shift workers: acceptable for the MVP?
7. May the weekly AI reflection mention at most one personal sleep finding a week ("mungkin" wording, causal words blocked by the validator), or should sleep stay out of the AI text at first?
8. Notifications ("Ada pola baru di tidurmu", at most weekly, through `notify()`): wanted in the MVP, later, or never?
9. Watch Fit 2 and other stage-less watches get personal findings on duration, awake time, HRV and heart rate only. Acceptable, or hide personal findings there?
10. Room sensor: willing to buy a LYWSD03MMC of a suitable hardware version and flash it, and is a store build (foreground service or GATT reader) acceptable for it? JoyoRogo only ever receives nightly aggregates.
