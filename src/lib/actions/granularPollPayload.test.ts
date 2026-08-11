import { describe, it, expect } from "vitest";
import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import { DEMOGRAPHIC_TURNOUT_RATES } from "@/lib/seeds/demographicCategories";
import { stateCensusData } from "@/lib/seeds/stateCensusData";
import {
  buildGranularPollPayload,
  buildGranularPollPayloadForState,
  resolveGranularPositions,
  type GranularPollCandidate,
} from "./granularPollPayload";

function ctConfig(): Layer1Config {
  return stateCensusData.CT;
}

function makeOpponent(overrides?: Partial<GranularPollCandidate>): GranularPollCandidate {
  return {
    candidateId: "opp-1",
    name: "Opponent One",
    economicPosition: 1,
    socialPosition: 1,
    favorability: 50,
    politicalInfluence: 50,
    ...overrides,
  };
}

describe("buildGranularPollPayload", () => {
  it("derives cells and candidate shares for a US Layer-1 config", () => {
    const config = ctConfig();
    const payload = buildGranularPollPayload({
      config,
      era: "2019",
      character: {
        economicPosition: -1,
        socialPosition: -1,
        favorability: 50,
        politicalInfluence: 50,
      },
      opponents: [makeOpponent()],
      turnoutRates: DEMOGRAPHIC_TURNOUT_RATES,
    });

    expect(payload.dims).toEqual(["race", "age", "education", "wealth"]);
    expect(payload.dimLabels).toMatchObject({
      race: "Race",
      age: "Age",
      education: "Education",
      wealth: "Wealth",
    });
    expect(payload.cells.length).toBeGreaterThan(0);
    expect(Object.keys(payload.candidateShares).length).toBe(payload.cells.length);

    for (const cell of payload.cells) {
      const shares = payload.candidateShares[cell.id];
      expect(shares).toBeDefined();
      const total =
        shares.you + shares.opponents.reduce((s, o) => s + o.share, 0) + shares.undecided;
      expect(total).toBeCloseTo(1, 5);
      expect(shares.you).toBeGreaterThanOrEqual(0);
      expect(shares.you).toBeLessThanOrEqual(1);
      expect(shares.undecided).toBeGreaterThanOrEqual(0.04);
      expect(shares.undecided).toBeLessThanOrEqual(0.16);
      // Generic cell shape: buckets hold the dimension keys.
      expect(cell.buckets).toMatchObject({
        race: expect.any(String),
        age: expect.any(String),
        education: expect.any(String),
        wealth: expect.any(String),
      });
    }
  });

  it("gives the player a larger share in a cell that matches the player's positions", () => {
    const config = ctConfig();
    const payload = buildGranularPollPayload({
      config,
      era: "2019",
      character: {
        economicPosition: -2,
        socialPosition: -2,
        politicalInfluence: 50,
      },
      opponents: [makeOpponent({ economicPosition: 2, socialPosition: 2 })],
      turnoutRates: DEMOGRAPHIC_TURNOUT_RATES,
    });

    // Find a cell whose lean is strongly progressive; the player should beat the opponent.
    const progressiveCell = payload.cells.find(
      (c) => c.economicLean <= -1.5 && c.socialLean <= -1.5
    );
    expect(progressiveCell).toBeDefined();
    const shares = payload.candidateShares[progressiveCell!.id];
    expect(shares.you).toBeGreaterThan(shares.opponents[0].share);
  });

  it("returns deterministic output for the same input", () => {
    const config = ctConfig();
    const input = {
      config,
      era: "2019" as const,
      character: { economicPosition: 0, socialPosition: 0, politicalInfluence: 50 },
      opponents: [makeOpponent()],
      turnoutRates: DEMOGRAPHIC_TURNOUT_RATES,
    };
    const a = buildGranularPollPayload(input);
    const b = buildGranularPollPayload(input);
    expect(a).toEqual(b);
  });

  it("handles an empty opponent list without crashing", () => {
    const config = ctConfig();
    const payload = buildGranularPollPayload({
      config,
      era: "2019",
      character: { economicPosition: 0, socialPosition: 0, politicalInfluence: 50 },
      opponents: [],
      turnoutRates: DEMOGRAPHIC_TURNOUT_RATES,
    });

    expect(payload.cells.length).toBeGreaterThan(0);
    for (const cell of payload.cells) {
      const shares = payload.candidateShares[cell.id];
      expect(shares.opponents).toHaveLength(0);
      expect(shares.you + shares.undecided).toBeCloseTo(1, 5);
    }
  });
});

describe("buildGranularPollPayloadForState", () => {
  it("derives cells and candidate shares for a US state via preset", () => {
    const payload = buildGranularPollPayloadForState({
      countryId: "US",
      stateId: "CT",
      preset: "2019-default",
      character: {
        economicPosition: -1,
        socialPosition: -1,
        favorability: 50,
        politicalInfluence: 50,
      },
      opponents: [makeOpponent()],
    });

    expect(payload.dims).toEqual(["race", "age", "education", "wealth"]);
    expect(payload.cells.length).toBeGreaterThan(0);
    expect(Object.keys(payload.candidateShares).length).toBe(payload.cells.length);
  });

  it("derives cells and candidate shares for a DE Layer-1 model", () => {
    const payload = buildGranularPollPayloadForState({
      countryId: "DE",
      stateId: "BW",
      preset: "2019-default",
      character: {
        economicPosition: -1,
        socialPosition: -1,
        favorability: 50,
        politicalInfluence: 50,
      },
      opponents: [makeOpponent()],
    });

    expect(payload.dims).toEqual(["ethnicity", "age", "education", "income", "urbanization"]);
    expect(payload.dimLabels).toMatchObject({
      ethnicity: "Ethnicity",
      age: "Age",
      education: "Education",
      income: "Income",
      urbanization: "Urbanization",
    });
    expect(payload.cells.length).toBeGreaterThan(0);
    expect(Object.keys(payload.candidateShares).length).toBe(payload.cells.length);

    for (const cell of payload.cells) {
      for (const dim of payload.dims) {
        expect(cell.buckets[dim]).toBeDefined();
      }
      const shares = payload.candidateShares[cell.id];
      const total =
        shares.you + shares.opponents.reduce((s, o) => s + o.share, 0) + shares.undecided;
      expect(total).toBeCloseTo(1, 5);
    }
  });

  it("throws for a country with no Layer-1 model", () => {
    expect(() =>
      buildGranularPollPayloadForState({
        countryId: "XX",
        stateId: "ZZ",
        preset: "2019-default",
        character: { economicPosition: 0, socialPosition: 0, politicalInfluence: 50 },
        opponents: [],
      })
    ).toThrow("No Layer-1 model");
  });

  it("throws for a missing region in a country model", () => {
    expect(() =>
      buildGranularPollPayloadForState({
        countryId: "DE",
        stateId: "ZZ",
        preset: "2019-default",
        character: { economicPosition: 0, socialPosition: 0, politicalInfluence: 50 },
        opponents: [],
      })
    ).toThrow("No census data");
  });

  it("returns deterministic output for the same state input", () => {
    const input = {
      countryId: "DE" as const,
      stateId: "NW" as const,
      preset: "2019-default" as const,
      character: { economicPosition: 0, socialPosition: 0, politicalInfluence: 50 },
      opponents: [makeOpponent()],
    };
    const a = buildGranularPollPayloadForState(input);
    const b = buildGranularPollPayloadForState(input);
    expect(a).toEqual(b);
  });
});

describe("resolveGranularPositions", () => {
  it("applies state-specific position overrides from the Layer-1 config", () => {
    const config = ctConfig();
    const positions = resolveGranularPositions(config, "2019");
    // CT's authored config.positions must win over the era base (0.8/1) —
    // assert against the authored value so recalibrations don't break this.
    expect(positions.race.white).toEqual(config.positions?.race?.white);
    expect(positions.race.white.economicLean).toBeLessThan(0);
  });
});
