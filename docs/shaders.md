# Shaders

The shaders are GLSL ES 3.00 ([`shaders.ts`](../src/shaders.ts)), used through `ShaderMaterial` with
`glslVersion: GLSL3`, which adds the `#version` line, the precision, `projectionMatrix`, `modelViewMatrix`
and the quad's `position` attribute. One vertex shader serves both passes; the draw and pick passes differ
only in the fragment shader.

## From decoded integers to clip space

Each vertex arrives as the integers the tile stores: `x, y` in tile coordinates (`0 .. extent`, 4096 here,
plus a small buffer beyond the edges) and `z` on the layer's grid. The shader turns them into the coordinates
MapLibre's projection expects, Web Mercator units (`0 .. 1` across the world) with altitude in the same units,
relative to the tile's north-west corner:

```glsl
vec4 toLocal(ivec3 v, out float metres) {
  vec2 xy = vec2(v.xy) * uScale;                       // tile coordinates → Mercator, relative to the corner
  metres = float(v.z) * uZScale + uZOffset;             // z grid → metres
  float y = uOrigin.y + xy.y;                           // the vertex's absolute Mercator y
  return vec4(xy, metres * uMetre * cosh(PI * (1.0 - 2.0 * y)), 1.0);
}
```

The per-tile uniforms come from [`tileFrame`](../src/transform.ts):

| Uniform               | Value                                        | Meaning                                             |
| --------------------- | -------------------------------------------- | --------------------------------------------------- |
| `uOrigin`             | `(x, y) / 2^z`                               | the tile's north-west corner in Mercator units      |
| `uScale`              | `1 / (extent · 2^z)`                         | Mercator units per tile coordinate                  |
| `uZScale`, `uZOffset` | `10^zStep`, `−10000`                         | metres are `−10000 + z · 10^zStep`, the MLT z grid  |
| `uMetre`              | `MercatorCoordinate.fromLngLat([0, 0], 1).z` | one metre in Mercator units at the equator (shared) |

### Altitude in Mercator units

MapLibre's 3D custom layers take altitude in Mercator units at the point's latitude: what
`MercatorCoordinate.fromLngLat(lngLat, metres).z` returns. In Web Mercator a metre on the ground spans
`1 / cos(lat)` times more map than at the equator, so the altitude has to grow by the same factor for the
geometry to keep its proportions. For a Mercator `y`, `lat = atan(sinh(π (1 − 2y)))`, so
`1 / cos(lat) = cosh(π (1 − 2y))`, which needs no trigonometry on latitude. The factor is computed per vertex,
from the vertex's own `y`, for one `cosh`. A per-tile factor would be off by up to `tan(lat) · Δlat`: about
1.4 % across a zoom 8 tile at 35° N (140 m at 10 km altitude), and far more across a zoom 3 tile.

### Then the projection

```glsl
vec4 cs = projectionMatrix * modelViewMatrix * toLocal(aStart, metresStart);
```

`modelViewMatrix` is the mesh's `matrixWorld`: MapLibre's `mainMatrix × translate(origin + wrap)`
(see [Architecture](architecture.md#a-frame)). `projectionMatrix` is the identity for the draw pass and the
pick matrix for the pick pass.

### Precision

Everything per vertex runs in float32; the design keeps the numbers small enough for that.

- **Integers to float** are exact below 2²⁴ (16,777,216). Tile coordinates are far below it. `z` on a 1 m
  grid is about 10,000 to 25,000 for these flights, exact. On a millimetre grid (`zStep` −3) `z` passes 2²⁴
  above about 6,800 m, where `float(v.z)` rounds to 2 mm: invisible on a map, but the shader's altitude is not
  exact in general. Exact metres for display come from `toElevation` on the CPU.
- **Positions** are relative to the tile's corner. A local coordinate is at most one tile wide, `2^−z`, so
  float32's relative precision of 2⁻²⁴ gives about 2 mm at zoom 10 (on a 40,075 km world). An absolute
  position, a number up to 1, would resolve only to about 2.4 m, so it enters only through the matrix,
  combined with MapLibre's matrix in float64 on the CPU before it is uploaded. MapLibre places its own tiles
  the same way.
- **Altitude** in Mercator units is about 10⁻⁴ for 10 km; relative precision is what counts there, and
  float32 has plenty.

## Thick lines in screen space

WebGL draws 1-pixel lines at best, so each segment is a quad, expanded on screen to a constant width in pixels
whatever the perspective.

```glsl
vec2 dir = (ce.xy / ce.w - cs.xy / cs.w) * uResolution;      // the segment on screen, in pixel proportions
vec2 normal = len > 0.0 ? vec2(-dir.y, dir.x) / len : vec2(0.0);
vec4 clip = atEnd ? ce : cs;
clip.xy += normal * position.y * uWidth * 0.5 * 2.0 / uResolution * clip.w;
```

1. Both ends are projected to clip space and divided by `w` to get normalised device coordinates. Their
   difference, scaled by the canvas size in CSS pixels, is the segment's direction in pixel proportions, so
   the normal is perpendicular on screen and not in a stretched NDC square.
2. The corner takes its end's clip position and moves along the normal by half the width, converted from
   pixels to NDC (`2 / resolution` per pixel) and multiplied by `w` so the perspective divide brings it back to
   that size. Lines therefore keep `uWidth` pixels near and far.
3. A zero-length segment gets a zero normal, a degenerate quad that draws nothing.

There are no joins or caps: consecutive quads overlap or leave a small notch at a bend, which at 1.5 px is not
visible. See [Limitations](extending.md) for how joins would fit.

### Segments that should not be drawn

```glsl
if (aLineStart != aLineEnd || (cs.w < NEAR && ce.w < NEAR)) {
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  return;
}
```

A segment that joins the end of one line to the start of the next (its two ids differ, see
[GPU data layout](gpu-data.md#line-ids)), or that lies entirely behind the camera, gets all four corners at
`z / w = 2`, outside the clip volume, and the rasteriser discards it.

### Near-plane clipping

With a pitched map a segment can run from in front of the camera to behind it. Its behind end has `w ≤ 0`, and
dividing by it would flip the end to the other side of the screen and smear the quad across it. The shader
moves such an end along the segment, in clip space where the interpolation is linear, to `w = 10⁻⁶`, before
any division. The hardware would clip the triangles correctly by itself; the problem is only the direction
and the normal, which need the divided positions.

### Culling and depth

The quad's winding depends on which way the segment runs on screen, so half of all segments face away. Both
materials are `side: DoubleSide`; with the default back-face culling, those segments were not drawn at all.
Depth testing stays on, against MapLibre's depth buffer, so lines go behind the basemap's 3D features and
behind each other.

## Fragment shader: two colour modes

```glsl
if (uColorMode == 0) {
  float t = (vMetres - uAltitudeRange.x) / (uAltitudeRange.y - uAltitudeRange.x);
  color = texture(uRamp, vec2(clamp(t, 0.0, 1.0), 0.5));
} else {
  int line = int(vLine);
  color = texelFetch(uLineStyle, ivec2(line % uStyleWidth, line / uStyleWidth), 0);
}
if (int(vLine) == uHighlight) color = vec4(1.0);
```

- **Altitude**: the vertex shader passes the metres it computed, interpolated along the segment, so the colour
  changes smoothly along a climbing line. The ramp texture is filtered linearly.
- **Property**: the line id is a `flat` varying (integers cannot be interpolated), and indexes the style
  texture with `texelFetch`, unfiltered.
- **Highlight**: the hovered line, if on this tile, is white. `uHighlight` is −1 on every other tile.

Switching mode sets one uniform; nothing is rebuilt.

## Pick fragment shader

```glsl
uint id = (uSlot << uLineBits) | (vLine + 1u);
outColor = vec4(uvec4(id, id >> 8u, id >> 16u, id >> 24u) & 255u) / 255.0;
```

It writes the 32-bit pick id as four bytes into an `RGBA8` target: dividing by 255 and storing back as 8 bits
round-trips every byte exactly. See [Picking](picking.md).
