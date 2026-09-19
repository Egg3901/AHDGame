import { describe, expect, it } from "vitest";
import { applyEraRevenueCap } from "./revenue";

const GDP = 1_000_000;

describe("era revenue Laffer soft-cap", () => {
  it("flag off (year null): raw total unchanged", () => {
    expect(applyEraRevenueCap(0.58 * GDP, GDP, null)).toBeCloseTo(0.58 * GDP);
  });

  it("below the knee (<=40% of GDP): unchanged even flag on", () => {
    expect(applyEraRevenueCap(0.35 * GDP, GDP, 2019)).toBeCloseTo(0.35 * GDP);
  });

  it("punitive aggregate rates compress toward a ~47% ceiling", () => {
    // 58% raw ⇒ 40% + (18%×0.4) = 47.2%
    expect(applyEraRevenueCap(0.58 * GDP, GDP, 2019) / GDP).toBeCloseTo(0.472);
    // 70% raw ⇒ 40% + (30%×0.4) = 52% (asymptotic, never lets max-tax fund max-spend)
    expect(applyEraRevenueCap(0.7 * GDP, GDP, 2019) / GDP).toBeCloseTo(0.52);
  });

  // 1953 Stalinist command economies (BG/CS/HU/PL/RO/YU — the
  // makeEasternBlocBudget1953 factory in seeds/reference/budgets.ts) are
  // authored to run 45-70% of GDP through the fiscal budget (Holzman / CIA
  // NMP-to-budget series, cited alongside these countries' tax bases in
  // budgets.ts) — their own authored day-one default (Total Surplus
  // Remittance 70% + Maximal Turnover Tax 26%) computes to ≈52% of GDP raw,
  // already above the generic 40% knee. Without a country-aware knee, this
  // cap compressed that authored default (and any in-game reform of it) down
  // to ~41-45%, turning the bloc's own documented "small planned deficit"
  // (spending ≈54% GDP vs ≈52% revenue) into an unintended ~13%-of-GDP
  // deficit that was never seeded (fiscal-scale audit, 2026-07-28).
  describe("command-economy knee override (BG/CS/HU/PL/RO/YU)", () => {
    it("raw revenue at or below the override knee (55%) is never compressed for these countries", () => {
      for (const cc of ["BG", "CS", "HU", "PL", "RO", "YU"]) {
        // Authored day-one default (~52% GDP raw).
        expect(applyEraRevenueCap(0.521 * GDP, GDP, 1953, cc) / GDP).toBeCloseTo(0.521);
        // A lighter post-reform rate (e.g. the enterprise levy relaxed from
        // 70%→55%, matching the "New Course" repeal seen in the turn-26
        // sandbox) still sits under the knee.
        expect(applyEraRevenueCap(0.434 * GDP, GDP, 1953, cc) / GDP).toBeCloseTo(0.434);
      }
    });

    it("a generic (non-command-economy) country is still compressed at the same raw share", () => {
      expect(applyEraRevenueCap(0.521 * GDP, GDP, 1953, "US") / GDP).toBeLessThan(0.521);
      expect(applyEraRevenueCap(0.521 * GDP, GDP, 1953) / GDP).toBeLessThan(0.521); // no countryId at all
    });

    it("CN/JP/RU are not in the override set — unaffected by this change", () => {
      for (const cc of ["CN", "JP", "RU"]) {
        expect(applyEraRevenueCap(0.521 * GDP, GDP, 1953, cc) / GDP).toBeLessThan(0.521);
      }
    });

    it("even a hypothetical max-lever push (~60% GDP) is only mildly compressed, not clipped to the generic ~47-52% ceiling", () => {
      // knee 0.55, compress 0.4: 0.55 + (0.60-0.55)×0.4 = 0.57
      expect(applyEraRevenueCap(0.6 * GDP, GDP, 1953, "HU") / GDP).toBeCloseTo(0.57);
    });
  });
});
