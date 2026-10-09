# Ribbons: tessellating on the CPU

The panel's "ribbons" toggle draws every line as a flat horizontal strip, 1,500 m wide
([`RIBBON_WIDTH_M`](../src/config.ts)), instead of a screen-space line. It is the counterpart of the
line path: lines keep the decoded vertex buffer and extrude it in our own shader, while ribbons are
tessellated on the CPU into ordinary triangles that a stock Three.js `MeshBasicMaterial` draws, with no
shader of our own.

## Tessellation

[`tessellateRibbons`](../src/ribbon.ts) walks each line through `featureGeometry`, the per-feature view
of the decoded tile, and writes indexed triangles:

- **Sides.** Each point gets a pair of vertices half the width to the left and right of the line.
  Tile coordinates and Mercator units share their axes, so directions and normals are computed on the
  decoded integers, and only the offsets are scaled.
- **Width in metres.** A metre at a point spans `metre × cosh(π (1 − 2y))` Mercator units, `metre` being
  a metre at the equator. The offsets use the point's own factor, so the ribbon is 1,500 m wide at every
  latitude, and the altitude, converted with the same factor, keeps its scale.
- **Joins.** A turn of up to 15° gets one mitred pair, on the bisector and pushed out by
  `1 / cos(turn / 2)` so that both edges keep their width; the two segments share it. A sharper turn
  gets a round join: the incoming and outgoing segments end at their own pairs, and a fan of triangles
  around the point, in steps of at most 15°, fills the outer side. The inner side overlaps, which is
  invisible on an opaque, flat ribbon.
- **Ends** are butt ends. Repeated points (same `x, y`) are skipped, since a segment of no length has no
  direction; a line that collapses to one point makes no ribbon.

The output is final: positions in Mercator units relative to the tile's corner, so the tile's mesh takes
the same matrix as its lines. Next to it, per ribbon vertex, the altitude in metres and the line id, and
per line, where its ribbon vertices start; a line's vertices are contiguous.

## Drawing with stock Three.js

| Attribute  | Type                     | Per ribbon vertex |
| ---------- | ------------------------ | ----------------- |
| `position` | `Float32Array`           | 12 B              |
| `color`    | `Uint8Array`, normalised | 3 B               |
| index      | `Uint32Array`            | 12 B per triangle |

One `MeshBasicMaterial({ vertexColors: true, side: DoubleSide })` draws every tile's ribbons; colour
management is off, so the 8-bit colours reach the screen as computed. The colours are computed on the CPU
([`ribbonColors`](../src/style.ts)): one array from the altitude ramp, one from the per-line style texels.

- **Colour mode** copies the other array into the drawn `color` attribute, uploaded whole.
- **Highlight** paints the hovered feature's ribbon vertices white and restores the previous feature's; a
  feature's lines, and so their ribbon vertices, are contiguous, and with `addUpdateRange` only those two
  ranges are uploaded again.
- **Picking** still uses the line pass ([Picking](picking.md)), so a ribbon is picked within the pick
  radius of its centre line, not across its whole width.

A tile is tessellated the first time it is drawn as ribbons, and kept until it is evicted. Each run is
recorded in the browser's performance timeline as `tessellate z/x/y`.

## Cost

|                                     | Lines                       | Ribbons                                                    |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------- |
| CPU per tile                        | line ids only               | tessellation and colours                                   |
| Initial view, CPU                   | —                           | ≈ 255 ms, in the frame of the toggle (busiest tile 107 ms) |
| Initial view, GPU                   | 524,764 instances of a quad | 1,228,453 triangles                                        |
| Largest tile (z5, 524,482 vertices) | 16 B per vertex             | 1.7 M ribbon vertices, 1.4 M triangles, 58 MB, 117 ms      |

Most source vertices become two ribbon vertices, but sharp turns add a centre and an arc. The tiles hold
every position of the source data at every zoom, and on a low-zoom tile those positions are quantised to
a coarse grid: on the z5 and z8 tiles measured, 41–51 % of segments are shorter than 4 tile units, and the
grid turns about 30 % of all points into turns sharper than 15°, each with a round join. On a z10 tile it is
6 %. Simplifying the lines for each zoom when tiling, which `mlt convert` does not do, would cut both the
tile and the tessellation; so would dropping points closer together than a fraction of the ribbon's width
before tessellating.

## What it shows about the API

The tessellator needed nothing beyond what the line path uses: `featureGeometry` for each line's vertices
and its `firstVertex`, the line ids built from it, and the tile frame. It is the "tessellation that creates
vertices" case of the mlt-wasm README: the decoded vertex buffer is read once and not uploaded, and the
output carries its own line ids.
