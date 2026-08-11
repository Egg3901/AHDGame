import { describe, it, expect } from "vitest";
import { scoreNpcOption } from "../scoreNpcOption";
import type { NpcCountryState, NpcExecutiveProfile } from "../types";

const baseState: NpcCountryState = {
  debtToGdp: 0.6,
  inflationRatePct: 3,
  fxDepreciationFraction: 0,
  hasReserveCurrency: false,
  turnsSinceLastDefault: null,
  inflationGateExceeded: false,
};

const centristDemocrat: NpcExecutiveProfile = {
  characterId: null,
  ideology: "centrist",
  governmentType: "democracy",
  kind: "none",
};

describe("scoreNpcOption — baselines", () => {
  it("baseline democracy/centrist favors bailout slightly over restructure", () => {
    const bailout = scoreNpcOption("bailout", baseState, centristDemocrat);
    const restructure = scoreNpcOption("restructure", baseState, centristDemocrat);
    expect(bailout).toBeGreaterThan(restructure);
  });

  it("baseline scoring is well within +/-1.5 envelope", () => {
    for (const opt of ["bailout", "restructure", "monetize", "repudiate"] as const) {
      const s = scoreNpcOption(opt, baseState, centristDemocrat);
      expect(s).toBeLessThan(1.5);
      expect(s).toBeGreaterThan(-1);
    }
  });
});

describe("scoreNpcOption — state modifiers", () => {
  it("D/GDP > 2.0 boosts repudiate", () => {
    const lowDebt = scoreNpcOption("repudiate", baseState, centristDemocrat);
    const highDebt = scoreNpcOption(
      "repudiate",
      { ...baseState, debtToGdp: 2.5 },
      centristDemocrat
    );
    expect(highDebt).toBeGreaterThan(lowDebt);
  });

  it("D/GDP > 3.0 boosts repudiate twice (compounding)", () => {
    const oneBump = scoreNpcOption("repudiate", { ...baseState, debtToGdp: 2.5 }, centristDemocrat);
    const twoBumps = scoreNpcOption(
      "repudiate",
      { ...baseState, debtToGdp: 3.5 },
      centristDemocrat
    );
    expect(twoBumps - oneBump).toBeCloseTo(0.15, 5);
  });

  it("reserve currency + low inflation strongly favors monetize", () => {
    const baseline = scoreNpcOption("monetize", baseState, centristDemocrat);
    const reserveAndLowInfl = scoreNpcOption(
      "monetize",
      { ...baseState, hasReserveCurrency: true, inflationRatePct: 1.5 },
      centristDemocrat
    );
    expect(reserveAndLowInfl - baseline).toBeCloseTo(0.25, 5);
  });

  it("recent default penalizes both repudiate and bailout", () => {
    const fresh = scoreNpcOption("repudiate", baseState, centristDemocrat);
    const recent = scoreNpcOption(
      "repudiate",
      { ...baseState, turnsSinceLastDefault: 50 },
      centristDemocrat
    );
    expect(recent - fresh).toBeCloseTo(-0.3, 5);

    const freshBailout = scoreNpcOption("bailout", baseState, centristDemocrat);
    const recentBailout = scoreNpcOption(
      "bailout",
      { ...baseState, turnsSinceLastDefault: 50 },
      centristDemocrat
    );
    expect(recentBailout - freshBailout).toBeCloseTo(-0.15, 5);
  });

  it("FX depreciation > 10% penalizes monetize", () => {
    const stable = scoreNpcOption("monetize", baseState, centristDemocrat);
    const depreciating = scoreNpcOption(
      "monetize",
      { ...baseState, fxDepreciationFraction: 0.15 },
      centristDemocrat
    );
    expect(depreciating - stable).toBeCloseTo(-0.1, 5);
  });
});

describe("scoreNpcOption — leader-profile modifiers", () => {
  it("nationalist authoritarian heavily favors repudiate", () => {
    const profile: NpcExecutiveProfile = {
      characterId: null,
      ideology: "nationalist",
      governmentType: "authoritarian",
      kind: "none",
    };
    const repudiate = scoreNpcOption("repudiate", baseState, profile);
    const bailout = scoreNpcOption("bailout", baseState, profile);
    expect(repudiate).toBeGreaterThan(bailout);
  });

  it("technocrat democracy heavily favors restructure or bailout", () => {
    const profile: NpcExecutiveProfile = {
      characterId: null,
      ideology: "technocrat",
      governmentType: "democracy",
      kind: "none",
    };
    const restructure = scoreNpcOption("restructure", baseState, profile);
    const bailout = scoreNpcOption("bailout", baseState, profile);
    const repudiate = scoreNpcOption("repudiate", baseState, profile);
    expect(restructure).toBeGreaterThan(repudiate);
    expect(bailout).toBeGreaterThan(repudiate);
  });
});
