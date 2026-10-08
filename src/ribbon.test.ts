import { readFileSync } from "node:fs";
import { decodeTileColumns, type MltColumnLayer, MltGeometryType } from "@maplibre/mlt-wasm";
import { describe, expect, test } from "vite-plus/test";
import { lineIds } from "./lines";
import { ARC_STEP, type Ribbons, tessellateRibbons } from "./ribbon";
import { tileFrame } from "./transform";

type Point = [number, number, number];

/** A 3D layer of `LineString`s, with z on a 1 m grid. */
function layerOf(...lines: Point[][]): MltColumnLayer {
  let total = 0;
  return {
    name: "lines",
    extent: 4096,
    version: 2,
    featureCount: lines.length,
    geometry: {
      types: Uint8Array.from(lines, () => MltGeometryType.LineString),
      partOffsets: Uint32Array.from([0, ...lines.map((l) => (total += l.length))]),
      dimension: 3,
      vertices: Int32Array.from(lines.flat(2)),
      zStep: 0,
    },
    properties: [],
  };
}

// The world tile, where at the equator (y = 2048) one metre is one tile unit, 1 / 4096 of the
// world; positions below are compared in tile units.
const frame = tileFrame({ z: 0, x: 0, y: 0 }, 4096, 0);
const metre = 1 / 4096;

function ribbons(layer: MltColumnLayer, width = 1): Ribbons {
  const ids = lineIds(layer);
  return tessellateRibbons(layer, ids.lineOfVertex, ids.featureOfLine.length, frame, metre, width);
}

/** Ribbon vertex `i`'s `x, y` in tile units, and its offset from `(cx, cy)`. */
const at = (r: Ribbons, i: number) => [r.positions[i * 3] * 4096, r.positions[i * 3 + 1] * 4096];
const from = (r: Ribbons, i: number, [cx, cy]: [number, number]) => {
  const [x, y] = at(r, i);
  return [x - cx, y - cy];
};

describe("tessellateRibbons", () => {
  test("a straight segment is a quad, half the width to each side, at its altitude", () => {
    const r = ribbons(
      layerOf([
        [0, 2048, 10500],
        [10, 2048, 10600],
      ]),
      2,
    );
    expect([0, 1, 2, 3].map((i) => at(r, i))).toEqual([
      [0, 2049],
      [0, 2047],
      [10, 2049],
      [10, 2047],
    ]);
    // Altitude in Mercator units: a metre at the equator.
    expect(r.positions[2] * 4096).toBeCloseTo(500, 6);
    expect([...r.metres]).toEqual([500, 500, 600, 600]);
    expect([...r.indices]).toEqual([0, 1, 2, 1, 3, 2]);
    expect([...r.lines]).toEqual([0, 0, 0, 0]);
    expect([...r.lineStart]).toEqual([0, 4]);
  });

  test("a slight turn shares one mitred pair between both segments", () => {
    const r = ribbons(
      layerOf([
        [0, 2048, 0],
        [100, 2048, 0],
        [200, 2058, 0],
      ]),
    );
    expect(r.lines).toHaveLength(6);
    expect(r.indices).toHaveLength(12);
    // The mitred offset reaches just beyond half the width, along the bisector.
    const [ox, oy] = from(r, 2, [100, 2048]);
    expect(Math.hypot(ox, oy)).toBeGreaterThan(0.5);
    expect(Math.hypot(ox, oy)).toBeLessThan(0.51);
  });

  test("a sharp turn gets a round join on its outer side", () => {
    // Right, then up: a left turn of 90°, so the join is on the right, around the corner.
    const r = ribbons(
      layerOf([
        [0, 2048, 0],
        [10, 2048, 0],
        [10, 2058, 0],
      ]),
    );
    const steps = Math.ceil(Math.PI / 2 / ARC_STEP);
    // Ends: two each. Corner: two pairs, the centre, and the arc between.
    expect(r.lines).toHaveLength(2 + 4 + 1 + (steps - 1) + 2);
    expect(r.indices).toHaveLength((2 + 2 + steps) * 3);
    expect(from(r, 6, [10, 2048])).toEqual([0, 0]);
    for (let i = 7; i < 7 + steps - 1; i++) {
      const [x, y] = from(r, i, [10, 2048]);
      // float32 resolves ~2.4e-4 tile units at y = 0.5 of the world tile.
      expect(Math.hypot(x, y)).toBeCloseTo(0.5, 3);
      expect(x).toBeGreaterThan(0);
      expect(y).toBeLessThan(0);
    }
  });

  test("keeps the width in metres at any latitude", () => {
    // y = 1024 is at latitude ~66.5°, where a metre is cosh(π / 2) ≈ 2.51 times wider.
    const r = ribbons(
      layerOf([
        [0, 1024, 10000],
        [10, 1024, 10000],
      ]),
    );
    expect(from(r, 0, [0, 1024])[1]).toBeCloseTo(0.5 * Math.cosh(Math.PI / 2), 4);
  });

  test("skips repeated points, and lines that collapse to one", () => {
    const r = ribbons(
      layerOf(
        [
          [5, 5, 0],
          [5, 5, 0],
        ],
        [
          [0, 2048, 0],
          [0, 2048, 5],
          [10, 2048, 0],
        ],
      ),
    );
    expect(r.lines).toHaveLength(4);
    expect(r.indices).toHaveLength(6);
    // The collapsed line 0 has no ribbon vertices; line 1 has all four.
    expect([...r.lineStart]).toEqual([0, 0, 4]);
  });

  test("keeps each line's vertices together, across features and parts", () => {
    // The fixture: a LineString of 3 vertices, and a MultiLineString of 2 + 3.
    const data = readFileSync(new URL("./__fixtures__/flights-0-0-0.mlt", import.meta.url));
    const [layer] = decodeTileColumns(new Uint8Array(data)).layers;
    const r = ribbons(layer);
    expect(r.lineStart).toHaveLength(4);
    for (let line = 0; line < 3; line++) {
      const range = r.lines.subarray(r.lineStart[line], r.lineStart[line + 1]);
      expect(range.length).toBeGreaterThan(0);
      expect(range.every((l) => l === line)).toBe(true);
    }
    expect(Math.max(...r.indices)).toBe(r.lines.length - 1);
  });
});
