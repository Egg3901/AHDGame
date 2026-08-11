import { describe, it, expect, beforeEach } from "vitest";
import { getBucketProfileForRegion } from "./bucketProfile";
import { deriveGranularElectorateUnits, clearGranularElectorateCache } from "./granularElectorate";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import type { StateDemographicTurnout } from "@/lib/db/types/stateDemographicTurnout";

const PRESET = "1953-default";

function firstRegion(cc: string): string {
  return Object.keys(getCountryLayer1Model(cc, eraForPreset(PRESET))!.census)[0];
}

describe("bucket profile", () => {
  beforeEach(() => clearGranularElectorateCache());

  it.each(["UK", "DE", "JP"])("%s: every dimension's shares sum to 100", (cc) => {
    const profile = getBucketProfileForRegion(cc, firstRegion(cc), PRESET)!;
    expect(profile.length).toBeGreaterThan(0);
    for (const section of profile) {
      const total = section.buckets.reduce((s, b) => s + b.sharePct, 0);
      expect(total, `${cc} ${section.dim}`).toBeCloseTo(100, 4);
    }
  });

  it("US: shares sum to 100 per dimension", () => {
    const profile = getBucketProfileForRegion("US", "CT", PRESET)!;
    for (const section of profile) {
      expect(section.buckets.reduce((s, b) => s + b.sharePct, 0)).toBeCloseTo(100, 4);
    }
  });

  // The tab must not disagree with the vote engine: the electorate-wide mean
  // lean computed from the buckets has to equal the mean over the raw units.
  it("agrees with the engine on the region's mean lean", () => {
    const region = firstRegion("UK");
    const units = deriveGranularElectorateUnits("UK", region, PRESET, null)!.units;
    const w = units.reduce((s, u) => s + u.share, 0);
    const engineEcon = units.reduce((s, u) => s + u.share * u.economicLean, 0) / w;

    const profile = getBucketProfileForRegion("UK", region, PRESET)!;
    for (const section of profile) {
      const fromBuckets =
        section.buckets.reduce((s, b) => s + b.sharePct * b.economicLean, 0) / 100;
      expect(fromBuckets, section.dim).toBeCloseTo(engineEcon, 4);
    }
  });

  it("reflects a live turnout modifier", () => {
    const region = firstRegion("UK");
    const base = getBucketProfileForRegion("UK", region, PRESET)!;
    const doc = { modifiers: { income: { low: 25 } } } as unknown as StateDemographicTurnout;
    const boosted = getBucketProfileForRegion("UK", region, PRESET, doc)!;
    const lowOf = (p: typeof base) =>
      p.find((s) => s.dim === "income")!.buckets.find((b) => b.id === "income:low")!.turnout;
    expect(lowOf(boosted)).toBeGreaterThan(lowOf(base));
  });

  it("returns null for a region with no Layer-1 substrate", () => {
    expect(getBucketProfileForRegion("ZZ", "NOWHERE", PRESET)).toBeNull();
  });
});
