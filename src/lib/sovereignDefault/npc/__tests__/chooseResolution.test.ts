import { describe, it, expect } from "vitest";
import { chooseResolution } from "../chooseResolution";
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

describe("chooseResolution", () => {
  it("centrist democrat with healthy economy → bailout (highest baseline + tiebreak)", () => {
    expect(chooseResolution(baseState, centristDemocrat)).toBe("bailout");
  });

  it("inflation-gated state excludes monetize entirely", () => {
    const populist: NpcExecutiveProfile = {
      characterId: null,
      ideology: "populist",
      governmentType: "democracy",
      kind: "none",
    };
    // Populist ideology favors monetize but gate excludes it.
    const gated = chooseResolution({ ...baseState, inflationGateExceeded: true }, populist);
    expect(gated).not.toBe("monetize");
  });

  it("nationalist + high D/GDP picks repudiate", () => {
    const nationalist: NpcExecutiveProfile = {
      characterId: null,
      ideology: "nationalist",
      governmentType: "democracy",
      kind: "none",
    };
    expect(chooseResolution({ ...baseState, debtToGdp: 3.5 }, nationalist)).toBe("repudiate");
  });

  it("recent default + low D/GDP avoids repudiate", () => {
    const nationalist: NpcExecutiveProfile = {
      characterId: null,
      ideology: "nationalist",
      governmentType: "democracy",
      kind: "none",
    };
    // turnsSinceLastDefault < 100 caps repudiate's score
    const choice = chooseResolution(
      { ...baseState, debtToGdp: 0.8, turnsSinceLastDefault: 30 },
      nationalist
    );
    expect(choice).not.toBe("repudiate");
  });

  it("reserve currency + low inflation + technocrat democrat → bailout still wins (technocrat tilts to bailout/restructure heavily)", () => {
    const technocrat: NpcExecutiveProfile = {
      characterId: null,
      ideology: "technocrat",
      governmentType: "democracy",
      kind: "none",
    };
    expect(
      chooseResolution({ ...baseState, hasReserveCurrency: true, inflationRatePct: 1 }, technocrat)
    ).toBe("bailout");
  });

  it("populist with reserve currency picks monetize over repudiate", () => {
    const populist: NpcExecutiveProfile = {
      characterId: null,
      ideology: "populist",
      governmentType: "democracy",
      kind: "none",
    };
    const choice = chooseResolution(
      { ...baseState, hasReserveCurrency: true, inflationRatePct: 1 },
      populist
    );
    expect(choice).toBe("monetize");
  });

  it("deterministic: same input → same output", () => {
    const a = chooseResolution(baseState, centristDemocrat);
    const b = chooseResolution(baseState, centristDemocrat);
    expect(a).toBe(b);
  });
});
