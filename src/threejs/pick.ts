import { Matrix4 } from "three";

/**
 * What the pick pass writes into its RGBA8 pixel: the drawn tile's slot and the line, as one
 * 32-bit id, `0` where nothing was drawn. The shader builds it the same way.
 */
export const LINE_BITS = 20;
export const MAX_LINES = 2 ** LINE_BITS - 1;
export const MAX_SLOTS = 2 ** (32 - LINE_BITS);

export interface PickId {
  readonly slot: number;
  readonly line: number;
}

/** The id for `slot` and `line`, as the shader writes it; throws when either overflows. */
export function encodePickId({ slot, line }: PickId): number {
  if (slot < 0 || slot >= MAX_SLOTS) throw new RangeError(`tile slot ${slot} does not fit`);
  if (line < 0 || line >= MAX_LINES) throw new RangeError(`line ${line} does not fit`);
  return (slot * 2 ** LINE_BITS + line + 1) >>> 0;
}

/** The pixel's bytes, as `readRenderTargetPixels` fills them, or `null` where nothing was drawn. */
export function decodePickId(rgba: ArrayLike<number>): PickId | null {
  const id = (rgba[0] | (rgba[1] << 8) | (rgba[2] << 16) | (rgba[3] << 24)) >>> 0;
  if (id === 0) return null;
  const line = (id % 2 ** LINE_BITS) - 1;
  return { slot: Math.floor(id / 2 ** LINE_BITS), line };
}

/**
 * The clip-space transform that maps the CSS pixel at `(px, py)` of a `width x height`
 * canvas onto the whole viewport, so a 1 x 1 render target sees exactly that pixel.
 * Linear in homogeneous coordinates, so it composes with any projection.
 */
export function pickMatrix(px: number, py: number, width: number, height: number): Matrix4 {
  const nx = (2 * (px + 0.5)) / width - 1;
  const ny = 1 - (2 * (py + 0.5)) / height;
  // Move the pixel's centre to the origin, then scale a pixel up to the viewport.
  return new Matrix4().makeScale(width, height, 1).setPosition(-width * nx, -height * ny, 0);
}
