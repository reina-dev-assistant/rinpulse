# JoyoFit Studio

A watch-face editor for the Huawei Watch Fit 4 and Fit 4 Pro (408 × 480, screen code `HWHD13`). It runs in the browser,
renders every digit, hand, ring and icon to a bitmap, and exports two things:

- a **photo face** (`<Name>.photo.png`), the picture layers flattened to exactly 408 × 480, which JoyoFit uploads from
  **Watch → Photo face**. This is the output that works with JoyoFit;
- a **`.hwt`** package, for Huawei's own tools (Theme Studio Pro with a Huawei developer account) and for inspection. The watch
  deletes an `.hwt` Huawei did not sign, so JoyoFit's **Watch faces → Install from file** cannot make this one stay (see
  [Why the `.hwt` is not the main output](#why-the-hwt-is-not-the-main-output)).

Nothing is uploaded unless a Pro account saves a project to its cloud library (see [Cloud projects](#cloud-projects)): the Worker only
serves static files.

Live: https://app.fit.joyorogo.com/studio/ (also https://joyofit-studio.dzulfikar-at.workers.dev/studio/; every other path on
that host redirects to `/studio/`).

Stack: Vite 8, React 19, Tailwind v4, zustand, `@cloudflare/vite-plugin` (a Worker with static assets, no bindings),
and [`packages/hwt`](../packages/hwt) for the `.hwt` format. Design: JoyoRogo's tokens and components (paper canvas,
borderless white cards, big radii, Plus Jakarta Sans) with JoyoFit's ink-teal primary and per-metric data colors from
`src/theme.ts`. The copied JoyoRogo files say where they came from in a header comment (`src/ui/*`, `src/styles.css`).

## Develop

```sh
cd web
bun install
bun run dev            # http://localhost:3100/studio/
bun run typecheck
bun run test           # vitest, runs in node with @napi-rs/canvas
bunx playwright install chromium   # once
bun run test:e2e       # Playwright: builds, then `vite preview` (the real Worker) on http://localhost:4173/studio/
STUDIO_URL=https://app.fit.joyorogo.com/studio/ bun run test:e2e   # the same tests against a deployment (keep the trailing slash)
bun run build          # tsc --noEmit && vite build, output in dist/
bunx wrangler deploy --dry-run
bun run deploy         # build + wrangler deploy
```

`wrangler.jsonc` pins the Cloudflare account and the Worker name `joyofit-studio`. The Vite plugin writes
`dist/wrangler.json` and a `.wrangler/deploy/config.json` redirect, so `wrangler deploy` ships `dist/`.

### Where it is served

Studio is part of the JoyoFit web app's site: **https://app.fit.joyorogo.com/studio/**. That host is a Custom Domain of a different
Worker (`joyofit-web`, `apps/fit` in the JoyoRogo repo, an assets-only SPA). Cloudflare runs a Worker *route* before a Custom Domain
Worker on the same hostname ([docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#interaction-with-routes)),
so `wrangler.jsonc` claims only `app.fit.joyorogo.com/studio` and `app.fit.joyorogo.com/studio/*` (zone `joyorogo.com`) and the web
app keeps every other path, with its own SPA fallback. Nothing changes in the JoyoRogo repo for this to work, and `joyofit-web`'s
`dist/` does not contain Studio.

- `vite.config.ts` sets `base: "/studio/"`, so the built HTML, CSS (fonts) and chunks all reference `/studio/...`. There is no
  client router, service worker or absolute URL in `src/`; `index.html` has the canonical link.
- The built files sit at the root of the asset store, so `worker/index.ts` (`main`, with `assets.run_worker_first`) strips the
  `/studio` prefix before calling `env.ASSETS.fetch`, and the store's SPA fallback returns *Studio's* `index.html`. `/studio` gets a
  308 to `/studio/`; any path outside `/studio/` (the `workers.dev` root) gets a 302 to `/studio/`. Tested in `worker/index.test.ts`.
- The browser storage is per origin: projects saved on the old `joyofit-studio.dzulfikar-at.workers.dev` origin (localStorage,
  IndexedDB) are not visible on `app.fit.joyorogo.com`; use *Save project JSON* there and *Open project JSON* here.
- The theme switch stores its value in `vite-ui-theme`, the key JoyoFit Web uses on the same origin, so the two follow each other.
  The header shows the JoyoFit ring mark and a *Kembali ke JoyoFit Web* link (`/` on `app.fit.joyorogo.com`, the live URL elsewhere).
- Any link from the web app to Studio must be a plain `<a href="/studio/">` (full page load), not a TanStack Router `Link`, which
  would treat `/studio/` as an unknown route of the SPA.

`@joyofit/hwt` is an alias to `../packages/hwt/src/index.ts` (Vite, Vitest and `tsconfig.json`); there is no workspace
dependency and no copy of the codec.

## How it works

```
model/        Project JSON (elements bottom to top), the field registry, assets (IndexedDB), project file import/export
              fields.ts      registry of data fields keyed by codec value_type id (label, icon, digits, sign glyph, preview range, slot)
render/       canvas.ts      OffscreenCanvas in the browser, @napi-rs/canvas in tests (setCanvasFactory); bounded sprite caches
              glyphs.ts      digit sets 0-9 + colon + minus + degree, word sets (weekday, month, AM/PM): the sprites
              shapes.ts      hand shapes, icons, ring and track sprites
              iconsets.ts    image sets for enum fields (battery level)
              layout.ts      where each sprite of a time / date / widget element goes (shared by preview and export)
              scene.ts       draws a project for a simulated watch state; bounds for selection
editor/       zustand store (history, autosave), Stage (canvas, drag, resize, guides), panels, dialogs
              fieldBrowser.ts  what the Fields tab offers for each codec id (pure, tested)
templates/    six starter faces, built from the same element factories
export/       support.ts     what may be exported, from the codec's value-id evidence; which layers are static
              build.ts       project -> .hwt, plus the layout sidecar
              photo.ts       project -> photo-face PNG
```

The preview draws the same bitmaps the export encodes, so what the editor shows is what the watch is given. Text is
rendered once to digit images in the chosen font (a digit sequence on the watch advances by image width and has no
spacing setting, so letter spacing is baked into the images). Fonts are `@fontsource` packages (SIL OFL), loaded per
weight on demand and never from a third party at run time. A font that fails to load is listed in the `.hwt` checklist
(its digits are drawn in the browser's fallback font); its sprites are cached once loading has finished.

### Data fields and the field browser

Widgets, rings and icon sets do not hold a fixed source name. They hold a codec `value_type` id, and `model/fields.ts` says
what Studio can do with that id: label, icon, number of digits and value range, the sign glyph (the degree sign of a
temperature, written as `res_sign`), the preview slider range and default, and the container `data_type` the export puts it in.
The *Simulated watch* panel builds its sliders from the registry. How well an id is known is never stored there: it is
`VALUE_TYPES[].evidence` from the codec, read through `levelOfId` in `export/support.ts`, the function the export gate uses.

**Add → Fields** lists every `VALUE_TYPES` entry (search by name, id or category) with its evidence badge (*Verified*,
*Unconfirmed*, *Unknown, preview only*), the layer types Huawei's docs allow for its data category, and its container slot when
Studio knows it. One action per category (**Add as number**, **Add as ring (ratio)**, **Add as icon set (enum)**) is enabled
only when Studio can write the id; otherwise a one-line reason says why: unknown id, drawn by the Time or Date element, a clock
hand, no container `data_type` known, `FaceBuilder` has no method for that layer type, or *needs an image set* (the weather
types: the order of the 11 images is not known).

| Field (id) | Element | Slot | Evidence |
|---|---|---|---|
| Steps (0), heart rate (2), altitude (8), temperature (4), temperature min / max (21 / 20), power (9) | number | 10, 11, 22, 21, 21 / 21, 17 | verified |
| Steps ratio (161), heart rate ratio (157), power ratio (163) | ring | 10, 11, 17 | verified |
| Altitude ratio (170) | ring | 22 | inferred |
| Power enum (54) | icon set of 11 battery levels | 17 | inferred |

The slot of temperature min / max is the weather slot (21) because the NikeCombo sample puts them in the weather gauge
(structure only). The 0 to 255 scale of the heart rate ring is Huawei's default (97 of 255); the scale the watch uses for the
altitude ring is not known, so the preview uses 0 to 8848 m.

A project written before the registry (`source: "steps"`, `"heartRate"`, `"battery"`, `"calories"` on widgets; `"steps"`,
`"battery"` on rings) is migrated when a project file is opened and when the autosave is restored: the id replaces the name
(calories becomes id 1, which has no evidence, so it stays preview only as before). Both paths run the same validation, so an
element the renderer cannot draw makes the project "damaged" instead of crashing it.

### Export mapping

| Editor element | In the `.hwt` | Ids |
|---|---|---|
| Background | `BACKGROUND` element: image(s) at 0,0 (split into bands when one image would pass 750 KB), plus a black image for the always-on display | none |
| Image / sticker | `SINGLE_RES` in a `BACKGROUND` element, cropped to the screen (positions cannot be negative) | none |
| Digital time | `TIME` element: hour and minute `COMBINED_RES` (ten digit images each), colon `SINGLE_RES` | hour 12, minute 13 (verified) |
| Seconds | two `SELECTED_RES` (6 and 10 images) | 63, 64 (inferred) |
| Date | weekday `SELECTED_RES` (slot 0 repeats Monday, Monday first), day `COMBINED_RES`, month `SELECTED_RES` (slot 0 repeats January) | 52, 17, 51 (verified) |
| Hands | `HAND_RES` in a `TIME` element; rotation box is a square centred on the pivot, as far across as the tip is from it | second 154 (verified); hour 150, minute 153 (inferred) |
| Data numbers | `WIDGET` element with a container (`data_type` from the registry): icon `SINGLE_RES` + number `COMBINED_RES`; a sign glyph goes out as `res_sign` | steps 0, heart rate 2, altitude 8, temperature 4, min 21, max 20, power 9 (verified) |
| Progress rings | container with the track as `SINGLE_RES` and the full arc as `ARC_RES`, angles from start and sweep | steps ratio 161, heart rate ratio 157, power ratio 163 (verified); altitude ratio 170 (inferred) |
| Icon set | container with one `SELECTED_RES` of 11 images (battery 0 to 100 percent in 10 percent steps) | power enum 54 (inferred) |
| AM/PM marker, the minus sign of a negative number, calories | not exported: **preview only** | no id / no codec field |

Every element is marked **verified**, **unconfirmed** (inferred ids, exported only while "Include unconfirmed elements"
is on in the export dialog) or **preview only** (never exported, listed in the checklist). The levels come from
`VALUE_TYPES[].evidence` in the codec, so they follow the codec as it learns ids. An image, a custom hand or a photo
background whose picture did not load (browser storage blocked, damaged file) is **preview only** too, and the checklist says
so; it is never exported as a placeholder.

The always-on display is a black screen with the time, date and hour and minute hands at 45 percent brightness. The
export dialog reports the share of lit pixels against Huawei's 20 percent guideline. The cover and the always-on preview show
the time the stage shows (a running clock is read at export).

### Photo face

The default export. `export/photo.ts` draws the static layers (`isStaticElement` in `export/support.ts`: backgrounds and
images; hidden layers are skipped) onto an opaque black 408 × 480 surface and writes it as PNG:

- **Exactly 408 × 480.** JoyoFit's photo-face flow skips its crop screen for a picture of exactly the watch's screen size and
  uploads it without resampling; any other size goes through the crop.
- **Opaque.** The watch's photo face is RGB24 (image option 1, `protocol/README.md`), so there is no alpha; transparent pixels
  become black. No rounded-corner mask is applied: the watch masks its own screen.
- **No live layers.** The watch draws its own clock and data over a photo (style, colour and position are set on the watch), so
  Time, Date, Hand, Data, Ring and Icon-set layers are left out. The stage's *Photo face preview* button shows what remains.
- **No placeholders.** An image whose picture did not load is left out, not drawn as the dashed box the stage shows.

Install: send the PNG to the phone, then **JoyoFit → Watch → Photo face**.

### Why the `.hwt` is not the main output

Firmware 6.x needs Huawei's signature on a watch face. **VERIFIED** on the Fit 4 Pro (6.1.0.117): an unsigned `.hwt`
uploads fine, the activation is answered with status 100014, and the watch deletes the face about 3 s later
(`protocol/README.md` → *Why a face did not install*); Gadgetbridge issue #6199 (HarmonyOS 6.1 cannot install `.hwt`)
agrees. The signature is tied to the Huawei account, the face id and version, and the watch. The `.hwt` export stays for
Huawei's Theme Studio Pro with a developer account and for reading the layout; it is no longer presented as installable.

### Files and storage

Files written: `<Name>.photo.png`, `<Name>.hwt` (letters and digits only), `<Name>.layout.json` (the layout and image table,
for troubleshooting) and `<Name>.project.json` (the project with its images embedded).

Uploaded images are blobs in IndexedDB. At start only the images the open project uses are decoded. Deleting the other stored
images is left to the one tab that holds the exclusive Web Lock `joyofit-studio-assets`: each tab queues for it, and when it is
granted (the previous document unloaded, or the other tab closed) the tab keeps it until it unloads and deletes every stored
image that the open project, the undo and redo history and the autosave do not name at that moment. Nothing is deleted when the
saved project failed to restore (its JSON still names those images) or when the browser has no lock API. When a project is
replaced (new face, template, import) the replaced project stays in the undo history, so its images stay until a later start;
template artwork lives in memory until a project that uses it is opened. The autosave
(localStorage, 300 ms debounce) is flushed when the page is hidden, and the app tells the user when the browser refused it.

### Language

Studio is Indonesian (default) and English, the same two languages as JoyoFit Web, with `i18next` and `react-i18next`. The language is,
first match wins: the choice stored in localStorage `jfit-locale` (JoyoFit Web writes the same key on the same origin, so one pick serves
both, and a pick made here is written there; another open tab follows through the `storage` event), then the browser's languages,
then `id`. The header switch (`src/i18n/LanguageSwitch.tsx`) flips between the two and sets `<html lang>`. The account's saved
language (`profile.locale`) is not read: Studio makes no call before the cloud dialog opens.

Text lives in `src/i18n/locales/<id|en>/<namespace>.ts`, one namespace per area (`app`, `help`, `templates`, `export`, `editor`, `props`,
`fields`, `cloud`). `id` is the source and types the keys (`t("header.undo")` is checked). Components use `useTranslation(ns)`; code
outside React (the store, the export builders, the field registry, toasts) calls `i18n.t("ns:key")` when the text is needed, never at
module load, so a switch applies at once. Names written into a project (layer names, a template's name) are created in the language
active at that moment and are the user's data afterwards. To add a string, add the key to both files; `i18n.test.ts` fails when
they differ. Unit tests run in English (`src/test/setup.ts`), and `e2e/studio.spec.ts` stores `jfit-locale=en` before it loads the page.

### Cloud projects

The cloud button in the header opens a dialog for the Pro project library (`src/cloud/`). The page asks `POST /rpc/fitness/cloudAccess`
who is signed in and whether Pro is unlocked, then talks to JoyoRogo's `/api/fit/studio/projects` proxy (origin `https://api.joyorogo.com`,
`VITE_API_URL` overrides it; every call sends the session cookie and `x-locale`). Signed out, the dialog links to the web app's login
(`/login?redirect=/studio/`); signed in without Pro it links to `/harga`, keeps open and delete working for what the account already has and
disables saving and renaming. Saving uploads the project file (`serializeProject` as an object) plus a small JPEG thumbnail of the face.
The open face is linked to its cloud project (`id`, `rev`, name, autosave switch in localStorage `joyofit-studio:cloud-link`, never the
document); saving sends the `rev` it last saw, and a `409 rev_conflict` (autosave or manual) stops autosave and offers *Save as a new copy*
(the local face becomes `<name> (copy)`, the cloud one stays) or *Load the cloud version* (the local edits stay one undo away). Opening a
project replaces the face, so the dialog asks first when that loses unsaved work. Autosave is off by default; when on it writes 4 s after the last
edit, one request at a time (`window.__STUDIO_CLOUD_AUTOSAVE_MS` shortens that for tests). The local file buttons and the local autosave are unchanged.

Size: the request body is capped at 5 MiB. Measured project files: an empty face 0.5 KB, five of the six templates 1 to 31 KB, the Photo
template 530 KB, a 408 x 480 photo background 80 to 200 KB, a 3000 x 2250 photo 600 KB (photos are stored at most 1600 px), but a
photographic 1024 px PNG sticker is 3.2 MB and a noise-like one 4.8 MB, so a few such stickers pass the cap. Only the cloud copy is
lightened, and only when over the cap: images above 48 KB are re-encoded at most 512 px (PNG) or 1000 px (JPEG, quality 0.85), then 384 / 816 and
256 / 640, until it fits. The local project and the local `.json` export are never changed. A body still over the limit is refused before it is sent,
with its size against the limit.

### What the tests cover

- `render/*.test.ts`: digit and word sprites (cell size, ink height, baseline, color, outline, caching, bounded caches, minus and
  degree glyphs), layout of time, date and widgets, hand and ring sprites, hand angles.
- `model/fields.test.ts`: the registry agrees with the codec (ids, categories, slots, image counts), every codec id has a field or a
  stated reason, old projects migrate (project file and autosave) and damaged ones are rejected.
- `model/assets.test.ts`: a replaced bitmap is closed; memory-only artwork survives a project replacement.
- `editor/fieldBrowser.test.ts`: for every `VALUE_TYPES` id the browser's evidence equals `levelOfId`; an action is enabled only
  when the element it makes has the same level and the export writes that id in the registry's slot (strict and with unconfirmed
  elements); the exact set of addable ids; the reasons for the rest; search.
- `editor/store.test.ts`: history, drag as one step, and that clicking an element (or a pan that does not move) adds no undo step
  and keeps the redo stack.
- `export/build.test.ts`: export a template, re-read it with `readHwt`, check header, image table (`verifyWatchface`),
  thumbnail size, every layout image reference, value ids, element gating, banding, cropping, file name.
- `export/robustness.test.ts`: an image, custom hand or photo background that did not load does not throw, is listed and writes no
  layer; the cover uses the stage's time for a running clock; a font that failed to load is listed and its glyphs are cached, one
  still loading is not.
- `export/photo.test.ts`: the PNG is 408 × 480 and fully opaque, holds a static layer's pixels and none of a live layer's (pixel
  probes), flattens transparency onto black, has no corner mask, and leaves out hidden and missing layers without a placeholder.
- `export/replay.test.ts`: reads the exported layout back the way the layout format describes (layers in order, digits by
  value, hands rotated about the pivot, arcs clipped to the ratio) and compares the result with the editor's preview for
  all six templates.
- `e2e/studio.spec.ts` (Playwright): load, add a time element, export the `.hwt` and parse it; the photo-face PNG (size, opacity,
  no live layer); the stage's photo preview; project JSON and debug downloads; drag, undo, redo and autosave; select-click adds
  no undo step; autosave flush on `pagehide`; the Fields tab (badges, reasons, add, filter) on desktop and in the mobile layout;
  resize handle; templates; preview-only marking; IndexedDB image lifecycle; photo upload.
- `i18n/i18n.test.ts`: language resolution (stored choice, browser languages, `id`) and, per namespace, the same keys and the same
  `{{placeholders}}` in Indonesian and English.
- `e2e/i18n.spec.ts` (Playwright): Indonesian by default, English browser, the choice JoyoFit Web stored, the header switch (every
  panel, persisted in `jfit-locale`, survives a reload), a switch in another tab followed live, no overflow at 360 px in Indonesian.
- `cloud/*.test.ts`: the API client (URLs, `credentials`, headers, error mapping for 401/402/409/413/5xx/network, the size check before
  sending), the link store and its persistence, the autosave scheduler (debounce, single flight, stop at a conflict, retry on the next
  edit), thumbnail size fitting, the cloud document's image shrinking ladder, formats and web-app links.
- `e2e/cloud.spec.ts` (Playwright, against an in-memory mock of the API): signed-out and non-Pro prompts, save, update with `rev`
  bump, rename, open with the replace confirmation, delete, size and library limits, outages, both conflict choices, autosave, local
  JSON still working, Indonesian and English, no horizontal overflow at 360 px.

## Not confirmed on a watch

No face from this editor has been installed on a Fit 4. What is settled and what is not:

- **Settled:** an unsigned `.hwt` is deleted by the watch (above). The photo-face upload is verified on the Fit 4 Pro; a
  Studio PNG goes through the same path, but a picture from Studio has not been put on a watch yet, and JoyoFit's exact-size
  shortcut (no crop) is new.
- **Open for the `.hwt`**, all listed in the export checklist: whether a Huawei-signed face made here would be accepted; layout
  details that no sample settles (whether a face without always-on layers shows a blank AOD, whether widget layers need their
  container, label and z-order rules between element types, `res_preview` for time and date, how single-digit hours and days
  are padded, and `createHwt` writing a flat package); how the watch places a `res_sign` glyph (Studio draws the degree sign
  after the digits and writes it as `res_sign`) and how it shows a negative number (the codec has no field for a minus sign, so
  it is preview only).
- The inferred ids above (hour and minute hands 150 / 153, seconds 63 / 64, altitude ratio 170, power enum 54), the container
  slot of temperature min / max, the scale of the altitude ring, and the order of the weather images (248), which is why that
  id has no image set.
- The rounded corner of the preview mask is an approximation.
