import { describe, expect, it } from "vitest";
import {
  decideBackgroundMaastricht,
  isCarriedOverEuropeanIntegration,
  canRatifyMaastricht,
  COMMUNITY_MEMBERS_1991,
  recordEuropeanRatification,
  reconcileEuropeanTreaty,
  withdrawEuropeanRatification,
  type EuropeanIntegrationState,
} from "./rules";
const initial: EuropeanIntegrationState = {
  stage: "community",
  source: "historical-seed",
  establishedTurn: 0,
  ratifications: {},
};
function approved() {
  return COMMUNITY_MEMBERS_1991.reduce(
    (state, countryId, i) =>
      recordEuropeanRatification({
        state,
        date: "1992-02-07",
        members: COMMUNITY_MEMBERS_1991,
        countryId,
        decision: { approved: true, decisionId: countryId, turn: 55 + i },
      }),
    initial
  );
}
describe("European treaty decisions", () => {
  it("opens the decision on the signature date, without enacting it", () => {
    expect(canRatifyMaastricht("1992-02-06", "community")).toBe(false);
    expect(canRatifyMaastricht("1992-02-07", "community")).toBe(true);
    expect(
      reconcileEuropeanTreaty({
        state: initial,
        date: "2000-01-01",
        turn: 500,
        members: COMMUNITY_MEMBERS_1991,
      })
    ).toBe(initial);
  });
  it("requires every actual member, including background countries, to consent", () => {
    const state = approved();
    const rejected = recordEuropeanRatification({
      state,
      date: "1992-06-02",
      members: COMMUNITY_MEMBERS_1991,
      countryId: "DK",
      decision: { approved: false, decisionId: "rejection", turn: 80 },
    });
    expect(
      reconcileEuropeanTreaty({
        state: rejected,
        date: "1993-11-01",
        turn: 140,
        members: COMMUNITY_MEMBERS_1991,
      })
    ).toBe(rejected);
    expect(
      reconcileEuropeanTreaty({
        state,
        date: "1993-10-31",
        turn: 139,
        members: COMMUNITY_MEMBERS_1991,
      })
    ).toBe(state);
    expect(
      reconcileEuropeanTreaty({
        state,
        date: "1993-11-01",
        turn: 140,
        members: COMMUNITY_MEMBERS_1991,
      })
    ).toMatchObject({ stage: "union", treatyEffectiveTurn: 140 });
  });
  it("does not let replay replace a newer rejection", () => {
    const state = recordEuropeanRatification({
      state: approved(),
      date: "1992-06-02",
      members: COMMUNITY_MEMBERS_1991,
      countryId: "DK",
      decision: { approved: false, decisionId: "newer", turn: 80 },
    });
    expect(
      recordEuropeanRatification({
        state,
        date: "1992-06-03",
        members: COMMUNITY_MEMBERS_1991,
        countryId: "DK",
        decision: { approved: true, decisionId: "DK", turn: 60 },
      })
    ).toBe(state);
  });
  it("does not turn an empty or single-member shell into a union", () => {
    for (const members of [[], ["DE"]])
      expect(
        reconcileEuropeanTreaty({ state: approved(), date: "1993-11-01", turn: 140, members }).stage
      ).toBe("community");
  });
  it("does not carry a withdrawn country's old vote into readmission", () => {
    const state = withdrawEuropeanRatification(approved(), "UK");
    expect(
      reconcileEuropeanTreaty({
        state,
        date: "1993-11-01",
        turn: 140,
        members: COMMUNITY_MEMBERS_1991,
      })
    ).toBe(state);
    expect(
      reconcileEuropeanTreaty({
        state,
        date: "1993-11-01",
        turn: 140,
        members: COMMUNITY_MEMBERS_1991.filter((id) => id !== "UK"),
      }).stage
    ).toBe("union");
  });
});

describe("carried-over European records", () => {
  it("flags only a record established after the world's current turn", () => {
    expect(isCarriedOverEuropeanIntegration({ ...initial, establishedTurn: 1262 }, 1)).toBe(true);
    expect(isCarriedOverEuropeanIntegration({ ...initial, establishedTurn: 1 }, 1)).toBe(false);
    expect(isCarriedOverEuropeanIntegration({ ...initial, establishedTurn: 0 }, 400)).toBe(false);
    expect(isCarriedOverEuropeanIntegration({ ...initial, establishedTurn: 5 }, Number.NaN)).toBe(
      false
    );
  });
});

describe("background Maastricht decisions", () => {
  const country = {
    countryId: "BE",
    membershipId: "be-membership",
    economicSystem: "market" as const,
    stability: 0.6,
    tradeExposure: 0.4,
    fiscalCapacity: 0.3,
  };
  const context = { state: initial, date: "1992-02-08", turn: 55, members: ["BE"], country };
  it("records consent and an explanation when conditions support integration", () => {
    expect(decideBackgroundMaastricht(context)).toMatchObject({
      approved: true,
      source: "background-government",
      reasons: [expect.any(String)],
    });
  });
  it("rejects on adverse conditions and does not change its answer merely because time passes", () => {
    const adverse = { ...country, stability: 0.2 };
    const decision = decideBackgroundMaastricht({ ...context, country: adverse })!;
    expect(decision.approved).toBe(false);
    expect(decision.reasons).toContain("Domestic instability prevents treaty commitments.");
    const state = { ...initial, ratifications: { BE: decision } };
    expect(
      decideBackgroundMaastricht({ ...context, state, country: adverse, turn: 56 })
    ).toBeUndefined();
    expect(
      decideBackgroundMaastricht({ ...context, state, country: adverse, turn: 103 })?.approved
    ).toBe(false);
    expect(decideBackgroundMaastricht({ ...context, state, turn: 103 })?.approved).toBe(true);
  });
  it("never overrides a domestic law or fabricates consent from invalid data", () => {
    const state = {
      ...initial,
      ratifications: {
        BE: { approved: false, decisionId: "law", turn: 55, membershipId: country.membershipId },
      },
    };
    expect(decideBackgroundMaastricht({ ...context, state, turn: 200 })).toBeUndefined();
    expect(
      decideBackgroundMaastricht({ ...context, country: { ...country, stability: NaN } })
    ).toBeUndefined();
    expect(decideBackgroundMaastricht({ ...context, date: "1991-01-01" })).toBeUndefined();
  });
});
