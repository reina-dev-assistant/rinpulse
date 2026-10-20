This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Marketing: every user-visible feature gets a release entry

When your change adds or visibly changes something a user can see or use (screen, feature, setting, supported watch,
plan or price, a fix people asked for in public), finish with both steps below. Skip refactors, tests, CI, internal
tooling, docs-only and invisible fixes.

1. Write `docs/marketing/releases/YYYY-MM-DD-<slug>.md` from the template in `docs/marketing/releases/README.md`, one
   file per feature. If the feature already has an entry, update that file (for example `available: code` to
   `test-build`) instead of adding another.
2. Create an atur issue (workspace `joyodigitama`, project Joyorogo `JRG`) titled `[Konten] JoyoFit: <feature>`, state
   Todo, as a sub-issue of JRG-235 (`parent_id` `62fc3334-ca8a-4427-b236-ce1c50b2bc52`), with the entry's angle and
   path, and put its key in the entry's `atur:` field. If atur is unreachable, leave `atur:` empty; the weekly sweep
   files it.

Claims follow the JoyoRogo repo's `docs/marketing/marketing-plan.md` section 1.1 and `docs/marketing/social-playbook.md`
(Huawei, Strava and WHOOP wording rules included). Never call a watch supported unless it is tested, and never call
the app available in the Play Store or App Store before it is.
