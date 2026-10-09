import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { lineTile } from "../shared/tile";
import { tileFrame } from "../shared/transform";
import { deckPlacement, deckTile } from "./tile";

/** `m × (x, y, z, 1)` plus the origin, for a column-major matrix. */
function place(
  { coordinateOrigin: o }: { coordinateOrigin: [number, number, number] },
  m: ArrayLike<number>,
  [x, y, z]: [number, number, number],
): number[] {
  return [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r] + o[r]);
}

describe("deckPlacement", () => {
  test("places tile coordinates in deck.gl's common space, y up, and z in metres", () => {
    const placement = deckPlacement(tileFrame({ z: 2, x: 3, y: 1 }, 4096, 0), 4096);
    const { high } = placement.modelMatrix;
    // The tile spans x 0.75 .. 1 and y 0.25 .. 0.5 of the world: 384 .. 512 and 384 .. 256 in common units.
    expect(place(placement, high, [0, 0, 10000])).toEqual([384, 384, 0]);
    expect(place(placement, high, [4096, 4096, 22000])).toEqual([512, 256, 12000]);
  });

  test("below deck.gl's offset zoom, scales metres to the tile centre's latitude", () => {
    const { modelMatrix } = deckPlacement(tileFrame({ z: 2, x: 3, y: 1 }, 4096, -1), 4096);
    // The centre is at Mercator y 0.375, latitude atan(sinh(π / 4)).
    const latitude = Math.atan(Math.sinh(Math.PI / 4));
    expect(modelMatrix.low[10] / modelMatrix.high[10]).toBeCloseTo(1 / Math.cos(latitude), 12);
    expect(modelMatrix.low[14] / modelMatrix.high[14]).toBeCloseTo(1 / Math.cos(latitude), 12);
    expect(modelMatrix.high[10]).toBeCloseTo(0.1, 15);
  });
});

describe("deckTile", () => {
  const data = readFileSync(new URL("../__fixtures__/flights-0-0-0.mlt", import.meta.url));
  const tile = deckTile(lineTile(new Uint8Array(data), { z: 0, x: 0, y: 0 }));

  test("gives every vertex its feature as the row index", () => {
    for (const data of [tile.data.altitude, tile.data.direction]) {
      expect([...data.attributes.rowIndexes.value]).toEqual([0, 0, 0, 1, 1, 1, 1, 1]);
    }
  });

  test("hands every PathLayer the decoded vertices and the line starts", () => {
    const { length, startIndices, attributes } = tile.data.altitude;
    expect(length).toBe(3);
    expect([...startIndices]).toEqual([0, 3, 5, 8]);
    expect(attributes.getPath.value).toBe(tile.tile.layer.geometry.vertices);
  });

  test("colours every vertex by altitude and by its line's direction", () => {
    // The first vertex is at 0 m, the ramp's start; feature 0 departs, feature 1 has no direction.
    const altitude = tile.data.altitude.attributes.getColor.value;
    const direction = tile.data.direction.attributes.getColor.value;
    expect([...altitude.subarray(0, 3)]).toEqual([13, 8, 135]);
    expect([...direction.subarray(0, 3)]).toEqual([255, 140, 0]);
    expect([...direction.subarray(9, 12)]).toEqual([110, 110, 110]);
  });
});
