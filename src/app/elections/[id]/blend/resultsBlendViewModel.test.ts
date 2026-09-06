import { describe, it, expect } from "vitest";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { buildResultsBlendViewModel, type ResultsBlendInput } from "./resultsBlendViewModel";

function unit(
  id: string,
  name: string,
  weight: number,
  leaderId: string | null,
  marginPct: number,
  called: boolean,
  totalVotes = 1000
) {
  return {
    id,
    name,
    weight,
    totalVotes,
    reportingPct: totalVotes > 0 ? 100 : 0,
    called,
    calledFor: called && leaderId ? leaderId : undefined,
    leaderId: leaderId ?? undefined,
    tied: false,
    leaderMargin: 0,
    leaderMarginPct: marginPct,
    candidates: [],
  };
}

function data(over: Partial<ElectionResultsResponse> = {}): ElectionResultsResponse {
  return {
    election: {
      id: "e1",
      countryId: "US",
      electionType: "president",
      state: "National",
      status: "completed",
      cycle: 1,
      electionYear: 2028,
      currentTurn: 4186,
      startTurn: 4100,
      endTurn: 4186,
      totalSeats: 1,
      evNeeded: 63,
      totalEv: 124,
    },
    candidates: [
      {
        id: "c1",
        name: "First Ticket",
        party: "1",
        partyName: "Democratic Party",
        partyColor: "#2563eb",
        isNPP: false,
        totalVotes: 71_937_000,
        voteSharePct: 50.1,
        electoralVotes: 73,
      },
      {
        id: "c2",
        name: "Second Ticket",
        party: "2",
        partyName: "Republican Party",
        partyColor: "#dc2626",
        isNPP: false,
        totalVotes: 67_055_000,
        voteSharePct: 46.7,
        electoralVotes: 51,
      },
      {
        id: "c3",
        name: "Third Ticket",
        party: "3",
        partyName: "Libertarian Party",
        partyColor: "#d4af37",
        isNPP: false,
        totalVotes: 4_596_000,
        voteSharePct: 3.2,
        electoralVotes: 0,
      },
    ],
    units: [
      unit("CA", "California", 54, "c1", 28.4, true),
      unit("TX", "Texas", 40, "c2", 11.2, true),
      unit("PA", "Pennsylvania", 19, "c1", 1.4, false),
      unit("AZ", "Arizona", 11, "c2", 0.8, false),
    ],
    summary: {
      totalVotes: 143_588_000,
      unitsReporting: 4,
      totalUnits: 4,
      unitsCalled: 2,
      projectedWinner: "c1",
    },
    ...over,
  } as ElectionResultsResponse;
}

function input(over: Partial<ResultsBlendInput> = {}): ResultsBlendInput {
  return {
    data: data(),
    route: "concluded",
    rail: "overview",
    sortBy: "ev",
    sortDesc: true,
    ...over,
  };
}

describe("route", () => {
  it("chips and labels the concluded page", () => {
    const vm = buildResultsBlendViewModel(input());
    expect(vm.routeChip).toBe("Concluded");
    expect(vm.railItems.find((i) => i.id === "board")?.label).toBe("Final board");
    expect(vm.railItems.find((i) => i.id === "states")?.label).toBe("State by state");
    expect(vm.eyebrow).toBe("President-elect");
  });

  it("chips and labels the live dashboard", () => {
    const vm = buildResultsBlendViewModel(input({ route: "dashboard" }));
    expect(vm.routeChip).toBe("Live results");
    expect(vm.railItems.find((i) => i.id === "board")?.label).toBe("Results board");
    expect(vm.railItems.find((i) => i.id === "states")?.label).toBe("Returns");
    expect(vm.eyebrow).toBe("Leading");
  });
});

describe("winner", () => {
  it("names the projected winner and their totals", () => {
    const vm = buildResultsBlendViewModel(input());
    expect(vm.winnerName).toBe("First Ticket");
    expect(vm.winnerLine).toContain("73");
    expect(vm.winnerLine).toContain("50.1");
  });

  it("says so plainly when nothing is projected yet", () => {
    const early = data({
      summary: { ...data().summary, projectedWinner: null },
    });
    const vm = buildResultsBlendViewModel(input({ data: early }));
    expect(vm.winnerName).toBeNull();
    expect(vm.winnerLine).toMatch(/no ticket/i);
  });
});

describe("electoral college", () => {
  it("uses the payload's own threshold and total", () => {
    const vm = buildResultsBlendViewModel(input());
    expect(vm.totalEv).toBe(124);
    expect(vm.threshold).toBe(63);
    expect(vm.thresholdPct).toBeCloseTo(50.8, 1);
  });

  it("omits tickets with no electoral votes from the bar", () => {
    expect(buildResultsBlendViewModel(input()).evSegments.some((s) => s.id === "c3")).toBe(false);
  });
});

describe("state rows", () => {
  it("labels a called state as called and an uncalled one as too close", () => {
    const vm = buildResultsBlendViewModel(input());
    expect(vm.states.find((s) => s.id === "CA")?.statusText).toBe("Called");
    expect(vm.states.find((s) => s.id === "PA")?.statusText).toBe("Too close");
  });

  it("says a silent state is not reporting rather than naming a winner", () => {
    const silent = data({
      units: [unit("WY", "Wyoming", 3, null, 0, false, 0)],
      summary: { ...data().summary, totalUnits: 1, unitsCalled: 0 },
    });
    const vm = buildResultsBlendViewModel(input({ data: silent }));
    expect(vm.states[0].winner).toBe("Not reporting");
    expect(vm.states[0].statusText).toBe("Not reporting");
  });

  it("sorts by electoral votes, descending by default", () => {
    const vm = buildResultsBlendViewModel(input());
    expect(vm.states.map((s) => s.id)).toEqual(["CA", "TX", "PA", "AZ"]);
  });

  it("reverses when the direction flips", () => {
    const vm = buildResultsBlendViewModel(input({ sortDesc: false }));
    expect(vm.states.map((s) => s.id)).toEqual(["AZ", "PA", "TX", "CA"]);
  });

  it("sorts by name and by margin on request", () => {
    expect(
      buildResultsBlendViewModel(input({ sortBy: "state", sortDesc: false })).states.map(
        (s) => s.name
      )
    ).toEqual(["Arizona", "California", "Pennsylvania", "Texas"]);

    expect(
      buildResultsBlendViewModel(input({ sortBy: "margin", sortDesc: false })).states.map(
        (s) => s.id
      )
    ).toEqual(["AZ", "PA", "TX", "CA"]);
  });

  it("marks the active sort column with a direction arrow", () => {
    const vm = buildResultsBlendViewModel(input({ sortBy: "margin", sortDesc: true }));
    expect(vm.sortLabels.margin).toContain("↓");
    expect(vm.sortLabels.state).not.toContain("↓");
  });
});

describe("closest states", () => {
  it("returns the four smallest margins, tightest first", () => {
    const vm = buildResultsBlendViewModel(input());
    expect(vm.closest.map((c) => c.name)).toEqual([
      "Arizona",
      "Pennsylvania",
      "Texas",
      "California",
    ]);
    expect(vm.closest[0].margin).toContain("0.8");
  });

  it("leaves out states that never reported", () => {
    const withSilent = data({
      units: [...data().units, unit("WY", "Wyoming", 3, null, 0, false, 0)],
    });
    const vm = buildResultsBlendViewModel(input({ data: withSilent }));
    expect(vm.closest.some((c) => c.name === "Wyoming")).toBe(false);
  });
});

describe("board", () => {
  it("greys a state that has not reported instead of tinting it", () => {
    const silent = data({ units: [unit("WY", "Wyoming", 3, null, 0, false, 0)] });
    const vm = buildResultsBlendViewModel(input({ data: silent }));
    expect(vm.tiles[0].title).toMatch(/not reporting/i);
  });

  it("inks every reporting tile light, because no tier is pale on this board", () => {
    // Shades run toward the page rather than toward white now, so the tightest
    // races are the dimmest tiles instead of the brightest ones and none of
    // them needs dark ink.
    const vm = buildResultsBlendViewModel(input());
    // AZ at 0.8pp is a toss-up.
    expect(vm.tiles.find((t) => t.stateId === "AZ")?.ink).toBe("#ffffff");
  });
});

describe("vitals and header", () => {
  it("counts called units against the total", () => {
    const vm = buildResultsBlendViewModel(input());
    expect(vm.certifiedText).toBe("2/4 CALLED");
  });

  it("reports the popular-vote margin between the top two", () => {
    const vm = buildResultsBlendViewModel(input());
    // 50.1 - 46.7 = 3.4
    expect(vm.vitals.find((v) => v.label === "Popular vote")?.sub).toContain("3.4");
  });

  it("counts the states the winner took", () => {
    const vm = buildResultsBlendViewModel(input());
    expect(vm.vitals.find((v) => v.label === "States won")?.value).toBe("2");
  });

  it("reads the turn and the ballot count", () => {
    const vm = buildResultsBlendViewModel(input());
    expect(vm.headerReadout).toContain("4,186");
    expect(vm.headerReadout).toContain("143,588,000");
  });
});

describe("copy", () => {
  it("never emits an em or en dash", () => {
    const vm = buildResultsBlendViewModel(input());
    const strings = [
      vm.winnerLine,
      vm.headerReadout,
      vm.certifiedText,
      vm.routeChip,
      ...vm.states.map((s) => s.statusText),
      ...vm.vitals.map((v) => `${v.label} ${v.value} ${v.sub ?? ""}`),
    ];
    for (const s of strings) expect(s).not.toMatch(/[–—]/);
  });
});
