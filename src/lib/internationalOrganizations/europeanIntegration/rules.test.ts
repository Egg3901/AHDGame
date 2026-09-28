import { describe, expect, it } from "vitest";
import {
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
