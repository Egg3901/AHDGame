import { describe, expect, it } from "vitest";
import { getCurrentCongressBillVote, matchesCongressBillStatusFilter } from "./congressBillFilters";

describe("matchesCongressBillStatusFilter", () => {
  it("treats both chamber vote statuses as Voting", () => {
    expect(matchesCongressBillStatusFilter("active", "active")).toBe(true);
    expect(matchesCongressBillStatusFilter("active_other", "active")).toBe(true);
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
});
