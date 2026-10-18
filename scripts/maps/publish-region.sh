#!/usr/bin/env bash
# Upload built map regions to the R2 bucket. DRY RUN by default: prints exactly what it would run and what it costs.
#
#   scripts/maps/publish-region.sh [--out DIR] [region-id ...]          dry run (all regions in index.json when no id)
#   scripts/maps/publish-region.sh [--out DIR] --yes [region-id ...]    really upload, then verify from the public URL
#
# Uploads <out>/<id>-<version>.pmtiles for each region (the version in <out>/<id>.region.json), then index.json last, so
# the index never points to a file that is not there yet. Uses `wrangler r2 object put --remote`.
# Old versions are never deleted by this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BUCKET="${MAPS_BUCKET:-joyofit-maps}"
PUBLIC_BASE_URL="${MAPS_BASE_URL:-https://maps.fit.joyorogo.com}"
OUT="${MAPS_OUT:-/run/media/dzul/ioswork/maps-out}"
# wrangler is logged into several accounts and fails non-interactively without this.
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-b7e6f8457bd39fa37a7eea5249799754}"

# wrangler: the one on PATH, else the checkout the server uses, else npx.
WRANGLER_LOCAL="$HOME/Documents/JoyoDigitama/watch-fit/server/node_modules/.bin/wrangler"
if command -v wrangler >/dev/null 2>&1; then WRANGLER=(wrangler)
elif [ -x "$WRANGLER_LOCAL" ]; then WRANGLER=("$WRANGLER_LOCAL")
else WRANGLER=(npx wrangler)
fi

# Cloudflare R2 pricing, checked 2026-10-18 (developers.cloudflare.com/r2/pricing): storage $0.015 per GB-month with
# 10 GB-month free; Class A (writes) $4.50 per million with 1 million free; egress free.
STORAGE_USD_PER_GB_MONTH="0.015"
FREE_GB_MONTH="10"
# `wrangler r2 object put` caps a single upload at 300 MiB; bigger files need a multipart S3 client (rclone is installed).
WRANGLER_MAX_BYTES=$((300 * 1024 * 1024))

YES=0
VERIFY_ONLY=0
IDS=()

die() { echo "publish-region: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1; shift ;;
    --verify) VERIFY_ONLY=1; shift ;;
    --out) OUT="${2:?--out needs a directory}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) IDS+=("$1"); shift ;;
  esac
done

command -v jq >/dev/null || die "jq is required"
[ -d "$OUT" ] || die "out dir $OUT does not exist (run build-region.sh first)"
[ -f "$OUT/index.json" ] || die "$OUT/index.json is missing"

if [ ${#IDS[@]} -eq 0 ]; then
  mapfile -t IDS < <(jq -r '.regions[].id' "$OUT/index.json")
fi
[ ${#IDS[@]} -gt 0 ] || die "no regions to publish"

TOTAL=0
UPLOADS=()   # "key|file|content-type|cache-control"
for id in "${IDS[@]}"; do
  case "$id" in *[!a-z0-9-]*|'') die "bad region id '$id'" ;; esac
  frag="$OUT/$id.region.json"
  [ -f "$frag" ] || die "$frag is missing: build $id first"
  version="$(jq -r '.version' "$frag")"
  bytes="$(jq -r '.bytes' "$frag")"
  file="$OUT/$id-$version.pmtiles"
  [ -f "$file" ] || die "$file is missing"
  actual="$(stat -c %s "$file")"
  [ "$actual" = "$bytes" ] || die "$file is $actual bytes, fragment says $bytes: rebuild"
  if [ "$actual" -gt "$WRANGLER_MAX_BYTES" ]; then
    die "$file is $actual bytes, over wrangler's 300 MiB put limit: upload it with a multipart S3 client (rclone) instead"
  fi
  TOTAL=$((TOTAL + actual))
  # Versioned file names never change, so they can be cached forever.
  UPLOADS+=("$id-$version.pmtiles|$file|application/octet-stream|public, max-age=31536000, immutable")
done
UPLOADS+=("index.json|$OUT/index.json|application/json|public, max-age=300")

echo "Bucket:   $BUCKET   (account $CLOUDFLARE_ACCOUNT_ID)"
echo "Base URL: $PUBLIC_BASE_URL   (index at $PUBLIC_BASE_URL/index.json)"
echo "Regions:  ${IDS[*]}"
# index.json replaces the one on the bucket, so it must list every region that is (or is about to be) there.
mapfile -t NOT_SELECTED < <(jq -r --argjson sel "$(printf '%s\n' "${IDS[@]}" | jq -R . | jq -s .)" '.regions[].id | select(. as $id | $sel | index($id) | not)' "$OUT/index.json")
if [ ${#NOT_SELECTED[@]} -gt 0 ]; then
  echo "NOTE: index.json also lists ${NOT_SELECTED[*]}, which this run does not upload: they must already be on the bucket, or the app will offer a download that 404s."
fi
echo
for u in "${UPLOADS[@]}"; do
  IFS='|' read -r key file ctype cache <<< "$u"
  printf '%q ' "${WRANGLER[@]}" r2 object put "$BUCKET/$key" --file "$file" --content-type "$ctype" --cache-control "$cache" --remote
  echo
done
echo

awk -v bytes="$TOTAL" -v rate="$STORAGE_USD_PER_GB_MONTH" -v free="$FREE_GB_MONTH" -v n="${#UPLOADS[@]}" 'BEGIN {
  gb = bytes / 1e9
  billable = gb > free ? gb - free : 0
  printf "Cost: %.3f GB stored (this upload) -> $%.4f / month beyond the %d GB-month free tier", gb, billable * rate, free
  printf " (assumes nothing else is in the bucket; egress is free; %d Class A writes, inside the 1M free)\n", n
}'

if [ "$YES" != 1 ] && [ "$VERIFY_ONLY" != 1 ]; then
  echo
  echo "Dry run: nothing uploaded. Re-run with --yes to upload."
  exit 0
fi

if [ "$VERIFY_ONLY" != 1 ]; then
  [ -n "${WRANGLER[0]}" ] || die "wrangler not found"
  for u in "${UPLOADS[@]}"; do
    IFS='|' read -r key file ctype cache <<< "$u"
    echo "uploading $key" >&2
    "${WRANGLER[@]}" r2 object put "$BUCKET/$key" --file "$file" --content-type "$ctype" --cache-control "$cache" --remote
  done
fi
echo "published to $PUBLIC_BASE_URL; verifying from the public URL" >&2

# Verify what a rider's phone will get: byte ranges work (206 + the right total) and the whole file hashes to the catalog value.
for id in "${IDS[@]}"; do
  frag="$OUT/$id.region.json"
  url="$(jq -r '.url' "$frag")"
  want_bytes="$(jq -r '.bytes' "$frag")"
  want_sha="$(jq -r '.sha256' "$frag")"
  head="$(curl -fsS -D - -o /dev/null -r 0-126 "$url" | tr -d '\r')"
  status="$(printf '%s\n' "$head" | awk 'NR == 1 {print $2}')"
  total="$(printf '%s\n' "$head" | awk 'tolower($1) == "content-range:" {sub(".*/", "", $3); print $3}')"
  [ "$status" = "206" ] || die "$url: Range request answered $status, expected 206"
  [ "$total" = "$want_bytes" ] || die "$url: size on the bucket is $total, expected $want_bytes"
  got_sha="$(curl -fsS "$url" | sha256sum | awk '{print $1}')"
  [ "$got_sha" = "$want_sha" ] || die "$url: sha256 $got_sha differs from $want_sha"
  echo "verified $url (206, $total bytes, sha256 ok)" >&2
done
curl -fsS "$PUBLIC_BASE_URL/index.json" | jq -e '.version == 1' >/dev/null || die "index.json on the bucket is not readable"
echo "index.json readable at $PUBLIC_BASE_URL/index.json" >&2
