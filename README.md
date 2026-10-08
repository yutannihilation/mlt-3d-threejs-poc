# MLT columns straight to the GPU: a Three.js renderer PoC

A proof of concept for rendering 3D [MapLibre Tiles (MLT)](https://github.com/maplibre/maplibre-tile-spec)
with Three.js on a MapLibre map, built on the columnar decoder of `@maplibre/mlt-wasm`. The question it
answers is how to get decoded tile data onto the GPU with as little work in between as possible.

It renders one data type, 3D lines (a day of flight trails to and from Tokyo Haneda), with two styles, and
picks the line under the cursor on the GPU. A toggle draws the lines as flat ribbons instead, tessellated on
the CPU and drawn by a stock Three.js material, to compare the two paths.

![Flight trails around Tokyo in 3D, coloured by altitude from purple near the ground to yellow at cruise](docs/images/altitude.jpg)

## The idea in brief

`decodeTileColumns` returns a layer as typed arrays. The renderer uploads the decoded `Int32Array` of
`x, y, z` vertices **as is** as the vertex buffer, and does every coordinate conversion in the vertex shader.
Next to it goes one `Uint32Array` of line ids, one per vertex, which separates the lines, indexes a per-line
style texture, and is what picking reads back. Per vertex, the CPU does nothing but write that id.

| Per vertex          | This PoC                         | A conventional Three.js approach (`LineSegments2`)                              |
| ------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| CPU work            | write one line id                | convert to float Mercator, compute altitude and colour, copy into segment pairs |
| Uploaded to the GPU | 16 bytes (12 B position, 4 B id) | 48 bytes (two float positions and two float colours per segment)                |

## Documentation

- [Architecture](docs/architecture.md): the modules, a frame from MapLibre's render call to the draw call,
  and a tile's life from fetch to eviction.
- [GPU data layout](docs/gpu-data.md): the buffers and textures, how one buffer serves as both segment ends,
  integer attributes, and the byte accounting.
- [Shaders](docs/shaders.md): the transform from decoded integers to clip space and its precision, thick
  lines in screen space, and the two colour modes.
- [Picking](docs/picking.md): the one-pixel id render, id encoding, the asynchronous readback, and the
  tooltip.
- [Ribbons](docs/ribbons.md): tessellating lines into flat strips with round joins on the CPU, drawing them
  with a stock material, and what it costs.
- [Limitations and next steps](docs/extending.md): what is not done, and how points, polygons, joins and a
  worker would fit the same pattern.

## Setup

This depends on APIs that are not released: `decodeTileColumns`, `featureGeometry` and `toElevation` of
`@maplibre/mlt-wasm` exist only on the
[`feat/wasm-columnar-3d`](https://github.com/yutannihilation/maplibre-tile-spec/tree/feat/wasm-columnar-3d)
branch of yutannihilation's fork of maplibre-tile-spec. `package.json` links the package from a sibling
checkout of that branch:

```text
repo/
├── maplibre-tile-spec/    the fork, on feat/wasm-columnar-3d
└── mlt-3d-threejs-poc/    this repository
```

Building the package needs Rust with a nightly toolchain, `wasm-pack` and Node.js:

```bash
git clone -b feat/wasm-columnar-3d https://github.com/yutannihilation/maplibre-tile-spec.git
(cd maplibre-tile-spec/rust/mlt-wasm && npm ci && npm run build)
```

### Tiles

The tiles are not in this repository: `public/tiles/{z}/{x}/{y}.mlt` is ignored by git, and can be a directory
or a symlink. They are 3D MLT tiles with one line layer named `flights`, written by the `mlt` CLI of the same
branch:

```bash
cargo build --release --manifest-path maplibre-tile-spec/rust/Cargo.toml -p mlt
maplibre-tile-spec/rust/target/release/mlt convert \
  --mlt-version 2 --min-zoom 3 --max-zoom 10 --z-step 0 --layer flights \
  flights.geojson mlt-3d-threejs-poc/public/tiles
```

The input is GeoJSON of `LineString` or `MultiLineString` features with `[longitude, latitude, altitude_m]`
positions. The tooltip and the direction style read the properties `callsign`, `registration`, `icao`, `type`
and `direction` (`departure`, `arrival` or `local`); any of them may be absent. The zoom range and the layer
name must match [`src/config.ts`](src/config.ts).

### Running

In this repository:

```bash
vp install --force   # --force re-copies the mlt-wasm build after rebuilding it
vp dev
```

There is no CI yet. Building and deploying this on CI will need the same: the branch built, and the tiles.

`vp check` formats, lints and type-checks; `vp test` runs the unit tests of the pure parts: line ids, the tile
frame and pick matrix, pick-id encoding, style texels and the tooltip.

## Data

The screenshots show the flights departing from or arriving at Tokyo Haneda (HND) on 2026-10-03, extracted from
the [adsb.lol](https://www.adsb.lol/) historical data
([`adsblol/globe_history_2026`](https://github.com/adsblol/globe_history_2026), release
`v2026.10.03-planes-readsb-prod-0`), made available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The map credits adsb.lol
and the ODbL in its attribution control.

The basemap is [OpenFreeMap](https://openfreemap.org/) (© [OpenMapTiles](https://www.openmaptiles.org/), data
from [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors).

The test fixture `src/__fixtures__/flights.geojson`, and the tile made from it, are synthetic.
