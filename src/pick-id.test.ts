import { describe, expect, test } from "vite-plus/test";
import { decodePickId, encodePickId, MAX_LINES, MAX_SLOTS } from "./pick-id";

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
