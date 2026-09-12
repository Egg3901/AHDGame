import { describe, expect, it } from "vitest";
import {
  OVERHANG_CAP,
  MAX_BLACK_MARKET_PREMIUM,
  MAX_SECOND_ECONOMY_SHARE,
  MAX_REPRESSION_LEGITIMACY_COST,
  accumulateOverhang,
  shortageIndexFrom,
  countryPhysicalDemandSupplyGapPct,
  blackMarketPremiumFrom,
  updateSecondEconomy,
  overhangInjectionFromIssuance,
  blackMarketPressure,
  repressionLegitimacyCost,
} from "./commandEconomyState";

const NAN_CASES = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

function expectFiniteInRange(v: number, lo: number, hi: number) {
  expect(Number.isFinite(v)).toBe(true);
  expect(v).toBeGreaterThanOrEqual(lo);
  expect(v).toBeLessThanOrEqual(hi);
}

describe("accumulateOverhang", () => {
  it("stays finite and within [0, OVERHANG_CAP]", () => {
    const samples = [
      accumulateOverhang(0, 8, 2, 1, 0),
      accumulateOverhang(50, 12, 1, 0.8, 5),
      accumulateOverhang(OVERHANG_CAP, 50, -10, 1, 0),
      accumulateOverhang(-5, -3, 10, 1, 100),
      accumulateOverhang(10, 0, 0, 0, 0),
    ];
    for (const v of samples) {
      expectFiniteInRange(v, 0, OVERHANG_CAP);
    }
  });

  it("never yields NaN when any argument is non-finite", () => {
    for (const bad of NAN_CASES) {
      expect(Number.isFinite(accumulateOverhang(bad, 5, 1, 1, 0))).toBe(true);
      expect(Number.isFinite(accumulateOverhang(10, bad, 1, 1, 0))).toBe(true);
      expect(Number.isFinite(accumulateOverhang(10, 5, bad, 1, 0))).toBe(true);
      expect(Number.isFinite(accumulateOverhang(10, 5, 1, bad, 0))).toBe(true);
      expect(Number.isFinite(accumulateOverhang(10, 5, 1, 1, bad))).toBe(true);
    }
  });

  it("rises when wageGrowth > goodsGrowth and plannedShare > 0", () => {
    const prev = 10;
    const next = accumulateOverhang(prev, 15, 2, 1, 0);
    expect(next).toBeGreaterThan(prev * 0.92); // more than pure decay
    expect(next).toBeGreaterThan(prev);
  });

  it("does not rise when wageGrowth <= goodsGrowth (decays or flat at 0)", () => {
    const prev = 20;
    const equal = accumulateOverhang(prev, 3, 3, 1, 0);
    const below = accumulateOverhang(prev, 1, 5, 1, 0);
    expect(equal).toBeLessThanOrEqual(prev);
    expect(below).toBeLessThanOrEqual(prev);
    expect(equal).toBeLessThan(prev); // decay with zero flow
  });

  // ── P1: directed-credit issuance feeds the SAME accumulator ────────────────
  it("credit issuance injection RAISES overhang above the no-credit baseline", () => {
    const prev = 10;
    const noCredit = accumulateOverhang(prev, 3, 3, 1, 0, 0); // gap 0 → pure decay
    const withCredit = accumulateOverhang(prev, 3, 3, 1, 0, 2); // +2 injection
    expect(withCredit).toBeGreaterThan(noCredit);
    expect(withCredit - noCredit).toBeCloseTo(2, 5);
  });

  it("default injection arg keeps the pre-P1 behaviour byte-identical", () => {
    expect(accumulateOverhang(10, 3, 3, 1, 0)).toBe(accumulateOverhang(10, 3, 3, 1, 0, 0));
  });

  it("injection stays finite for non-finite input", () => {
    expect(Number.isFinite(accumulateOverhang(10, 3, 3, 1, 0, Number.NaN))).toBe(true);
  });
});

describe("overhangInjectionFromIssuance", () => {
  it("is zero when nothing is monetized or the plan base is empty", () => {
    expect(overhangInjectionFromIssuance(0, 1_000, 1)).toBe(0);
    expect(overhangInjectionFromIssuance(50, 0, 1)).toBe(0);
  });

  it("grows with monetized issuance and with administered share", () => {
    const small = overhangInjectionFromIssuance(10, 1_000, 1);
    const big = overhangInjectionFromIssuance(50, 1_000, 1);
    const lessAdministered = overhangInjectionFromIssuance(50, 1_000, 0.5);
    expect(big).toBeGreaterThan(small);
    expect(lessAdministered).toBeLessThan(big);
    expectFiniteInRange(big, 0, OVERHANG_CAP);
  });

  it("decays monotonically toward 0 with zero flow and zero relief", () => {
    // Slow, sticky decay (0.99/turn ≈ 2-year horizon): must strictly decrease
    // every turn and be well below the start within a couple of years...
    let overhang = 40;
    let prev = overhang;
    for (let i = 0; i < 96; i++) {
      overhang = accumulateOverhang(overhang, 2, 2, 1, 0);
      expect(overhang).toBeLessThan(prev);
      prev = overhang;
    }
    expect(overhang).toBeLessThan(40);
    // ...and effectively gone over a long horizon (~12 years).
    for (let i = 0; i < 500; i++) overhang = accumulateOverhang(overhang, 2, 2, 1, 0);
    expectFiniteInRange(overhang, 0, OVERHANG_CAP);
    expect(overhang).toBeLessThan(0.5);
  });
});

describe("shortageIndexFrom", () => {
  it("limits physical scarcity to a mild annual repression consequence", () => {
    const addedShortage = shortageIndexFrom(20, 500) - shortageIndexFrom(20, 0);
    expect(addedShortage).toBeGreaterThan(0);
    expect(addedShortage).toBeLessThanOrEqual(6);
    // At 60% repression, even maximum physical stress adds under two
    // legitimacy points per 48-turn year, holding other drivers fixed.
    expect((addedShortage / 100) * 0.6 * 48).toBeLessThan(2);
  });

  it("stays finite and within [0, 100]", () => {
    const samples = [
      shortageIndexFrom(0),
      shortageIndexFrom(50, 0),
      shortageIndexFrom(OVERHANG_CAP, 500),
      shortageIndexFrom(-10, -5),
      shortageIndexFrom(30, 100),
    ];
    for (const v of samples) {
      expectFiniteInRange(v, 0, 100);
    }
  });

  it("never yields NaN when any argument is non-finite", () => {
    for (const bad of NAN_CASES) {
      expect(Number.isFinite(shortageIndexFrom(bad, 10))).toBe(true);
      expect(Number.isFinite(shortageIndexFrom(20, bad))).toBe(true);
    }
  });

  it("increases with overhang", () => {
    const low = shortageIndexFrom(10, 0);
    const mid = shortageIndexFrom(40, 0);
    const high = shortageIndexFrom(80, 0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it("increases with demand-supply gap at fixed overhang", () => {
    const a = shortageIndexFrom(20, 0);
    const b = shortageIndexFrom(20, 100);
    const c = shortageIndexFrom(20, 400);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("countryPhysicalDemandSupplyGapPct", () => {
  it("weights country rows and never pools another country's shortage", () => {
    const us = countryPhysicalDemandSupplyGapPct([
      { basis: "country_scoped_ledger", supply: 100, demand: 200, price: 1 },
      { basis: "country_scoped_ledger", supply: 100, demand: 100, price: 1 },
    ]);
    const ru = countryPhysicalDemandSupplyGapPct([
      { basis: "country_scoped_ledger", supply: 100, demand: 100, price: 1 },
    ]);
    expect(us).toBeGreaterThan(0);
    expect(ru).toBe(0);
  });

  it("returns null for absent or non-explicit ledger observations", () => {
    expect(countryPhysicalDemandSupplyGapPct([])).toBeNull();
    expect(
      countryPhysicalDemandSupplyGapPct([{ supply: 100, demand: 200, price: 1, basis: "global" }])
    ).toBeNull();
    expect(
      countryPhysicalDemandSupplyGapPct([
        { supply: Number.NaN, demand: 200, price: 1, basis: "country_scoped_ledger" },
        { supply: -1, demand: 200, price: 1, basis: "country_scoped_ledger" },
        { supply: 100, demand: 200, basis: "country_scoped_ledger" },
      ])
    ).toBeNull();
  });

  it("stays finite when valid ledger values would overflow value weighting", () => {
    const gap = countryPhysicalDemandSupplyGapPct([
      {
        basis: "country_scoped_ledger",
        supply: Number.MAX_VALUE,
        demand: Number.MAX_VALUE,
        price: Number.MAX_VALUE,
      },
      {
        basis: "country_scoped_ledger",
        supply: Number.MAX_VALUE / 2,
        demand: Number.MAX_VALUE,
        price: Number.MAX_VALUE,
      },
    ]);
    expect(Number.isFinite(gap)).toBe(true);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(500);
  });
});

describe("blackMarketPremiumFrom", () => {
  it("stays finite and within [0, MAX_BLACK_MARKET_PREMIUM]", () => {
    const samples = [
      blackMarketPremiumFrom(0, 0, 0),
      blackMarketPremiumFrom(50, 40, 0.3),
      blackMarketPremiumFrom(100, OVERHANG_CAP, 0),
      blackMarketPremiumFrom(100, OVERHANG_CAP, 1),
      blackMarketPremiumFrom(-5, -5, -1),
    ];
    for (const v of samples) {
      expectFiniteInRange(v, 0, MAX_BLACK_MARKET_PREMIUM);
    }
  });

  it("never yields NaN when any argument is non-finite", () => {
    for (const bad of NAN_CASES) {
      expect(Number.isFinite(blackMarketPremiumFrom(bad, 20, 0.3))).toBe(true);
      expect(Number.isFinite(blackMarketPremiumFrom(40, bad, 0.3))).toBe(true);
      expect(Number.isFinite(blackMarketPremiumFrom(40, 20, bad))).toBe(true);
    }
  });

  it("increases with overhang (and shortage)", () => {
    const low = blackMarketPremiumFrom(10, 10, 0.3);
    const high = blackMarketPremiumFrom(80, 80, 0.3);
    expect(high).toBeGreaterThan(low);
  });

  it("higher tolerance lowers the premium", () => {
    const repressed = blackMarketPremiumFrom(60, 50, 0);
    const tolerant = blackMarketPremiumFrom(60, 50, 1);
    expect(tolerant).toBeLessThan(repressed);
  });
});

describe("updateSecondEconomy", () => {
  it("keeps share finite and within [0, MAX_SECOND_ECONOMY_SHARE]", () => {
    const samples = [
      updateSecondEconomy(0, 0, 0, 0),
      updateSecondEconomy(0.2, 50, 40, 0.3),
      updateSecondEconomy(MAX_SECOND_ECONOMY_SHARE, 100, OVERHANG_CAP, 1),
      updateSecondEconomy(-0.1, -5, -5, -1),
    ];
    for (const { share, relief } of samples) {
      expectFiniteInRange(share, 0, MAX_SECOND_ECONOMY_SHARE);
      expectFiniteInRange(relief, 0, OVERHANG_CAP);
    }
  });

  it("never yields NaN when any argument is non-finite", () => {
    for (const bad of NAN_CASES) {
      const a = updateSecondEconomy(bad, 40, 30, 0.3);
      const b = updateSecondEconomy(0.1, bad, 30, 0.3);
      const c = updateSecondEconomy(0.1, 40, bad, 0.3);
      const d = updateSecondEconomy(0.1, 40, 30, bad);
      for (const r of [a, b, c, d]) {
        expect(Number.isFinite(r.share)).toBe(true);
        expect(Number.isFinite(r.relief)).toBe(true);
      }
    }
  });

  it("higher tolerance raises second-economy share and relief", () => {
    const lowTol = updateSecondEconomy(0.1, 70, 50, 0.1);
    const highTol = updateSecondEconomy(0.1, 70, 50, 0.9);
    expect(highTol.share).toBeGreaterThan(lowTol.share);
    expect(highTol.relief).toBeGreaterThan(lowTol.relief);
  });
});

describe("internal repression — blackMarketPressure", () => {
  const shortage = 80;
  const premium = 1.5;
  const share = 0.4;

  it("repression=0 is byte-identical to the pre-repression 3-arg blend", () => {
    expect(blackMarketPressure(shortage, premium, share, 0)).toBe(
      blackMarketPressure(shortage, premium, share)
    );
  });

  it("higher repression LOWERS the black-market pressure", () => {
    const none = blackMarketPressure(shortage, premium, share, 0);
    const some = blackMarketPressure(shortage, premium, share, 0.5);
    const heavy = blackMarketPressure(shortage, premium, share, 1);
    expect(some).toBeLessThan(none);
    expect(heavy).toBeLessThan(some);
  });

  it("suppresses ONLY the premium + grey-market EXPRESSION, never the shortage floor", () => {
    // With no premium and no grey market, pressure is pure shortage (0.5 * s) and
    // repression must not touch it — repression hides the black market, not the scarcity.
    const s = 60;
    const pureShortage = blackMarketPressure(s, 0, 0, 0);
    expect(blackMarketPressure(s, 0, 0, 1)).toBeCloseTo(pureShortage, 10);
    // The shortage floor (0.5 * s/100) always survives — even full repression only
    // forces the EXPRESSION (premium + grey market) down, never below zero, so the
    // repressed pressure stays strictly above the pure-shortage floor when a black
    // market exists.
    const floor = 0.5 * (s / 100);
    const repressedWithMarket = blackMarketPressure(
      s,
      MAX_BLACK_MARKET_PREMIUM,
      MAX_SECOND_ECONOMY_SHARE,
      1
    );
    expect(repressedWithMarket).toBeGreaterThan(floor);
    // ...and it is well below the un-repressed pressure (heavy suppression of the expression).
    const unrepressed = blackMarketPressure(
      s,
      MAX_BLACK_MARKET_PREMIUM,
      MAX_SECOND_ECONOMY_SHARE,
      0
    );
    expect(repressedWithMarket).toBeLessThan(unrepressed);
  });

  it("does NOT change the overhang or shortage kernels (the cause is untouched)", () => {
    // Repression is not an input to accumulateOverhang or shortageIndexFrom at all;
    // assert the readouts computed here are independent of any repression level.
    const overhang = accumulateOverhang(40, 10, 2, 1, 0);
    const shortageIdx = shortageIndexFrom(overhang, 50);
    // These are the exact values feeding pressure; only pressure moves with repression.
    for (const rep of [0, 0.3, 0.7, 1]) {
      const premiumR = blackMarketPremiumFrom(shortageIdx, overhang, 0.3);
      // premium/overhang/shortage kernels never receive `rep` — recompute is stable.
      expect(Number.isFinite(premiumR)).toBe(true);
      expect(blackMarketPressure(shortageIdx, premiumR, 0.3, rep)).toBeLessThanOrEqual(
        blackMarketPressure(shortageIdx, premiumR, 0.3, 0) + 1e-9
      );
    }
  });

  it("stays finite in [0, 1] for adversarial repression", () => {
    for (const rep of [-1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectFiniteInRange(blackMarketPressure(shortage, premium, share, rep), 0, 1);
    }
  });
});

describe("repressionLegitimacyCost", () => {
  it("is zero with no repression, regardless of shortage", () => {
    expect(repressionLegitimacyCost(0, 0)).toBe(0);
    expect(repressionLegitimacyCost(0, 100)).toBe(0);
  });

  it("is zero with no shortage, regardless of repression (nothing to bottle up)", () => {
    expect(repressionLegitimacyCost(1, 0)).toBe(0);
  });

  it("is negative and climbs (more negative) with BOTH repression and shortage", () => {
    const light = repressionLegitimacyCost(0.3, 40);
    const harder = repressionLegitimacyCost(0.6, 40);
    const worseShortage = repressionLegitimacyCost(0.6, 80);
    expect(light).toBeLessThan(0);
    expect(harder).toBeLessThan(light); // more repression, more cost
    expect(worseShortage).toBeLessThan(harder); // more shortage, more cost
  });

  it("is the product of repression x shortage (pressure cooker), bounded", () => {
    expect(repressionLegitimacyCost(1, 100)).toBeCloseTo(-MAX_REPRESSION_LEGITIMACY_COST, 10);
    for (const rep of [-1, 2, Number.NaN]) {
      for (const s of [-10, 500, Number.POSITIVE_INFINITY]) {
        expectFiniteInRange(-repressionLegitimacyCost(rep, s), 0, MAX_REPRESSION_LEGITIMACY_COST);
      }
    }
  });
});

describe("accumulateOverhang plan-shortfall goods deficit", () => {
  it("accrues overhang for a USSR whose wages trail GDP but whose plan is missed", () => {
    // The exact production shape on 2026-08-10: RU ran wageGrowth 4.81 against
    // gdpGrowth 5.50, a NEGATIVE gap, so the old kernel accrued nothing and
    // structurally never could however badly the enterprises did.
    const onPlan = accumulateOverhang(0, 4.81, 5.5, 0.9, 0, 0, 1);
    expect(onPlan).toBe(0);

    // Same wages, same GDP, but the enterprises deliver 84% of plan.
    const missingPlan = accumulateOverhang(0, 4.81, 5.5, 0.9, 0, 0, 0.84);
    expect(missingPlan).toBeGreaterThan(0);
  });

  it("scales with the size of the miss", () => {
    const small = accumulateOverhang(0, 4.81, 5.5, 0.9, 0, 0, 0.95);
    const big = accumulateOverhang(0, 4.81, 5.5, 0.9, 0, 0, 0.6);
    expect(big).toBeGreaterThan(small);
  });

  it("does not let an over-delivering plan create negative overhang", () => {
    const over = accumulateOverhang(0, 4.81, 5.5, 0.9, 0, 0, 1.5);
    expect(over).toBe(0);
    // And an over-delivering plan is identical to an exactly-met one: the term
    // only ever adds a deficit, it never subtracts.
    expect(over).toBe(accumulateOverhang(0, 4.81, 5.5, 0.9, 0, 0, 1));
  });

  it("defaults to on-plan so existing callers are unchanged", () => {
    expect(accumulateOverhang(10, 8, 2, 1, 0, 0)).toBe(accumulateOverhang(10, 8, 2, 1, 0, 0, 1));
  });

  it("stays bounded on a total plan collapse", () => {
    let o = 0;
    for (let i = 0; i < 500; i++) o = accumulateOverhang(o, 20, 0, 1, 0, 0, 0);
    expectFiniteInRange(o, 0, OVERHANG_CAP);
  });

  it("tolerates a non-finite fulfillment", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(Number.isFinite(accumulateOverhang(10, 5, 1, 1, 0, 0, bad))).toBe(true);
    }
  });
});
