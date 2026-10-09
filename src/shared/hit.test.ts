import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { describeFeature } from "./hit";
import { type LineTile, lineTile } from "./tile";

// Feature 1 (id 42) is a MultiLineString from 3,000 m to 11,000 m; see lines.test.ts.
const data = new Uint8Array(
  readFileSync(new URL("../__fixtures__/flights-0-0-0.mlt", import.meta.url)),
);
const decode = () => lineTile(data, { z: 0, x: 0, y: 0 });

describe("describeFeature", () => {
  test("gives the feature's properties and its altitude range", () => {
    const tile = decode();
    expect(describeFeature(tile, 1, [tile])).toEqual({
      properties: { icao: "def456" },
      altitude: [3000, 11000],
      tiles: 1,
    });
  });

  test("counts each tile in view holding a piece once, found by the feature id", () => {
    const [tile, other] = [decode(), decode()];
    const without: LineTile = {
      ...decode(),
      featureIds: { idOfFeature: Float64Array.of(1, 2), featureOfId: new Map([[1, 0]]) },
    };
    expect(describeFeature(tile, 1, [tile, tile, other, without]).tiles).toBe(2);
  });
});
