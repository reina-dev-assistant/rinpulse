#!/usr/bin/env bash
# Publish an over-the-air JS update (EAS Update, expo-updates) for JoyoFit. Policy and rollback: docs/ota.md.
#
#   scripts/ota.sh "Fix the workout list header on small phones"     production, android + ios
#   scripts/ota.sh --platform ios "Copy fix"                         one platform only
#   scripts/ota.sh --channel preview "Try the new notice"            preview channel (needs a binary built for it)
#   scripts/ota.sh --runtime                                         print the runtimeVersion of this commit, publish nothing
#   scripts/ota.sh --platform android --runtime-version <hash> "Copy fix"
#                                                                    target the runtimeVersion a binary really carries (see below)
#
# Steps: translation key parity + no hard-coded UI text (scripts/i18n-check.ts), typecheck + unit tests, then a release `expo export` (bundle sanity checks), then `eas update` with that
# bundle. Prints the update group id. Nothing is uploaded to a store.
#
# JS and asset changes only. A change that touches native code (modules/, plugins/), native config (app.json,
# permissions, entitlements), a native dependency or the lockfile changes the fingerprint runtimeVersion: the update
# would then target a runtimeVersion that no installed binary has, so nobody receives it. Ship a new binary for those
# (docs/ota.md "When OTA is not enough").
#
# --runtime-version: the Gradle build computes the fingerprint while it runs (generated files in the module and app
# directories already exist), so a store build can carry a runtimeVersion that `--runtime` (computed on a clean tree) does not
# print, and an update for the printed one then reaches nobody. Read what the installed binary carries (Android:
# `unzip -p base.apk assets/fingerprint`; Settings, About, Quick updates shows its first 8 characters) and pass it here
# (one platform). docs/ota.md "When the printed runtime does not match the installed one".
#
# Needs: bun, jq and an EAS login (`bunx eas-cli login`, owner dzulfikar08) or EXPO_TOKEN. EAS Update code signing needs a paid EAS plan the account
# does not have, so updates are unsigned.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
EAS=(bunx "eas-cli@${EAS_CLI_VERSION:-25.1.1}")

usage() { sed -n '2,9p' "$0" >&2; exit 2; }

channel=production platform=all message= runtime_only=0 runtime_override=
while [ $# -gt 0 ]; do
  case $1 in
    --channel) channel=${2:?--channel needs production or preview}; shift ;;
    --platform) platform=${2:?--platform needs android, ios or all}; shift ;;
    --runtime) runtime_only=1 ;;
    --runtime-version) runtime_override=${2:?--runtime-version needs the hash of the installed binary}; shift ;;
    -h|--help) usage ;;
    --) shift; message=${message:+$message }$*; break ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) message=${message:+$message }$1 ;;
  esac
  shift
done
[ "$runtime_only" = 1 ] || [ -n "$message" ] || { echo "an update message is required" >&2; usage; }
case $channel in production|preview) ;; *) echo "channel must be production or preview" >&2; exit 2 ;; esac
case $platform in android|ios|all) ;; *) echo "platform must be android, ios or all" >&2; exit 2 ;; esac
[ -z "$runtime_override" ] || [ "$platform" != all ] || { echo "--runtime-version needs --platform android or ios (the hash is per platform)" >&2; exit 2; }
[ -z "$runtime_override" ] || [[ $runtime_override =~ ^[0-9a-f]{40}$ ]] || { echo "--runtime-version must be the 40-character hash" >&2; exit 2; }
command -v jq > /dev/null || { echo "jq is required" >&2; exit 1; }

step() { printf '\n== %s ==\n' "$*"; }
fail() { echo "ota: $*" >&2; exit 1; }

if [ "$runtime_only" = 1 ]; then
  for p in android ios; do
    [ "$platform" = all ] || [ "$platform" = "$p" ] || continue
    echo "$p  $(bunx expo-updates runtimeversion:resolve --platform "$p" | tail -n 1 | jq -r .runtimeVersion)"
  done
  exit 0
fi

step "1. checks"
bun scripts/i18n-check.ts
bunx tsrs --noEmit
bun test ./src/

# The store builds bake nothing in from the environment (cloud and API URLs live in app.json extra). A stray
# EXPO_PUBLIC_* variable on this machine must not leak into the published bundle.
unset EXPO_PUBLIC_JOYOROGO_URL EXPO_PUBLIC_JOYOFIT_CLOUD_URL EXPO_PUBLIC_FB_APP_ID
export NODE_ENV=production

publish() {
  local p=$1 out=$ROOT/dist/ota-$1 json
  json=$(mktemp)

  step "2. $p: export"
  rm -rf "$out"
  bunx expo export --clear --platform "$p" --output-dir "$out" > /dev/null
  local bundle
  bundle=$(find "$out/_expo/static/js/$p" \( -name '*.hbc' -o -name '*.js' \) | head -n 1)
  [ -f "$bundle" ] || fail "$p: no JS bundle in $out"
  # Metro with a bad cache can bundle without the app's routes and say nothing; the API default is in app code.
  LC_ALL=C grep -aqF 'https://api.joyorogo.com' "$bundle" || fail "$p: bundle holds no app code"
  echo "   bundle $(basename "$bundle") $(stat -c %s "$bundle") bytes, app code present"

  local runtime=$runtime_override
  if [ -z "$runtime" ]; then
    runtime=$(bunx expo-updates runtimeversion:resolve --platform "$p" | tail -n 1 | jq -r .runtimeVersion)
    [ -n "$runtime" ] && [ "$runtime" != null ] || fail "$p: runtimeVersion did not resolve"
  fi

  step "3. $p: eas update --channel $channel (runtimeVersion $runtime)"
  if [ -n "$runtime_override" ]; then
    # eas-cli takes the runtimeVersion from the app config: pin it for this one call with a throw-away dynamic config.
    [ ! -e app.config.js ] || fail "app.config.js exists; remove it before using --runtime-version"
    printf 'module.exports = ({ config }) => ({ ...config, runtimeVersion: process.env.OTA_RUNTIME_VERSION });\n' > app.config.js
    trap 'rm -f "$ROOT/app.config.js"' EXIT
    export OTA_RUNTIME_VERSION=$runtime
  fi
  "${EAS[@]}" update --channel "$channel" --platform "$p" --message "$message" \
    --skip-bundler --input-dir "$out" --environment "$channel" \
    --non-interactive --json > "$json"
  local group
  rm -f "$ROOT/app.config.js"
  group=$(jq -r '[.[]? | .group] | map(select(. != null)) | .[0] // empty' "$json")
  [ -n "$group" ] || { cat "$json" >&2; fail "$p: eas update printed no update group id"; }
  rm -f "$json"
  RESULTS+=("$p  channel=$channel  runtimeVersion=$runtime  group=$group")
}

RESULTS=()
if [ "$platform" = all ]; then
  publish android
  publish ios
else
  publish "$platform"
fi

step "published"
printf '%s\n' "${RESULTS[@]}"
echo "view:     bunx eas-cli update:view <group>   (dashboard: https://expo.dev/accounts/dzulfikar08/projects/joyofit/updates)"
echo "rollback: bunx eas-cli update:rollback <group> --non-interactive   (the group must be the latest of its runtimeVersion; docs/ota.md)"
