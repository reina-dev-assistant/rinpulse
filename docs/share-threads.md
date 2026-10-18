# Share to Threads

A carousel of 1080 x 1350 images, one per topic (summary, splits, charts, zones, power, climbs, exercises, four weeks), each
carrying the JoyoFit logo and `fit.joyorogo.com`, plus an editable caption. For people who post "pace-ku segini, gimana?" and want
others to judge from the full data. It is a new template kind (`threads`) of the sticker engine (`docs/sticker-studio.md`), not a
new renderer.

**Native or not: no native code.** Everything is JavaScript on `react-native-share`, `react-native-view-shot`, `expo-media-library`
and `expo-clipboard`, all already linked. It ships over the air. One optional native change is flagged under "Flags".

## 1. Research

Verified 2026-10-18.

### Image specs

| Item | Value | Source |
|---|---|---|
| Image formats | JPEG and PNG | Meta, [Threads Posts, Image Specifications](https://developers.facebook.com/documentation/threads/posts) |
| File size | 8 MB maximum per image | same |
| Aspect ratio limit | 10:1 (anything up to it is accepted) | same |
| Width | 320 minimum (scaled up), 1440 maximum (scaled down); height follows the ratio | same |
| Color space | sRGB (others are converted) | same |
| Images per carousel | 2 minimum, **20 maximum**, images and videos mixed | same, "Carousel Posts"; [@threads](https://www.threads.com/@threads/post/DNinzYKgJzv) "You can post up to 20 photos in a carousel here" |
| Text | 500 characters | Meta, Threads Posts (text limit), [Ignis summary](https://ignisapp.co/blog/threads-for-brands-limits-formats-and-scheduling) |
| Recommended size | **1080 x 1350, 4:5 portrait**; every slide should match the first | [PostSize](https://postsize.org/threads/carousel-size), [Moda](https://moda.app/resources/sizes/threads-carousel), [PostFast](https://postfa.st/sizes/threads/posts) |

Decisions:

- **4:5, 1080 x 1350.** Meta's page sets only limits (10:1, width 1440), not a feed crop; the practical sources agree on 4:5, which is
  also the tallest ratio of the Instagram feed that Threads shares its image system with. 1:1 (1080 x 1080) is the only alternative
  they name, and only when every slide is square; none of them recommends 3:4. 4:5 gives a table of 12 rows or three stacked
  charts room that a square does not, and 1080 is under the 1440 maximum, so Threads never rescales the images.
- **All slides share one size**, because Threads crops every slide to the ratio of the first (PostSize, Moda).
- **Up to 20, 10 by default.** Meta and @threads say 20. Several third-party guides still say 10, so the sheet starts with the first
  ten slides on (`THREADS_DEFAULT_SLIDES`) and lets the person turn on up to 20 (`THREADS_MAX_SLIDES`).
- **PNG.** A slide is flat color and text; the golden renders weigh 80 to 230 KB, far under 8 MB.

### Handing several images to Threads

| Platform | What works | Evidence |
|---|---|---|
| Android | `ACTION_SEND_MULTIPLE` with `image/png` URIs and `EXTRA_TEXT`. Threads (`com.instagram.barcelona`) handles it in `BarcelonaShareHandlerActivity`: filters `SEND` `text/plain` and `SEND` + `SEND_MULTIPLE` for `image/*` and `video/*`. | `dumpsys package com.instagram.barcelona` on the owner's phone, Threads 451.0.0.51.80 (Android 16) |
| iOS | `UIActivityViewController` with several image files (`Share.open({ urls })`). Whether Threads' share extension accepts more than one image is not documented by Meta and was not testable here (no iPhone). The save route below is the guaranteed path. | Meta documents no image share for iOS |
| Both, text only | `https://www.threads.com/intent/post?text=...` (also `url`, `tag`); opens the app when installed. No images. (`threads.net` redirects to `threads.com`.) | Meta, [Web Intents](https://developers.facebook.com/documentation/threads/threads-web-intents) |
| Both, programmatic | The Threads API publishes carousels, but needs the person's OAuth token and app review; JoyoFit does not use it. | Meta, Threads Posts |

What the app already had: `react-native-share` 12.3.1 (`Share.open({ urls, type, message })` builds `ACTION_SEND_MULTIPLE` with
`EXTRA_STREAM` and `EXTRA_TEXT` on Android, read in `node_modules/react-native-share/android/.../ShareIntent.java`; a share sheet with
all files on iOS), `expo-media-library`, `expo-clipboard`. `expo-sharing` is single-file and is not used. `react-native-share` has no
`Social.Threads`, so Android shows the system chooser instead of opening Threads directly: one extra tap. A direct target would need a
small native module (an intent with `setPackage('com.instagram.barcelona')` and a list of FileProvider URIs); it is not built.

### How sharing works in the app

`ThreadsSheet` (opened from the "Threads" button next to Instagram in the share sheet of a run, ride, walk or strength workout):

1. **Bagikan ke Threads**: each enabled slide is drawn at 1080 x 1350 and captured to a PNG (`captureToFile`, the same proven path as
   the stickers), the caption goes to the clipboard, then `Share.open` sends all PNGs and the caption. Android: pick Threads in the
   chooser; the composer opens with all images. Text prefill from `EXTRA_TEXT` together with images is not documented by Threads and
   was not verified on the device, which is why the caption is also on the clipboard.
2. **Simpan semua dan buka Threads** (works on both platforms and when the share sheet does not take several images): every PNG is
   saved to the photo library (pre-permission dialog first, add-only on iOS), the caption is copied, and the composer opens with the
   text through the web intent. The person taps the photo button and selects the saved images.
3. **Salin teks**: the caption only.

## 2. The carousel

Seventeen slide templates, `threads.<slide>.portrait` (`templates/threads.ts`), all 1080 x 1350, one design: header (sport glyph, slide
title, date, `n/total`), body, rule, footer (lockup + link). A slide is offered only when the data exists (`requires`), so a sparse
workout gets a short carousel. The person can switch slides on and off and reorder them; the counter (`n/total`) is each slide's place
among the slides that go out, written at render time by `slideSetData`, so it follows every toggle and reorder (tested).

| Slide | For | Content |
|---|---|---|
| `summary` | run, walk, ride | route (privacy trim), distance, time, pace or speed, elevation, heart rate average and max, calories, cadence, power, steps, recording device |
| `splits`, `splits2`, `splits3` | run, walk, ride | table: km, elapsed time, pace (or km/h), heart rate, cadence, power, climb; per km, per 5 km for rides; 12 rows per slide; a long workout (more than 36 rows) merges neighbouring rows; the best row is amber; a recap row of totals |
| `charts` | with series | pace or speed, heart rate, elevation, each with min / average / max |
| `sensors` | with sensors | cadence, power (average, max); the charts use a 30 s rolling mean (cadence on a pinned axis), average and max come from the raw data |
| `zones` | with HR zones or load | HR zones with share and time, strain, training effect (aerobic, anaerobic), recovery hours, load ratio with 7-day and weekly average, TRIMP, VO2max |
| `power`, `powerzones` | ride with power | average power, NP, IF, TSS, VI, work, W/kg, max, power curve (5 s, 1, 5, 20, 60 min); the seven Coggan zones, FTP, pedal balance |
| `climbs` | ride | up to five climbs: category, length, gain, grade, time, VAM, power, heart rate, plus the elevation profile |
| `lift` | strength | volume, time, sets, reps, exercises, RPE, calories, PR count |
| `lifts`, `lifts2`, `lifts3` | strength | exercises with sets x reps x weight, volume, PR marks; 6 per slide, "+n more" past 18 |
| `muscle` | strength | muscle load by group (set counts, heat colors), new records |
| `context`, `contextlift` | when 2+ sessions in 28 days | four 7-day windows ending at the workout of the same sport: distance or minutes (lift: volume), sessions, totals and weekly averages |

Data: `data/threads.ts` (`buildThreadsRun`, `buildThreadsStrength`, `weeklyContext`, `slideData`). Slide list, order, choices and the
10 / 20 rules: `threads/slides.ts`. Caption: `threads/caption.ts`. Namespaces and paths are documented at the top of
`data/threads.ts`.

### Caption

`buildCaption(subject, { locale, question, hashtag, slideCount })`: headline (`Lari 10,40 km · 1:01:02 · pace 5:52/km`), stats line
(heart rate, climb, cadence, power, calories), the recording device, the four-week line, "Data lengkapnya ada di 6 gambar, geser ya.",
the optional question (`Minta saran: pace-ku segini, gimana?`; nine templates by sport, `questionsFor`) and the optional `#JoyoFit`.
It is capped at 500 characters: the pointer, the four-week line, the device and the stats line are dropped in that order, the headline
and the question last. The sheet shows it in an editable field with a counter; an edit is kept until the question, the tag or the slide
count changes. Indonesian and English (`stickers:threads.caption.*`).

### Branding

The footer lockup and `fit.joyorogo.com` are `attribution` layers: the Pro watermark switch (`role: watermark`) does not remove them.
**The Threads set is always branded, also for Pro accounts**, by decision of the owner for this format. A test renders every slide
with `watermark: false` and asserts the lockup and the link are there.

### Privacy

- The route is trimmed 200 m at both ends by default (the same "Sembunyikan awal dan akhir rute" switch as the stickers); a route
  shorter than 450 m is left out, since nothing would remain after the trim. "Tampilkan rute" drops the route altogether. No map
  tiles are drawn, so there are no street names or coordinates on a slide.
- No name unless the person opts in ("Tampilkan namamu": first name from the signed-in account, shown in the header; the engine binds
  `user.name` only when `options.showName` is on).
- No body weight (the template test fails if a template binds one); W/kg appears only on rides, from the profile weight, as a ratio.
- The recording device is the watch model (`productModel`), never the name the person gave it.

## 3. Tests and files

- `bun test ./src/features/stickers`: `threads/threads.test.ts` (context windows, split pages and merging, strength rows, choices
  (10 / 20, order, reconcile), caption in id and en, 500 characters, questions), `testing/threadsGolden.test.ts` (each fixture offers
  exactly the slides it has data for; every slide renders in id and en, dark and light, inside the canvas, at least 22 px, no leaked
  i18n key, branded with the watermark off, numbered; privacy; a golden PNG and Scene hash per fixture slide in
  `testing/__goldens__/threads/`), the generic template tests (every template parses, lint, text inside, contrast), and
  `share/shareThreadsUrl.test.ts`.
- Fixtures (`testing/threadsFixtures.ts`) run synthetic workouts through the real `analyzeWorkout`, `analyzeRide` and builders:
  a 10.4 km run, a hilly 48 km ride with power, a push day, a 30 km run (three split pages), a twenty-exercise session (three exercise
  pages), a sparse walk and a sparse bodyweight session. A 43 km run (`RUN_MARATHON`) covers the merging.
- Contact sheets: `TMPDIR=... bun scripts/stickers-sheet.ts --only threads [--mode dark|light] [--locale id|en] [--out DIR]`; one sheet
  per workout with its slides in carousel order. Latest: `/run/media/dzul/ioswork/stickers/threads/`.

## Flags

- **Threads installed check (optional native):** `app.json` lists only `com.instagram.android` (Android `<queries>`) and `instagram`
  (iOS `LSApplicationQueriesSchemes`) for react-native-share. On Android 11+ `isPackageInstalled('com.instagram.barcelona')` therefore
  cannot see Threads, and on iOS `canOpenURL('threads://')` is always false, so the sheet does not hide anything when Threads is
  missing (it only reorders which button is primary). Adding `com.instagram.barcelona` and `threads` there is a manifest change and
  needs a store build; not done.
- **Direct Android target (optional native):** see above, a small module would skip the chooser. Not built.
- **Not verified on a device:** Threads filling the composer text from `EXTRA_TEXT` when images are attached, and the iOS share
  extension taking several images. Both are covered by the clipboard copy and the save-and-open route.
