/**
 * §7/§10 baseline fiscal calibration goldens: every program law priced at its
 * authored 1953 baseline level on the §4.1 rollup bases must reproduce the
 * catalog documents' §5 reconciliations — within ±15% of the seeded-outlays
 * targets, AND within 1 percentage point of the docs' own computed deviations
 * (+9.8% / +13.7% / −5.3%) so silent transcription drift is caught.
 */

import { describe, expect, it } from "vitest";
import { budgetKeyForLaw } from "./budgetKeys";
import { computeLawCost, type FiscalBase } from "./costEngine";
import { getCatalog } from "./catalog";
import type { LawCountryId } from "./types";

const BASES: Record<LawCountryId, FiscalBase> = {
  US: { gdp: 397_100_000_000, population: 151_300_000 },
  UK: { gdp: 19_800_000_000, population: 52_600_000 },
  RU: { gdp: 1_400_000_000_000, population: 189_500_000 },
  DD: { gdp: 50_000_000_000, population: 18_400_000 },
};

/** Seeded-outlays targets (§4.2) and the catalog docs' §5 computed deviations. */
const TARGETS: Record<LawCountryId, { outlays: number; docDeviation: number; revenue: number }> = {
  US: { outlays: 76_100_000_000, docDeviation: 0.098, revenue: 480_000_000 },
  UK: { outlays: 4_520_000_000, docDeviation: 0.137, revenue: 15_000_000 },
  RU: { outlays: 535_000_000_000, docDeviation: -0.053, revenue: 13_600_000_000 },
  // DD (RU-parity catalog on the DDM 50B basis): baseline rollup ≈ M 16.11B
  // against 17.3B seeded outlays (spending categories + state grants).
  DD: { outlays: 17_300_000_000, docDeviation: -0.069, revenue: 450_000_000 },
};

function baselineTotals(countryId: LawCountryId) {
  let cost = 0;
  let revenue = 0;
  const byKey: Record<string, number> = {};
  for (const law of getCatalog(countryId)) {
    if (law.kind === "tax") continue;
    // Regional secondaries are Land / state spending, not national outlays, and
    // they are costed against national BASES here. Summing them inflated the
    // national baseline against the doc's figure: PR #17 added the six DD Land
    // laws (all baselineLevel 3) on 2026-08-12 and pushed DD's deviation 3.3pt
    // off the doc, well past the 1pt pin. Same carve-out the seeder applies
    // (`seedPoliticalLegislation`: allowedScope === "regional" continue) and the
    // reset e2e now applies.
    if (law.allowedScope === "regional") continue;
    const level = law.baselineLevel ?? 0;
    if (level === 0) continue;
    const fiscal = computeLawCost(law.levels![level], BASES[countryId], countryId, null);
    cost += fiscal.cost;
    revenue += fiscal.revenue;
    const key = budgetKeyForLaw(law);
    byKey[key] = (byKey[key] ?? 0) + fiscal.cost;
  }
  return { cost, revenue, byKey };
}

describe("baseline fiscal calibration (±15% + doc-deviation pinning)", () => {
  for (const countryId of ["US", "UK", "RU", "DD"] as const) {
    it(`${countryId}: baseline sum within ±15% of seeded outlays and ±1pt of the doc's §5 figure`, () => {
      const { cost } = baselineTotals(countryId);
      const target = TARGETS[countryId];
      const deviation = cost / target.outlays - 1;
      expect(Math.abs(deviation)).toBeLessThan(0.15);
      expect(Math.abs(deviation - target.docDeviation)).toBeLessThan(0.01);
    });

    it(`${countryId}: baseline law revenue matches the doc's §5 figure (±10%)`, () => {
      const { revenue } = baselineTotals(countryId);
      expect(revenue).toBeGreaterThan(TARGETS[countryId].revenue * 0.9);
      expect(revenue).toBeLessThan(TARGETS[countryId].revenue * 1.1);
    });
  }

  it("UK health-key baseline total hits the §4.2 £570M anchor band (≈£566M ±2%)", () => {
    const { byKey } = baselineTotals("UK");
    expect(byKey.health).toBeGreaterThan(554_000_000);
    expect(byKey.health).toBeLessThan(578_000_000);
  });

  it("RU defense-key baseline total lands on the ruling-#15 ≈₽110B line (±10%)", () => {
    const { byKey } = baselineTotals("RU");
    expect(byKey.defense).toBeGreaterThan(99_000_000_000);
    expect(byKey.defense).toBeLessThan(121_000_000_000);
  });
});
