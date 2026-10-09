import { readFileSync } from "node:fs";
import { decodeTileColumns } from "@maplibre/mlt-wasm";
import { describe, expect, test } from "vite-plus/test";
import { lineIds } from "./lines";
import {
  ALTITUDE_RAMP,
  altitudeRampTexels,
  DIRECTION_COLORS,
  lineStyleTexels,
  RAMP_WIDTH,
  vertexColors,
  STYLE_WIDTH,
} from "./style";

const data = readFileSync(new URL("../__fixtures__/flights-0-0-0.mlt", import.meta.url));
const [layer] = decodeTileColumns(new Uint8Array(data), { layers: ["flights"] }).layers;

describe("altitudeRampTexels", () => {
  test("runs from the first stop to the last, opaque", () => {
    const texels = altitudeRampTexels();
    expect(texels).toHaveLength(RAMP_WIDTH * 4);
    expect([...texels.subarray(0, 4)]).toEqual([...ALTITUDE_RAMP[0], 255]);
    expect([...texels.subarray(-4)]).toEqual([...ALTITUDE_RAMP.at(-1)!, 255]);
  });
});

describe("vertexColors", () => {
  test("colours each vertex by its altitude, and by its line's texel", () => {
    const texels = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255);
    const { altitude, direction } = vertexColors(
      Float32Array.of(-100, 6000, 99999),
      Uint32Array.of(0, 1, 1),
      texels,
      [0, 12000],
    );
    const ramp = altitudeRampTexels();
    const texel = (i: number) => [...ramp.subarray(i * 4, i * 4 + 3)];
    expect([...altitude]).toEqual([...texel(0), ...texel(128), ...texel(RAMP_WIDTH - 1)]);
    expect([...direction]).toEqual([1, 2, 3, 4, 5, 6, 4, 5, 6]);
  });
});

describe("lineStyleTexels", () => {
  test("colours each line by its feature's direction, grey without one", () => {
    // Feature 0 departs; feature 1, two lines, has no direction.
    const { texels, height } = lineStyleTexels(layer, lineIds(layer).featureOfLine);
    expect(height).toBe(1);
    expect(texels).toHaveLength(STYLE_WIDTH * 4);
    expect([...texels.subarray(0, 4)]).toEqual([...DIRECTION_COLORS.departure, 255]);
    expect([...texels.subarray(4, 8)]).toEqual([110, 110, 110, 255]);
    expect([...texels.subarray(8, 12)]).toEqual([110, 110, 110, 255]);
  });

  test("adds a row per STYLE_WIDTH lines", () => {
    const many = new Uint32Array(STYLE_WIDTH + 1);
    expect(lineStyleTexels(layer, many).height).toBe(2);
  });
});
