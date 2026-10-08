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
