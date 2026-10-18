# Ride on the web (phone side and relay)

"Main di web" / "Ride on the web": an indoor ride in a browser game, with the JoyoFit phone as the sensor bridge. Web Bluetooth does not exist on iPhone Safari, TVs or most laptops, so the phone reads the Bluetooth sensors (the sensor manager and recorder of docs/sensors.md), streams them to a relay, and the game reads them from there. The browser game is described in [ride-web.md](ride-web.md).

```
JoyoFit phone (sensors + recorder) --WebSocket--> Durable Object "ride room" --WebSocket--> browser game
```

The phone is the source of truth for the workout: it records the ride as an indoor ride, the game is the display and fun layer. When the game ends it sends its summary (distance, climb, route, laps) through the room and the phone saves it with the ride.

Everything on the phone is JavaScript (no native code, no migration), so it ships over the air. The owner has a cadence sensor and an HR strap, no power meter and no smart trainer; the design starts from that.

## Files

| Path | What |
|---|---|
| `src/features/ride/protocol.ts` | Wire protocol v1: message types, `parseMessage` (validates, drops unknown fields), who may send what, room REST types, deep link and code helpers. Pure TS, no imports; the app, the Worker, the site and the sim import this one file. |
| `src/features/ride/physics.ts` | Virtual gear table, cadence x gear to speed, ESTIMATED power, grade, drafting, heart rate effort. Pure TS; the site imports it too. |
| `src/features/ride/session.ts` | `RideSession`: the phone's room (join, stream, obey, reconnect). Framework-free, tested with fakes. |
| `src/features/ride/api.ts`, `errors.ts`, `links.ts` | The join call (`cloudRequest`), its error kinds, the game's address. |
| `src/state/RideProvider.tsx` | React shell around the one session; `finish` and `discard` combine the room with the recorder. |
| `src/features/ride/ui/*`, `src/app/ride/*` | The screen and the routes `/ride` and `/ride/join`. |
| `server/src/ride/*` | The relay: routes, `RideRoom` and `RideIndex` Durable Objects, limits. |
| `scripts/ride-sim.ts` | A fake phone for developing the game without hardware. |
| `i18n` namespace `ride` | Indonesian and English copy of the screen. |

## Why the relay is inside `joyofit-api`

Same Worker, new routes (`/ride/*`) and two Durable Object classes, not a second Worker. It reuses the JoyoRogo session check (`requireUser`, with its cache and service binding), the domain `api.fit.joyorogo.com`, the observability and the deploy; a second Worker would need its own route or domain, its own copy of the auth code, and one more thing to deploy. The Durable Objects are separate classes with their own migration tag (`ride-v1`), so the D1 routes are untouched. The cost: a deploy of the relay is a deploy of the whole API, and a preview deploy must not copy the crons or the D1 binding (see "Testing against a deployed Worker").

## Rooms

- The web opens a room: `POST /ride/rooms` (no login, CORS open) answers `{roomId, code, token, codeExpiresAt}`. `code` is six digits and valid 10 minutes; `token` is the WEB token for the WebSocket (spectators use the same one, put it in the watch link). The web shows the code and a QR of `joyofit://ride/join?code=XXXXXX`.
- The phone joins: `POST /ride/rooms/join {code}` with the JoyoRogo session cookie answers `{roomId, token}` (`token` is the PHONE token). Not Pro-gated. One JoyoRogo user is the phone of a room: the same user may join again (new token, the old one stops working), another user gets `409 room_taken`. Errors: `400`/`404` unknown or expired code, `401` not signed in, `429` too many tries (10 joins per user and 30 per address in 5 minutes).
- WebSocket: `GET /ride/rooms/:roomId/ws?role=phone|web&token=...`. One phone, up to 8 web sockets. A second phone socket replaces the first (close `4001`).
- Code to room: one `RideIndex` Durable Object per code (`code:<digits>`), not KV (KV is eventually consistent, and a phone joining seconds after the page opened must find the room) and not one global object (a bottleneck). The same class counts the REST rate limits (`rl:<scope>:<who>`, addresses hashed). Both clean up with an alarm.
- Tokens: 192 random bits per role, only their SHA-256 is stored in the room. No secret to deploy.
- Expiry: a room with no frame for 3 hours is closed (alarm; sockets get `err expired` and close `4002`) and its storage is deleted. The room's last-activity time is written at most every 5 minutes.
- The `RideRoom` uses hibernatable WebSockets (`acceptWebSocket`) and answers the exact text `{"t":"ping"}` with `{"t":"pong"}` through `setWebSocketAutoResponse`, without waking. State that must survive hibernation (token hashes, the phone's `hello`, an unconfirmed `sum`) is in storage.
- Abuse: a frame over 2 KB closes the socket (`1008`); malformed, not-allowed or over-rate frames get an `err` frame and count as strikes (10 close the socket, forgiven after 10 quiet seconds). Rates: phone 12 frames/s (burst 30), web 6/s (burst 20).

## Messages (version 1)

JSON text frames of at most 2 KB, `{t, v: 1, ...}`. The relay stamps what it forwards with `rt` (its clock, epoch ms).

| `t` | from | to | fields |
|---|---|---|---|
| `hello` | phone, web | other side | `role`, `app`, phone: `massKg?`. The relay keeps the phone's and replays it to a web that connects later. |
| `s` | phone | web | `ts`, `hr?`, `cad?`, `spd?`, `pwr?`, `rr?` about 4 Hz. A missing field is no data; `pwr` is only ever a measured value. |
| `ctl` | web, phone | other side | `action`: `start`, `pause`, `resume`, `lap`, `stop`. |
| `gear` | phone | web | `d`: 1 or -1. |
| `st` | web | phone, other webs | `gear`, `gearCount`, `route`, `phase`, `distM`, `elevM`, `grade`, `vKmh`, `pwrEst` about 1 Hz. |
| `sum` | web | phone | `distM`, `elevM`, `route`, `laps: [{sec, distM}]`. Kept by the relay until `ack`. |
| `ack` | phone | relay | `of: "sum"`. |
| `room` | relay | all | `phone`, `webs`, `expiresAt`: on connect and on every join and leave. |
| `err` | relay | sender | `code`, then the socket may be closed. |
| `ping` / `pong` | both | relay | latency and keep-alive. |

## The phone

Screen "Main di web" (route `/ride`): from the indoor ride picker (Workouts > record) and from Watch > Sensors. The deep link `joyofit://ride/join?code=XXXXXX` (the QR of the game, scanned with the phone's camera app) opens it with the code filled in. The app has no camera module, so there is no in-app scanner; typing six digits works too.

While joined (`RideSession`):

- Streams the live sensor values from its own `SensorTracker` fed by the sensor hub: heart rate, crank cadence, wheel speed and power when those sensors exist, RR intervals once. Four frames a second, none when there is no data.
- Gets the recorder ready as an indoor ride (`prepare('indoorRide')`: connects the paired sensors, starts the foreground service so the stream survives the screen turning off). Joining while another sport is recorded is refused.
- Keeps the game and the recorder in step. The game's `ctl` start / pause / resume / lap drive the recorder; a start, pause, resume or lap made on the phone is sent to the game; the game's `st` speed feeds the recorder (`Recorder.virtualSpeed`: used for the sample speed and the distance of an indoor ride while it is fresh and no wheel sensor reports a speed). A game `stop` only pauses the recorder and opens the save dialog: the person saves.
- Saving: `RideProvider.finish` tells the game to stop (unless it already did), waits up to 4 s for its `sum`, saves the workout with `saveRecordedWorkout(..., virtual)` (distance = the game's distance, `summary_json.virtualRide` = distance, climb, route, laps; `elevationGain` = the game's climb with `ascentSource: 'virtual'`; average speed from that distance) and then sends `ack`. Without a summary the ride is saved with the recorder's own numbers.
- Connection: pings every 5 s (the pong gives the latency shown on screen), drops a socket that heard nothing for 15 s, reconnects with 0.5 s doubling to 15 s (up to 20 times, then "Putus" with a button). The relay closing for good (`4001` replaced, `4002` expired, `1008`) is not retried.
- The screen shows the connection, the number of game screens, heart rate and cadence read on the phone, latency, then the game's figures (virtual speed, distance, grade, gear, estimated power) with gear buttons, and the recorder's usual live view.

## Virtual power without a power meter

`physics.ts`. Labelled "estimasi" / "estimated" everywhere; never stored as measured power.

1. Drivetrain: `driveSpeed = cadence x chainring/cog x 2.105 m / 60` (700x25c, a compact 34/50 chainset with an 11-28 cassette, 15 distinct gears, the rider shifts up and down the list in the game or on the phone).
2. Physics: the power needed to move rider plus a 9 kg bike at that speed against rolling resistance (Crr 0.004), air (CdA 0.35 m^2, 1.2 kg/m^3) and gravity on the grade, with 97.6 % drivetrain efficiency (`powerAtSpeed`). Rider mass comes from the profile (the phone's `hello.massKg`, 70 kg when missing). These are the constants `cycling/series.ts` uses for indoor rides with a power meter and no wheel sensor, imported from the one place.
3. Limits (`stepSpeed`): the legs give at most 6 W/kg (a game limit, not a claim about fitness), so a hard gear on a steep climb grinds slower than the cadence suggests until the rider shifts down; acceleration is capped at 2 m/s^2 and the bike has inertia; pedals slower than the wheel freewheel (0 W) and gravity or resistance change the speed; `cdaScale` below 1 models drafting.
4. Gear: a ride starts in about 2.3 on the flat. Until the rider shifts (in the game or on the phone) the game picks the gear for the grade (`climbGear`): the one whose steady power at 80 rpm is closest to 225 W, never harder than the default. 6 % lands in 34x24 (about 240 W at 80 rpm), Bukit's 10.8 % peak in the easiest gear. The first shift hands the gear to the rider for the rest of the ride.
5. Heart rate drives cosmetics only (`effortFromHr`, share of the reserve), never speed or power.

## Develop and test

```sh
# relay locally; the Worker asks JoyoRogo who the phone is, so point it at the fake sign-in the sim starts on :8788
cd server && bunx wrangler dev --var JOYOROGO_AUTH_URL:http://localhost:8788       # :8787
# game: docs/ride-web.md, open /ride?relay=http://localhost:8787, note the 6 digit code
bun scripts/ride-sim.ts --code 123456                                              # fake phone
```

`scripts/ride-sim.ts` options: `--profile steady|intervals|hills`, `--cad`, `--hr-rest`, `--hr-max`, `--mass`, `--rate`, `--relay <url>`, `--cookie '<JoyoRogo session cookie header>'` (a real relay with a real account instead of the fake sign-in), `--no-keys`, `--exit-on-sum`. Keys: `+`/`-` gear, space coast, `p` pause, `l` lap, `q` stop, Ctrl-C quit.

Tests: `bun test src/features/ride src/features/record` (protocol, physics, session with a fake socket and clock, recorder and save with the game's summary), `cd server && bunx vitest run test/ride.test.ts` (rooms, tokens, relay, hand-back, abuse, rate limits, expiry, eviction and hibernation).

## Testing against a deployed Worker

The relay shares `joyofit-api`'s config, so `wrangler deploy --name <other>` would also copy the cron triggers (family alert emails would go out twice) and the production D1 binding. Do not deploy a preview of this Worker as it is. Either run `wrangler dev` (as above), or add a trimmed config for a preview (no `triggers`, no `routes`, a throwaway D1 id) before deploying it to a `*.workers.dev` name. A production deploy of the relay is a normal `wrangler deploy` of `server/` and needs the owner's OK.

## Not done, on purpose

- No in-app QR scanner: `expo-camera` is not installed and adding it is a native change. The phone's own camera app opens the deep link.
- No resume of a room after the app was killed (the recording itself is restored by the recorder's journal; the room has to be joined again with a fresh code).
- The measured power of a real meter is streamed (`pwr`) and the game can use it, but the phone does not record the game's estimate as power.
