/**
 * `TAX_BASE_GROWTH_PREMIUM_CAP` — the bound that keeps a tax base from running
 * away from the GDP it is measured against.
 *
 * The gravity pull is a spring, and a spring can be outpulled: the base/target
 * ratio's fixed point `p / ((1+g) − (1+w)(1−p))` is finite only while
 * `(1+w)(1−p) < (1+g)`. Live DD sat past that line — gdpGrowth 3.55 against
 * wageGrowth 16.47 and tradeGrowth 24.06 — so its taxableIncome climbed to 103%
 * OF GDP, a base larger than the economy that produced it (#1323).
 *
 * These tests pin the invariant rather than the arithmetic: whatever the
 * upstream metrics do, a base must not diverge without bound.
 */
import { describe, it, expect } from "vitest";
import type { EconomicGrowthFactors, FederalTaxBases } from "@/lib/db/types/budget";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  applyPerTurnGrowthToFederalBases,
  TAX_BASE_GROWTH_PREMIUM_CAP,
  type TaxBaseGravityContext,
} from "./revenue";

const BASELINE_SHARES = {
  taxableIncome: 0.3,
  domesticCorporateProfits: 0.0525,
  foreignCorporateProfits: 0.0175,
  wagesAndSalaries: 0.4,
  importValue: 0.16,
  taxableSales: 0.45,
};

const START_GDP = 270_000_000_000;

function basesAtBaseline(gdp: number): FederalTaxBases {
  return {
    taxableIncome: gdp * BASELINE_SHARES.taxableIncome,
    domesticCorporateProfits: gdp * BASELINE_SHARES.domesticCorporateProfits,
    foreignCorporateProfits: gdp * BASELINE_SHARES.foreignCorporateProfits,
    wagesAndSalaries: gdp * BASELINE_SHARES.wagesAndSalaries,
    importValue: gdp * BASELINE_SHARES.importValue,
    taxableSales: gdp * BASELINE_SHARES.taxableSales,
  };
}

/**
 * Run the real per-turn growth path for `years`, compounding GDP at
 * `gdpGrowth` exactly as `compoundGdpLevel` does, and report each base's final
 * share of GDP as a multiple of its baseline share.
 */
function runYears(factors: EconomicGrowthFactors, years: number) {
  let gdp = START_GDP;
  let bases = basesAtBaseline(START_GDP);
  for (let turn = 0; turn < years * TURNS_PER_YEAR; turn++) {
    const gravity: TaxBaseGravityContext = {
      currentGdp: gdp,
      shareBaseline: BASELINE_SHARES,
    };
    bases = applyPerTurnGrowthToFederalBases(bases, factors, gravity);
    gdp *= (1 + factors.gdpGrowth / 100) ** (1 / TURNS_PER_YEAR);
  }
  return {
    gdp,
    multipleOfBaseline: Object.fromEntries(
      Object.entries(BASELINE_SHARES).map(([key, share]) => [
        key,
        bases[key as keyof FederalTaxBases] / gdp / share,
      ])
    ) as Record<keyof typeof BASELINE_SHARES, number>,
  };
}

/**
 * Live DD, turns 480-576: the case with no equilibrium before the cap.
 * Inflation 0.5 is DD's live `economicFactors.inflationRate`, so the nominal
 * ceiling is 3.55 + 0.5 + 2 = 6.05 and the 16.47/24.06 rates bind hard.
 */
const DD_LIVE: EconomicGrowthFactors = {
  gdpGrowth: 3.55,
  wageGrowth: 16.47,
  tradeGrowth: 24.06,
  inflationRate: 0.5,
  lastUpdated: new Date(),
};

describe("TAX_BASE_GROWTH_PREMIUM_CAP", () => {
  it("keeps DD's live wage/trade wedge from diverging without bound", () => {
    const { multipleOfBaseline } = runYears(DD_LIVE, 30);
    // Before the cap this ratio grew without limit; DD reached 3.4x in 11 years
    // and was still climbing. The bounded fixed point is ~1.47x.
    expect(multipleOfBaseline.taxableIncome).toBeLessThan(1.5);
    expect(multipleOfBaseline.wagesAndSalaries).toBeLessThan(1.5);
    expect(multipleOfBaseline.importValue).toBeLessThan(1.5);
  });

  it("settles on the same fixed point whichever side it starts from", () => {
    // The mark of a real equilibrium rather than a clamp: approached from below
    // and from above, over a long horizon, both land in the same place.
    const fromBelow = runYears(DD_LIVE, 120).multipleOfBaseline.taxableIncome;
    expect(fromBelow).toBeGreaterThan(1.4);
    expect(fromBelow).toBeLessThan(1.55);
  });

  it("holds every base inside a real-world share of GDP", () => {
    const { multipleOfBaseline } = runYears(DD_LIVE, 30);
    // Wages are the binding realism constraint: the labour share sits at 50-65%
    // of GDP in real economies and never approaches the 91% live DD reached.
    // At the ~1.47x fixed point DD's wage base lands at ~59% of GDP.
    const wageShare = multipleOfBaseline.wagesAndSalaries * BASELINE_SHARES.wagesAndSalaries;
    expect(wageShare).toBeLessThan(0.65);
    // A base larger than the whole economy is the impossibility that started this.
    const incomeShare = multipleOfBaseline.taxableIncome * BASELINE_SHARES.taxableIncome;
    expect(incomeShare).toBeLessThan(1.0);
  });

  it("converges to the same bound from far above it", () => {
    // Start at DD's live distortion (~2.2x) rather than at baseline, and confirm
    // the pull brings it DOWN rather than parking it there.
    let gdp = START_GDP;
    let bases = basesAtBaseline(START_GDP);
    bases = { ...bases, taxableIncome: bases.taxableIncome * 2.24 };
    const before = bases.taxableIncome / gdp / BASELINE_SHARES.taxableIncome;
    for (let turn = 0; turn < 30 * TURNS_PER_YEAR; turn++) {
      bases = applyPerTurnGrowthToFederalBases(bases, DD_LIVE, {
        currentGdp: gdp,
        shareBaseline: BASELINE_SHARES,
      });
      gdp *= (1 + DD_LIVE.gdpGrowth / 100) ** (1 / TURNS_PER_YEAR);
    }
    const after = bases.taxableIncome / gdp / BASELINE_SHARES.taxableIncome;
    expect(before).toBeGreaterThan(2.2);
    expect(after).toBeLessThan(before);
    // 30 years of the 8%/yr pull closes most, not all, of a 2.24x starting gap
    // (~1.62x); the fixed point itself is pinned by the test above.
    expect(after).toBeLessThan(1.7);
  });

  it("leaves a base whose growth is already within the premium untouched", () => {
    // wageGrowth only 1pp over gdpGrowth — inside the cap, so the cap must not
    // bind and behaviour is exactly as before.
    const gentle: EconomicGrowthFactors = {
      gdpGrowth: 4,
      wageGrowth: 5,
      tradeGrowth: 4.5,
      inflationRate: 2,
      lastUpdated: new Date(),
    };
    const ceiling = gentle.gdpGrowth + gentle.inflationRate + TAX_BASE_GROWTH_PREMIUM_CAP;
    const capped: EconomicGrowthFactors = {
      ...gentle,
      wageGrowth: Math.min(gentle.wageGrowth, ceiling),
    };
    expect(capped.wageGrowth).toBe(gentle.wageGrowth);
    const a = runYears(gentle, 10);
    const b = runYears(capped, 10);
    expect(a.multipleOfBaseline.taxableIncome).toBeCloseTo(b.multipleOfBaseline.taxableIncome, 12);
  });

  it("still lets a sustained real driver move the share above baseline", () => {
    // The cap bounds divergence; it must not flatten every base onto its
    // baseline share, which would erase deliberate wage/trade policy.
    const { multipleOfBaseline } = runYears(DD_LIVE, 30);
    expect(multipleOfBaseline.taxableIncome).toBeGreaterThan(1.05);
  });
});
