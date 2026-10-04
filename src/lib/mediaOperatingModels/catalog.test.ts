import { describe, expect, it } from "vitest";
import { TECH_TREE } from "@/lib/constants/techTree/nodes";
import {
  getMediaOperatingModel,
  MEDIA_OPERATING_MODELS,
  mediaOperatingModelOutputRates,
} from "./catalog";

describe("media operating model catalog", () => {
  it("lists only the current media and entertainment sector lanes", () => {
    expect(MEDIA_OPERATING_MODELS).toHaveLength(8);
    expect(MEDIA_OPERATING_MODELS.flatMap((model) => model.sectorTypes)).not.toContain(
      "media_entertainment"
    );
  });

  it("keeps streaming outside the 1953 opening world and on the existing media tech lane", () => {
    const streaming = getMediaOperatingModel("streaming_platform");
    expect(streaming?.availableFromYear).toBeGreaterThan(1953);
    expect(streaming?.technology).toEqual({
      sectorType: "media",
      decade: "2009",
      nodeName: "Streaming Platforms",
    });
  });

  it("points every paid technology prerequisite at a node in its existing sector lane", () => {
    for (const model of MEDIA_OPERATING_MODELS) {
      if (!model.technology) continue;
      const nodeExists = TECH_TREE[model.technology.sectorType].some(
        (node) =>
          node.decadeId === model.technology?.decade && node.name === model.technology?.nodeName
      );
      expect(nodeExists, model.id).toBe(true);
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
