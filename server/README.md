# JoyoFit cloud (Cloudflare Worker)

A small backend for the JoyoFit app: it accepts JoyoRogo sign-ins and stores what the app uploads in
D1, with a raw-file endpoint into R2 for the future Huawei-export importer.

- Hono + TypeScript on Workers, D1 (`DB`), R2 (`IMPORTS`).
- Auth: the app sends its JoyoRogo better-auth session cookies; the Worker asks
  `${JOYOROGO_AUTH_URL}/api/auth/get-session` who they belong to. See
  [`JOYOROGO_PATCH.md`](JOYOROGO_PATCH.md) for the one change JoyoRogo needs and why.
- Every row is keyed by the JoyoRogo user id; one user can never read or overwrite another's.

## API

All endpoints need `Cookie: <JoyoRogo session cookies>`; without a live session they answer `401`
(`503` when JoyoRogo itself cannot be reached).

Uploading is a JoyoRogo Pro benefit. `POST /v1/sync` and `POST /v1/imports` ask JoyoRogo's oRPC
`fitness/cloudAccess` (with the forwarded session cookies) and answer `402 {"error":"founder_required","paywall":true}`
unless the account is Pro, or the JoyoRogo server has no paywall (self-host: the same `premiumUnlocked` rule
JoyoRogo uses for its own Pro features). Reads (`GET`) stay open, so existing data is never locked away. If
JoyoRogo cannot answer (including a `404` from a JoyoRogo that predates the procedure) the answer is `503`, never
a guess. Deploy JoyoRogo with `fitness.cloudAccess` before this Worker.

| Endpoint | What it does |
|---|---|
| `GET /v1/me` | `{ user: {id, email, name}, rev, lastSyncAt, cloud: { unlocked } }`; `unlocked` says whether uploads are accepted |
| `POST /v1/sync` | Batched upsert. JSON body, at most 3 MB: `stepSamples` (≤ 5 000), `sleepSegments` (≤ 2 000), `workouts` (≤ 50, each with `points`, ≤ 30 000), `devices` (≤ 10). Validated with zod (`400` with the issues, `413` too big). Idempotent: a row identical to the stored one is not rewritten. Answers `{ rev, written }`. |
| `GET /v1/sync?since=<rev>&limit=<n>` | Pull for other devices: rows changed after `since`, oldest change first, across all tables (`limit` ≤ 1 000, workouts ≤ 25 per page). Answers the four arrays plus `cursor` (the next `since`) and `hasMore`. |
| `GET /v1/restore?table=steps\|sleep&from=<unix s>&after=<cursor>&limit=<n>` | Windowed history for a new phone, open to every signed-in account (no Pro gate). Rows with key time ≥ `from` (steps: `timestamp`; sleep: `end`), ordered by primary key (steps by `timestamp`, sleep by `start, type`) and paged by a keyset cursor: `after` is the previous page's `cursor` (steps: last timestamp; sleep: `start:type` of the last row). `limit` default 2 000, max 5 000. Answers `{ rows, cursor, hasMore }` with the pull's camelCase row shapes (steps: `timestamp, steps, calories, distance, heartRate, spo2, restingHeartRate, device`; sleep: `start, end, type, stage, device`). `400` for a bad `table`/`from`/`after`/`limit`, and for `from` older than 400 days. One primary-key range query per page; sleep scans `start >= from - 1 day` and filters `end >= from`, so a segment longer than a day that began before that is not returned. |
| `POST /v1/imports?filename=<name>` | The request body is the file, streamed straight into R2 at `imports/<userId>/<uuid>` (needs `Content-Length`, at most `MAX_IMPORT_BYTES`, default 100 MiB). Records an `imports` row (`uploading` → `uploaded`, or `failed`). Answers `201 {id, status, size, ...}`. |
| `GET /v1/imports` | The caller's 50 newest imports. |
| `DELETE /v1/data` | Wipes what the app uploaded for the caller (steps, sleep, devices, workout rows of older builds, import files and rows, live tracking sessions and points). Keeps the Strava connection and family links. No Pro gate (data is never locked in). Answers `{deleted: true}`. |
| `DELETE /v1/account` | Everything above plus the Strava connection and family links; the app calls it before it deletes the JoyoRogo account. |
| `GET /v1/strava`, `GET /v1/strava/authorize`, `POST /v1/strava/token`, `POST /v1/strava/disconnect` | Strava connection of the signed-in user, **free (no Pro gate)**: status, authorize URL (scope `activity:write` plus whatever the athlete already granted JoyoRogo), a fresh short-lived access token, unlink. The Strava application is shared with JoyoRogo and Strava keeps one token per athlete, so the tokens live in **JoyoRogo's D1** (`strava_account`) and this Worker calls JoyoRogo's `/internal/joyofit/strava/*` with the Strava client credentials as HTTP Basic; the refresh token and client secret never reach the phone. The old table `strava_connection` is dropped by [`migrations/0004_drop_strava_connection.sql`](migrations/0004_drop_strava_connection.sql). |
| `GET /strava/callback`, `GET\|POST /strava/webhook` | Public, called by Strava: the OAuth redirect (JoyoRogo exchanges the code and stores the tokens; redirects to `joyofit://settings/strava`) and the webhook (subscription validation; a deauthorization event is forwarded to JoyoRogo, which deletes that athlete's tokens for both products, `503` when the forward fails so Strava retries). |

| `POST /v1/waitlist` | Public (no session, CORS for `https://fit.joyorogo.com`): the /strava and /iphone invite forms. Body `{ kind: "strava" \| "iphone", email, stravaProfile?, watchModel?, note?, website? }`; `website` is a honeypot (filled = `200`, nothing stored). Upserts by `(kind, email)` (status and `created_at` kept), at most 5 submissions per IP per hour (`429` + `Retry-After`; only a one-hour salted hash of the IP is stored, table `waitlist_rate`). Table `waitlist` ([`migrations/0003_waitlist.sql`](migrations/0003_waitlist.sql)). |
| `GET /v1/waitlist?kind=&status=` | Owner only: `Authorization: Bearer $WAITLIST_ADMIN_TOKEN` (Worker secret, `503` when unset). Easiest: `scripts/waitlist.sh [strava\|iphone]` from the repo root, which reads the token from `~/.config/joyofit/waitlist-admin-token`. |

Strava needs the `STRAVA_CLIENT_ID` var (in `wrangler.jsonc`) and two secrets, `STRAVA_CLIENT_SECRET` (the same value as on
JoyoRogo's Worker) and `STRAVA_WEBHOOK_VERIFY_TOKEN`; without the client secret the Strava routes answer `503 strava_not_configured`.
Owner setup (callback domain, webhook registration, the shared application, review): [`../docs/strava.md`](../docs/strava.md).

`rev` is a per-user change counter: each row a request creates or changes gets its own increasing value,
which is what `since` filters on. D1 schema: [`migrations/0001_init.sql`](migrations/0001_init.sql)
(`step_samples`, `sleep_segments` with `stage`, `workouts`, `workout_points`, `device`, `user_state`,
`imports`).

### Ride relay ("Main di web")

Rooms for the browser ride game, with the JoyoFit phone as the sensor bridge; code in `src/ride/`, the protocol in `../src/features/ride/protocol.ts`, the whole feature in [`../docs/ride.md`](../docs/ride.md). Two SQLite-backed Durable Object classes (`RideRoom`, `RideIndex`, migration `ride-v1`), no D1.

| Endpoint | What it does |
|---|---|
| `POST /ride/rooms` | Public (no session, CORS `*`, 10 per address per 10 minutes, `429` + `Retry-After`). Answers `{ roomId, code, token, codeExpiresAt }`: a six digit code valid 10 minutes and the web token for the socket. |
| `POST /ride/rooms/join` | Body `{ code }`, JoyoRogo session. Answers `{ roomId, token }` (the phone token). `400` malformed, `404` unknown or expired code, `409` another user is the room's phone, `429` rate limited (10 per user, 30 per address, 5 minutes). Free for every account. |
| `GET /ride/rooms/:roomId/ws?role=phone\|web&token=...` | WebSocket (hibernatable). `401` wrong token, `404` no such room, `429` room full (8 web sockets) or rate limited. Frames: 2 KB at most, validated, stamped with `rt` and relayed; a room idle for 3 hours is closed. |

### Gear sync

Shoes and bikes (and which workout used which) travel as one JSON document per user, table `gear_doc`
([`migrations/0006_gear.sql`](migrations/0006_gear.sql)); code in `src/gear.ts`.

| Endpoint | What it does |
|---|---|
| `GET /v1/gear` | `200 { rev, doc }`; `rev: 0, doc: null` when the user has none. Open to every signed-in account, like `GET /v1/sync`. |
| `PUT /v1/gear` | Body `{ baseRev, doc }`, at most 1 MiB (`413`). **Pro only** (`402 { error: "founder_required", paywall: true }`, same gate as `POST /v1/sync`). The doc is validated with zod (`400`): `version: 1`, `gear` ≤ 200, `defaults` ≤ 20, `assignments` ≤ 50 000; unknown extra keys are kept, a missing `notified` becomes `0`. The stored JSON is the validated doc re-serialised. |

`rev` is the optimistic-concurrency counter. A write lands only when `baseRev` equals the stored `rev` (`0` when the
user has no doc): it stores the doc, sets `rev = rev + 1` and answers `200 { rev }`. Otherwise nothing is stored and
the answer is `409 { error: "conflict", rev, doc }` with the current server state, for the client to merge and retry
with the new `rev`. The check and the write are one conditional D1 statement, so two concurrent writers with the same
`baseRev` cannot both win. `DELETE /v1/data` and `DELETE /v1/account` remove the row.

Each table is written as one JSON bind parameter expanded with `json_each`, so a request costs a handful of
D1 statements however large it is (D1 allows 100 bound parameters and, on the free plan, 50 queries per
invocation).

### Live tracking link

Bike computer mode can share the phone's position while a ride is recorded (`docs/bike-computer.md`, "Live tracking link"); code in
`src/live.ts` (routes, purge) and `src/livePage.ts` (the page), tables in [`migrations/0007_live_tracking.sql`](migrations/0007_live_tracking.sql).
Three kinds of caller, three secrets, all 128-bit random; only SHA-256 hashes are stored, so a leaked database holds no usable link or key.

| Endpoint | Auth | What it does |
|---|---|---|
| `POST /v1/live` | JoyoRogo session | Body `{ title? }` (trimmed, at most 80 characters). Starts a session and answers `201 { id, viewUrl, token, writeKey }`: the only time the token and the write key exist in the clear. One active session per user (a partial unique index): starting another ends the previous in the same batch. At most 10 starts per user per hour (`429`). |
| `POST /v1/live/:id/points` | `Authorization: Bearer <writeKey>` (not the cookie, so a backgrounded phone with an expired session keeps posting) | Body `{ points: [{ ts, lat, lon, alt?, speed?, hr? }] }`, 1 to 30 points, at most 8 KiB. `ts` is Unix ms, strictly increasing inside the batch, within 6 h in the past and 10 min in the future of the server clock; `lat` -90..90, `lon` -180..180, `alt` -1000..12000 m, `speed` 0..120 m/s, `hr` integer 0..255. Anything else is `400 invalid_body` (the app drops that batch). `INSERT OR IGNORE` on `(session_id, ts)`, so a retried batch is harmless. Answers `{ stored }`. `401` for a wrong key, `409 ended` / `409 expired` (12 h after the last batch) / `409 session_full` (20 000 rows), `429` with `Retry-After` past 12 requests per session per minute. |
| `POST /v1/live/:id/end` | Bearer write key | Sets `ended_at`; repeatable. |
| `GET /v1/live/:token` | none (the token is the capability) | `Cache-Control: no-store`. `{ state: "live" \| "ended" \| "expired" \| "unknown", title, startedAt, lastAt, last: { lat, lon, speed, hr, ts } \| null, track: [[lat, lon], ...] }`, the track downsampled to at most 300 points keeping the first and the last. Only `live` carries a title, position or track: ending the ride revokes the link (`ended` keeps the times), and a link 12 h past its last batch is `expired`. An unknown or malformed token is `404` with `state: "unknown"` and nulls, identical for both. `?track=0` skips the track (one D1 row read instead of the whole ride; the page uses it for most polls). |
| `GET /live/:token` | none | The page people open: HTML with inline CSS and JS only, a per-request nonce CSP (`default-src 'none'`, `connect-src 'self'`, no images, no frames), `noindex`, `Referrer-Policy: no-referrer`, Indonesian or English by `Accept-Language`. It polls the JSON every 15 s and draws the track as an inline SVG polyline with the last position marked, plus speed, "diperbarui X menit lalu", banners for ended/expired links and a link "Buka di OpenStreetMap" with the attribution. **No map tiles, on purpose**: a tile server would learn the viewer's address and, through the tile requests, where the rider is, and the page would need a tile provider's terms and key. The title is only ever written with `textContent`; the first answer is embedded as a JSON data block with `<`, `>`, `&` escaped. |

The nightly purge (`0 20 * * *`, the family cron's `purge`) deletes sessions and their points 24 h after `COALESCE(ended_at, last_at)`;
`DELETE /v1/data` and `DELETE /v1/account` delete a user's sessions and points. The Worker never logs coordinates. The migration needs to be
applied before the routes are deployed (`bun run db:migrate:remote`); no new secrets or wrangler changes.

## Setup (you run these)

You need a Cloudflare account and `wrangler` login (`bunx wrangler login`). From this directory:

```bash
bun install

# 1. D1 + R2
bunx wrangler d1 create joyofit          # prints database_id
bunx wrangler r2 bucket create joyofit-imports
```

Edit `wrangler.jsonc`: put the printed `database_id` in `d1_databases[0].database_id` (the
`0000…` value is a placeholder), and the bucket name if you chose another. Then:

```bash
# 2. Schema
bun run db:migrate:remote                # wrangler d1 migrations apply joyofit --remote

# 3. JoyoRogo origin (default https://api.joyorogo.com) — change in wrangler.jsonc `vars` if needed:
#    "JOYOROGO_AUTH_URL": "https://api.joyorogo.com"

# 4. Deploy
bun run deploy                           # wrangler deploy; prints https://joyofit-api.<subdomain>.workers.dev
```

Then apply [`JOYOROGO_PATCH.md`](JOYOROGO_PATCH.md) to JoyoRogo and redeploy it, and build the app with the
printed URL: `EXPO_PUBLIC_JOYOFIT_CLOUD_URL=https://joyofit-api.<subdomain>.workers.dev` (or set
`expo.extra.cloudUrl` in the app's `app.json`).

Local development: `bun run db:migrate:local && bun run dev`.

## Develop

```bash
bun run test         # vitest + @cloudflare/vitest-plugin (miniflare): auth, idempotency, user isolation, imports
bunx tsc --noEmit
bun run types        # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

The tests replace JoyoRogo with a fake `get-session` and `fitness/cloudAccess` (a stubbed `fetch`, and a fake `AUTH_SERVICE` binding
for the service-binding path).

## Language of the text the Worker writes

Push and email copy go to someone else's phone or inbox, so they follow the **recipient's** language: `locale` (`id` or `en`) from
JoyoRogo's `/internal/joyofit/family/users` answer (`RogoUser.locale`; anything else or missing is `id`). `src/i18n/` holds
`serverT(locale)` (`{{param}}` interpolation, `_one`/`_other` plurals by `Intl.PluralRules`) and
`locales/{id,en}/{push,email,errors}.json`; `id` is the source. There is no per-isolate "current language": callers pass the `Locale`
down (`EvalInput.locale`, `deliver(..., locale, ...)`, `sendFamilyEmail(env, to, locale, ...)`).

- Alert titles and bodies are written when the alert is decided and stored in `family_alert_log` as written; a queued alert or digest
  item goes out in that language. The digest title and the email disclaimer follow the watcher's language at send time.
- A poke goes to the monitored person, so it uses *their* locale.
- API errors stay machine codes (`invite_invalid`, ...); the app words them. The only localized API text is the inviter fallback name in
  `GET /v1/family/invites/:code` (header `x-locale`, else the caller's JoyoRogo locale) and the Strava fallback page (`Accept-Language`).
- `bun run server/scripts/i18n-keys.ts` (from the repo root) checks that `en` has every `id` key, once per plural category, with no orphans.

## Notes

- Sessions are cached per isolate for 60 s; a session revoked in JoyoRogo keeps working here for up to
  that long. Failures are never cached. The Pro answer is cached the same way (60 s when unlocked, 10 s
  when locked, so a fresh purchase is noticed quickly).
- Workouts moved to JoyoRogo: app builds from the cloud-workouts release on keep their workouts (summary, every sample stream, the analysis) in JoyoRogo's D1 and R2, Pro only, restorable on a new phone and shown on joyorogo.com (design in JoyoRogo's `docs/watch-workout-cloud.md`). They no longer send `workouts` to `POST /v1/sync`. The `workouts` and `workout_points` tables and the workout part of `/v1/sync` stay only for older installed builds; drop them in a migration once those are gone.
- Deleting: the app deletes nothing row by row. `DELETE /v1/data` wipes everything it uploaded, `DELETE /v1/account` additionally drops Strava and family links.
- The importer for the Huawei export does not exist yet; `imports.r2_key` and `status` are where it will
  pick files up (`uploaded` → its own states).
- `device` (nullable `TEXT`, max 64 chars) on `step_samples`, `sleep_segments` and `workouts` holds the id of the watch that produced a row (multi-watch). `POST /v1/sync` accepts it optionally on those items (a changed value counts as a change and bumps `rev`), `GET /v1/sync` and `GET /v1/restore` return it (`null` when absent); builds that send none keep working. Migration [`migrations/0008_device_column.sql`](migrations/0008_device_column.sql) is numbered 0008 on purpose: `0007_live_tracking` lives on the unmerged `bikecomp` branch.
