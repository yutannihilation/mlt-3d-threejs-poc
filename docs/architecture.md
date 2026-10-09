# Architecture

## Modules

| Module                                | Role                                                                                          | Pure?            |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------- |
| [`main.ts`](../src/main.ts)           | Creates the map, the panel and the layer; turns mouse moves into picks.                       | no               |
| [`layer.ts`](../src/layer.ts)         | `LinesLayer`, the MapLibre custom layer: tile scheduling and cache, the draw and pick passes. | no               |
| [`tile.ts`](../src/tile.ts)           | Fetches a tile and decodes it into a `LineTile`.                                              | decode is        |
| [`lines.ts`](../src/lines.ts)         | Expands a layer's offsets into one line id per vertex.                                        | yes              |
| [`transform.ts`](../src/transform.ts) | The per-tile `TileFrame` uniforms, and the pick matrix.                                       | yes              |
| [`style.ts`](../src/style.ts)         | The altitude ramp, and the per-line style texels from a property column.                      | yes              |
| [`pick-id.ts`](../src/pick-id.ts)     | Encodes and decodes the 32-bit pick id.                                                       | yes              |
| [`gpu.ts`](../src/gpu.ts)             | Builds the Three.js geometry, textures and materials.                                         | no               |
| [`shaders.ts`](../src/shaders.ts)     | The GLSL ES 3.00 sources.                                                                     | —                |
| [`ui.ts`](../src/ui.ts)               | The panel, the legend and the tooltip text.                                                   | `describeHit` is |

Everything that computes something from data is a pure function with a unit test; the Three.js and MapLibre
code only wires the results to the GPU.

## Hosting: a MapLibre custom layer

`LinesLayer` implements MapLibre's `CustomLayerInterface` with `renderingMode: "3d"`, so it draws into the
map's own WebGL2 context, between the basemap's layers, sharing its depth buffer.

- **`onAdd`** creates a `THREE.WebGLRenderer` over MapLibre's canvas and context, with `autoClear` off so it
  does not erase the basemap. Colour management is off and the output colour space linear, so 8-bit colours
  reach the framebuffer untouched. It also builds what every tile shares: the altitude ramp texture and the
  size of one metre in Mercator units at the equator (`MercatorCoordinate.fromLngLat([0, 0], 1).z`).
- **`render`** is called by MapLibre every frame; see below.
- **`onRemove`** disposes every tile's GPU resources, the pick target and the ramp.

The camera is a plain `THREE.Camera` whose projection is the identity (or the pick matrix, see
[Picking](picking.md)): each mesh carries its full model-view-projection matrix in `matrixWorld`. Meshes have
`matrixAutoUpdate`, `matrixWorldAutoUpdate` and `frustumCulled` off, since Three.js would otherwise recompute
the matrix, or cull against a camera that knows nothing of the map.

## A frame

```text
MapLibre render(gl, { defaultProjectionData })
 │
 ├─ tilesToDraw()            covering tiles → loaded tile or nearest loaded ancestor, per world copy
 ├─ matrix per drawn tile    mainMatrix × translate(tile origin + wrap, 0)        (float64, on the CPU)
 ├─ renderer.resetState()    Three.js forgets the GL state it cached; MapLibre has changed it
 ├─ renderPick(x, y)         only if a pick is pending: ids into the 1 × 1 target, readback queued
 └─ renderDraw()             one draw call per drawn tile, into the canvas
```

1. **Which tiles.** `map.coveringTiles` with a tile size of 512 px and the tiles' zoom range (3 to 10) gives
   the ideal tiles for the view; beyond zoom 10 it returns zoom 10 tiles, which are then overzoomed. For each,
   the layer requests it (or bumps it in the LRU), and draws the tile itself if loaded, or else its nearest
   loaded ancestor, so that zooming shows coarser lines rather than holes. An ancestor standing in for several
   children is drawn once. A tile that is empty or failed is not replaced by an ancestor.
2. **Where.** `defaultProjectionData.mainMatrix` maps Web Mercator units (`0 .. 1` across the world) to clip
   space. Each drawn tile gets `mainMatrix × translate(origin.x + wrap, origin.y, 0)`, computed in float64,
   so vertex positions on the GPU are small numbers relative to the tile's corner (see
   [Shaders](shaders.md#precision)). `wrap` is the world copy, for views that cross the antimeridian.
3. **Draw.** The draw material's per-frame uniforms are set (canvas size in CSS pixels, line width, colour
   mode, highlighted line), each tile's mesh for that world copy is added to the scene, and the scene is
   rendered once: one draw call per drawn tile, each an instanced draw of `vertices - 1` quads.

## A tile's life

```text
request ─▶ loading ─▶ fetch ─▶ decodeTileColumns ─▶ lineIds, tileFrame ─▶ upload ─▶ ready ─▶ evicted
                         │ 404/204                   │ throws
                         ▼                           ▼
                       empty                       error
```

- **Fetch and decode** ([`tile.ts`](../src/tile.ts)). A 404 or 204 is an empty tile. Otherwise
  `decodeTileColumns(data, { layers: ["flights"] })` decodes only that layer. The tile must hold exactly one
  such layer (layer names need not be unique) with 3D vertices, or it fails. `lineIds` then walks the
  layer's offsets once through `featureGeometry` (see [GPU data layout](gpu-data.md#line-ids)), and
  `tileFrame` derives the five numbers that place the tile.
- **Upload** ([`gpu.ts`](../src/gpu.ts)). The style texels are computed from the `direction` column, and the
  geometry and the two materials (draw and pick) are built. Three.js uploads the buffers to the GPU at the
  tile's first draw. A tile with fewer than two vertices has no segment and is stored as empty.
- **Meshes.** A tile gets one draw mesh and one pick mesh per world copy it is drawn in, created on first
  use. They share the tile's geometry and materials, so a second world copy costs nothing on the GPU.
- **Eviction.** The cache keeps 256 tiles beyond those in view, least recently requested out first, never one
  still loading. Evicting a ready tile disposes its geometry (freeing the GL buffers), its style texture and
  its materials. The highlight is a feature id, not a tile, so it needs nothing cleared.

Decoding runs on the main thread; see [Limitations](extending.md).

### Materials per tile, programs shared

Each tile has its own `ShaderMaterial`, because its uniforms (the tile frame, its style texture) differ.
Three.js compiles one GL program per distinct shader source, so all draw materials share one program and all
pick materials another; a material is just a set of uniform values. Switching tiles costs uniform uploads,
not program switches.

## Stats

On MapLibre's `idle` event the layer reports the tiles, lines and vertices of the ready covering tiles, which
the panel shows. At the initial view that is 20 tiles, 6,154 lines and 524,764 vertices.

## Development server

`vite.config.ts` sets `appType: "mpa"`. With the SPA default, Vite answers a request for a missing tile with
`index.html` and status 200, which the decoder then rejects as a truncated tile; as an MPA a missing tile is a
404, which is an empty tile. In development, `main.ts` also puts `map` and `lines` on `window` for inspection
from the console.
