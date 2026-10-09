/**
 * GLSL ES 3.00. Three.js adds `#version`, the precision, `projectionMatrix`,
 * `modelViewMatrix` and the quad's `position` attribute.
 */

/**
 * One instance per segment `v[i] -> v[i + 1]` of the layer's vertex buffer, read as decoded:
 * `aStart` and `aEnd` are the same buffer at element offsets 0 and 3, `aLineStart` and
 * `aLineEnd` the line ids at offsets 0 and 1. The quad's `position` says which end
 * (`x`: 0 or 1) and which side (`y`: -1 or 1) of the segment a corner is.
 */
export const LINE_VERTEX = /* glsl */ `
in ivec3 aStart;
in ivec3 aEnd;
in uint aLineStart;
in uint aLineEnd;

uniform vec2 uOrigin;
uniform float uScale;
uniform float uZScale;
uniform float uZOffset;
uniform float uMetre;
uniform vec2 uResolution;
uniform float uWidth;

flat out uint vLine;
out float vMetres;

const float PI = 3.141592653589793;
// Clip w below this is as good as behind the camera.
const float NEAR = 1e-6;

// A decoded vertex to Mercator units relative to the tile's north-west corner: x and y by
// the tile's scale, z from the layer's grid to metres, then to Mercator units at the vertex's
// latitude, where a metre grows by 1 / cos(lat) = cosh(pi * (1 - 2 * y)).
vec4 toLocal(ivec3 v, out float metres) {
  vec2 xy = vec2(v.xy) * uScale;
  metres = float(v.z) * uZScale + uZOffset;
  float y = uOrigin.y + xy.y;
  return vec4(xy, metres * uMetre * cosh(PI * (1.0 - 2.0 * y)), 1.0);
}

void main() {
  float metresStart, metresEnd;
  vec4 cs = projectionMatrix * modelViewMatrix * toLocal(aStart, metresStart);
  vec4 ce = projectionMatrix * modelViewMatrix * toLocal(aEnd, metresEnd);
  bool atEnd = position.x > 0.5;
  vLine = aLineStart;
  vMetres = atEnd ? metresEnd : metresStart;

  // A segment that straddles two lines, or lies behind the camera, is put outside the clip volume.
  if (aLineStart != aLineEnd || (cs.w < NEAR && ce.w < NEAR)) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  // Trim the end behind the camera to the near plane, so the division below stays sane.
  if (cs.w < NEAR) cs = mix(cs, ce, (NEAR - cs.w) / (ce.w - cs.w));
  if (ce.w < NEAR) ce = mix(ce, cs, (NEAR - ce.w) / (cs.w - ce.w));

  // The segment's direction on screen, aspect-corrected, and its normal.
  vec2 dir = (ce.xy / ce.w - cs.xy / cs.w) * uResolution;
  float len = length(dir);
  vec2 normal = len > 0.0 ? vec2(-dir.y, dir.x) / len : vec2(0.0);

  // Push the corner half the width out, in pixels: pixels to clip is 2 / resolution, times w.
  vec4 clip = atEnd ? ce : cs;
  clip.xy += normal * position.y * uWidth * 0.5 * 2.0 / uResolution * clip.w;
  gl_Position = clip;
}
`;

/** The line's colour: the altitude ramp sampled by metres, or the per-line style texel. */
export const LINE_FRAGMENT = /* glsl */ `
flat in uint vLine;
in float vMetres;

uniform int uColorMode;
uniform sampler2D uRamp;
uniform vec2 uAltitudeRange;
uniform sampler2D uLineStyle;
uniform int uStyleWidth;
// The highlighted feature's lines, [start, end); empty when none is.
uniform ivec2 uHighlight;

out vec4 outColor;

void main() {
  int line = int(vLine);
  vec4 color;
  if (uColorMode == 0) {
    float t = (vMetres - uAltitudeRange.x) / (uAltitudeRange.y - uAltitudeRange.x);
    color = texture(uRamp, vec2(clamp(t, 0.0, 1.0), 0.5));
  } else {
    color = texelFetch(uLineStyle, ivec2(line % uStyleWidth, line / uStyleWidth), 0);
  }
  if (line >= uHighlight.x && line < uHighlight.y) color = vec4(1.0);
  outColor = color;
}
`;

/** The pick id as four bytes: the tile's slot above the line, plus one so that 0 is nothing. */
export const PICK_FRAGMENT = /* glsl */ `
flat in uint vLine;

uniform uint uSlot;
uniform uint uLineBits;

out vec4 outColor;

void main() {
  uint id = (uSlot << uLineBits) | (vLine + 1u);
  outColor = vec4(uvec4(id, id >> 8u, id >> 16u, id >> 24u) & 255u) / 255.0;
}
`;
