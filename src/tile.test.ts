import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import type { MltColumnLayer } from "@maplibre/mlt-wasm";
import { featureIds, lineTile, tileUrl } from "./tile";

const data = new Uint8Array(
  readFileSync(new URL("./__fixtures__/flights-0-0-0.mlt", import.meta.url)),
);

describe("lineTile", () => {
  test("decodes the layer, its line ids and its frame", () => {
    const tile = lineTile(data, { z: 0, x: 0, y: 0 });
    expect(tile.layer.featureCount).toBe(2);
    expect(tile.ids.featureOfLine).toHaveLength(3);
    expect(tile.frame).toEqual({ origin: [0, 0], scale: 1 / 4096, zScale: 1, zOffset: -10000 });
  });

  test("indexes each feature's id, both ways", () => {
    const { featureIds: ids } = lineTile(data, { z: 0, x: 0, y: 0 });
    expect([...ids.idOfFeature]).toEqual([7, 42]);
    expect([...ids.featureOfId]).toEqual([
      [7, 0],
      [42, 1],
    ]);
  });

  test("rejects ids that cannot tell a flight's pieces apart from other flights", () => {
    const { layer } = lineTile(data, { z: 0, x: 0, y: 0 });
    const withIds = (ids: MltColumnLayer["ids"]): MltColumnLayer => ({ ...layer, ids });
    expect(() => featureIds(withIds(undefined))).toThrow(/has no feature ids; build the tiles/);
    const absent = { values: Float64Array.of(7, 0), present: Uint8Array.of(0b01) };
    expect(() => featureIds(withIds(absent))).toThrow(/feature 1 of layer "flights" has no id/);
    const twice = { values: Float64Array.of(7, 7) };
    expect(() => featureIds(withIds(twice))).toThrow(
      /features 0 and 1 of layer "flights" share the id 7/,
    );
  });

  test("rejects a tile without the layer", () => {
    expect(() => lineTile(new Uint8Array(), { z: 0, x: 0, y: 0 })).toThrow(/0 layers named/);
  });
});

describe("tileUrl", () => {
  test("fills the template", () => {
    expect(tileUrl("/tiles/{z}/{x}/{y}.mlt", { z: 5, x: 28, y: 12 })).toBe("/tiles/5/28/12.mlt");
  });
});
