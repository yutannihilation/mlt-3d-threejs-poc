# GPU data layout

Per tile, the GPU receives:

| Data              | Type                            | Size                         | Source                                   |
| ----------------- | ------------------------------- | ---------------------------- | ---------------------------------------- |
| Vertex buffer     | `Int32Array`, `x, y, z` triples | 12 B per vertex              | `layer.geometry.vertices`, as decoded    |
| Line ids          | `Uint32Array`                   | 4 B per vertex               | expanded from the offsets, once per tile |
| Quad              | `Float32Array` and indices      | 4 corners, 6 indices         | constant                                 |
| Style texture     | `RGBA8`, 1024 × ⌈lines / 1024⌉  | 4 B per line, at least 4 KiB | the `direction` column, once per tile    |
| Per-tile uniforms | 5 floats                        | —                            | `tileFrame(tile, extent, zStep)`         |

And shared by all tiles, a 256 × 1 `RGBA8` texture of the altitude ramp.

## One buffer, both ends of every segment

A line of `n` vertices has `n - 1` segments, and a thick segment is a quad. The usual way to draw that with
instancing is to build a segment buffer: every segment's two endpoints, side by side, which copies every
vertex twice (this is what Three.js's `LineSegmentsGeometry` takes). Here, the decoded vertex buffer is used
directly, read twice:

```ts
const positions = new InstancedInterleavedBuffer(vertices, 3, 1); // stride 3 elements, advance per instance
geometry.setAttribute("aStart", new InterleavedBufferAttribute(positions, 3, 0)); // v[i]
geometry.setAttribute("aEnd", new InterleavedBufferAttribute(positions, 3, 3)); // v[i + 1]
geometry.instanceCount = vertices.length / 3 - 1;
```

Both attributes walk the same GL buffer with a stride of 12 bytes; `aEnd` starts 12 bytes later. Instance `i`
therefore sees `v[i]` and `v[i + 1]`, which is exactly segment `i` of the layer's vertex sequence. The buffer is
uploaded once, and the vertex fetch reads each vertex twice from cache rather than from two copies in memory.
`instanceCount` stops one vertex short, so the last instance's `aEnd` is the last vertex.

The quad (`position`, 4 corners and 6 indices) is shared by all instances: its `x` (0 or 1) says which end of
the segment a corner belongs to, its `y` (−1 or 1) which side.

### Integer attributes

The vertex buffer is an `Int32Array`, and Three.js binds a buffer of 32-bit integers with
`vertexAttribIPointer`, so the shader declares `in ivec3 aStart` and receives the integers exactly, with no
normalisation and no conversion on the CPU. The shader converts them to float itself (see
[Shaders](shaders.md)). Likewise the line ids, a `Uint32Array`, arrive as `in uint`.

## Line ids

The vertex sequence of a layer runs through all its lines back to back, so the instanced draw above also
produces a segment from the last vertex of each line to the first vertex of the next. The line ids tell those
apart. [`lineIds`](../src/shared/lines.ts) numbers the lines of a layer in vertex order, a `MultiLineString` feature
getting one id per part, and returns:

- `lineOfVertex`: a `Uint32Array` with the line id of every vertex;
- `featureOfLine`: a `Uint32Array` with the feature index of every line, for looking up properties.

It is built from `geometryStarts(layer.geometry)`, which resolves the layer's offset levels into where each
feature's lines and each line's vertices start, so the renderer works on any line layout MLT stores. In a
layer of lines, those starts are stored columns, returned as they are; they also become `lineStart` and
`featureLineStart`, which the deck.gl page and the highlight use. The cost is one `fill` per line and one per
feature.

The ids are uploaded like the positions, read at element offsets 0 and 1:

```ts
const lines = new InstancedInterleavedBuffer(lineOfVertex, 1, 1);
geometry.setAttribute("aLineStart", new InterleavedBufferAttribute(lines, 1, 0));
geometry.setAttribute("aLineEnd", new InterleavedBufferAttribute(lines, 1, 1));
```

They do three jobs:

1. **Breaks.** A segment whose ends have different ids straddles two lines, and the vertex shader moves it out
   of the clip volume. That wastes one instance per line boundary: at the initial view, 6,259 lines among
   528,285 vertices, about 1 %.
2. **Style.** The id is the texel index into the style texture.
3. **Picking.** The id is what the pick pass writes out, along with the tile.

## The style texture

Colouring by a property means a colour per line, known only on the CPU after reading a property column. The
renderer computes it once per tile into a texture, one texel per line, and the fragment shader fetches it with
the line id: [`lineStyleTexels`](../src/shared/style.ts) reads the `direction` string column at `featureOfLine[line]`
and writes the colour for `departure`, `arrival` or `local` (grey when absent) into an `RGBA8` array of
1024 texels per row.

A texture rather than a vertex attribute because the value is per line, not per vertex: a per-vertex colour
buffer would cost 4 bytes per vertex and repeat the same colour along every line; the texture costs 4 bytes per
line. Changing the style means rewriting the texels, not the geometry. Rows of 1024 keep the texture within
every GPU's size limit however many lines a tile has; the shader addresses texel `(line % 1024, line / 1024)`
with `texelFetch`, with no filtering.

## The altitude ramp

Colour by altitude needs no per-tile data. The ramp, eight colour stops of "plasma" from 0 m to 12,000 m, is
sampled into 256 texels with linear filtering, and the fragment shader looks it up by the altitude in metres
that the vertex shader computes from `z` anyway.

## Byte accounting

At the initial view (22 tiles, 528,285 vertices, 6,259 lines):

|                              | This PoC                                | A conventional Three.js approach (`LineSegments2`)              |
| ---------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| Uploaded per vertex          | 16 B: position 12 B, line id 4 B        | 48 B per segment: positions 2 × 12 B, colours 2 × 12 B          |
| Uploaded at the initial view | ≈ 8.5 MB, plus ≈ 96 KiB of style texels | ≈ 25 MB                                                         |
| CPU work per vertex          | one `Uint32Array.fill` slot             | float Mercator conversion, altitude, colour, two segment copies |
| CPU memory kept per vertex   | the decoded columns, 16 B               | the decoded columns plus float positions, altitudes and colours |

The conventional approach converts the vertices to float Mercator positions on the CPU, then hands
`LineSegmentsGeometry` a buffer of segments, each with both endpoints and both colours, so every vertex is
converted once and copied twice. Both draw the same lines, so the difference is the cost of preparing data on
the CPU, not of what is drawn. Frame times have not been measured; see [Limitations](extending.md).
