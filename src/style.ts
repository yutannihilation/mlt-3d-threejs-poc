import { isPresent, type MltColumnLayer } from "@maplibre/mlt-wasm";

export type Rgb = readonly [number, number, number];

/** Stops of the "plasma" colour map, evenly spaced from low to high altitude. */
export const ALTITUDE_RAMP: readonly Rgb[] = [
  [13, 8, 135],
  [84, 2, 163],
  [139, 10, 165],
  [185, 50, 137],
  [219, 92, 104],
  [244, 136, 73],
  [254, 188, 43],
  [240, 249, 33],
];

/** The ramp as a CSS `linear-gradient`, low altitude at the start. */
export function altitudeGradientCss(direction = "to right"): string {
  const stops = ALTITUDE_RAMP.map(([r, g, b]) => `rgb(${r} ${g} ${b})`);
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

/** The ramp as `RAMP_WIDTH` RGBA bytes, for a 1D texture the shader samples by altitude. */
export const RAMP_WIDTH = 256;
export function altitudeRampTexels(): Uint8Array {
  const out = new Uint8Array(RAMP_WIDTH * 4);
  for (let i = 0; i < RAMP_WIDTH; i++) {
    const scaled = (i / (RAMP_WIDTH - 1)) * (ALTITUDE_RAMP.length - 1);
    const k = Math.min(ALTITUDE_RAMP.length - 2, Math.floor(scaled));
    const f = scaled - k;
    for (let c = 0; c < 3; c++) {
      out[i * 4 + c] = Math.round(
        ALTITUDE_RAMP[k][c] + (ALTITUDE_RAMP[k + 1][c] - ALTITUDE_RAMP[k][c]) * f,
      );
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

export const DIRECTION_COLORS: Record<string, Rgb> = {
  departure: [255, 140, 0],
  arrival: [0, 170, 255],
  local: [200, 200, 200],
};
const NO_DIRECTION: Rgb = [110, 110, 110];

/** Width of the per-line style texture; a line's texel is `(line % width, line / width)`. */
export const STYLE_WIDTH = 1024;

/**
 * One RGBA texel per line, coloured by its feature's `direction` property: the property
 * column is read once per tile, and the GPU looks the line's colour up by the line id.
 * `height` rows of `STYLE_WIDTH` texels, at least one row.
 */
export function lineStyleTexels(
  layer: MltColumnLayer,
  featureOfLine: Uint32Array,
): { texels: Uint8Array; height: number } {
  const direction = layer.properties.find((column) => column.name === "direction");
  if (direction !== undefined && direction.type !== "string") {
    throw new Error(`"direction" is a ${direction.type} column, expected strings`);
  }
  const height = Math.max(1, Math.ceil(featureOfLine.length / STYLE_WIDTH));
  const texels = new Uint8Array(STYLE_WIDTH * height * 4);
  for (let line = 0; line < featureOfLine.length; line++) {
    const feature = featureOfLine[line];
    const value =
      direction && isPresent(direction, feature) ? direction.values[feature] : undefined;
    const [r, g, b] = (value !== undefined && DIRECTION_COLORS[value]) || NO_DIRECTION;
    texels.set([r, g, b, 255], line * 4);
  }
  return { texels, height };
}
