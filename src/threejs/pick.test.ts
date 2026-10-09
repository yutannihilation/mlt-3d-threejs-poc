import { Vector4 } from "three";
import { describe, expect, test } from "vite-plus/test";
import { decodePickId, encodePickId, MAX_LINES, MAX_SLOTS, pickMatrix } from "./pick";

function bytes(id: number): Uint8Array {
  return Uint8Array.of(id & 255, (id >>> 8) & 255, (id >>> 16) & 255, (id >>> 24) & 255);
}

describe("pick ids", () => {
  test("round-trip through the pixel's bytes", () => {
    for (const id of [
      { slot: 0, line: 0 },
      { slot: 3, line: 1234 },
      { slot: MAX_SLOTS - 1, line: MAX_LINES - 1 },
    ]) {
      expect(decodePickId(bytes(encodePickId(id)))).toEqual(id);
    }
  });

  test("an undrawn pixel is nothing", () => {
    expect(decodePickId(bytes(0))).toBeNull();
  });

  test("reject what the bits cannot hold", () => {
    expect(() => encodePickId({ slot: MAX_SLOTS, line: 0 })).toThrow(RangeError);
    expect(() => encodePickId({ slot: 0, line: MAX_LINES })).toThrow(RangeError);
  });
});

describe("pickMatrix", () => {
  const [width, height] = [800, 600];
  const clipAt = (px: number, py: number, w = 1) =>
    new Vector4((2 * (px + 0.5)) / width - 1, 1 - (2 * (py + 0.5)) / height, 0, 1).multiplyScalar(
      w,
    );

  test("maps the picked pixel to the viewport's centre", () => {
    const m = pickMatrix(100, 50, width, height);
    const v = clipAt(100, 50).applyMatrix4(m);
    expect(v.x / v.w).toBeCloseTo(0, 12);
    expect(v.y / v.w).toBeCloseTo(0, 12);
  });

  test("maps the neighbouring pixel one viewport away, also behind perspective", () => {
    const m = pickMatrix(100, 50, width, height);
    const right = clipAt(101, 50, 3).applyMatrix4(m);
    expect(right.x / right.w).toBeCloseTo(2, 9);
    const below = clipAt(100, 51, 3).applyMatrix4(m);
    expect(below.y / below.w).toBeCloseTo(-2, 9);
  });
});
