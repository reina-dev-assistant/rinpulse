#!/usr/bin/env bash
# Set the launch-time update gate (docs/force-update.md): the lowest native build allowed to run, per platform.
#
#   scripts/app-min-build.sh show                       what the live server hands out
#   scripts/app-min-build.sh android 1470409            block Android builds below 1470409
#   scripts/app-min-build.sh ios 57 --latest 60         block iOS below 57, banner below 60
#   scripts/app-min-build.sh android 0                  gate off again
#   scripts/app-min-build.sh message "Ada perbaikan penting, update dulu ya."   owner text on the blocking screen ("" = app copy)
#   scripts/app-min-build.sh android-url https://play.google.com/store/apps/details?id=com.joyodigitama.joyofit
#
# Build = Android versionCode / iOS CFBundleVersion. Writes to the remote D1 `joyofit` (table app_config); takes effect within
# about a minute (edge cache) and on the next app launch or resume. Add --local to write the local dev database instead.
set -euo pipefail
cd "$(dirname "$0")/../server"

target=--remote
args=()
for a in "$@"; do if [ "$a" = --local ]; then target=--local; else args+=("$a"); fi; done
set -- "${args[@]}"

sql_str() { printf "'%s'" "${1//\'/\'\'}"; }
put() { bunx wrangler d1 execute joyofit "$target" --command "INSERT INTO app_config (key, value, updated_at) VALUES ($(sql_str "$1"), $(sql_str "$2"), unixepoch() * 1000) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"; }
del() { bunx wrangler d1 execute joyofit "$target" --command "DELETE FROM app_config WHERE key = $(sql_str "$1")"; }

case "${1:-}" in
  show)
    curl -fsS https://api.fit.joyorogo.com/v1/app-config | jq .
    ;;
  android|ios)
    platform=$1
    [[ "${2:-}" =~ ^[0-9]+$ ]] || { echo "usage: $0 $platform <minBuild> [--latest <build>]" >&2; exit 2; }
    put "${platform}_min_build" "$2"
    if [ "${3:-}" = --latest ]; then
      [[ "${4:-}" =~ ^[0-9]+$ ]] || { echo "--latest needs a build number" >&2; exit 2; }
      put "${platform}_latest_build" "$4"
    fi
    ;;
  android-url | ios-url)
    [ -n "${2:-}" ] || { echo "usage: $0 $1 <https url>" >&2; exit 2; }
    put "${1%-url}_store_url" "$2"
    ;;
  message)
    if [ -z "${2:-}" ]; then del message; else put message "$2"; fi
    ;;
  *)
    sed -n 2,14p "$0" >&2
    exit 2
    ;;
esac
