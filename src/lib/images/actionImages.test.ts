import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bypassNextImageOptimization } from "./bypassImageOptimization";
import {
  ACTION_ART_REVISIONS,
  ACTION_IMAGE_SLUGS,
  countriesWithArt,
  erasWithGenericSet,
  getActionImage,
  hasCountryActionImage,
  NEUTRAL_ART_FOLDER,
} from "./actionImages";
import { eraForPreset } from "@/lib/seeds/presetSelector";

const PRESETS = [
  "1953-default",
  "1979-default",
  "1991-default",
  "1999-default",
  "2007-default",
  "2019-default",
  "2023-default",
  "2027-default",
  "empty",
  "2019-no-parties",
];

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

  it("serves each modern era its own set, not the neutral or another era's", () => {
    for (const era of ["1991", "1999", "2007", "2019", "2023", "2027"]) {
      const rev = ACTION_ART_REVISIONS[`${era}/campaign`];
      expect(getActionImage("campaign", { era, countryId: "US" })).toBe(
        `${BASE}/${era}/campaign${rev ? `-v${rev}` : ""}.webp`
      );
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

  it("falls back to the era-neutral set when the era is unknown, never the flat legacy files", () => {
    expect(getActionImage("poll")).toBe(`${BASE}/neutral/poll.webp`);
    expect(getActionImage("poll", { era: null, countryId: null })).toBe(
      `${BASE}/neutral/poll.webp`
    );
    expect(getActionImage("poll", { era: "1960", countryId: "US" })).toBe(
      `${BASE}/neutral/poll.webp`
    );
    expect(getActionImage("fundraise", { era: "1960" })).toBe(`${BASE}/neutral/fundraise-v2.webp`);
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

describe("era isolation", () => {
  const countries = ["US", "UK", "FR", "DD", "RU", "DE", "JP", "IT", "XX", null];
  const eras = [...PRESETS.map(eraForPreset), "1960", "1973", "unknown", null];

  it("every preset's era has its own complete generic set", () => {
    for (const preset of PRESETS) {
      expect(erasWithGenericSet(), preset).toContain(eraForPreset(preset));
    }
  });

  it("every era x country x action resolves to that era's art or the neutral set", () => {
    for (const era of eras) {
      for (const countryId of countries) {
        for (const slug of ACTION_IMAGE_SLUGS) {
          const url = getActionImage(slug, { era, countryId });
          const rel = url.slice(BASE.length + 1);
          const folder = rel.split("/")[0];
          const own = era !== null && erasWithGenericSet().includes(era);
          // strip the `-v<n>` revision suffix; the folder is what isolation is about
          expect(folder, `${era}/${countryId}/${slug} -> ${url}`).toBe(
            own ? era : NEUTRAL_ART_FOLDER
          );
          // National art, when present, stays inside the same era folder.
          if (rel.split("/").length === 3) expect(rel.split("/")[1]).toBe(countryId);
        }
      }
    }
  });

  it("never serves the flat legacy files", () => {
    for (const era of eras) {
      for (const countryId of countries) {
        for (const slug of ACTION_IMAGE_SLUGS) {
          expect(getActionImage(slug, { era, countryId })).not.toBe(`${BASE}/${slug}.webp`);
        }
      }
    }
  });

  it("the neutral set has a recorded source for every slug", () => {
    const sources = JSON.parse(
      readFileSync(path.join(process.cwd(), "scripts", "action-image-sources.json"), "utf8")
    ) as Record<string, unknown>;
    for (const slug of ACTION_IMAGE_SLUGS) {
      expect(`${NEUTRAL_ART_FOLDER}/${slug}` in sources, slug).toBe(true);
    }
  });
});

describe("replaced art revisions", () => {
  const sources: Record<string, { revision?: number }> = JSON.parse(
    readFileSync(path.join(process.cwd(), "scripts", "action-image-sources.json"), "utf8")
  );

  it("serves a replaced image under its versioned name, never the cached original", () => {
    expect(getActionImage("fundraise", { era: "2023", countryId: "US" })).toBe(
      `${BASE}/2023/fundraise-v2.webp`
    );
    expect(getActionImage("canvass", { era: "2027" })).toBe(`${BASE}/2027/canvass-v2.webp`);
    // Untouched art keeps its original name.
    expect(getActionImage("poll", { era: "2023" })).toBe(`${BASE}/2023/poll.webp`);
  });

  it("keeps the resolver revisions equal to the source manifest", () => {
    const fromManifest = Object.fromEntries(
      Object.entries(sources)
        .filter(([key, v]) => !key.startsWith("_") && v.revision)
        .map(([key, v]) => [key, v.revision])
    );
    expect(ACTION_ART_REVISIONS).toEqual(fromManifest);
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
