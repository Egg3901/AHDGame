import { describe, expect, it } from "vitest";
import { SEED_TAX_RATES_1953 } from "@/lib/politicalLegislation/seedTaxRates";
import { calculateEnactedLawAnnualCost } from "@/lib/budget/costs";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import { getCostClass } from "@/lib/era/legislationCostCatalog";
import { atLegislationTypes } from "@/lib/seeds/at/atLegislationTypes";
import { fiLegislationTypes } from "@/lib/seeds/fi/fiLegislationTypes";
import { frLegislationTypes } from "@/lib/seeds/fr/frLegislationTypes";
import { grLegislationTypes } from "@/lib/seeds/gr/grLegislationTypes";
import { itLegislationTypes } from "@/lib/seeds/it/itLegislationTypes";
import { seLegislationTypes } from "@/lib/seeds/se/seLegislationTypes";
import { trLegislationTypes } from "@/lib/seeds/tr/trLegislationTypes";
import {
  generateDefaultEnactedLaws,
  getInitialNationalBudgetsForPreset,
  NATIONAL_BUDGET_SEED_CONFIGS_1953,
} from "./budgets";

const budgets = getInitialNationalBudgetsForPreset("1953-default");
const byCountry = (cc: string) => budgets.find((b) => b.countryId === cc)!;
const configByCountry = (cc: string) =>
  NATIONAL_BUDGET_SEED_CONFIGS_1953.find((c) => c.countryId === cc)!;

describe("1953 budget seeds — political-legislation derivation switch (§4.2a)", () => {
  it("writes federalBudget.taxRates exactly from SEED_TAX_RATES_1953 for US/UK/RU/DD", () => {
    for (const cc of ["US", "UK", "RU", "DD"] as const) {
      const rates = byCountry(cc).taxRates;
      for (const [taxType, rate] of Object.entries(SEED_TAX_RATES_1953[cc])) {
        expect(rates[taxType as keyof typeof rates], `${cc}.${taxType}`).toBe(rate);
      }
    }
  });

  it("RU taxBaseRatios are the §4.2a authored ratios (75/25 corporate split)", () => {
    const ru = byCountry("RU");
    // ₽1.4T while Ukraine, Byelorussia and the Baltics were RU regions; the
    // rollup and the budget config both dropped to ₽1,029,166M when they left.
    const gdp = 1_029_166_000_000;
    expect(ru.taxBases.taxableIncome).toBe(0.35 * gdp);
    expect(ru.taxBases.domesticCorporateProfits).toBe(0.08 * gdp * 0.75);
    expect(ru.taxBases.foreignCorporateProfits).toBe(0.08 * gdp * 0.25);
    expect(ru.taxBases.wagesAndSalaries).toBe(0.31 * gdp);
    expect(ru.taxBases.importValue).toBe(0.18 * gdp);
    expect(ru.taxBases.taxableSales).toBe(0.55 * gdp);
  });

  it("RU receipts land on the ruling-#15 anchor, scaled to RU's share of GDP", () => {
    const ru = byCountry("RU");
    // Ruling #15 anchored the whole Union at ≈₽526B of receipts on ₽1.4T of
    // GDP. RU kept 73.5% of that GDP, so the same 38%-of-GDP shape lands at
    // ≈₽386B: derived ≈273B + otherRevenue ₽113B.
    expect(ru.revenue.total).toBeGreaterThan(367_000_000_000);
    expect(ru.revenue.total).toBeLessThan(401_000_000_000);
    expect(ru.revenue.salesTax).toBeCloseTo(0.31 * 0.55 * 1_029_166_000_000, -9);
  });

  it("RU outlay lines follow the ruling-#15 historical fiscal scale", () => {
    const config = configByCountry("RU");
    const lines = config.baselineSpendingByCategory;
    const total = Object.values(lines).reduce((a, b) => a + b, 0);
    // Ruling #15's ₽535B whole-Union outlay, scaled by 0.735 to RU's share of
    // the regional GDP rollup after the three republics left.
    expect(total + config.baselineStateGrants).toBe(393_000_000_000);
    expect(lines.defense).toBe(81_000_000_000);
    expect(lines.infrastructure).toBe(118_000_000_000);
    expect(lines.statePensions).toBe(15_000_000_000);
    expect(lines.welfare).toBe(18_000_000_000);
    expect(config.baselineStateGrants).toBe(44_000_000_000);
    expect(config.debt.ceiling).toBe(88_000_000_000);
  });

  it("UK receipts move <2% off the pre-switch total and drop the orphaned NHS revenue line", () => {
    const uk = byCountry("UK");
    // Old modern-config derivation totalled ≈£4.80B; the 1953-rate switch
    // yields ≈£4.83B (income up, NI down, derived-VAT zeroed).
    expect(uk.revenue.total).toBeGreaterThan(4_600_000_000);
    expect(uk.revenue.total).toBeLessThan(5_050_000_000);
    expect(uk.revenue.salesTax).toBe(0);
    expect(uk.revenue.healthcareIncome).toBe(0);
  });

  it("no policyRevenueConfigs remain on the re-seeded 1953 blocks", () => {
    for (const cc of ["US", "UK", "RU", "DD"]) {
      expect(configByCountry(cc).policyRevenueConfigs, cc).toBeUndefined();
    }
  });

  it("other 1953 countries' derivation is untouched by the override mechanism", () => {
    const fr = configByCountry("FR");
    expect(fr.seedTaxRatesOverride).toBeUndefined();
    const frBudget = byCountry("FR");
    expect(frBudget.revenue.total).toBeGreaterThan(0);
  });
});

describe("1953 budget seeds — authored baseline spending (Cold War realism)", () => {
  it("US defense lands on the Korean War ~14% GDP band, not modern peacetime ~2%", () => {
    const us = byCountry("US");
    const def = us.spending.byCategory.defense ?? 0;
    expect(def / us.gdp).toBeGreaterThan(0.12);
    expect(def / us.gdp).toBeLessThan(0.16);
    expect(def).toBe(52_800_000_000);
  });

  it("US federal healthcare stays near VA-only (≪ modern Medicare/Medicaid share)", () => {
    const us = byCountry("US");
    const health = us.spending.byCategory.healthcare ?? 0;
    expect(health / us.gdp).toBeLessThan(0.01);
    expect(health).toBe(1_600_000_000);
  });

  it("UK defence lands on the Cold War rearmament ~8–12% GDP band", () => {
    const uk = byCountry("UK");
    const def = uk.spending.byCategory.defense ?? 0;
    expect(def / uk.gdp).toBeGreaterThan(0.07);
    expect(def / uk.gdp).toBeLessThan(0.13);
    expect(def).toBe(1_600_000_000);
  });

  it("UK health matches the early-NHS £570M anchor, not modern NHS scale", () => {
    const uk = byCountry("UK");
    const health = uk.spending.byCategory.health ?? 0;
    expect(health).toBe(570_000_000);
    expect(health / uk.gdp).toBeLessThan(0.05);
  });

  it("DE/JP keep historically near-minimal defense (pre-Bundeswehr / Article 9)", () => {
    const de = byCountry("DE");
    const jp = byCountry("JP");
    // Authored occupation-cost residual (~2% GDP) / SDF ~1% GNP — do NOT raise.
    expect((de.spending.byCategory.defense ?? 0) / de.gdp).toBeLessThan(0.03);
    expect((jp.spending.byCategory.defense ?? 0) / jp.gdp).toBeLessThan(0.015);
  });

  it("generateDefaultEnactedLaws skips old US/UK/RU/DD catalogs on 1953-default", () => {
    const laws = generateDefaultEnactedLaws("1953-default");
    for (const cc of ["US", "UK", "RU", "DD"]) {
      expect(
        laws.filter((l) => l.countryId === cc),
        `${cc} old laws`
      ).toHaveLength(0);
    }
  });

  it("non-political 1953 defense/health laws price via GDP share matching authored baselines", () => {
    const laws = generateDefaultEnactedLaws("1953-default").filter((l) => l.countryId === "DE");
    const defenseLaws = laws.filter((l) => l.budgetCategory === "defense" && l.rate === undefined);
    expect(defenseLaws.length).toBeGreaterThan(0);
    for (const law of defenseLaws) {
      expect(law.gdpPerCapitaMultiplier, law.legislationTypeId).toBeTypeOf("number");
      expect(law.annualCostPerCapita, law.legislationTypeId).toBeUndefined();
    }
    const config = configByCountry("DE");
    const defenseShare = defenseLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
    expect(defenseShare * config.gdp).toBeCloseTo(config.baselineSpendingByCategory.defense, -3);
  });
});

describe("1953 budget seeds — day-1 fiscal balance (fiscal-scale audit, 2026-07-28)", () => {
  // BR and ES's `baselineSpendingByCategory` + `baselineStateGrants` were
  // authored independently of their OWN revenue side (taxRateOverrides /
  // taxBaseRatios), with no reconciliation check analogous to the existing
  // zero-revenue-rate guard in `getInitialNationalBudgetsForPreset`. That
  // produced a day-1 structural deficit of 35.5% of GDP (BR) / 28.4% of GDP
  // (ES) — verified against the sandbox `ahd_sim_grand53fx` DB's
  // `federalBudgetSnapshots` turn-1 docs before this fix. Financed onto debt at
  // the credit-rating interest schedule (src/lib/budget/debt.ts — uncapped
  // past the CCC tier), a 650-turn run compounded this into the audit's
  // reported 185.1% / 167.9% of GDP spending and 1009% / 904% debt-to-GDP. The
  // seed values were rescaled (this commit) to bring day-1 deficit under a
  // generous but sane ceiling.
  const DAY_ONE_DEFICIT_CEILING_PCT = 20;
  // The original guard only bounded excessive DEFICITS (spending > revenue).
  // It missed FI (+25.4% of GDP day-1 SURPLUS) and SE (+23% of GDP) entirely,
  // because a surplus makes `deficitPct` negative and the old test only
  // asserted an upper bound. A day-1 government running a quarter of its GDP
  // as a cash surplus is exactly as implausible as one running a matching
  // deficit, so the guard is now symmetric (fiscal-scale audit, 2026-07-28).
  const DAY_ONE_SURPLUS_FLOOR_PCT = -20;

  function dayOneDeficitPctGdp(cc: string): number {
    const b = byCountry(cc);
    return (100 * (b.spending.total - b.revenue.total)) / b.gdp;
  }

  it("BR's day-1 deficit is a small fraction of what it was (35.5% of GDP pre-fix)", () => {
    const deficitPct = dayOneDeficitPctGdp("BR");
    expect(deficitPct).toBeGreaterThan(0); // still a real (Korean-War-era) deficit
    expect(deficitPct).toBeLessThan(DAY_ONE_DEFICIT_CEILING_PCT);
  });

  it("ES's day-1 deficit is a small fraction of what it was (28.4% of GDP pre-fix)", () => {
    const deficitPct = dayOneDeficitPctGdp("ES");
    expect(deficitPct).toBeGreaterThan(0);
    expect(deficitPct).toBeLessThan(DAY_ONE_DEFICIT_CEILING_PCT);
  });

  it("FI's day-1 surplus is a small fraction of what it was (+25.4% of GDP pre-fix)", () => {
    // taxBaseRatios cut from footprint-scale (0.26 income / 0.38 wages) to
    // fiscal-scale (0.10 / 0.15) — see the config's own comment in budgets.ts.
    // This commit (fiscal audit F-11) additionally corrects fi_customs_tariff
    // idx2→idx1 (25%→9%, matching its own "moderate" stance framing, not the
    // ladder's maximalist option) and bumps the infrastructure baseline
    // 26B→32B (Oulujoki hydro + Karelian resettlement running concurrently),
    // narrowing the day-1 surplus further to ≈6.4% of GDP. (The 1e60a2db9
    // commit's own comment cites an "≈11% of GDP" TURN-26 sandbox
    // measurement, not day-1 — day-1 and turn-26 diverge because of a
    // per-turn tax-base gravity-pull mechanism this test does not simulate.)
    const deficitPct = dayOneDeficitPctGdp("FI");
    expect(deficitPct).toBeLessThan(0); // still a real surplus, just not an absurd one
    expect(deficitPct).toBeGreaterThan(DAY_ONE_SURPLUS_FLOOR_PCT);
    expect(deficitPct).toBeLessThan(-3); // still meaningfully positive, not overcorrected to ~0
    expect(deficitPct).toBeGreaterThan(-10); // tighter than the generic ±20 band post fiscal audit F-11
  });

  it("SE's day-1 surplus is a small fraction of what it was (+23% of GDP pre-fix)", () => {
    // se_income_tax/se_social_charges corrected to the ladder's own "standard"
    // bracket (basePolicies1953.ts) instead of one step further left. This
    // commit (fiscal audit F-11) additionally trims taxBaseRatios
    // (0.42/0.45 → 0.35/0.42 income/wages) toward a DE-comparable formal-
    // wage-economy base, narrowing the day-1 surplus to ≈6.1% of GDP. (The
    // 1e60a2db9 commit's own comment cites an "≈11%" TURN-26 sandbox
    // measurement, not day-1 — see the FI test above for why those frames
    // diverge. SE seeds no spending laws at all, so day-1 and runtime
    // spending are identical for it, unlike CN/JP below.)
    const deficitPct = dayOneDeficitPctGdp("SE");
    expect(deficitPct).toBeLessThan(0);
    expect(deficitPct).toBeGreaterThan(DAY_ONE_SURPLUS_FLOOR_PCT);
    expect(deficitPct).toBeGreaterThan(-9); // tighter than the generic ±20 band post fiscal audit F-11
  });

  it("every 1953 national budget config's day-1 deficit stays inside a symmetric sane band", () => {
    // General regression guard so this defect class (spending baseline, or
    // revenue-side tax-base/rate picks, authored without checking against the
    // SAME config's other side) can't reappear silently for any 1953 country
    // — deficit-side (BR/ES) or surplus-side (FI/SE).
    for (const config of NATIONAL_BUDGET_SEED_CONFIGS_1953) {
      const b = byCountry(config.countryId);
      const deficitPct = (100 * (b.spending.total - b.revenue.total)) / b.gdp;
      expect(deficitPct, config.countryId).toBeLessThan(DAY_ONE_DEFICIT_CEILING_PCT);
      expect(deficitPct, config.countryId).toBeGreaterThan(DAY_ONE_SURPLUS_FLOOR_PCT);
    }
  });

  it("no 1953 country seeds debt principal above its own ceiling", () => {
    // Coherence check independent of the deficit band above: whatever the
    // day-1 fiscal position, a country's OWN seeded debt principal must never
    // already exceed its OWN seeded ceiling (CN hit this by turn 26 — see the
    // CN central-transfer-pool fix in countries.ts — but every country's DAY-1
    // numbers should already be internally coherent regardless).
    for (const config of NATIONAL_BUDGET_SEED_CONFIGS_1953) {
      expect(
        config.debt.principal,
        `${config.countryId} debt.principal (${config.debt.principal}) vs ceiling (${config.debt.ceiling})`
      ).toBeLessThanOrEqual(config.debt.ceiling);
    }
  });
});

describe("1953 budget seeds — CN/JP spending-category calibration (fiscal audit F-11)", () => {
  // CN and JP both seed real spending-law catalogs (unlike ES/HU/PL/RO/YU/BG/
  // BLR/CS/BAL, which fall back to baselineSpendingByCategory wholesale — see
  // the AT/FI/FR/GR/IT/SE/TR describe block below, which used to be in this
  // bucket too before the fiscal-scale audit 2026-07-28 spending-calibration
  // fix). For those two, `deriveSpending`/`deriveEnactedLaws` only pin
  // BASELINE_OVERRIDE_CATEGORIES ("defense"/"healthcare"/"health") to the
  // authored figure; every OTHER category — including CN's First-Five-Year-
  // Plan "infrastructure" line and JP's reconstruction "publicWorks" (now
  // renamed "infrastructure") / "socialSecurity" (now renamed "social") lines —
  // was priced off the modern (2019/2023) per-domain era catalog instead,
  // silently discarding the authored 1953 figure. That collapsed CN to 9.9%
  // and JP to 7.4% of GDP in spending (day-26 sandbox `ahd_sim_grand53r4`),
  // against a plausible command-economy band of 25-40% (CN) and a documented
  // real ~18-20% of GDP (JP). Fixed via EXTRA_OVERRIDE_CATEGORIES_BY_COUNTRY
  // (CN: infrastructure; JP: infrastructure, social) and GRANT_OVERRIDE_COUNTRIES
  // (JP's Local Allocation Tax Act).
  const laws1953 = generateDefaultEnactedLaws("1953-default");

  function lawsFor(cc: string) {
    return laws1953.filter((l) => l.countryId === cc && l.rate === undefined);
  }

  it("CN's every authored baseline category (except the 'other' catch-all) matches an actual seeded law category", () => {
    const cn = configByCountry("CN");
    const actualCats = new Set(lawsFor("CN").map((l) => l.budgetCategory));
    for (const key of Object.keys(cn.baselineSpendingByCategory)) {
      if (key === "other") continue;
      expect(actualCats.has(key), `CN baselineSpendingByCategory key "${key}"`).toBe(true);
    }
  });

  it("JP's every authored baseline category (except the 'other' catch-all) matches an actual seeded law category", () => {
    const jp = configByCountry("JP");
    const actualCats = new Set(lawsFor("JP").map((l) => l.budgetCategory));
    for (const key of Object.keys(jp.baselineSpendingByCategory)) {
      if (key === "other") continue;
      expect(actualCats.has(key), `JP baselineSpendingByCategory key "${key}"`).toBe(true);
    }
  });

  it("CN's 'infrastructure' laws (First-Five-Year-Plan heavy industry) sum to the authored 1953 baseline, not the thin modern-era-catalog default", () => {
    const cn = configByCountry("CN");
    const infraLaws = lawsFor("CN").filter((l) => l.budgetCategory === "infrastructure");
    expect(infraLaws.length).toBeGreaterThan(0);
    for (const law of infraLaws) {
      expect(law.gdpPerCapitaMultiplier, law.legislationTypeId).toBeTypeOf("number");
    }
    const share = infraLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
    expect(share * cn.gdp).toBeCloseTo(cn.baselineSpendingByCategory.infrastructure, -2);
  });

  it("CN's 'health' laws sum to the authored 1953 baseline (key renamed from the never-matching 'healthcare')", () => {
    const cn = configByCountry("CN");
    const healthLaws = lawsFor("CN").filter((l) => l.budgetCategory === "health");
    expect(healthLaws.length).toBeGreaterThan(0);
    const share = healthLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
    expect(share * cn.gdp).toBeCloseTo(cn.baselineSpendingByCategory.health, -2);
  });

  it("JP's 'infrastructure' laws (reconstruction public works) sum to the authored 1953 baseline (key renamed from the never-matching 'publicWorks')", () => {
    const jp = configByCountry("JP");
    const infraLaws = lawsFor("JP").filter((l) => l.budgetCategory === "infrastructure");
    expect(infraLaws.length).toBeGreaterThan(0);
    const share = infraLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
    expect(share * jp.gdp).toBeCloseTo(jp.baselineSpendingByCategory.infrastructure, -2);
  });

  it("JP's 'social' laws sum to the authored 1953 baseline (key renamed from the never-matching 'socialSecurity')", () => {
    const jp = configByCountry("JP");
    const socialLaws = lawsFor("JP").filter((l) => l.budgetCategory === "social");
    expect(socialLaws.length).toBeGreaterThan(0);
    const share = socialLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
    expect(share * jp.gdp).toBeCloseTo(jp.baselineSpendingByCategory.social, -2);
  });

  it("JP's isGrant Local Allocation Tax Act prices to the authored baselineStateGrants, not its thin modern-era-catalog share", () => {
    const jp = configByCountry("JP");
    const grantLaws = lawsFor("JP").filter((l) => l.isGrant);
    expect(grantLaws.length).toBeGreaterThan(0);
    const share = grantLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
    expect(share * jp.gdp).toBeCloseTo(jp.baselineStateGrants, -2);
  });

  it("CN's total booked spending (runtime era-cost path) lands in the command-economy 25-40% of GDP band, not the pre-fix <10%", () => {
    const cn = configByCountry("CN");
    const total = lawsFor("CN").reduce((sum, law) => {
      if (!isLegislationTypeActive(law.legislationTypeId, 1953)) return sum;
      const cost = calculateEnactedLawAnnualCost(
        law as unknown as Parameters<typeof calculateEnactedLawAnnualCost>[0],
        {
          budgetCapacity: 0,
          gdp: cn.gdp,
          population: cn.population,
          countryId: "CN",
          nationalGdpPerCapita: cn.gdp / cn.population,
          year: 1953,
        }
      );
      return Number.isFinite(cost) ? sum + (law.isGrant ? 0 : cost) : sum;
    }, 0);
    const pctGdp = (100 * total) / cn.gdp;
    expect(pctGdp).toBeGreaterThan(25);
    expect(pctGdp).toBeLessThan(40);
  });

  it("JP's total booked spending (runtime era-cost path) lands near the documented real ~18-20% of GDP, not the pre-fix <10%", () => {
    const jp = configByCountry("JP");
    const total = lawsFor("JP").reduce((sum, law) => {
      if (!isLegislationTypeActive(law.legislationTypeId, 1953)) return sum;
      const cost = calculateEnactedLawAnnualCost(
        law as unknown as Parameters<typeof calculateEnactedLawAnnualCost>[0],
        {
          budgetCapacity: 0,
          gdp: jp.gdp,
          population: jp.population,
          countryId: "JP",
          nationalGdpPerCapita: jp.gdp / jp.population,
          year: 1953,
        }
      );
      return Number.isFinite(cost) ? sum + cost : sum; // JP's grant IS a real spend line
    }, 0);
    const pctGdp = (100 * total) / jp.gdp;
    expect(pctGdp).toBeGreaterThan(15);
    expect(pctGdp).toBeLessThan(22);
  });
});

describe("1953 budget seeds — DE spending-category calibration (fiscal-scale audit, 2026-07-28)", () => {
  // Same defect class as the CN/JP block above, found auditing DE's +13.1%-of-
  // GDP day-26 sandbox surplus. DE's authored baseline used "socialSecurity"/
  // "infrastructure", but deLegislationTypes.ts's actual budgetCategory strings
  // for those lines are "welfare"/"transport" — so, exactly like JP's
  // publicWorks/socialSecurity rename, those two lines (the largest in DE's
  // baseline) fell through to the modern per-domain catalog instead of the
  // authored 1953 figure. "education" and "other" matched by name but still
  // undershot the authored figure (same as CN/JP's "infrastructure"/"social"),
  // so they're pinned too via EXTRA_OVERRIDE_CATEGORIES_BY_COUNTRY.DE.
  //
  // Why the existing guards didn't catch this: the day-1 symmetric-band test
  // above only bounds `spending.total - revenue.total`, computed from the SEED
  // snapshot's `deriveSpending` — which already falls back to the full
  // baseline when `hasPolicySpending` is false. DE DOES have real spending
  // laws (deLegislationTypes.ts), so `hasPolicySpending` is true and
  // `deriveSpending`'s seed snapshot silently used the (undershooting) policy-
  // derived costs for every non-overridden category — day-1 and the runtime
  // engine agreed with each other, so no reconciliation check flagged it. Only
  // an explicit "does this baseline key match an actual seeded law category"
  // check (mirroring the CN/JP tests above) surfaces a silent rename miss.
  const laws1953 = generateDefaultEnactedLaws("1953-default");

  function lawsFor(cc: string) {
    return laws1953.filter((l) => l.countryId === cc && l.rate === undefined);
  }

  it("DE's every authored baseline category matches an actual seeded law category", () => {
    const de = configByCountry("DE");
    const actualCats = new Set(lawsFor("DE").map((l) => l.budgetCategory));
    for (const key of Object.keys(de.baselineSpendingByCategory)) {
      expect(actualCats.has(key), `DE baselineSpendingByCategory key "${key}"`).toBe(true);
    }
  });

  it("DE's 'welfare' laws (Bismarckian pensions/unemployment insurance) sum to the authored 1953 baseline, not the thin modern-era-catalog default", () => {
    const de = configByCountry("DE");
    const welfareLaws = lawsFor("DE").filter((l) => l.budgetCategory === "welfare");
    expect(welfareLaws.length).toBeGreaterThan(0);
    const share = welfareLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
    expect(share * de.gdp).toBeCloseTo(de.baselineSpendingByCategory.welfare, -2);
  });

  it("DE's 'transport' laws (Wirtschaftswunder rail/road reconstruction) sum to the authored 1953 baseline (key renamed from the never-matching 'infrastructure')", () => {
    const de = configByCountry("DE");
    const transportLaws = lawsFor("DE").filter((l) => l.budgetCategory === "transport");
    expect(transportLaws.length).toBeGreaterThan(0);
    const share = transportLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
    expect(share * de.gdp).toBeCloseTo(de.baselineSpendingByCategory.transport, -2);
  });

  it("DE's total booked spending lands near the documented real ~30% of GDP (Adenauer-era Sozialstaat), not the pre-fix ~21%", () => {
    const de = configByCountry("DE");
    const total = lawsFor("DE").reduce((sum, law) => {
      if (!isLegislationTypeActive(law.legislationTypeId, 1953)) return sum;
      const cost = calculateEnactedLawAnnualCost(
        law as unknown as Parameters<typeof calculateEnactedLawAnnualCost>[0],
        {
          budgetCapacity: 0,
          gdp: de.gdp,
          population: de.population,
          countryId: "DE",
          nationalGdpPerCapita: de.gdp / de.population,
          year: 1953,
        }
      );
      return Number.isFinite(cost) ? sum + (law.isGrant ? 0 : cost) : sum;
    }, 0);
    const pctGdp = (100 * total) / de.gdp;
    expect(pctGdp).toBeGreaterThan(25);
    expect(pctGdp).toBeLessThan(35);
  });
});

describe("1953 budget seeds — TR tariff-lever calibration (fiscal-scale audit, 2026-07-28)", () => {
  // TR falls back to baselineSpendingByCategory wholesale (no budgetCategory
  // laws — same bucket as HU/PL/RO/YU/BG/CS), so its -14.5%-of-GDP day-26
  // deficit was not a spending problem. basePolicies1953.ts's
  // COUNTRY_POLICY_CONFIGS_1953.tr.optionIndexes authored `tr_customs_tariff:
  // 3`, but tr_customs_tariff's taxRateOptions array (trLegislationTypes.ts)
  // only has 3 entries (indices 0-2) — one past the end. getDefaultPolicyOption
  // returned `policyOptions?.[3]` = undefined, so deriveTaxRates left
  // taxRates.tariffs at 0 and deriveEnactedLaws never seeded tr_customs_tariff
  // at all (both bail on `!defaultOption`), silently zeroing a real tariff-
  // revenue line against a 15%-of-GDP importValue base for the whole game.
  //
  // Why the existing guards didn't catch this: nothing asserts every
  // `policyOptionOverrides` index is in range for every country/legislation
  // type — `getDefaultPolicyOption` fails silently (`?.[]` on an out-of-bounds
  // index is `undefined`, not a thrown error) rather than surfacing a seed
  // defect loudly.
  it("TR's tax-lever policyOptionOverrides indexes are all in range (deriveTaxRates seeds a real rate, not silently 0)", () => {
    // Scoped to TR's five tax-rate legislation types (taxPolicyIds) rather than
    // every policyOptionOverrides entry — non-fiscal stance levers like
    // tr_state_enterprises/tr_labor_law/tr_welfare_state have no `rate` and are
    // never seeded as enacted laws by design (deriveEnactedLaws requires either
    // a tax rate or a budgetCategory), so they're not exposed to this bug class.
    const config = configByCountry("TR");
    const laws1953 = generateDefaultEnactedLaws("1953-default").filter((l) => l.countryId === "TR");
    for (const legislationTypeId of Object.values(config.taxPolicyIds)) {
      if (!legislationTypeId) continue;
      const seeded = laws1953.find((l) => l.legislationTypeId === legislationTypeId);
      const index = config.policyOptionOverrides[legislationTypeId];
      expect(seeded, `${legislationTypeId} (optionIndexes = ${index})`).toBeDefined();
      expect(seeded?.rate, legislationTypeId).toBeTypeOf("number");
    }
  });

  it("tr_customs_tariff seeds a real (non-zero) tariff rate", () => {
    const laws1953 = generateDefaultEnactedLaws("1953-default");
    const tariffLaw = laws1953.find(
      (l) => l.countryId === "TR" && l.legislationTypeId === "tr_customs_tariff"
    );
    expect(tariffLaw).toBeDefined();
    expect(tariffLaw?.rate).toBe(35); // "Import-Substitution Act" — index 2, not the out-of-bounds 3
  });

  it("TR's day-one tariff revenue is no longer silently zero", () => {
    const tr = byCountry("TR");
    expect(tr.taxRates.tariffs).toBe(35);
    const tariffRevenue = tr.taxBases.importValue * (tr.taxRates.tariffs / 100);
    expect(tariffRevenue).toBeGreaterThan(0);
  });
});

describe("1953 budget seeds — AT/FI/FR/GR/IT/SE/TR spending-category calibration (fiscal-scale audit, 2026-07-28)", () => {
  // These seven market democracies previously had exactly one budgetCategory-
  // bearing legislation type each (the welfare-state law), classed "none" in
  // legislationCostCatalog.ts (see that file's header for the mechanic).
  // `calculateFederalSpending`'s fallback is all-or-nothing: with zero
  // categories booking a real cost, EVERY turn forever fell back to the
  // static `baselineSpendingByCategory`, frozen and inert to policy — a
  // government elected on austerity could never actually spend less. Each
  // country now authors one gdpPerCapitaMultiplier-costed law per category
  // (health/education/infrastructure/defense/other, plus the retrofitted
  // welfare-state law for socialSecurity, plus a local-government grant law),
  // so the fallback no longer fires and spending tracks the enacted policy.
  const laws1953 = generateDefaultEnactedLaws("1953-default");
  const SEVEN = ["AT", "FI", "FR", "GR", "IT", "SE", "TR"] as const;
  const CATEGORIES = [
    "socialSecurity",
    "healthcare",
    "education",
    "infrastructure",
    "defense",
    "other",
  ] as const;
  const COUNTRY_LEGISLATION_TYPES: Record<(typeof SEVEN)[number], { _id: string }[]> = {
    AT: atLegislationTypes,
    FI: fiLegislationTypes,
    FR: frLegislationTypes,
    GR: grLegislationTypes,
    IT: itLegislationTypes,
    SE: seLegislationTypes,
    TR: trLegislationTypes,
  };

  function lawsFor(cc: string) {
    return laws1953.filter((l) => l.countryId === cc && l.rate === undefined);
  }

  it.each(SEVEN)(
    "%s's legislation types classify every new spending law as a real cost class, not the phantom 'none'",
    (cc) => {
      for (const legType of COUNTRY_LEGISLATION_TYPES[cc]) {
        if (
          !/_(welfare_state|health_insurance|education_funding|infrastructure_investment|defense_appropriations|economic_subsidies|local_grants)$/.test(
            legType._id
          )
        ) {
          continue;
        }
        expect(getCostClass(legType._id), legType._id).not.toBe("none");
      }
    }
  );

  it.each(SEVEN)(
    "%s books a non-zero gdpPerCapitaMultiplier law in all six spending categories (baseline fallback no longer fires)",
    (cc) => {
      const laws = lawsFor(cc);
      for (const cat of CATEGORIES) {
        const catLaws = laws.filter((l) => l.budgetCategory === cat);
        expect(catLaws.length, `${cc} ${cat}`).toBeGreaterThan(0);
        const total = catLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
        expect(total, `${cc} ${cat}`).toBeGreaterThan(0);
      }
    }
  );

  it.each(SEVEN)(
    "%s's default-option category totals reconcile with the authored 1953 baseline within 2%%",
    (cc) => {
      const config = configByCountry(cc);
      const laws = lawsFor(cc);
      for (const cat of CATEGORIES) {
        const catLaws = laws.filter((l) => l.budgetCategory === cat);
        const share = catLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
        const actual = share * config.gdp;
        const target = config.baselineSpendingByCategory[cat];
        expect(target, `${cc} ${cat} missing from authored baseline`).toBeTypeOf("number");
        const tolerance = Math.max(target * 0.02, 1);
        expect(
          Math.abs(actual - target),
          `${cc} ${cat}: booked ${actual} vs authored ${target}`
        ).toBeLessThan(tolerance);
      }
    }
  );

  it.each(SEVEN)(
    "%s's local-grants law reconciles with the authored baselineStateGrants within 2%%",
    (cc) => {
      const config = configByCountry(cc);
      const laws = lawsFor(cc);
      const grantLaws = laws.filter((l) => l.isGrant);
      expect(grantLaws.length, cc).toBeGreaterThan(0);
      const share = grantLaws.reduce((s, l) => s + (l.gdpPerCapitaMultiplier ?? 0), 0);
      const actual = share * config.gdp;
      const target = config.baselineStateGrants;
      const tolerance = Math.max(target * 0.02, 1);
      expect(
        Math.abs(actual - target),
        `${cc}: booked ${actual} vs authored ${target}`
      ).toBeLessThan(tolerance);
    }
  );

  it.each(SEVEN)(
    "%s's total booked spending (runtime era-cost path) is close to the authored 1953 total, not the pre-fix inert baseline",
    (cc) => {
      const config = configByCountry(cc);
      const total = lawsFor(cc).reduce((sum, law) => {
        if (!isLegislationTypeActive(law.legislationTypeId, 1953)) return sum;
        const cost = calculateEnactedLawAnnualCost(
          law as unknown as Parameters<typeof calculateEnactedLawAnnualCost>[0],
          {
            budgetCapacity: 0,
            gdp: config.gdp,
            population: config.population,
            countryId: cc,
            nationalGdpPerCapita: config.gdp / config.population,
            year: 1953,
          }
        );
        return Number.isFinite(cost) ? sum + (law.isGrant ? 0 : cost) : sum;
      }, 0);
      const authoredTotal = Object.values(config.baselineSpendingByCategory).reduce(
        (a, b) => a + b,
        0
      );
      const pctDiff = (100 * Math.abs(total - authoredTotal)) / authoredTotal;
      expect(pctDiff, `${cc}: booked ${total} vs authored ${authoredTotal}`).toBeLessThan(5);
    }
  );

  it.each(SEVEN)(
    "%s: an austerity (retrenchment) option on the welfare-state law books strictly less than the enacted default",
    (cc) => {
      // "Gravity, not rails" — a government elected on austerity must be able
      // to move spending. Compare the seeded default option's cost against
      // the ladder's most austere (index 0, "Retrenchment Act") option, using
      // the SAME legislation type's own policyOptions (not a different type).
      const welfareTypeId = `${cc.toLowerCase()}_welfare_state`;
      const legType = COUNTRY_LEGISLATION_TYPES[cc].find((t) => t._id === welfareTypeId) as
        { _id: string; policyOptions?: { gdpPerCapitaMultiplier?: number }[] } | undefined;
      expect(legType, welfareTypeId).toBeDefined();
      const options = legType!.policyOptions ?? [];
      expect(options.length, welfareTypeId).toBeGreaterThan(1);
      const seededLaw = lawsFor(cc).find((l) => l.legislationTypeId === welfareTypeId);
      expect(seededLaw, welfareTypeId).toBeDefined();
      const defaultCost = seededLaw!.gdpPerCapitaMultiplier ?? 0;
      const retrenchmentCost = options[0]?.gdpPerCapitaMultiplier ?? 0;
      expect(retrenchmentCost, `${cc} retrenchment vs default`).toBeLessThan(defaultCost);
    }
  );
});
