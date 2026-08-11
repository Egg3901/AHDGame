import { describe, it, expect } from "vitest";
import {
  getTurnoutTargetsForCountry,
  isTargetValidForCountry,
  turnoutTargetIdsForCountry,
} from "./turnoutTargets";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { eraForPreset } from "@/lib/seeds/presetSelector";

const PRESET = "1953-default";
const INTL = ["UK", "DE", "JP", "BR", "RU", "SE"];

describe("turnout targets are the country's own buckets", () => {
  // The load-bearing assertion. A fixed US bucket list (race/wealth) would pass
  // every US test and silently offer buckets no other country has — the boost is
  // charged, stored, and lands on nobody. That is the exact failure this whole
  // change exists to remove, so it is asserted against the real substrate.
  it.each(INTL)("%s targets exist in that country's Layer-1 model", (cc) => {
    const model = getCountryLayer1Model(cc, eraForPreset(PRESET));
    expect(model, `${cc} has no Layer-1 model`).not.toBeNull();
    const real = new Set(
      model!.dims.flatMap((d) => Object.keys(model!.turnoutRates[d] ?? {}).map((k) => `${d}:${k}`))
    );
    const offered = turnoutTargetIdsForCountry(cc, PRESET);
    expect(offered.size).toBeGreaterThan(0);
    for (const id of offered) expect(real.has(id), `${cc} offers ${id}`).toBe(true);
  });

  it("offers the US census dimensions for the US", () => {
    const dims = getTurnoutTargetsForCountry("US", PRESET).map((s) => s.dim);
    expect(dims).toEqual(["race", "age", "education", "wealth"]);
  });

  it("does not offer US buckets abroad, nor foreign buckets in the US", () => {
    expect(isTargetValidForCountry("race:black", "US", PRESET)).toBe(true);
    expect(isTargetValidForCountry("race:black", "UK", PRESET)).toBe(false);
    expect(isTargetValidForCountry("wealth:low", "UK", PRESET)).toBe(false);
    expect(isTargetValidForCountry("ethnicity:white_british", "UK", PRESET)).toBe(true);
    expect(isTargetValidForCountry("ethnicity:white_british", "US", PRESET)).toBe(false);
    // Germany's education keys are its own — the UK's must not validate there.
    expect(isTargetValidForCountry("education:degree_plus", "UK", PRESET)).toBe(true);
    expect(isTargetValidForCountry("education:degree_plus", "DE", PRESET)).toBe(false);
  });

  it("never renders a target as a raw key or blank", () => {
    for (const cc of ["US", ...INTL]) {
      for (const section of getTurnoutTargetsForCountry(cc, PRESET)) {
        expect(section.dimLabel).not.toContain("_");
        for (const o of section.options) {
          expect(o.label.trim(), `${cc} ${o.id}`).not.toBe("");
          expect(o.label, `${cc} ${o.id}`).not.toContain("_");
          expect(o.label, `${cc} ${o.id}`).not.toContain(":");
        }
      }
    }
  });

  it("returns nothing for a country with no Layer-1 model rather than throwing", () => {
    expect(getTurnoutTargetsForCountry("ZZ", PRESET)).toEqual([]);
  });
});
