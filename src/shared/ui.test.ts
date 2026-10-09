import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { lineTile } from "./tile";
import { describeHit, tileStats } from "./ui";

describe("describeHit", () => {
  test("names the flight, its aircraft, direction and altitude range", () => {
    expect(
      describeHit({
        properties: { callsign: "ANA1", type: "B738", registration: "JA1", direction: "arrival" },
        altitude: [120.4, 11000],
        tiles: 3,
      }),
    ).toEqual([
      "ANA1",
      "B738 · JA1",
      "arriving at HND",
      "120 – 11,000 m",
      "across 3 tiles in view",
    ]);
  });

  test("falls back through the identifiers and leaves out what is absent", () => {
    expect(describeHit({ properties: { icao: "abc123" }, altitude: [0, 0], tiles: 1 })).toEqual([
      "abc123",
      "0 – 0 m",
    ]);
  });
});

describe("tileStats", () => {
  test("counts the tiles, their lines and their vertices", () => {
    const data = readFileSync(new URL("../__fixtures__/flights-0-0-0.mlt", import.meta.url));
    const tile = () => lineTile(new Uint8Array(data), { z: 0, x: 0, y: 0 });
    expect(tileStats([tile(), tile()])).toEqual({ tiles: 2, lines: 6, vertices: 16 });
  });
});
