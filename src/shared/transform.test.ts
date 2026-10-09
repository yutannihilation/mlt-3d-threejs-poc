import { describe, expect, test } from "vite-plus/test";
import { metreScale, tileFrame } from "./transform";

describe("tileFrame", () => {
  test("places the world tile at the origin with one metre per z step", () => {
    expect(tileFrame({ z: 0, x: 0, y: 0 }, 4096, 0)).toEqual({
      origin: [0, 0],
      scale: 1 / 4096,
      zScale: 1,
      zOffset: -10000,
    });
  });

  test("offsets a tile by its position and scales a fine z grid", () => {
    const frame = tileFrame({ z: 2, x: 3, y: 1 }, 4096, -2);
    expect(frame.origin).toEqual([0.75, 0.25]);
    expect(frame.scale).toBeCloseTo(1 / (4096 * 4), 15);
    expect(1001234 * frame.zScale + frame.zOffset).toBeCloseTo(12.34, 9);
  });
});

describe("metreScale", () => {
  test("is one at the equator and 1 / cos(latitude) elsewhere", () => {
    expect(metreScale(0.5)).toBe(1);
    // Mercator y 0.375 is latitude atan(sinh(π / 4)).
    expect(metreScale(0.375)).toBeCloseTo(1 / Math.cos(Math.atan(Math.sinh(Math.PI / 4))), 12);
  });
});
