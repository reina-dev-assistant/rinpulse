# TestFlight feedback

Testers send feedback from the TestFlight app (Send Beta Feedback, or a screenshot then Share Beta Feedback) and report a crash right after it happens. It lands in App Store Connect, TestFlight tab, Feedback: Screenshots and Crashes. `scripts/testflight-feedback.ts` pulls it through the App Store Connect API and files it in Atur.

## What Apple does and does not give us

- There is no reply channel: neither TestFlight nor App Store Connect can answer a piece of feedback (checked in Apple's "View tester feedback" and "Beta tester feedback" help pages, 2026-10-21). Only a tester's **email** lets us write back, outside TestFlight.
- A tester invited **by email** shows their address in the feedback. A tester who joined through a **public link** (JoyoFit's testers do, `inviteType: PUBLIC_LINK`) is "Anonymous" unless they typed an email on that one submission; the address is then attached to that submission only (the same tester can send three items with it and others without). So a reply is possible only when the email is there, and never by looking the tester up.
- Crash reports stay downloadable for 120 days. Screenshot URLs from the API carry an `expirationDate` (2026-10-28 for the items sent 10-16 to 10-19), which is why the script downloads them.
- App Store Connect can also push each new feedback to a web server (Manage webhooks): an alternative to polling if a public endpoint is ever wanted.
- Crash logs are symbolicated only when the build's symbols reached Apple. Until 2026-10-21 `uploadSymbols` was off, so reports came back with bare `0x... + offset` frames. The export now uploads symbols and the **Release iOS** run keeps the dSYMs as the artifact `joyofit-ios-dsyms-<run number>` (30 days). To symbolicate by hand: `llvm-symbolizer --obj=<dSYM>/Contents/Resources/DWARF/JoyoFit --demangle 0x<vmaddr + offset>` (vmaddr is 0x100000000 for the main binary; the offset is the number after `+` in the frame).

## The script

```
bun scripts/testflight-feedback.ts --app 6823324343 --name joyofit  --repo dzulfikar08/joyofit --atur --project <Atur project id>
bun scripts/testflight-feedback.ts --app 6823222101 --name joyorogo --repo dzulfikar08/joyorogo --atur --project <Atur project id>
```

JoyoFit is ASC app `6823324343`, JoyoRogo `6823222101`. Both are tracked in the Atur project JRG (`b00a31c6-cf01-400d-a0a5-4d8349e5c0df`, workspace `joyodigitama`).

- Saves under `--out` (default `./tf-feedback/<name>`): `submissions.json` (the raw API objects), `items.json` (flattened), `screenshots/<id>-<n>.jpg`, `crashlogs/<id>.crash`, `state.json`.
- **New** means an id not in `state.json` (ASC ids are opaque, not ordered). The first run has no state: without `--since` it is a baseline (everything recorded as seen, nothing filed); with `--since <ISO date>` (or `TF_FEEDBACK_SINCE`) items created at or after it are new. `--all` ignores the state.
- Prints a summary per new item (tester, build and its commit, device, comment, crash head or screenshot paths). `--repo` maps `CFBundleVersion` (`YYYYMMDDHHMM` UTC) to the **Release iOS** run that made it, hence its commit; builds made locally have none.
- `--atur` files one Atur issue per new item, state Todo, titled `[TestFlight] <app>: <comment> (<submission id>)`. The id in the title is searched before creating, so losing the state file never files twice. `--dry` prints instead of writing anything.
- Auth. ASC: `ASC_KEY_ID` (default `BUU2CPKLGM`), `ASC_ISSUER_ID` (default the team issuer) and the key as `ASC_KEY_P8` (PEM), `ASC_KEY_P8_BASE64`, or `ASC_KEY_PATH` (default `~/Downloads/AuthKey_<id>.p8`). Atur: `ATUR_API_KEY`, else `ATUR_API_KEY_FILE`, else `~/.config/atur/crew-api-key`; `ATUR_BASE_URL` defaults to `https://app.diatur.com`.
- Tests: `bun test scripts/testflight-feedback.test.ts` (new-item selection, build to commit, issue titles).

## Running it daily

**Local (works today).** A user timer on the machine that has the keys:

```
# ~/.config/systemd/user/testflight-feedback.service
[Service]
Type=oneshot
WorkingDirectory=%h/Documents/JoyoDigitama/watch-fit
ExecStart=/usr/bin/env bun scripts/testflight-feedback.ts --app 6823324343 --name joyofit  --out %h/.local/state/testflight-feedback/joyofit  --repo dzulfikar08/joyofit  --atur --project b00a31c6-cf01-400d-a0a5-4d8349e5c0df
ExecStart=/usr/bin/env bun scripts/testflight-feedback.ts --app 6823222101 --name joyorogo --out %h/.local/state/testflight-feedback/joyorogo --repo dzulfikar08/joyorogo --atur --project b00a31c6-cf01-400d-a0a5-4d8349e5c0df

# ~/.config/systemd/user/testflight-feedback.timer
[Timer]
OnCalendar=*-*-* 08:00:00
Persistent=true
[Install]
WantedBy=timers.target
```

`systemctl --user enable --now testflight-feedback.timer`. `gh` must be logged in for `--repo`. The state files live in the `--out` dirs, so nothing is filed twice.

**GitHub Actions (installed).** `.github/workflows/testflight-feedback.yml` runs daily at 01:00 UTC (08:00 WIB) and on `workflow_dispatch`, for JoyoFit and JoyoRogo, filing into Atur project JRG. It uses the `feedback` environment of `dzulfikar08/joyofit` (no required reviewers, unlike `release`) with the secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_BASE64` and `ATUR_API_KEY`.

- State: the seen ids (`joyofit/state.json`, `joyorogo/state.json`) live on the `feedback-state` branch, which the job checks out into `tf-feedback/` and pushes back after each run. A branch, not `actions/cache`, because a cache can be evicted and then the next run would be a silent baseline. It was seeded from the 13 items already triaged, so the first run files nothing for them. The Atur title search still prevents duplicates if the state is lost.
- JoyoRogo runs without `--repo`: the job token cannot read the joyorogo repo's runs, so its builds are not mapped to commits.
- The ASC secrets currently hold the build key (`BUU2CPKLGM`). A dedicated, narrower key (App Store Connect, Users and Access, Integrations, role Developer or App Manager) is recommended later, so it can be revoked on its own; then reset `ASC_KEY_ID`/`ASC_KEY_BASE64` in the `feedback` environment.
