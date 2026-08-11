import { describe, expect, it } from "vitest";
import { resolveRegionBannerImage } from "./regionBanner";
import { getIERegionImage } from "./ireland";
import { getRURegionImage } from "./ruRegionImages";
import { getDDRegionImage } from "./ddRegionImages";
import { RU_REGION_CODES } from "../maps/ruGeometry";
import { ddRegions } from "../seeds/dd/ddRegions";

// The 8 playable IE NUTS-III regions (ids match lib/seeds/ie/ieRegions.ts).
const IE_REGION_IDS = ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"];

describe("resolveRegionBannerImage", () => {
  it("returns a dedicated banner for every IE region (regression: IE was missing)", () => {
    for (const id of IE_REGION_IDS) {
      const src = resolveRegionBannerImage("IE", id);
      expect(src, `expected a banner for IE/${id}`).toBeTruthy();
      expect(src).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    }
  });

  it("gives each IE region a distinct image", () => {
    const urls = IE_REGION_IDS.map((id) => resolveRegionBannerImage("IE", id));
    expect(new Set(urls).size).toBe(IE_REGION_IDS.length);
  });

  it("falls back to the IE default for an unknown IE region id", () => {
    expect(resolveRegionBannerImage("IE", "ZZZ")).toBe(getIERegionImage("ZZZ"));
  });

  it("lets an admin bannerImage override win for IE", () => {
    const override = "https://example.com/custom-dublin.jpg";
    expect(resolveRegionBannerImage("IE", "DUB", override)).toBe(override);
  });
});

describe("RU/DD region banners", () => {
  it("returns a dedicated, distinct banner for every USSR macro-region", () => {
    const urls = RU_REGION_CODES.map((id) => resolveRegionBannerImage("RU", id));
    for (const [i, src] of urls.entries()) {
      expect(src, `expected a banner for RU/${RU_REGION_CODES[i]}`).toMatch(
        /^https:\/\/commons\.wikimedia\.org\//
      );
    }
    expect(new Set(urls).size).toBe(RU_REGION_CODES.length);
  });

  it("returns a dedicated, distinct banner for every DD Land (both Cold-War presets)", () => {
    const ids = ddRegions.map((r) => r._id);
    const urls = ids.map((id) => resolveRegionBannerImage("DD", id));
    for (const [i, src] of urls.entries()) {
      expect(src, `expected a banner for DD/${ids[i]}`).toMatch(
        /^https:\/\/commons\.wikimedia\.org\//
      );
    }
    expect(new Set(urls).size).toBe(ids.length);
  });

  it("falls back to the country default for unknown ids and lets admin overrides win", () => {
    expect(resolveRegionBannerImage("RU", "ZZZ")).toBe(getRURegionImage("ZZZ"));
    expect(resolveRegionBannerImage("DD", "ZZZ")).toBe(getDDRegionImage("ZZZ"));
    const override = "https://example.com/custom.jpg";
    expect(resolveRegionBannerImage("RU", "CEN", override)).toBe(override);
    expect(resolveRegionBannerImage("DD", "BEO", override)).toBe(override);
  });
});

describe("getIERegionImage", () => {
  it("returns the default (Cliffs of Moher) for an unknown region", () => {
    const def = getIERegionImage("ZZZ");
    expect(def).toContain("Cliffs-Of-Moher");
  });

  it("returns a distinct, defined image for each known region", () => {
    for (const id of IE_REGION_IDS) {
      expect(getIERegionImage(id)).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    }
  });
});
