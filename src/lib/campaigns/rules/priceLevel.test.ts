/**
 * Era price-level table tests (issue #2119).
 *
 * Pins three things: (1) table sanity (2019 === 1, monotonic across eras,
 * unknown === 1), (2) the table stays consistent with the US row of the #798
 * GDP-per-capita baseline it is derived from, and (3) the feature-gated
 * resolver is exactly 1 whenever the flag is off/absent.
 */
import { describe, expect, it } from "vitest";
import {
  ERA_PRICE_LEVEL,
  MODERN_PRICE_LEVEL,
  eraPriceLevelFor,
  resolveCampaignPriceLevel,
} from "./priceLevel";
import { getGdpBaselineTable } from "./gdpBaseline";
import type { EraId } from "@/lib/seeds/presetSelector";

const ERAS: EraId[] = ["1953", "1979", "1991", "1999", "2007", "2019", "2023", "2027"];

describe("ERA_PRICE_LEVEL table sanity", () => {
  it("anchors the modern era at exactly 1.0", () => {
    expect(ERA_PRICE_LEVEL["2019"]).toBe(1);
    expect(MODERN_PRICE_LEVEL).toBe(1);
    expect(eraPriceLevelFor("2019-default")).toBe(1);
    expect(eraPriceLevelFor("2019")).toBe(1);
  });

  it("deflates 1953 to a small fraction of the modern baseline", () => {
    expect(ERA_PRICE_LEVEL["1953"]).toBeGreaterThan(0);
    expect(ERA_PRICE_LEVEL["1953"]).toBeLessThan(0.1);
  });

  it("is strictly monotonic across the chronological eras", () => {
    for (let i = 1; i < ERAS.length; i++) {
      expect(ERA_PRICE_LEVEL[ERAS[i]], `${ERAS[i - 1]} -> ${ERAS[i]} must rise`).toBeGreaterThan(
        ERA_PRICE_LEVEL[ERAS[i - 1]]
      );
    }
  });

  it("covers every EraId", () => {
    for (const era of ERAS) {
      expect(typeof ERA_PRICE_LEVEL[era], era).toBe("number");
      expect(Number.isFinite(ERA_PRICE_LEVEL[era]), era).toBe(true);
    }
  });
});

describe("eraPriceLevelFor resolution", () => {
  it("accepts an era id or a preset id equivalently", () => {
    for (const era of ERAS) {
      expect(eraPriceLevelFor(era)).toBe(ERA_PRICE_LEVEL[era]);
      expect(eraPriceLevelFor(`${era}-default`)).toBe(ERA_PRICE_LEVEL[era]);
    }
  });

  it("treats 2019-family presets as the modern baseline", () => {
    expect(eraPriceLevelFor("empty")).toBe(1);
    expect(eraPriceLevelFor("2019-no-parties")).toBe(1);
  });

  it("fails safe to 1 for unknown or missing input", () => {
    for (const input of [undefined, null, "", "bogus-default", "constructor", "__proto__"]) {
      expect(eraPriceLevelFor(input)).toBe(1);
    }
  });
});

describe("derived-vs-baseline consistency", () => {
  it("equals the US nominal GDP-per-capita ratio to the 2019 baseline", () => {
    const us = getGdpBaselineTable().US;
    const modern = us["2019"];
    // The table is rounded to 5 decimals, so the raw ratio must match within
    // 1e-5. Recompute here so a seed edit that moves the US row fails loudly.
    for (const era of ERAS) {
      const ratio = us[era] / modern;
      expect(
        Math.abs(ERA_PRICE_LEVEL[era] - ratio),
        `${era}: table=${ERA_PRICE_LEVEL[era]} ratio=${ratio}`
      ).toBeLessThan(1e-5);
    }
  });

  it("keeps 2019 the single 1.0 cell and matches the raw ratio there", () => {
    const us = getGdpBaselineTable().US;
    expect(us["2019"]).toBe(69_618);
    expect(ERA_PRICE_LEVEL["2019"]).toBe(1);
  });
});

describe("resolveCampaignPriceLevel feature gate", () => {
  it("is exactly 1 when the flag is false, null, or absent", () => {
    for (const enabled of [false, undefined, null]) {
      for (const preset of ["1953-default", "2019-default", "bogus", undefined]) {
        expect(resolveCampaignPriceLevel(enabled, preset)).toBe(1);
      }
    }
  });

  it("returns the era value only when the flag is true", () => {
    expect(resolveCampaignPriceLevel(true, "1953-default")).toBe(ERA_PRICE_LEVEL["1953"]);
    expect(resolveCampaignPriceLevel(true, "2019-default")).toBe(1);
    expect(resolveCampaignPriceLevel(true, "2027-default")).toBe(ERA_PRICE_LEVEL["2027"]);
    // Unknown preset with the flag on still fails safe to the modern value.
    expect(resolveCampaignPriceLevel(true, "bogus")).toBe(1);
  });
});
