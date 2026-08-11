import { describe, expect, it } from "vitest";
import { calculateMoneyAggregates, annualizedMoneyGrowthPct } from "./calculate";
import {
  addCentralBankMoney,
  addComponent,
  addHouseholdMoneyFromDemography,
  effectiveExternalBroadMoney,
  emptyComponents,
  governmentLiquidFromTreasury,
  UNMODELED_EXTERNAL_SHARE,
} from "./assemble";

describe("governmentLiquidFromTreasury", () => {
  it("counts only positive surplus cash — never mirrors debt principal", () => {
    // Seeded indebted treasury: treasuryBalance === -debt.principal by design.
    expect(governmentLiquidFromTreasury(-4_200_000_000_000)).toBe(0);
    expect(governmentLiquidFromTreasury(0)).toBe(0);
    expect(governmentLiquidFromTreasury(750_000)).toBe(750_000);
  });
});

describe("effectiveExternalBroadMoney", () => {
  it("keeps only the unmodeled share of the seeded baseline so domestic mass is not double-counted", () => {
    expect(effectiveExternalBroadMoney(240)).toBeCloseTo(240 * UNMODELED_EXTERNAL_SHARE);
  });

  it("passes QE/QT net issuance through at face value", () => {
    // Seed 1000, then +200 QE recorded on both external and netMoneyCreatedLifetime.
    expect(effectiveExternalBroadMoney(1_200, 200)).toBeCloseTo(
      1_000 * UNMODELED_EXTERNAL_SHARE + 200
    );
  });
});

describe("household demography derivation", () => {
  it("builds household money from state population × median income, including countries outside NATIONAL_SCOPE", () => {
    const byCurrency = new Map();
    addHouseholdMoneyFromDemography(
      byCurrency,
      [
        { _id: "Île-de-France", countryId: "FR", population: 8_000_000 },
        { _id: "federal", countryId: "US", population: 158_000_000 }, // national synthetic — skipped
        { _id: "CA", countryId: "US", population: 12_000_000 },
      ],
      [
        { _id: "Île-de-France", economic: { medianIncome: { value: 30_000 } } },
        { _id: "federal", economic: { medianIncome: { value: 3_900 } } },
        { _id: "CA", economic: { medianIncome: { value: 4_500 } } },
      ]
    );

    const fr = byCurrency.get("FRF");
    const us = byCurrency.get("USD");
    expect(fr?.householdLiquid).toBeCloseTo((8_000_000 / 3.2) * 30_000 * 0.15);
    expect(fr?.householdSavings).toBeCloseTo((8_000_000 / 3.2) * 30_000 * 0.6);
    // Only CA contributes — the federal synthetic row is excluded.
    expect(us?.householdLiquid).toBeCloseTo((12_000_000 / 3.2) * 4_500 * 0.15);
  });
});

describe("M2 responds to domestic components", () => {
  it("raises M2 when corporate liquid capital rises", () => {
    const byCurrency = new Map();
    addCentralBankMoney(byCurrency, [
      { countryId: "US", externalBroadMoney: 240_000_000_000, netMoneyCreatedLifetime: 0 },
    ]);
    addComponent(byCurrency, "USD", "corporateLiquid", 10_000_000_000);
    const before = calculateMoneyAggregates(byCurrency.get("USD")!);

    addComponent(byCurrency, "USD", "corporateLiquid", 5_000_000_000);
    const after = calculateMoneyAggregates(byCurrency.get("USD")!);

    expect(after.m2).toBe(before.m2 + 5_000_000_000);
    expect(after.corporateLiquid).toBe(15_000_000_000);
    // Growth over a 12-turn lag is non-zero — the frozen-constant regression.
    expect(annualizedMoneyGrowthPct(before.m2, after.m2, 12)).toBeGreaterThan(0);
  });

  it("no longer leaves M2 identical to the full seeded external constant", () => {
    const byCurrency = new Map();
    const seeded = 239_940_000_000;
    addCentralBankMoney(byCurrency, [
      { countryId: "US", externalBroadMoney: seeded, netMoneyCreatedLifetime: 0 },
    ]);
    addHouseholdMoneyFromDemography(
      byCurrency,
      [{ _id: "CA", countryId: "US", population: 158_000_000 }],
      [{ _id: "CA", economic: { medianIncome: { value: 3_900 } } }]
    );
    const agg = calculateMoneyAggregates(byCurrency.get("USD") ?? emptyComponents());
    expect(agg.householdLiquid).toBeGreaterThan(0);
    expect(agg.householdSavings).toBeGreaterThan(0);
    expect(agg.externalBroadMoney).toBeCloseTo(seeded * UNMODELED_EXTERNAL_SHARE);
    // Domestic households dominate the residual external stand-in.
    expect(agg.householdLiquid + agg.householdSavings).toBeGreaterThan(agg.externalBroadMoney);
    expect(agg.m2).not.toBe(seeded);
  });
});
