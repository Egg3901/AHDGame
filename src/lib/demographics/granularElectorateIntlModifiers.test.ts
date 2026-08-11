import { describe, it, expect, beforeEach } from "vitest";
import { deriveGranularElectorateUnits, clearGranularElectorateCache } from "./granularElectorate";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import type { StateDemographicTurnout } from "@/lib/db/types/stateDemographicTurnout";

const PRESET = "1953-default";

function firstRegion(cc: string): string {
  const model = getCountryLayer1Model(cc, eraForPreset(PRESET))!;
  return Object.keys(model.census)[0];
}

function meanTurnout(units: { share: number; turnout: number }[]): number {
  const w = units.reduce((s, u) => s + u.share, 0);
  return units.reduce((s, u) => s + u.share * u.turnout, 0) / w;
}

function doc(modifiers: Record<string, Record<string, number>>): StateDemographicTurnout {
  return { modifiers } as unknown as StateDemographicTurnout;
}

/**
 * Outside the US, a turnout modifier stored per-group used to reach the granular
 * electorate only as a whole-state aggregate ratio, or — for a bucket the
 * archetype map could not place — not at all. Bucket-targeted actions write
 * dim-keyed modifiers, and those must move that dimension's voters natively, the
 * same way they always have on the US census path.
 */
describe("dim-keyed turnout modifiers apply natively outside the US", () => {
  beforeEach(() => clearGranularElectorateCache());

  it.each(["UK", "DE", "JP"])("%s: an income:low boost raises turnout", (cc) => {
    const region = firstRegion(cc);
    const base = deriveGranularElectorateUnits(cc, region, PRESET, null);
    const boosted = deriveGranularElectorateUnits(cc, region, PRESET, doc({ income: { low: 25 } }));
    expect(base, cc).not.toBeNull();
    expect(boosted, cc).not.toBeNull();
    expect(meanTurnout(boosted!.units)).toBeGreaterThan(meanTurnout(base!.units));
  });

  it("moves only the targeted dimension", () => {
    const region = firstRegion("UK");
    const base = deriveGranularElectorateUnits("UK", region, PRESET, null)!;
    const boosted = deriveGranularElectorateUnits(
      "UK",
      region,
      PRESET,
      doc({ ethnicity: { white_british: 20 } })
    )!;
    expect(meanTurnout(boosted.units)).toBeGreaterThan(meanTurnout(base.units));
    // Population shares are a census fact; a turnout modifier must not touch them.
    const shareOf = (u: { share: number }[]) => u.reduce((s, x) => s + x.share, 0);
    expect(shareOf(boosted.units)).toBeCloseTo(shareOf(base.units), 6);
  });

  // Archetype-keyed modifiers keep going through the aggregate-ratio path, so
  // they must remain inert here or they would be counted twice.
  it("ignores archetype-keyed modifiers, which the aggregate ratio still owns", () => {
    const region = firstRegion("UK");
    const base = deriveGranularElectorateUnits("UK", region, PRESET, null)!;
    const withArchetype = deriveGranularElectorateUnits(
      "UK",
      region,
      PRESET,
      doc({ voterGroups: { post_industrial_workers: 25 } })
    )!;
    expect(meanTurnout(withArchetype.units)).toBeCloseTo(meanTurnout(base.units), 6);
    expect(withArchetype.modifiersNative).toBe(false);
  });

  it("ignores a bucket key the country's model does not have", () => {
    const region = firstRegion("UK");
    const base = deriveGranularElectorateUnits("UK", region, PRESET, null)!;
    // `wealth` is a US dimension; the UK model has `income`.
    const foreign = deriveGranularElectorateUnits(
      "UK",
      region,
      PRESET,
      doc({ wealth: { low: 25 } })
    )!;
    expect(meanTurnout(foreign.units)).toBeCloseTo(meanTurnout(base.units), 6);
  });
});
