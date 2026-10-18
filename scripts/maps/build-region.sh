#!/usr/bin/env bash
# Build one offline map region: OSM extract -> Planetiler (OpenMapTiles profile) -> MBTiles -> PMTiles (+ index fragment).
#
#   scripts/maps/build-region.sh [options] <region-id>
#
#   --work DIR       scratch (JDK/jar/extract caches excluded: see --tools); default $MAPS_WORK or /run/media/dzul/ioswork/maps-work
#   --out DIR        output; default $MAPS_OUT or /run/media/dzul/ioswork/maps-out
#   --tools DIR      JDK, planetiler.jar, pmtiles CLI; default $MAPS_TOOLS or /run/media/dzul/ioswork/tools
#   --version V      YYYYMMDD; default today (build date)
#   --clean          afterwards delete this region's scratch (the .mbtiles and Planetiler temp); the extract and aux data stay for the next region
#   --purge          --clean, and also delete the extract and the Planetiler aux data under --work
#   --min-free-gb N  stop before building when less than N GB is free under --work (default 6)
#   --list           print the region ids and exit
#
# Env: MAPS_THREADS (default 3), MAPS_XMX (default 4g), MAPS_BASE_URL (public base of the bucket).
# Heavy steps run through ~/.local/bin/lowprio when it exists. Nothing is ever deleted outside --work.
# Output: <out>/<id>-<version>.pmtiles, <out>/<id>.region.json (one fragment) and <out>/index.json (all fragments merged).
#
# Layers: the app style (src/features/map/palette.ts `maplibreStyle`) reads the source-layers landcover, landuse, park,
# water, waterway, aeroway, building, transportation and boundary, and nothing else (no labels: no glyphs are hosted).
# The layers listed in regions.json `profile.excludeLayers` (poi, housenumber, place, mountain_peak, aerodrome_label,
# transportation_name, water_name) are never read by that style, so they only cost bytes; Planetiler drops them
# with --exclude-layers. Keep that list in step with the style when it starts drawing labels.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGIONS_JSON="$SCRIPT_DIR/regions.json"

PLANETILER_VERSION="0.10.2"
PMTILES_VERSION="1.31.2"
JDK_URL="https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
PLANETILER_URL="https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar"
PMTILES_URL="https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz"
GEOFABRIK="https://download.geofabrik.de"
BASE_URL="${MAPS_BASE_URL:-https://maps.fit.joyorogo.com}"

WORK="${MAPS_WORK:-/run/media/dzul/ioswork/maps-work}"
OUT="${MAPS_OUT:-/run/media/dzul/ioswork/maps-out}"
TOOLS="${MAPS_TOOLS:-/run/media/dzul/ioswork/tools}"
THREADS="${MAPS_THREADS:-3}"
XMX="${MAPS_XMX:-4g}"
VERSION="$(date +%Y%m%d)"
CLEAN=0
PURGE=0
MIN_FREE_GB=6
REGION=""

die() { echo "build-region: $*" >&2; exit 1; }
log() { echo "[$(date +%H:%M:%S)] $*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --work) WORK="${2:?--work needs a directory}"; shift 2 ;;
    --out) OUT="${2:?--out needs a directory}"; shift 2 ;;
    --tools) TOOLS="${2:?--tools needs a directory}"; shift 2 ;;
    --version) VERSION="${2:?--version needs YYYYMMDD}"; shift 2 ;;
    --clean) CLEAN=1; shift ;;
    --purge) PURGE=1; shift ;;
    --min-free-gb) MIN_FREE_GB="${2:?--min-free-gb needs a number}"; shift 2 ;;
    --list) command -v jq >/dev/null || die "jq is required"; jq -r '.regions[].id' "$REGIONS_JSON"; exit 0 ;;
    -h|--help) sed -n '2,/^set -/p' "${BASH_SOURCE[0]}" | grep '^#' | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$REGION" ] || die "one region id only"; REGION="$1"; shift ;;
  esac
done

[ -n "$REGION" ] || die "usage: build-region.sh [options] <region-id> (see --list)"
case "$VERSION" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;; *) die "--version must be YYYYMMDD" ;; esac
case "$REGION" in *[!a-z0-9-]*|'') die "region id must be [a-z0-9-]+" ;; esac
for tool in jq curl tar sha256sum stat; do command -v "$tool" >/dev/null || die "$tool is required"; done

jq -e --arg id "$REGION" '.regions[] | select(.id == $id)' "$REGIONS_JSON" >/dev/null || die "region '$REGION' not in regions.json (try --list)"
region_field() { jq -r --arg id "$REGION" ".regions[] | select(.id == \$id) | $1" "$REGIONS_JSON"; }
BBOX="$(region_field '.bbox | map(tostring) | join(",")')"
EXTRACT_PATH="$(region_field '.geofabrik')"
MINZOOM="$(jq -r '.profile.minzoom' "$REGIONS_JSON")"
MAXZOOM="$(jq -r '.profile.maxzoom' "$REGIONS_JSON")"
EXCLUDE="$(jq -r '.profile.excludeLayers | join(",")' "$REGIONS_JSON")"

LOWPRIO=()
[ -x "$HOME/.local/bin/lowprio" ] && LOWPRIO=("$HOME/.local/bin/lowprio")

# Only ever delete inside $WORK, and only paths this script made.
safe_rm_in_work() {
  local target="$1"
  case "$target" in "$WORK"/?*) rm -rf -- "$target" ;; *) die "refusing to delete outside the work dir: $target" ;; esac
}

mkdir -p "$WORK" "$OUT" "$TOOLS/dl"
WORK="$(cd "$WORK" && pwd)"
OUT="$(cd "$OUT" && pwd)"
TOOLS="$(cd "$TOOLS" && pwd)"

fetch() { # url dest : resumable, atomic, quiet progress
  local url="$1" dest="$2"
  curl -fL --retry 3 --retry-delay 5 -C - -sS -o "$dest.part" "$url"
  mv -f -- "$dest.part" "$dest"
}

# --- tools --------------------------------------------------------------------------------------------------------
JAVA="$TOOLS/jdk-21/bin/java"
if [ ! -x "$JAVA" ]; then
  log "downloading Temurin JDK 21"
  fetch "$JDK_URL" "$TOOLS/dl/jdk21.tar.gz"
  mkdir -p "$TOOLS/jdk-21"
  tar xzf "$TOOLS/dl/jdk21.tar.gz" -C "$TOOLS/jdk-21" --strip-components=1
fi
JAR="$TOOLS/planetiler-${PLANETILER_VERSION}.jar"
if [ ! -f "$JAR" ]; then
  log "downloading Planetiler $PLANETILER_VERSION"
  fetch "$PLANETILER_URL" "$JAR"
  want="$(curl -fsSL "$PLANETILER_URL.sha256" | awk '{print $1}')"
  got="$(sha256sum "$JAR" | awk '{print $1}')"
  if [ "$want" != "$got" ]; then rm -f -- "$JAR"; die "planetiler.jar checksum mismatch"; fi
fi
PMTILES="$TOOLS/bin/pmtiles"
if [ ! -x "$PMTILES" ]; then
  log "downloading pmtiles CLI $PMTILES_VERSION"
  mkdir -p "$TOOLS/bin"
  fetch "$PMTILES_URL" "$TOOLS/dl/pmtiles.tgz"
  tar xzf "$TOOLS/dl/pmtiles.tgz" -C "$TOOLS/bin" pmtiles
fi

# --- extract ------------------------------------------------------------------------------------------------------
# Geofabrik's `-latest` URL is a 307 to the dated file, and a ranged (resumed) request through that redirect hangs, so the
# redirect is resolved once and the dated file is what is downloaded and cached.
EXTRACT_NAME="$(basename "$EXTRACT_PATH")"
EXTRACT_DIR="$WORK/extracts"
mkdir -p "$EXTRACT_DIR"
LATEST_URL="$GEOFABRIK/$EXTRACT_PATH-latest.osm.pbf"
DATED_URL="$(curl -fsSI "$LATEST_URL" | tr -d '\r' | awk 'tolower($1) == "location:" {print $2}' | head -n 1)"
[ -n "$DATED_URL" ] || DATED_URL="$LATEST_URL"
PBF="$EXTRACT_DIR/$(basename "$DATED_URL")"
if [ ! -f "$PBF" ]; then
  log "downloading $DATED_URL"
  fetch "$DATED_URL" "$PBF"
  md5_want="$(curl -fsSL "$DATED_URL.md5" | awk '{print $1}' || true)"
  md5_got="$(md5sum "$PBF" | awk '{print $1}')"
  if [ -n "$md5_want" ] && [ "$md5_want" != "$md5_got" ]; then
    rm -f -- "$PBF"
    die "extract md5 mismatch for $DATED_URL"
  fi
fi

# --- planetiler ---------------------------------------------------------------------------------------------------
# Planetiler's temp files and the MBTiles can take a few GB: stop before the disk gets tight, not in the middle of a build.
free_gb="$(df -Pk "$WORK" | awk 'NR == 2 {printf "%d", $4 / 1048576}')"
[ "$free_gb" -ge "$MIN_FREE_GB" ] || die "only ${free_gb} GB free under $WORK, need at least $MIN_FREE_GB (--min-free-gb)"
REGION_WORK="$WORK/build-$REGION"
MBTILES="$REGION_WORK/$REGION.mbtiles"
mkdir -p "$REGION_WORK/tmp" "$WORK/sources"
rm -f -- "$MBTILES"

log "planetiler: $REGION bounds=$BBOX z$MINZOOM-$MAXZOOM extract=$EXTRACT_NAME threads=$THREADS Xmx=$XMX"
START="$(date +%s)"
# --download fetches the ocean polygons and Natural Earth (not the OSM file: --osm-path is given). They are cached in
# $WORK/sources, so a second region does not fetch them again.
# Peak resident memory (VmHWM of the java process, includes mmap'd temp files) sampled every 2 s: this machine has no
# /usr/bin/time. Written to $REGION_WORK/peak-rss-kb.txt.
sample_peak_rss() {
  local peak=0 pid kb
  while sleep 2; do
    pid="$(pgrep -f -- "--output=$MBTILES" | head -n 1 || true)"
    [ -n "$pid" ] || continue
    kb="$(awk '/^VmHWM:/ {print $2}' "/proc/$pid/status" 2>/dev/null || true)"
    if [ -n "$kb" ] && [ "$kb" -gt "$peak" ]; then peak="$kb"; echo "$peak" > "$REGION_WORK/peak-rss-kb.txt"; fi
  done
}
echo 0 > "$REGION_WORK/peak-rss-kb.txt"
sample_peak_rss & SAMPLER=$!
trap 'kill "$SAMPLER" 2>/dev/null || true' EXIT

"${LOWPRIO[@]}" "$JAVA" "-Xmx$XMX" -jar "$JAR" \
  --osm-path="$PBF" \
  --output="$MBTILES" \
  --bounds="$BBOX" \
  --minzoom="$MINZOOM" --maxzoom="$MAXZOOM" \
  --exclude-layers="$EXCLUDE" \
  --download --download-dir="$WORK/sources" \
  --tmpdir="$REGION_WORK/tmp" \
  --threads="$THREADS" \
  --force 2>&1 | tee "$REGION_WORK/planetiler.log" >&2 || die "planetiler failed (see $REGION_WORK/planetiler.log)"
kill "$SAMPLER" 2>/dev/null || true
PLANETILER_SECONDS=$(( $(date +%s) - START ))
log "planetiler finished in ${PLANETILER_SECONDS}s"
[ -f "$MBTILES" ] || die "planetiler produced no MBTiles"

# --- pmtiles ------------------------------------------------------------------------------------------------------
FINAL="$OUT/$REGION-$VERSION.pmtiles"
rm -f -- "$FINAL.part"
"${LOWPRIO[@]}" "$PMTILES" convert "$MBTILES" "$FINAL.part"
"$PMTILES" verify "$FINAL.part" >&2 || { rm -f -- "$FINAL.part"; die "pmtiles verify failed"; }
mv -f -- "$FINAL.part" "$FINAL"

BYTES="$(stat -c %s "$FINAL")"
SHA256="$(sha256sum "$FINAL" | awk '{print $1}')"
log "wrote $FINAL ($BYTES bytes, sha256 $SHA256)"

# --- index fragment + merged index.json ---------------------------------------------------------------------------
jq -n \
  --arg id "$REGION" --arg version "$VERSION" --arg sha "$SHA256" --arg url "$BASE_URL/$REGION-$VERSION.pmtiles" \
  --argjson bytes "$BYTES" --argjson seconds "$PLANETILER_SECONDS" \
  --argjson region "$(jq --arg id "$REGION" '.regions[] | select(.id == $id) | {name, bbox}' "$REGIONS_JSON")" \
  '{id: $id, name: $region.name, bbox: $region.bbox, bytes: $bytes, version: $version, sha256: $sha, url: $url}' \
  > "$OUT/$REGION.region.json.part"
mv -f -- "$OUT/$REGION.region.json.part" "$OUT/$REGION.region.json"

jq -s \
  --argjson meta "$(jq '{attribution, licenseUrl}' "$REGIONS_JSON")" \
  '{version: 1, attribution: $meta.attribution, licenseUrl: $meta.licenseUrl, regions: (sort_by(.id))}' \
  "$OUT"/*.region.json > "$OUT/index.json.part"
mv -f -- "$OUT/index.json.part" "$OUT/index.json"

# Stats the lead asked for.
{
  echo "region=$REGION version=$VERSION bytes=$BYTES sha256=$SHA256 planetiler_seconds=$PLANETILER_SECONDS"
  echo "peak_rss_kb=$(cat "$REGION_WORK/peak-rss-kb.txt" 2>/dev/null || echo unknown)"
} | tee "$OUT/$REGION-$VERSION.stats.txt" >&2

if [ "$CLEAN" = 1 ] || [ "$PURGE" = 1 ]; then
  log "cleaning this region's scratch under $WORK"
  safe_rm_in_work "$REGION_WORK"
fi
if [ "$PURGE" = 1 ]; then
  log "purging the extract and the Planetiler aux data under $WORK"
  safe_rm_in_work "$EXTRACT_DIR"
  safe_rm_in_work "$WORK/sources"
fi
log "done: $FINAL"
