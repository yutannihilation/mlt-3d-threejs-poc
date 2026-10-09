# Limitations and next steps

## Not measured

The design removes CPU work and upload volume (see
[GPU data layout](gpu-data.md#byte-accounting)), but frame times, tile preparation times and GPU memory have
not been measured, nor compared with a conventional `LineSegments2` renderer of the same tiles. A fair
comparison renders both at the same URL hash (the camera is kept in it) and records, per tile, the time from response to first draw, and per frame, the GPU time
(`EXT_disjoint_timer_query_webgl2`) of the layer's draw calls.

## Not done

- **Decoding on the main thread.** `decodeTileColumns` and `lineIds` run where the map renders, so a large
  tile can drop frames. Both belong in a worker: decode there, then transfer `vertices.buffer`, the line ids and
  the style texels to the main thread without copying; only the Three.js objects need to be built on the main
  thread. The worker needs its own instance of the WASM module.
- **Line joins and caps.** Segments are independent quads. Joins need the neighbouring vertices: read the
  vertex buffer at four offsets (0, 3, 6, 9 elements) and draw the middle segment `v[i+1] → v[i+2]`, with the
  outer two giving the directions for a miter or a round join. The line ids at the same offsets say whether a
  neighbour belongs to the same line. It stays one buffer, read four times. (The ribbons have round joins,
  but they are tessellated on the CPU; see [Ribbons](ribbons.md).)
- **Ribbons**: tessellation runs on the main thread, about 175 ms when toggling at the initial view, and
  their width is fixed at tessellation. A worker would remove the hitch; simplifying low-zoom lines would cut
  most of the work. See [Ribbons](ribbons.md#cost).
- **One draw call per tile.** At the initial view that is 22 draw calls, which is fine. Many more tiles, or many
  layers, would want tiles packed into shared buffers and drawn with `WEBGL_multi_draw`, or a
  `BatchedMesh`-like scheme, with the tile frame in a texture indexed by the draw id.
- **The quad is built per tile.** Each tile's geometry has its own copy of the 4-corner quad. Sharing one
  `BufferAttribute` between all geometries would share the GL buffer; it is a few dozen bytes per tile.
- **Picking** finds the line, not the position along it, and finds a flight's pieces only in the tiles in
  view; see [Picking](picking.md#limitations).

## Other geometry types

The vertex buffer is the same for every geometry type; what differs is how it is read and the small side
buffers. `geometryStarts` gives, for the whole layer, where each feature's geometries, each geometry's
vertices and each polygon's rings start in the layer's vertex sequence; `featureGeometry` gives one feature's
parts as views with their `firstVertex`. Either turns per-feature results into indices into the shared
buffer.

### Points

An instanced quad per vertex: one attribute at offset 0 of the vertex buffer, `instanceCount` equal to the
vertex count, no break handling. The id buffer holds the feature index per vertex; a `MultiPoint` feature's
points share it. Size in pixels, extruded in screen space as for lines.

### Polygons

- **Fills** are triangles over the same vertex buffer, through an index buffer. For a layer stored with
  outlines, triangulate each polygon of `featureGeometry` with earcut:
  `earcut(polygon.vertices, polygon.holeIndices, 3)` returns indices into the polygon's view; adding
  `polygon.firstVertex` turns them into indices into the layer's buffer. earcut triangulates on `x, y` and
  ignores `z`, so a 3D vertex keeps its altitude. A `TessPolygonsWithOutlines` or `TessPolygons` layer carries
  the triangles already: its `indexBuffer` column is layer-relative and can be uploaded as is.
- **Outlines** are the line case over the rings (`geometryStarts`' `ringVertices`), with one difference: a ring's closing vertex is not stored,
  so the segment from its last vertex back to its first is missing from the consecutive reading. An index
  buffer of segment starts, or a second small draw of the closing segments, adds them.
- **The id buffer** holds the feature index per vertex, for styling and picking.
- Triangulation is CPU work per polygon, and belongs in the worker with the decoding.

### Other styles

The style texture holds any per-feature value the fragment or vertex shader can use: a colour, a width, a
visibility flag. Data-driven expressions that MapLibre evaluates per feature would be evaluated once per tile
into such a texture, and re-evaluated only when the style changes.
