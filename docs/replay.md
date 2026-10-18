# Workout replay

An animated replay of a workout with a GPS route, in the style of Huawei Health's replay, Strava Flyover and Relive: a dark map
with faint roads, a camera that follows the rider with a slight tilt, the route drawing itself in the sport's colour, km marks,
pins for the highest heart rate, top speed, highest point, records and the biggest climb, a counting distance with the sport
icon, an elevation and heart-rate strip with a progress cursor, and a final summary card (distance, elevation gain, time).
Open it from a workout's detail: **Putar ulang** / **Replay**. It plays in the app and exports to a 1080 x 1920, 30 fps MP4 for
Reels, Stories, TikTok and WhatsApp.

Code: `src/features/replay/`, native encoder: `modules/replay-encoder/`, preview tool: `scripts/replay-preview.ts`.

## How a frame is made

```
WorkoutAnalysis ──trackFromAnalysis──> ReplayTrack      aligned per-sample arrays, GPS gaps filled (track.ts)
ReplayTrack ──buildRoutePath(trim)───> RoutePath         Mercator path, privacy trim, Chaikin smoothing (route.ts)
RoutePath ──planReplay───────────────> ReplayPlan        timeline, camera, tiles, pins, km marks, chart (plan.ts)
ReplayPlan + second ──frameAt────────> FrameState        camera, counters, pins, alphas: pure numbers (frame.ts)
FrameState ──createSceneBuilder──────> ReplayScene       sticker-engine nodes on a 1080 x 1920 canvas (build.ts)
ReplayScene ──ReplayPainter | replayToSvg──> pixels      react-native-svg in the app, SVG string in tests (ui/, emitSvg.ts)
```

`frameAt(plan, t)` has no memory: the player, the exporter and the tests get the same frame for the same time, frames can be
rendered out of order, and the camera has no per-frame state to drift.

- **Data.** Everything comes from the `WorkoutAnalysis` of the detail screen (the 720-sample grid with `track`, `dist`, `hr`,
  `pace`, `alt`, `power`, the best efforts, the stats), so a replay agrees with the detail view, the stickers and the post. A
  ride also passes its climbs (`RideAnalysis.climbs`). A workout without a GPS track (indoor, manual) has no Replay button.
- **Timeline** (`timing.ts`). 15 s for a workout of 10 minutes or less, 45 s from 4 hours, on a log scale in between: intro
  1.2 s (the camera settles on the start), run (the route draws, eased in and out over 7 % at each end), outro 4.5 s (zoom out
  to the whole route, then the summary card). The speed control (0.5x, 1x, 2x) only changes how fast the timeline is walked.
- **Camera** (`camera.ts`). The centre is the rider averaged over a window (corners are rounded), nudged towards the point
  ahead, and filtered over neighbouring keys: it anticipates a corner instead of chasing it. The follow zoom is chosen so the
  screen shows about 14 % of the route (0.9 to 9 km wide); the outro zooms out to a flat overview of the whole route.
- **2.5D.** The tilt is an oblique squash of the map plane (vertical axis x 0.72 while following, 1 at the end), with a terrain
  silhouette on the horizon that scrolls with the route. It is not a perspective projection: react-native-svg has none, and a
  squash gives the same picture in the app, in the view-shot capture and in the headless render.
- **Pins** (`callouts.ts`). Highest heart rate, top speed (best pace on a run, none on a walk), highest point (only with 25 m
  of relief), a personal record (rank 1 of the analysis, pinned where the effort ends) and the biggest climb (50 m or more).
  Only inside the drawn part of the route, never within 4 % of either end, never within 5 % of each other (the higher
  priority stays: record, highest point, speed or heart rate, climb), at most four. A pin pops when the rider arrives, its
  chip with the value stays 2.4 s, and the pin itself stays for the overview.
- **Counters.** Distance and clock run 0 to the workout's totals across the drawn path, so the privacy trim does not show as a
  jump; km marks sit where the counter crosses 1, 2, 5, 10, 20, 25, 50 or 100 km steps (at most five).
- **Look.** The sticker engine's own tokens (`INK` for light, `VOLT` for dark), fonts and text metrics (`FIT_FONTS`, measured
  from the real font tables, so Node and a phone place text identically), icon paths and number formats (`core/format`), one
  sport colour per type (ride orange, run coral, walk cyan, other amber). Dark is the default; it follows the phone's scheme
  until the person picks one.

## Map

The replay does not use the native MapLibre view: the export captures frames offscreen with view-shot, and a GL surface is
not capturable. It uses the app's own JS tile pipeline (`src/features/map`: OpenMapTiles vector tiles decoded to SVG paths,
the palette of the in-app map). That is the same data and schema as the MapLibre style of the bike computer, and the same
palette, so no second map stack exists.

- **Levels of detail** (`basemap.ts`). The camera goes from street level to the whole route, which no single tile zoom serves.
  The plan holds two to four zoom levels (at most three zoom steps apart); the finest fades in over the coarser one as the
  camera approaches it. Tiles are planned only where the camera goes (a corridor), at most 150 per replay: a long ride is
  followed from higher up (the follow zoom drops by half steps until the tiles fit).
- **Cheap frames.** Tile groups are built once and reused by identity; the painter skips an unchanged node. Only the map root
  group (one matrix: scale, squash, translate) and the HUD change every frame. Coordinates are local pixels around the route
  (float32-safe at zoom 16).
- **Loading.** Coarse levels first, then the finest in the order the camera needs them, six at a time with a timeout. The
  player starts when they are in; a tile that fails stays blank. If every tile fails (offline) the replay draws the route on the
  plain card with the terrain silhouette and says so.
- **Offline regions.** `createBytesTileSource(getBytes)` (tiles.ts) turns any `z/x/y -> raw MVT bytes` function into a tile
  source, and `firstOf(a, b)` tries sources in order. The bike computer's PMTiles reader (`createPmtilesReader().getTile`)
  returns exactly those bytes: pass `firstOf(createBytesTileSource(regionTile), tileSource)` to `loadBasemap` to use a
  downloaded region when the route is inside one and the network otherwise. The player currently passes `tileSource` (online).
  The wiring waits for the bike computer branch to merge.

## Privacy

Same setting as the stickers (`stickers:ui.routePrivacy`): on by default, 200 m cut from both ends of the route (the path,
the pins, the chart and the tiles all start inside the trim; the counters are scaled so the cut is not visible). A route
shorter than 2 x 200 m + 50 m cannot be replayed with the trim on: the screen says so and offers the switch. No name unless the
person turns on "Tampilkan namaku" (first name of the JoyoRogo account, only when signed in). The JoyoFit mark and link are on
unless a Pro person switches them off, like the stickers.

## Export to MP4

`src/features/replay/exportVideo.ts` + `scheduler.ts` + `modules/replay-encoder/`.

- **Frames.** The screen's preview *is* the capture target: the scene is laid out at 1080 / PixelRatio dp (the stickers' trick),
  scaled down to fit, and `captureRef` reads it at exactly 1080 x 1920 whatever the phone. Android asks view-shot for its `raw`
  format (RGBA straight to the encoder, no PNG round trip); iOS has no raw format and gets a 0.95 JPEG.
- **Encoder.** Android: MediaCodec H.264 with byte-buffer input and explicit presentation times, MediaMuxer. iOS:
  AVAssetWriter with a pixel-buffer adaptor. No ffmpeg-kit (retired). The JS API: `getSupport`, `begin`, `appendFrame(id, uri, index)`,
  `finish`, `cancel` (`modules/replay-encoder/src/ReplayEncoder.types.ts`). `appendFrame` resolves when the encoder has taken
  the frame, which is the back-pressure.
- **Schedule.** 30 fps; frame `i` shows timeline second `min(total, i x speed / 30)` computed from the integer index, so there
  is no drift; the last frame (the summary card) is held for one second and captured once. Rendering frame `i + 1` overlaps with
  the encoder taking frame `i`, never more: at most two frame files exist at a time, so a 45 s video costs the same memory as a
  15 s one.
- **Progress and cancel.** A progress bar and Cancel while it runs (the screen stays awake). Cancel, or any failure, cancels the
  encoder (which deletes its partial file) and discards the frame files.
- **Share.** Save (iOS asks the "Lanjut" pre-prompt before the system Photos dialog; Android 11 and newer needs no permission),
  Instagram (Story composer with the video as background when the Facebook App ID is set, else the Instagram share target) and
  the system share sheet. The MP4 lives in the cache and is deleted when the sheet closes or the next export starts.
- **Hook for music.** `encodeReplay` takes everything it needs from its options; a soundtrack would be a second input of the
  encoder session (`begin({ audioUri })`) and is not built. The video has no audio track.

## Preview tool

```
bun scripts/replay-preview.ts --fit FILE [--out DIR] [--frames 5] [--mp4] [--fps 30] [--width 540]
                              [--mode dark|light] [--locale id|en] [--trim 200] [--offline] [--speed 1]
```

Runs a FIT file through the app's own analysis, planner, camera, tile pipeline (OpenFreeMap, cached on disk) and scene builder,
rasterises each frame with sharp (the sticker goldens' Node script) and, with `--mp4`, encodes with the system `ffmpeg`. ffmpeg
is for previews only; the app never uses it. Default output: `/run/media/dzul/ioswork/replay/out`.

## Tests

`bun test ./src/features/replay`: timing and duration mapping, the privacy trim, camera path sampling (rider on screen, smooth
at every frame and at the phase borders, overview contains the route), callout selection, plan, frame state, basemap plan and
loading, scene builder (text, locales, themes, options, reuse of tile nodes), the frame scheduler (order, tail hold, two files
at a time, cancel, failures). The encoder's pure parts have JVM tests (`modules/replay-encoder/android/src/test`) and a SwiftPM
package (`modules/replay-encoder/ios/EncoderLogicTests`), both run by CI.

## Known limits

- The 2.5D look is an oblique squash with a horizon, not a true perspective camera.
- The map is a JS render of vector tiles without labels (like the in-app map). The camera does not rotate with the heading.
- Export speed is bound by one view-shot capture per frame: expect roughly one to three minutes for a 30 s video on a mid-range
  phone (not measured on hardware yet; no device run was possible for this work). The screen must stay open while it runs.
- A route with more than 150 tiles at its follow zoom is followed from higher up (less street detail).
- The privacy trim cuts the route and the pins but a tile request for the area around the route still goes to the tile server
  (the same as the in-app map).
- No audio track; no clips from the person's camera (the reference spliced in phone footage).
- The encoder has not run on a device here (CI builds the APK): the Kotlin pure logic ran on a JVM, the rest compiled against the
  Android and Expo jars, and the Swift side is untested until CI runs it. An Android encoder that rejects 1080 x 1920 gets one
  retry at the size rounded up to a multiple of 16 (1088 x 1920: frames scaled to fill, black padding); if no encoder takes it,
  `begin` rejects and the screen says the phone cannot make MP4 videos.
- The Swift encoder cannot decode `.raw` frames (Android only); iOS captures JPEG instead.
