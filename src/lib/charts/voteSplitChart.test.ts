import { describe, expect, it } from "vitest";
import { billChamberVoteSplits, generateVoteSplitChartSvg } from "@/lib/charts/voteSplitChart";

describe("generateVoteSplitChartSvg", () => {
  it("renders one bar per chamber with aye/nay/abstain segments", () => {
    const svg = generateVoteSplitChartSvg([
      { label: "House", votesFor: 232, votesAgainst: 198, votesAbstain: 5, seats: 435 },
      { label: "Senate", votesFor: 62, votesAgainst: 35, votesAbstain: 3, seats: 100 },
    ]);

    expect(svg).toContain("HOUSE");
    expect(svg).toContain("SENATE");
    expect(svg).toContain("#4ade80");
    expect(svg).toContain("#ef4444");
    expect(svg).toContain("#94a3b8");
    expect(svg).toContain('fill="#4ade80">232</tspan>');
    expect(svg).toContain("> ayes</tspan>");
    expect(svg).toContain('fill="#94a3b8">3</tspan>');
  });

  it("shows a not-voting remainder when seats exceed votes cast", () => {
    const svg = generateVoteSplitChartSvg([
      { label: "Senate", votesFor: 40, votesAgainst: 30, votesAbstain: 0, seats: 100 },
    ]);
    expect(svg).toContain("30 not voting");
  });

  it("returns an empty string when no chamber recorded votes", () => {
    expect(
      generateVoteSplitChartSvg([{ label: "House", votesFor: 0, votesAgainst: 0, votesAbstain: 0 }])
    ).toBe("");
    expect(generateVoteSplitChartSvg([])).toBe("");
  });

  it("escapes chamber labels", () => {
    const svg = generateVoteSplitChartSvg([
      { label: "A<B", votesFor: 1, votesAgainst: 0, votesAbstain: 0 },
    ]);
    expect(svg).toContain("A&lt;B");
  });
});

describe("billChamberVoteSplits", () => {
  it("maps a US bill's frozen snapshots to House and Senate rows", () => {
    const splits = billChamberVoteSplits(
      {
        originChamber: "house",
        currentChamber: "senate",
        voteSnapshot: {
          votes: {},
          weights: {},
          totals: { for: 232, against: 198, abstain: 5 },
          resolvedAtTurn: 10,
        },
        otherChamberVoteSnapshot: {
          votes: {},
          weights: {},
          totals: { for: 62, against: 35, abstain: 3 },
          resolvedAtTurn: 11,
        },
      },
      "US",
      "national"
    );

    expect(splits).toEqual([
      { label: "House", seats: 435, votesFor: 232, votesAgainst: 198, votesAbstain: 5 },
      { label: "Senate", seats: 100, votesFor: 62, votesAgainst: 35, votesAbstain: 3 },
    ]);
  });

  it("labels a senate-originated bill correctly", () => {
    const splits = billChamberVoteSplits(
      {
        originChamber: "senate",
        currentChamber: "house",
        votesFor: 60,
        votesAgainst: 40,
        votesAbstain: 0,
        otherChamberVotesFor: 300,
        otherChamberVotesAgainst: 100,
        otherChamberVotesAbstain: 0,
      },
      "US",
      "national"
    );

    // Lower chamber renders first regardless of which chamber originated.
    expect(splits?.[0]).toMatchObject({ label: "House", votesFor: 300 });
    expect(splits?.[1]).toMatchObject({ label: "Senate", votesFor: 60 });
  });

  it("falls back to raw vote maps when counters are absent", () => {
    const splits = billChamberVoteSplits(
      {
        originChamber: "commons",
        votes: { a: "for", b: "for", c: "against", d: "abstain" },
      },
      "UK",
      "national"
    );

    expect(splits).toEqual([
      {
        label: "Commons",
        seats: expect.any(Number),
        votesFor: 2,
        votesAgainst: 1,
        votesAbstain: 1,
      },
    ]);
  });

  it("renders the frozen override display for veto-override enactments", () => {
    const splits = billChamberVoteSplits(
      {
        presidentAction: "override",
        overrideDisplaySnapshot: {
          house: { for: 300, against: 135, seats: 435 },
          senate: { for: 70, against: 30, seats: 100 },
        },
        voteSnapshot: {
          votes: {},
          weights: {},
          totals: { for: 1, against: 1, abstain: 0 },
          resolvedAtTurn: 5,
        },
      },
      "US",
      "national"
    );

    expect(splits).toEqual([
      { label: "House", seats: 435, votesFor: 300, votesAgainst: 135, votesAbstain: 0 },
      { label: "Senate", seats: 100, votesFor: 70, votesAgainst: 30, votesAbstain: 0 },
    ]);
  });

  it("labels a regional bill with the country's sub-national chamber", () => {
    const splits = billChamberVoteSplits(
      {
        voteSnapshot: {
          votes: {},
          weights: {},
          totals: { for: 30, against: 12, abstain: 2 },
          resolvedAtTurn: 3,
        },
      },
      "US",
      "regional"
    );

    expect(splits).toEqual([
      { label: "State Senate", votesFor: 30, votesAgainst: 12, votesAbstain: 2 },
    ]);
  });

  it("returns undefined when nothing was recorded", () => {
    expect(billChamberVoteSplits({ originChamber: "house" }, "US", "national")).toBeUndefined();
  });
});
