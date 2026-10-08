import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { lineTile, tileUrl } from "./tile";

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

  test("rejects a tile without the layer", () => {
    expect(() => lineTile(new Uint8Array(), { z: 0, x: 0, y: 0 })).toThrow(/0 layers named/);
  });
});

describe("tileUrl", () => {
  test("fills the template", () => {
    expect(tileUrl("/tiles/{z}/{x}/{y}.mlt", { z: 5, x: 28, y: 12 })).toBe("/tiles/5/28/12.mlt");
  });
});
