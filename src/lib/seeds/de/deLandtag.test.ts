import { describe, it, expect } from "vitest";
import {
  LANDTAG_CYCLE1_END_TURN_BY_LAND,
  LANDTAG_CYCLE1_END_TURN_BY_LAND_1991,
  getLandtagAnchor,
} from "./deLandtag";

describe("getLandtagAnchor", () => {
  it("returns 2019-default anchor for 2019 preset", () => {
    expect(getLandtagAnchor("BW", "2019-default")).toBe(288);
    expect(getLandtagAnchor("TH", "2019-default")).toBe(432);
  });

  it("returns 1991 anchor for 1991-default preset", () => {
    // BW Landtag: April 1992 ≈ 60 turns from Jan 1991
    expect(getLandtagAnchor("BW", "1991-default")).toBe(60);
    // RP Landtag: April 1991 ≈ 12 turns
    expect(getLandtagAnchor("RP", "1991-default")).toBe(12);
    // BY Landtag: Sep 1994 ≈ 176 turns
    expect(getLandtagAnchor("BY", "1991-default")).toBe(176);
  });

  it("returns undefined for unknown land in either preset", () => {
    expect(getLandtagAnchor("ZZZ", "2019-default")).toBeUndefined();
    expect(getLandtagAnchor("ZZZ", "1991-default")).toBeUndefined();
  });

  it("all 16 Länder have a 1991 anchor", () => {
    const ids = Object.keys(LANDTAG_CYCLE1_END_TURN_BY_LAND);
    for (const id of ids) {
      expect(
        LANDTAG_CYCLE1_END_TURN_BY_LAND_1991[id],
        `missing 1991 anchor for ${id}`
      ).toBeGreaterThan(0);
    }
    expect(Object.keys(LANDTAG_CYCLE1_END_TURN_BY_LAND_1991)).toHaveLength(16);
  });

  it("1991 anchors are all less than 2019 anchors (earlier elections)", () => {
    for (const id of Object.keys(LANDTAG_CYCLE1_END_TURN_BY_LAND)) {
      expect(LANDTAG_CYCLE1_END_TURN_BY_LAND_1991[id]).toBeLessThan(
        LANDTAG_CYCLE1_END_TURN_BY_LAND[id]
      );
    }
  });
});
