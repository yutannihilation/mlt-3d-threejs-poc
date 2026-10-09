#!/usr/bin/env bash
# Tile a GeoJSON of 3D flight lines into public/tiles/{z}/{x}/{y}.mlt, giving every feature an id.
#
# A flight that crosses several tiles is clipped into a piece per tile; the feature id, which
# every piece keeps, is how the renderer finds them all. `mlt convert` writes a GeoJSON
# feature's `id` as its MLT id, which must be a non-negative integer, so each feature gets its
# position in the file.
#
# Usage: scripts/build-tiles.sh FLIGHTS.geojson
# The mlt CLI is taken from $MLT, or else from a build of the sibling checkout (see README).
# The zoom range and the layer name must match src/shared/config.ts.
set -euo pipefail
input="${1:?usage: scripts/build-tiles.sh FLIGHTS.geojson}"
mlt="${MLT:-../maplibre-tile-spec/rust/target/release/mlt}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
jq -c '.features |= [to_entries[] | .value + {id: .key}]' "$input" > "$work/flights.geojson"

# Without a trailing slash, rm removes a symlink itself, never what it points to.
rm -rf public/tiles
"$mlt" convert \
  --mlt-version 2 \
  --min-zoom 3 \
  --max-zoom 8 \
  --z-step 0 \
  --layer flights \
  --verify \
  "$work/flights.geojson" public/tiles
du -sh public/tiles
