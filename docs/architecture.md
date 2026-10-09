# Architecture

## Modules

There are two pages, one per renderer, over the same map, tiles, decoding, styles and panel. This document
is about the Three.js page; the deck.gl page is described in [deck.gl](deckgl.md).

| Module                                              | Role                                                                                          | Pure?            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------- |
| **Shared**                                          |                                                                                               |                  |
| [`shared/map.ts`](../src/shared/map.ts)             | Creates the MapLibre map, with the camera in the URL hash.                                    | no               |
| [`shared/tile.ts`](../src/shared/tile.ts)           | Fetches a tile and decodes it into a `LineTile`, with its feature ids indexed.                | decode is        |
| [`shared/lines.ts`](../src/shared/lines.ts)         | Expands a layer's offsets into one line id per vertex, and where lines and features start.    | yes              |
| [`shared/transform.ts`](../src/shared/transform.ts) | The per-tile `TileFrame`: where a tile is, and its z grid.                                    | yes              |
| [`shared/style.ts`](../src/shared/style.ts)         | The altitude ramp, the per-line style texels, and per-vertex colours.                         | yes              |
| [`shared/hit.ts`](../src/shared/hit.ts)             | A hovered feature's properties and altitude range over its pieces in view.                    | yes              |
| [`shared/ui.ts`](../src/shared/ui.ts)               | The panel, the legend and the tooltip text.                                                   | `describeHit` is |
| **Three.js**                                        |                                                                                               |                  |
| [`threejs/main.ts`](../src/threejs/main.ts)         | Creates the map, the panel and the layer; turns mouse moves into picks.                       | no               |
| [`threejs/layer.ts`](../src/threejs/layer.ts)       | `LinesLayer`, the MapLibre custom layer: tile scheduling and cache, the draw and pick passes. | no               |
| [`threejs/pick.ts`](../src/threejs/pick.ts)         | Encodes and decodes the 32-bit pick id; the pick matrix.                                      | yes              |
| [`threejs/ribbon.ts`](../src/threejs/ribbon.ts)     | Tessellates lines into ribbons ([Ribbons](ribbons.md)).                                       | yes              |
| [`threejs/gpu.ts`](../src/threejs/gpu.ts)           | Builds the Three.js geometry, textures and materials.                                         | no               |
| [`threejs/shaders.ts`](../src/threejs/shaders.ts)   | The GLSL ES 3.00 sources.                                                                     | —                |
| **deck.gl**                                         |                                                                                               |                  |
| [`deckgl/main.ts`](../src/deckgl/main.ts)           | Creates the map, the panel and the deck.gl overlay; the tooltip.                              | no               |
| [`deckgl/layer.ts`](../src/deckgl/layer.ts)         | `FlightsLayer`, a `TileLayer` of one stock `PathLayer` per tile; the highlight.               | no               |
| [`deckgl/tile.ts`](../src/deckgl/tile.ts)           | A tile's placement matrices, per-vertex colours and row indexes.                              | yes              |

Everything that computes something from data is a pure function with a unit test; the Three.js, deck.gl and
MapLibre code only wires the results to the GPU.

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

- **Fetch and decode** ([`tile.ts`](../src/shared/tile.ts)). A 404 or 204 is an empty tile. Otherwise
  `decodeTileColumns(data, { layers: ["flights"] })` decodes only that layer. The tile must hold exactly one
  such layer (layer names need not be unique) with 3D vertices, or it fails. `lineIds` then numbers
  the lines from the starts `geometryStarts` resolves (see [GPU data layout](gpu-data.md#line-ids)), and
  `tileFrame` derives the five numbers that place the tile. A 404 or 204, or a tile with fewer than two
  vertices, which make no segment, is an empty tile (`fetchLineTile` returns `null`, for both pages).
- **Upload** ([`gpu.ts`](../src/threejs/gpu.ts)). The style texels are computed from the `direction` column, and the
  geometry and the two materials (draw and pick) are built. Three.js uploads the buffers to the GPU at the
  tile's first draw.
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
the panel shows. At the initial view that is 22 tiles, 6,259 lines and 528,285 vertices.

## Development server

`vite.config.ts` builds three pages: `index.html`, which links the two, `threejs.html` and `deckgl.html`. It
sets `appType: "mpa"`. With the SPA default, Vite answers a request for a missing tile with `index.html` and
status 200, which the decoder then rejects as a truncated tile; as an MPA a missing tile is a 404, which is an
empty tile. In development, each page's `main.ts` also puts `map` and its layer (`lines`) or overlay
(`overlay`) on `window` for inspection from the console.
