import { describe, expect, it } from "vitest";
import { TECH_TREE } from "@/lib/constants/techTree/nodes";
import {
  effectiveMediaOperatingModelId,
  getMediaOperatingModel,
  MEDIA_OPERATING_MODELS,
  mediaOperatingModelOutputRates,
} from "./catalog";

describe("media operating model catalog", () => {
  it("lists only the current media and entertainment sector lanes", () => {
    expect(MEDIA_OPERATING_MODELS).toHaveLength(8);
    expect(
      [...new Set(MEDIA_OPERATING_MODELS.flatMap((model) => model.sectorTypes))].sort()
    ).toEqual(["media", "media_entertainment"]);
  });

  it("keeps streaming outside the 1953 opening world and on the current tech lanes", () => {
    const streaming = getMediaOperatingModel("streaming_platform");
    expect(streaming?.availableFromYear).toBeGreaterThan(1953);
    expect(streaming?.technologies).toEqual({
      media: { decade: "2009", nodeName: "Streaming Platforms" },
      media_entertainment: { decade: "2009", nodeName: "Streaming Distribution" },
    });
  });

  it("resolves unset and standard media strategies to newspaper for advertising", () => {
    for (const strategyId of [undefined, null, "", "   ", "standard"]) {
      expect(effectiveMediaOperatingModelId(strategyId, "media", 1953)).toBe("newspaper");
    }
  });

  it("resolves legacy broadcast to radio before 1950 and television from 1950", () => {
    expect(effectiveMediaOperatingModelId("legacy_broadcast", "media", 1949)).toBe("radio_network");
    expect(effectiveMediaOperatingModelId("legacy_broadcast", "media", 1950)).toBe("broadcast_tv");
  });

  it("uses explicit catalogued models when they are available for the sector and year", () => {
    expect(effectiveMediaOperatingModelId("broadcast_tv", "media", 1950)).toBe("broadcast_tv");
    expect(effectiveMediaOperatingModelId("film_studio", "media_entertainment", 1910)).toBe(
      "film_studio"
    );
    expect(effectiveMediaOperatingModelId("streaming_platform", "media", 2005)).toBe(
      "streaming_platform"
    );
  });

  it("returns undefined for non-media, unmapped, mismatched, unavailable, or unknown-year inputs", () => {
    expect(effectiveMediaOperatingModelId("newspaper", "manufacturing", 1953)).toBeUndefined();
    expect(effectiveMediaOperatingModelId("film_studio", "media", 1953)).toBeUndefined();
    expect(effectiveMediaOperatingModelId("streaming_platform", "media", 2004)).toBeUndefined();
    expect(effectiveMediaOperatingModelId("legacy_broadcast", "media", 1919)).toBeUndefined();
    expect(effectiveMediaOperatingModelId("retired_strategy", "media", 2000)).toBeUndefined();
    expect(effectiveMediaOperatingModelId("newspaper", "media", undefined)).toBeUndefined();
  });

  it("points every paid technology prerequisite at a node in its existing sector lane", () => {
    for (const model of MEDIA_OPERATING_MODELS) {
      for (const [sectorType, technology] of Object.entries(model.technologies)) {
        const node = TECH_TREE[sectorType as "media" | "media_entertainment"].find(
          (candidate) =>
            candidate.decadeId === technology.decade && candidate.name === technology.nodeName
        );
        expect(
          node?.effects.some(
            (effect) => effect.kind === "unlockStrategy" && effect.strategyId === model.id
          ),
          `${model.id} on ${sectorType}`
        ).toBe(true);
      }
    }
  });

  it("preserves the legacy base-value budget while allowing recipe unit yield to change", () => {
    const rates = mediaOperatingModelOutputRates(
      { advertising: 0.2, entertainment_services: 0.4 },
      { advertising: 0.25, entertainment_services: 0.75 }
    );
    expect(Object.values(rates).reduce((sum, rate) => sum + (rate ?? 0), 0)).toBeCloseTo(0.6);

    const legacyYield = 0.2 / 20_000 + 0.4 / 18_000;
    const modelYield =
      (rates.advertising ?? 0) / 20_000 + (rates.entertainment_services ?? 0) / 18_000;
    expect(Math.abs(modelYield - legacyYield)).toBeGreaterThan(1e-8);
    expect(
      ((rates.advertising ?? 0) / 20_000) * 20_000 +
        ((rates.entertainment_services ?? 0) / 18_000) * 18_000
    ).toBeCloseTo(0.6);
  });

  it("rejects empty, invalid, or non-normalized value shares", () => {
    expect(mediaOperatingModelOutputRates({ advertising: 0.5 }, {})).toEqual({});
    expect(mediaOperatingModelOutputRates({ advertising: 0.5 }, { advertising: 0.8 })).toEqual({});
    expect(mediaOperatingModelOutputRates({ advertising: Number.NaN }, { advertising: 1 })).toEqual(
      {}
    );
  });
});
