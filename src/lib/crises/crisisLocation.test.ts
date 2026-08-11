import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { interpolateLocation, resolveCrisisLocationName } from "./crisisLocation";

const noopDb = {} as unknown as Db; // unused for the cases below (no DB lookups)

describe("interpolateLocation", () => {
  it("replaces every {location} token", () => {
    expect(interpolateLocation("A quake hit {location} near {location}.", "California")).toBe(
      "A quake hit California near California."
    );
  });

  it("is a no-op for text without the token (safe to run twice)", () => {
    const baked = "A quake hit California.";
    expect(interpolateLocation(baked, "Texas")).toBe(baked);
  });

  it("handles empty text", () => {
    expect(interpolateLocation("", "California")).toBe("");
  });
});

describe("resolveCrisisLocationName", () => {
  it("joins region names provided by the caller without a DB hit", async () => {
    const name = await resolveCrisisLocationName(
      noopDb,
      { scope: "region", countryIds: ["US"], regionIds: ["CA", "TX"] },
      ["California", "Texas"]
    );
    expect(name).toBe("California and Texas");
  });

  it("falls back when a region has no resolved name", async () => {
    const name = await resolveCrisisLocationName(
      noopDb,
      { scope: "region", countryIds: ["US"], regionIds: ["CA"] },
      []
    );
    expect(name).toBe("the affected region");
  });

  it("uses full country names for country scope", async () => {
    const name = await resolveCrisisLocationName(noopDb, {
      scope: "country",
      countryIds: ["US"],
      regionIds: [],
    });
    expect(name.length).toBeGreaterThan(2);
    expect(name).not.toBe("US");
  });

  it("describes a global crisis generically", async () => {
    const name = await resolveCrisisLocationName(noopDb, {
      scope: "global",
      countryIds: [],
      regionIds: [],
    });
    expect(name).toBe("communities around the world");
  });
});
