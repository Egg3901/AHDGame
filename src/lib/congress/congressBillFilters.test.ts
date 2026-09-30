import { describe, expect, it } from "vitest";
import { getCurrentCongressBillVote, matchesCongressBillStatusFilter } from "./congressBillFilters";

describe("matchesCongressBillStatusFilter", () => {
  it("treats both chamber vote statuses as Voting", () => {
    expect(matchesCongressBillStatusFilter("active", "active")).toBe(true);
    expect(matchesCongressBillStatusFilter("active_other", "active")).toBe(true);
    expect(matchesCongressBillStatusFilter("veto_override", "active")).toBe(true);
    expect(matchesCongressBillStatusFilter("enrolled", "active")).toBe(false);
  });

  it("matches exact non-voting status filters", () => {
    expect(matchesCongressBillStatusFilter("enrolled", "enrolled")).toBe(true);
    expect(matchesCongressBillStatusFilter("signed", "signed")).toBe(true);
    expect(matchesCongressBillStatusFilter("failed", "failed")).toBe(true);
    expect(matchesCongressBillStatusFilter("active_other", "enrolled")).toBe(false);
  });
});

describe("getCurrentCongressBillVote", () => {
  it("uses the current chamber vote for second-chamber bills", () => {
    expect(
      getCurrentCongressBillVote({
        status: "active_other",
        myVote: null,
        myOtherChamberVote: "for",
      })
    ).toBe("for");
  });

  it("uses the origin vote for first-chamber bills", () => {
    expect(
      getCurrentCongressBillVote({
        status: "active",
        myVote: "against",
        myOtherChamberVote: null,
      })
    ).toBe("against");
  });

  it("uses only the fresh override ballot after a veto", () => {
    expect(
      getCurrentCongressBillVote({
        status: "veto_override",
        myVote: "for",
        myOtherChamberVote: "against",
        myOverrideVote: null,
      })
    ).toBeNull();
    expect(
      getCurrentCongressBillVote({
        status: "veto_override",
        myVote: "for",
        myOtherChamberVote: "against",
        myOverrideVote: "for",
      })
    ).toBe("for");
  });
});
