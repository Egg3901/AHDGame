import { describe, expect, it } from "vitest";
import { selectNationalEuropeanDecision } from "./nationalDecisions";

const input: Parameters<typeof selectNationalEuropeanDecision>[0] = {
  countryId: "UK",
  date: "1992-03-01",
  members: ["UK", "DE", "IE"],
  membershipId: "uk-member",
  state: { stage: "community", source: "historical-seed", establishedTurn: 1, ratifications: {} },
  policy: { economic: 1, social: 0 },
  inflationRate: 3,
  euro: {
    countryId: "UK",
    year: 1999,
    europeanMembers: ["UK", "DE", "IE"],
    europeanStage: "union",
    consentedCountries: [],
  },
};

describe("national European government decisions", () => {
  it("opens a ratification proposal without recording an outcome", () => {
    expect(selectNationalEuropeanDecision(input)).toMatchObject({
      kind: "maastricht",
      action: "ratify",
      reasons: expect.any(Array),
    });
    expect(input.state.ratifications).toEqual({});
  });
  it("lets a sovereignty-oriented party seek rejection", () => {
    expect(
      selectNationalEuropeanDecision({ ...input, policy: { economic: -5, social: 5 } })
    ).toMatchObject({ kind: "maastricht", action: "reject" });
  });
  it("respects the decision date and membership", () => {
    expect(
      selectNationalEuropeanDecision({
        ...input,
        date: "1991-01-01",
        euro: { ...input.euro, europeanStage: "community" },
      })
    ).toBeNull();
    expect(selectNationalEuropeanDecision({ ...input, members: [] })).toBeNull();
  });
  it("does not repeatedly propose a decision already enacted by this membership", () => {
    expect(
      selectNationalEuropeanDecision({
        ...input,
        state: {
          ...input.state,
          ratifications: {
            UK: { approved: true, decisionId: "law", membershipId: "uk-member", turn: 60 },
          },
        },
      })
    ).toBeNull();
  });
  it("permits reconsideration after membership changes", () => {
    expect(
      selectNationalEuropeanDecision({
        ...input,
        state: {
          ...input.state,
          ratifications: {
            UK: { approved: true, decisionId: "law", membershipId: "old-membership", turn: 60 },
          },
        },
      })
    ).not.toBeNull();
  });
  it("delays new commitments during severe inflation and when data is missing", () => {
    expect(selectNationalEuropeanDecision({ ...input, inflationRate: 25 })).toBeNull();
    expect(selectNationalEuropeanDecision({ ...input, inflationRate: undefined })).toBeNull();
  });
  it("proposes euro accession only with consent eligibility and stable inflation", () => {
    const union = {
      ...input,
      date: "1999-01-01",
      state: { ...input.state, stage: "union" as const },
    };
    expect(selectNationalEuropeanDecision(union)).toMatchObject({ kind: "euro", action: "ratify" });
    expect(selectNationalEuropeanDecision({ ...union, inflationRate: 9 })).toBeNull();
    expect(
      selectNationalEuropeanDecision({
        ...union,
        euro: { ...input.euro, consentedCountries: ["UK"] },
      })
    ).toBeNull();
  });
});
