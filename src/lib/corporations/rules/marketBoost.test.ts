import { describe, expect, it } from "vitest";
import {
  STOCK_BOOST_BANK_NPV_TARGET,
  STOCK_BOOST_FINANCIAL_REVENUE_EXTRA,
  STOCK_BOOST_FINANCIAL_RISK_PREMIUM,
  STOCK_BOOST_NPV_RAMP_TURNS,
  STOCK_BOOST_NPV_START_TURN,
  STOCK_BOOST_REVENUE_RAMP_TURNS,
  STOCK_BOOST_REVENUE_START_TURN,
  STOCK_BOOST_REVENUE_TARGET,
  STOCK_BOOST_SECTOR_NPV_TARGET,
} from "@/lib/constants/corporations";
import {
  bankNpvBoostMultiplier,
  rampMultiplier,
  rampProgress,
  sectorNpvBoostMultiplier,
  sectorRevenueBoostMultiplier,
  sectorRiskPremiumAtTurn,
} from "./marketBoost";

describe("rampProgress", () => {
  it("returns 0 before the start turn and 1 after the ramp", () => {
    expect(
      rampProgress(STOCK_BOOST_REVENUE_START_TURN - 1, STOCK_BOOST_REVENUE_START_TURN, 100)
    ).toBe(0);
    expect(rampProgress(STOCK_BOOST_REVENUE_START_TURN, STOCK_BOOST_REVENUE_START_TURN, 100)).toBe(
      0
    );
    expect(
      rampProgress(STOCK_BOOST_REVENUE_START_TURN + 100, STOCK_BOOST_REVENUE_START_TURN, 100)
    ).toBe(1);
    expect(
      rampProgress(STOCK_BOOST_REVENUE_START_TURN + 10_000, STOCK_BOOST_REVENUE_START_TURN, 100)
    ).toBe(1);
  });

  it("is linear mid-ramp and fail-closed on bad input", () => {
    expect(rampProgress(150, 100, 100)).toBeCloseTo(0.5, 10);
    expect(rampProgress(undefined, 100, 100)).toBe(0);
    expect(rampProgress(null, 100, 100)).toBe(0);
    expect(rampProgress(NaN, 100, 100)).toBe(0);
    expect(rampProgress(50, 100, 100)).toBe(0);
  });
});

describe("rampMultiplier", () => {
  it("returns 1.0 on early turns so legacy worlds are byte-identical", () => {
    expect(
      rampMultiplier(1, STOCK_BOOST_REVENUE_START_TURN, STOCK_BOOST_REVENUE_RAMP_TURNS, 2)
    ).toBe(1);
    expect(
      rampMultiplier(undefined, STOCK_BOOST_REVENUE_START_TURN, STOCK_BOOST_REVENUE_RAMP_TURNS, 2)
    ).toBe(1);
  });
});

describe("sectorRevenueBoostMultiplier", () => {
  it("is 1.0 before phase A and reaches target after the ramp", () => {
    expect(sectorRevenueBoostMultiplier(1, "manufacturing")).toBe(1);
    expect(sectorRevenueBoostMultiplier(STOCK_BOOST_REVENUE_START_TURN - 1, "manufacturing")).toBe(
      1
    );
    expect(
      sectorRevenueBoostMultiplier(
        STOCK_BOOST_REVENUE_START_TURN + STOCK_BOOST_REVENUE_RAMP_TURNS,
        "manufacturing"
      )
    ).toBeCloseTo(STOCK_BOOST_REVENUE_TARGET, 10);
  });

  it("compounds the financial extra only for financial sectors", () => {
    const done = STOCK_BOOST_REVENUE_START_TURN + STOCK_BOOST_REVENUE_RAMP_TURNS;
    expect(sectorRevenueBoostMultiplier(done, "financial")).toBeCloseTo(
      STOCK_BOOST_REVENUE_TARGET * STOCK_BOOST_FINANCIAL_REVENUE_EXTRA,
      10
    );
    expect(sectorRevenueBoostMultiplier(done, "retail")).toBeCloseTo(
      STOCK_BOOST_REVENUE_TARGET,
      10
    );
    expect(sectorRevenueBoostMultiplier(done, undefined)).toBeCloseTo(
      STOCK_BOOST_REVENUE_TARGET,
      10
    );
  });

  it("ramps monotonically mid-window", () => {
    const t0 = STOCK_BOOST_REVENUE_START_TURN;
    const mid1 = sectorRevenueBoostMultiplier(t0 + 10, "manufacturing");
    const mid2 = sectorRevenueBoostMultiplier(t0 + 100, "manufacturing");
    expect(mid1).toBeGreaterThan(1);
    expect(mid2).toBeGreaterThan(mid1);
    expect(mid2).toBeLessThan(STOCK_BOOST_REVENUE_TARGET);
  });
});

describe("sectorNpvBoostMultiplier", () => {
  it("lags revenue: still 1.0 when phase A opens", () => {
    expect(sectorNpvBoostMultiplier(STOCK_BOOST_REVENUE_START_TURN)).toBe(1);
    expect(
      sectorNpvBoostMultiplier(STOCK_BOOST_NPV_START_TURN + STOCK_BOOST_NPV_RAMP_TURNS)
    ).toBeCloseTo(STOCK_BOOST_SECTOR_NPV_TARGET, 10);
    expect(sectorNpvBoostMultiplier(1)).toBe(1);
  });
});

describe("bankNpvBoostMultiplier", () => {
  it("shares the NPV window with a higher bank target", () => {
    expect(bankNpvBoostMultiplier(1)).toBe(1);
    expect(bankNpvBoostMultiplier(STOCK_BOOST_REVENUE_START_TURN)).toBe(1);
    expect(
      bankNpvBoostMultiplier(STOCK_BOOST_NPV_START_TURN + STOCK_BOOST_NPV_RAMP_TURNS)
    ).toBeCloseTo(STOCK_BOOST_BANK_NPV_TARGET, 10);
  });
});

describe("sectorRiskPremiumAtTurn", () => {
  it("holds non-financial premia flat at every turn", () => {
    const done = STOCK_BOOST_NPV_START_TURN + STOCK_BOOST_NPV_RAMP_TURNS;
    expect(sectorRiskPremiumAtTurn("manufacturing", 1)).toBe(
      sectorRiskPremiumAtTurn("manufacturing", done)
    );
    expect(sectorRiskPremiumAtTurn("unknown-type", done)).toBe(
      sectorRiskPremiumAtTurn("unknown-type", 1)
    );
  });

  it("eases only the financial premium over the NPV window", () => {
    expect(sectorRiskPremiumAtTurn("financial", 1)).toBeCloseTo(0.06, 10);
    const done = STOCK_BOOST_NPV_START_TURN + STOCK_BOOST_NPV_RAMP_TURNS;
    expect(sectorRiskPremiumAtTurn("financial", done)).toBeCloseTo(
      STOCK_BOOST_FINANCIAL_RISK_PREMIUM,
      10
    );
    const mid = sectorRiskPremiumAtTurn(
      "financial",
      STOCK_BOOST_NPV_START_TURN + STOCK_BOOST_NPV_RAMP_TURNS / 2
    );
    expect(mid).toBeGreaterThan(STOCK_BOOST_FINANCIAL_RISK_PREMIUM);
    expect(mid).toBeLessThan(0.06);
  });
});
