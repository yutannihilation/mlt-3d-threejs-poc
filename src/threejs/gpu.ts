import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  GLSL3,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LinearFilter,
  MeshBasicMaterial,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  type Texture,
  UnsignedByteType,
  Vector2,
} from "three";
import { ALTITUDE_RANGE_M } from "../shared/config";
import { LINE_BITS } from "./pick";
import type { Ribbons } from "./ribbon";
import { LINE_FRAGMENT, LINE_VERTEX, PICK_FRAGMENT } from "./shaders";
import { altitudeRampTexels, RAMP_WIDTH, STYLE_WIDTH } from "../shared/style";
import type { TileFrame } from "../shared/transform";

/**
 * The layer's vertex buffer as decoded (`x, y, z` triples) and its line ids, uploaded
 * once each, as one segment per instance. Nothing is copied or converted: consecutive
 * instances read the same buffers one vertex apart, through attributes at different offsets.
 */
export function segmentGeometry(
  vertices: Int32Array,
  lineOfVertex: Uint32Array,
): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  // The quad every segment is drawn as: x says which end, y which side.
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, 1, 0, 1, -1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  // Integer arrays bind with vertexAttribIPointer, so the shader reads them as ivec3 and uint, exactly.
  const positions = new InstancedInterleavedBuffer(vertices, 3, 1);
  geometry.setAttribute("aStart", new InterleavedBufferAttribute(positions, 3, 0));
  geometry.setAttribute("aEnd", new InterleavedBufferAttribute(positions, 3, 3));
  const lines = new InstancedInterleavedBuffer(lineOfVertex, 1, 1);
  geometry.setAttribute("aLineStart", new InterleavedBufferAttribute(lines, 1, 0));
  geometry.setAttribute("aLineEnd", new InterleavedBufferAttribute(lines, 1, 1));
  geometry.instanceCount = vertices.length / 3 - 1;
  return geometry;
}

/**
 * Ribbons as a stock Three.js geometry: final positions, 8-bit vertex colours, and the
 * triangles' indices. Any stock material with `vertexColors` draws it.
 */
export function ribbonGeometry(ribbons: Ribbons, colors: Uint8Array): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(ribbons.positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3, true));
  geometry.setIndex(new BufferAttribute(ribbons.indices, 1));
  return geometry;
}

/** One material for every tile's ribbons; a ribbon is seen from above and below. */
export function ribbonMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
}

export function rampTexture(): DataTexture {
  const texture = new DataTexture(
    altitudeRampTexels(),
    RAMP_WIDTH,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function styleTexture(texels: Uint8Array, height: number): DataTexture {
  const texture = new DataTexture(texels, STYLE_WIDTH, height, RGBAFormat, UnsignedByteType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** What every tile's materials share. */
export interface Shared {
  readonly ramp: Texture;
  /** One metre in Mercator units at the equator. */
  readonly metre: number;
}

function frameUniforms(frame: TileFrame, shared: Shared) {
  return {
    uOrigin: { value: new Vector2(frame.origin[0], frame.origin[1]) },
    uScale: { value: frame.scale },
    uZScale: { value: frame.zScale },
    uZOffset: { value: frame.zOffset },
    uMetre: { value: shared.metre },
    uResolution: { value: new Vector2(1, 1) },
    uWidth: { value: 1 },
  };
}

/** A tile's drawing material; `uResolution`, `uWidth`, `uColorMode` and `uHighlight` are set per frame. */
export function lineMaterial(frame: TileFrame, style: Texture, shared: Shared): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    // A screen-aligned quad faces whichever way its segment runs.
    side: DoubleSide,
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    uniforms: {
      ...frameUniforms(frame, shared),
      uColorMode: { value: 0 },
      uRamp: { value: shared.ramp },
      uAltitudeRange: { value: new Vector2(ALTITUDE_RANGE_M[0], ALTITUDE_RANGE_M[1]) },
      uLineStyle: { value: style },
      uStyleWidth: { value: STYLE_WIDTH },
      uHighlight: { value: new Vector2(0, 0) },
    },
  });
}

/** A tile's picking material; `uSlot` is the tile's position among the tiles drawn, set per pick. */
export function pickMaterial(frame: TileFrame, shared: Shared): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    side: DoubleSide,
    vertexShader: LINE_VERTEX,
    fragmentShader: PICK_FRAGMENT,
    uniforms: {
      ...frameUniforms(frame, shared),
      uSlot: { value: 0 },
      uLineBits: { value: LINE_BITS },
    },
  });
}
