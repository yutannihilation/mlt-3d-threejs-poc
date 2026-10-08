import { describe, expect, test } from "vite-plus/test";
import { describeHit } from "./ui";

describe("describeHit", () => {
  test("names the flight, its aircraft, direction and altitude range", () => {
    expect(
      describeHit({
        properties: { callsign: "ANA1", type: "B738", registration: "JA1", direction: "arrival" },
        altitude: [120.4, 11000],
      }),
    ).toEqual(["ANA1", "B738 · JA1", "arriving at HND", "120 – 11,000 m"]);
  });

  test("falls back through the identifiers and leaves out what is absent", () => {
    expect(describeHit({ properties: { icao: "abc123" }, altitude: [0, 0] })).toEqual([
      "abc123",
      "0 – 0 m",
    ]);
  });
});
