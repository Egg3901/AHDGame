import { describe, expect, it } from "vitest";
import {
  NATIONAL_PASSIVE_PS_PER_TURN,
  STATE_PASSIVE_PS_PER_TURN,
  PRESSURE_DECAY_PER_TURN,
  PRESSURE_LADDER_INCREMENT,
  PRESSURE_LADDER_MAX_COST,
  PRIORITY_REGION_EFFECT_BONUS,
  PRIORITY_REGION_LOCKOUT_TURNS,
  PRIORITY_REGION_MAX_STATES,
  PS_INVESTMENT_MAX_TIERS,
  NATIONAL_PS_CAP,
  REGION_COUNT_BY_COUNTRY,
  STATE_PS_CAP_DEFAULT,
  TREASURY_PS_RATE_BY_COUNTRY,
  NPP_ONLY_STATE_PS_CAP_FRACTION,
  BUILD_ORG_DIMINISHING_THRESHOLD,
  effectivePsCost,
  effectiveStatePsCap,
  nationalCapForCountry,
  psInvestmentRate,
} from "./strengthConstants";

describe("flat passive PS per turn", () => {
  it("national parties gain a flat 20 PS/turn", () => {
    expect(NATIONAL_PASSIVE_PS_PER_TURN).toBe(20);
  });
  it("state/regional parties gain a flat 5 PS/turn", () => {
    expect(STATE_PASSIVE_PS_PER_TURN).toBe(5);
  });
});

describe("TREASURY_PS_RATE_BY_COUNTRY", () => {
  it("matches plan recommended starting baselines for active countries", () => {
    expect(TREASURY_PS_RATE_BY_COUNTRY.US.national).toBe(75_000);
    expect(TREASURY_PS_RATE_BY_COUNTRY.UK.national).toBe(60_000);
    expect(TREASURY_PS_RATE_BY_COUNTRY.DE.national).toBe(70_000);
    expect(TREASURY_PS_RATE_BY_COUNTRY.JP.national).toBe(5_000_000);
  });

  it("state rate is 50% of national (state cost is half of national)", () => {
    for (const country of ["US", "UK", "DE", "JP", "IE", "BR", "CN", "NG"] as const) {
      const rate = TREASURY_PS_RATE_BY_COUNTRY[country];
      expect(rate.state * 2).toBe(rate.national);
    }
  });
});

describe("NATIONAL_PS_CAP", () => {
  it("is a flat 280 for all countries (region-scaling removed)", () => {
    expect(NATIONAL_PS_CAP).toBe(280);
  });
});

describe("nationalCapForCountry", () => {
  it("returns the flat national cap regardless of country / region count", () => {
    for (const country of ["US", "UK", "DE", "JP", "IE", "BR", "CN", "NG", "SCO", "WAL"] as const) {
      expect(nationalCapForCountry(country)).toBe(NATIONAL_PS_CAP);
    }
  });

  it("does not depend on REGION_COUNT_BY_COUNTRY (JP still 8 regions but cap is 280)", () => {
    expect(REGION_COUNT_BY_COUNTRY.JP).toBe(8);
    expect(nationalCapForCountry("JP")).toBe(280);
  });
});

describe("STATE_PS_CAP_DEFAULT", () => {
  it("is 30 per Phase 0.5 #7", () => {
    expect(STATE_PS_CAP_DEFAULT).toBe(30);
  });
});

describe("effectivePsCost", () => {
  it("adds pressure to base cost", () => {
    expect(effectivePsCost(2, 0)).toBe(2);
    expect(effectivePsCost(2, 3)).toBe(5);
  });

  it("saturates at PRESSURE_LADDER_MAX_COST", () => {
    expect(effectivePsCost(2, 100)).toBe(PRESSURE_LADDER_MAX_COST);
    expect(effectivePsCost(7, 5)).toBe(PRESSURE_LADDER_MAX_COST);
  });

  it("treats negative pressure as 0", () => {
    expect(effectivePsCost(2, -5)).toBe(2);
  });
});

describe("pressure ladder constants", () => {
  it("PRESSURE_DECAY_PER_TURN = 3", () => {
    expect(PRESSURE_DECAY_PER_TURN).toBe(3);
  });
  it("PRESSURE_LADDER_INCREMENT = 1", () => {
    expect(PRESSURE_LADDER_INCREMENT).toBe(1);
  });
  it("PRESSURE_LADDER_MAX_COST = 8", () => {
    expect(PRESSURE_LADDER_MAX_COST).toBe(8);
  });
});

describe("Priority Region constants", () => {
  it("lockout = 168 turns (7 IRL days at hourly cadence)", () => {
    expect(PRIORITY_REGION_LOCKOUT_TURNS).toBe(168);
  });
  it("max cluster size is 3", () => {
    expect(PRIORITY_REGION_MAX_STATES).toBe(3);
  });
  it("effect bonus is +25%", () => {
    expect(PRIORITY_REGION_EFFECT_BONUS).toBe(0.25);
  });
});

describe("PS_INVESTMENT_MAX_TIERS", () => {
  it("caps spend-driven gain at +20 PS/turn", () => {
    expect(PS_INVESTMENT_MAX_TIERS).toBe(20);
  });
});

describe("psInvestmentRate (5% of the legacy per-country rate)", () => {
  it("UK national is £10,000 / +1 PS (was £200,000)", () => {
    expect(psInvestmentRate("UK", "national")).toBeCloseTo(10_000);
  });
  it("US national is £12,500 / +1 PS (was £250,000)", () => {
    expect(psInvestmentRate("US", "national")).toBeCloseTo(12_500);
  });
  it("state rate stays half of national", () => {
    for (const c of ["US", "UK", "DE", "JP"] as const) {
      expect(psInvestmentRate(c, "state")).toBeCloseTo(psInvestmentRate(c, "national") / 2);
    }
  });
});

describe("NPP_ONLY_STATE_PS_CAP_FRACTION", () => {
  it("is 25%", () => {
    expect(NPP_ONLY_STATE_PS_CAP_FRACTION).toBe(0.25);
  });
});

describe("effectiveStatePsCap", () => {
  it("returns the full state cap when a player member is present", () => {
    expect(effectiveStatePsCap(true)).toBe(STATE_PS_CAP_DEFAULT); // 30
  });

  it("returns 25% of the state cap when only NPP / no members", () => {
    expect(effectiveStatePsCap(false)).toBe(STATE_PS_CAP_DEFAULT * 0.25); // 7.5
  });
});

describe("BUILD_ORG_DIMINISHING_THRESHOLD", () => {
  it("is 50% Org", () => {
    expect(BUILD_ORG_DIMINISHING_THRESHOLD).toBe(50);
  });
});
