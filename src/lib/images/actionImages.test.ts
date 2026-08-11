import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bypassNextImageOptimization } from "./bypassImageOptimization";
import {
  ACTION_IMAGE_SLUGS,
  countriesWithArt,
  erasWithGenericSet,
  getActionImage,
  hasCountryActionImage,
} from "./actionImages";

const BASE = "https://cdn.ahousedividedgame.com/static/actions";

describe("getActionImage", () => {
  it("serves national art when the era + country has it", () => {
    expect(getActionImage("campaign", { era: "1953", countryId: "US" })).toBe(
      `${BASE}/1953/US/campaign.webp`
    );
    expect(getActionImage("hero", { era: "1953", countryId: "DD" })).toBe(
      `${BASE}/1953/DD/hero.webp`
    );
  });

  it("falls back to the era-generic set for a slug the country has no art for", () => {
    // FR only overrides `advertise`; everything else is the shared 1953 set.
    expect(getActionImage("advertise", { era: "1953", countryId: "FR" })).toBe(
      `${BASE}/1953/FR/advertise.webp`
    );
    expect(getActionImage("flipflop", { era: "1953", countryId: "FR" })).toBe(
      `${BASE}/1953/flipflop.webp`
    );
  });

  it("falls back to the era-generic set for a country with no national art at all", () => {
    expect(getActionImage("campaign", { era: "1953", countryId: "IT" })).toBe(
      `${BASE}/1953/campaign.webp`
    );
  });

  it("falls back to the legacy flat set for eras with no uploaded set", () => {
    for (const era of ["2019", "2023", "1991", "1999", "2007"]) {
      expect(getActionImage("campaign", { era, countryId: "US" })).toBe(`${BASE}/campaign.webp`);
    }
  });

  it("serves the 1979 set, national where it exists and generic where it does not", () => {
    expect(getActionImage("campaign", { era: "1979", countryId: "RU" })).toBe(
      `${BASE}/1979/RU/campaign.webp`
    );
    // UK 1979 only overrides `campaign` — canvass was dropped in review.
    expect(getActionImage("canvass", { era: "1979", countryId: "UK" })).toBe(
      `${BASE}/1979/canvass.webp`
    );
    // FR has 1953 art but none in 1979; it must not leak across eras.
    expect(getActionImage("advertise", { era: "1979", countryId: "FR" })).toBe(
      `${BASE}/1979/advertise.webp`
    );
  });

  it("falls back to the legacy flat set when era or country is unknown", () => {
    expect(getActionImage("poll")).toBe(`${BASE}/poll.webp`);
    expect(getActionImage("poll", { era: null, countryId: null })).toBe(`${BASE}/poll.webp`);
    expect(getActionImage("poll", { era: "1953" })).toBe(`${BASE}/1953/poll.webp`);
  });

  it("returns URLs the image optimizer must bypass (CDN egress is not billed via Railway)", () => {
    for (const slug of ACTION_IMAGE_SLUGS) {
      expect(
        bypassNextImageOptimization(getActionImage(slug, { era: "1953", countryId: "US" }))
      ).toBe(true);
    }
  });
});

describe("hasCountryActionImage", () => {
  it("is true only for listed (era, country, slug) triples", () => {
    expect(hasCountryActionImage("campaign", "1953", "UK")).toBe(true);
    expect(hasCountryActionImage("flipflop", "1953", "UK")).toBe(false);
    expect(hasCountryActionImage("campaign", "2019", "US")).toBe(false);
    expect(hasCountryActionImage("campaign", null, "US")).toBe(false);
    expect(hasCountryActionImage("campaign", "1953", null)).toBe(false);
  });
});

describe("action image sources", () => {
  // The resolver never probes the CDN: an entry listed in ERA_COUNTRY_SLUGS but
  // missing from the source manifest would 404 in production instead of quietly
  // falling back. Keep the two in lockstep.
  const sources: Record<string, unknown> = JSON.parse(
    readFileSync(path.join(process.cwd(), "scripts", "action-image-sources.json"), "utf8")
  );
  const keys = new Set(Object.keys(sources).filter((k) => !k.startsWith("_")));

  it("has a source for every slug each generic set promises", () => {
    // A listed era resolves EVERY slug to `<era>/<slug>.webp` with no further
    // fallback, so a hole here is a 404 in production, not a graceful degrade.
    for (const era of erasWithGenericSet()) {
      for (const slug of ACTION_IMAGE_SLUGS) {
        expect(keys.has(`${era}/${slug}`), `missing source for ${era}/${slug}`).toBe(true);
      }
    }
  });

  it("has a source for every national override the resolver advertises", () => {
    for (const era of erasWithGenericSet()) {
      for (const countryId of countriesWithArt(era)) {
        for (const slug of ACTION_IMAGE_SLUGS) {
          if (!hasCountryActionImage(slug, era, countryId)) continue;
          expect(
            keys.has(`${era}/${countryId}/${slug}`),
            `missing source for ${era}/${countryId}/${slug}`
          ).toBe(true);
        }
      }
    }
  });

  it("advertises a national override for every national source", () => {
    for (const key of keys) {
      const parts = key.split("/");
      if (parts.length !== 3) continue;
      const [era, countryId, slug] = parts;
      expect(
        hasCountryActionImage(slug as (typeof ACTION_IMAGE_SLUGS)[number], era, countryId),
        `${key} is fetched and uploaded but ERA_COUNTRY_SLUGS never serves it`
      ).toBe(true);
    }
  });
});
