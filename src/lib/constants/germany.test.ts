import { describe, expect, it } from "vitest";
import { getDERegionImage } from "./germany";
import { deRegions } from "@/lib/seeds/de/deRegions";

describe("getDERegionImage", () => {
  // A nonexistent id returns the shared Reichstag fallback.
  const fallback = getDERegionImage("__no_such_land__");

  it("has a dedicated banner for every Bundesland id (no silent fallback)", () => {
    // Regression guard for the Bremen HB→BRE state-id collision: the image map
    // was keyed by the real-world code "HB" while the Land seeds as "BRE", so
    // getDERegionImage(land._id) silently fell back to the Reichstag default.
    const usingFallback = deRegions
      .filter((land) => getDERegionImage(land._id) === fallback)
      .map((land) => land._id);
    expect(usingFallback).toEqual([]);
  });

  it("resolves Bremen (BRE) to its own banner, not the fallback", () => {
    expect(getDERegionImage("BRE")).not.toBe(fallback);
    expect(getDERegionImage("BRE")).toContain("Bremer_Rathaus");
  });
});
