import { readFileSync } from "node:fs";
import { decodeTileColumns, MltGeometryType, type MltColumnLayer } from "@maplibre/mlt-wasm";
import { describe, expect, test } from "vite-plus/test";
import { featureLines, lineIds } from "./lines";

// `mlt convert --mlt-version 2 --max-zoom 0 --z-step 0 --layer flights` of __fixtures__/flights.geojson:
// a LineString of 3 vertices and a MultiLineString of 2 + 3.
const data = readFileSync(new URL("../__fixtures__/flights-0-0-0.mlt", import.meta.url));
const [layer] = decodeTileColumns(new Uint8Array(data), { layers: ["flights"] }).layers;

describe("lineIds", () => {
  test("numbers each line's vertices and maps lines to features", () => {
    const ids = lineIds(layer);
    const { lineOfVertex, featureOfLine, lineStart, featureLineStart } = ids;
    expect([...lineOfVertex]).toEqual([0, 0, 0, 1, 1, 2, 2, 2]);
    expect([...featureOfLine]).toEqual([0, 1, 1]);
    expect([...lineStart]).toEqual([0, 3, 5, 8]);
    // Feature 0 is line 0; feature 1 is lines 1 and 2.
    expect([...featureLineStart]).toEqual([0, 1, 3]);
    expect(featureLines(ids, 1)).toEqual([1, 3]);
  });

  test("rejects a feature that is not a line", () => {
    const point: MltColumnLayer = {
      ...layer,
      featureCount: 1,
      geometry: {
        ...layer.geometry,
        types: Uint8Array.of(MltGeometryType.Point),
        geometryOffsets: undefined,
        partOffsets: undefined,
      },
    };
    expect(() => lineIds(point)).toThrow(/is a Point, expected a line/);
  });
});
