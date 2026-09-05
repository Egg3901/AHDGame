import { describe, it, expect } from "vitest";
import type { CandidateDetail, ElectionDetail } from "../components/ElectionDetailTypes";
import { buildGeneralBlendViewModel, type GeneralBlendInput } from "./generalBlendViewModel";

function candidate(over: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    id: "c1",
    characterId: "ch1",
    characterName: "First Ticket",
    party: "1",
    partyName: "Democratic Party",
    partyColor: "#2563eb",
    partyEcon: -34,
    partySocial: 41,
    isNPP: false,
    nppId: null,
    economicPosition: -20,
    socialPosition: 30,
    favorability: 55,
    politicalInfluence: 10,
    nationalInfluence: 8,
    primaryScore: 90,
    sharePct: 49.2,
    enteredAt: new Date().toISOString(),
    endorsements: [],
    isYou: false,
    ...over,
  } as CandidateDetail;
}

const CANDIDATES = [
  candidate({
    id: "c1",
    characterName: "First Ticket",
    runningMateName: "First Mate",
    isYou: true,
  }),
  candidate({
    id: "c2",
    characterName: "Second Ticket",
    party: "2",
    partyName: "Republican Party",
    partyColor: "#dc2626",
    runningMateName: "Second Mate",
  }),
  candidate({
    id: "c3",
    characterName: "Third Ticket",
    party: "3",
    partyName: "Libertarian Party",
    partyColor: "#d4af37",
  }),
];

function election(over: Partial<ElectionDetail> = {}): ElectionDetail {
  return {
    id: "e1",
    seatId: null,
    electionType: "president",
    state: "National",
    countryId: "US",
    senateClass: null,
    chamberClass: null,
    cycle: 1,
    electionYear: 2028,
    status: "active",
    totalSeats: null,
    startTime: null,
    endTime: null,
    primaryEndTime: null,
    startTurn: 4100,
    endTurn: 4186,
    primaryEndTurn: 4150,
    durationHours: null,
    primaryDurationHours: null,
    inPrimary: false,
    isEnded: false,
    isUpcoming: false,
    inGeneral: true,
    primaryAdvanceCount: 1,
    byParty: [],
    allCandidates: CANDIDATES,
    snapshotHistory: [],
    myCharId: "ch1",
    myEndorsedCandidateId: null,
    gameState: { isActive: true, pausedAt: null, currentTurn: 4182 },
    generalVotes: {
      totalVotes: { c1: 69_473_000, c2: 67_213_000, c3: 4_519_000 },
      candidateNames: {},
      candidateParties: {},
      candidateColors: {},
      finalized: false,
      seatsEstimate: null,
      turnSnapshots: [],
      electoralVotesByCandidate: { c1: 276, c2: 251, c3: 0 },
      evByState: { CA: 54, TX: 40, PA: 19, AZ: 11 },
      stateVoteData: {
        CA: { votesByCandidate: { c1: 700, c2: 300 }, evByCandidate: { c1: 54 } },
        TX: { votesByCandidate: { c1: 400, c2: 600 }, evByCandidate: { c2: 40 } },
        PA: { votesByCandidate: { c1: 510, c2: 490 }, evByCandidate: { c1: 19 } },
        AZ: { votesByCandidate: { c1: 504, c2: 496 }, evByCandidate: { c1: 11 } },
      },
    },
    ...over,
  } as ElectionDetail;
}

function input(over: Partial<GeneralBlendInput> = {}): GeneralBlendInput {
  return { election: election(), wire: [], rail: "overview", ...over };
}

describe("tickets", () => {
  it("ranks by electoral votes and carries the running mate", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.tickets[0].name).toBe("First Ticket");
    expect(vm.tickets[0].mate).toBe("First Mate");
    expect(vm.tickets[0].ev).toBe(276);
  });

  it("computes each ticket's popular share from the tally", () => {
    const vm = buildGeneralBlendViewModel(input());
    // 69.473M of 141.205M = 49.2%
    expect(vm.tickets[0].pct).toBe("49.2");
  });

  it("compacts vote totals", () => {
    expect(buildGeneralBlendViewModel(input()).tickets[0].votes).toBe("69.5M");
  });

  it("marks the viewer's own ticket", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.tickets.find((t) => t.isYou)?.name).toBe("First Ticket");
  });

  it("flags the ticket the viewer endorsed", () => {
    const endorsed = election({ myEndorsedCandidateId: "c2" });
    const vm = buildGeneralBlendViewModel(input({ election: endorsed }));
    expect(vm.tickets.find((t) => t.id === "c2")?.endorsed).toBe(true);
  });
});

describe("electoral college", () => {
  it("divides by the live apportionment total, not a hardcoded 538", () => {
    // The fixture's four states total 124 EV.
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.totalEv).toBe(124);
    expect(vm.threshold).toBe(63);
  });

  it("places the majority marker at the real threshold", () => {
    const vm = buildGeneralBlendViewModel(input());
    // 63 / 124 = 50.8%, not the mockup's fixed 50.19%.
    expect(vm.thresholdPct).toBeCloseTo(50.8, 1);
  });

  it("labels only segments wide enough to read", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.evSegments.every((s) => (s.widthPct > 8 ? s.label !== "" : s.label === ""))).toBe(
      true
    );
  });

  it("omits tickets with no electoral votes from the bar", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.evSegments.some((s) => s.id === "c3")).toBe(false);
  });
});

describe("battleground board", () => {
  it("builds one tile per state with votes, from the shared margin model", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.tiles.map((t) => t.stateId)).toEqual(["AZ", "CA", "PA", "TX"]);
  });

  it("carries each state's electoral weight", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.tiles.find((t) => t.stateId === "CA")?.ev).toBe(54);
  });

  it("uses dark ink on the near-white toss-up and lean shades", () => {
    // AZ is 50.4 to 49.6, a 0.8pp toss-up.
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.tiles.find((t) => t.stateId === "AZ")?.ink).toBe("#14141c");
    // CA is 70 to 30, safe, so light ink on a dark shade.
    expect(vm.tiles.find((t) => t.stateId === "CA")?.ink).toBe("#ffffff");
  });

  it("names the leader and margin in each tile's title", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.tiles.find((t) => t.stateId === "CA")?.title).toContain("First Ticket");
  });

  it("legends all four margin tiers", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.tierLegend.map((t) => t.label)).toEqual(["Safe", "Likely", "Lean", "Toss-up"]);
    expect(vm.tierLegend.every((t) => t.swatch.startsWith("rgb") || t.swatch.startsWith("#"))).toBe(
      true
    );
  });

  it("is empty when no state has reported", () => {
    const noStates = election({
      generalVotes: { ...election().generalVotes!, stateVoteData: undefined },
    });
    expect(buildGeneralBlendViewModel(input({ election: noStates })).tiles).toEqual([]);
  });
});

describe("your ticket", () => {
  it("reports the lead over the runner up", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.yourTicket?.leadText).toBe("+25 EV lead");
    expect(vm.yourTicket?.name).toContain("First Mate");
  });

  it("reports a deficit as behind, not as a negative lead", () => {
    const behind = election({
      generalVotes: {
        ...election().generalVotes!,
        electoralVotesByCandidate: { c1: 200, c2: 276, c3: 0 },
      },
    });
    const vm = buildGeneralBlendViewModel(input({ election: behind }));
    expect(vm.yourTicket?.leadText).toBe("76 EV behind");
  });

  it("is absent when the viewer has no ticket in the race", () => {
    const notMine = election({
      allCandidates: CANDIDATES.map((c) => ({ ...c, isYou: false })),
    });
    expect(buildGeneralBlendViewModel(input({ election: notMine })).yourTicket).toBeNull();
  });
});

describe("rail", () => {
  it("shows every section on overview", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect([vm.showCollege, vm.showBoard, vm.showTickets]).toEqual([true, true, true]);
  });

  it("narrows to one section when a rail item is picked", () => {
    const vm = buildGeneralBlendViewModel(input({ rail: "board" }));
    expect([vm.showCollege, vm.showBoard, vm.showTickets]).toEqual([false, true, false]);
  });

  it("badges the college with the leader's electoral votes", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.railItems.find((i) => i.id === "college")?.badge).toBe("276");
  });
});

describe("header", () => {
  it("reports the turn and the ballot count", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.turnReadout).toContain("4,182");
    expect(vm.turnReadout).toContain("141,205,000");
  });

  it("counts the turns left in the general", () => {
    expect(buildGeneralBlendViewModel(input()).closesIn).toBe(4);
    expect(buildGeneralBlendViewModel(input()).liveText).toContain("4");
  });

  it("generates a headline from the standing", () => {
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.headline).toContain("First Ticket");
    expect(vm.headline).toContain("63");
  });
});

describe("copy", () => {
  it("never emits an em or en dash", () => {
    const vm = buildGeneralBlendViewModel(input());
    const strings = [
      vm.headline,
      vm.standfirst,
      vm.turnReadout,
      vm.liveText,
      vm.yourTicket?.leadText ?? "",
      ...vm.tierLegend.map((t) => `${t.label} ${t.band}`),
    ];
    for (const s of strings) expect(s).not.toMatch(/[–—]/);
  });
});

describe("the masthead does not cry election night early", () => {
  // The general runs 48 turns. A race with half of them left is a campaign
  // being polled, not a count being read out.
  it("reads as a campaign while the count is far from closing", () => {
    const vm = buildGeneralBlendViewModel(
      input({
        election: election({
          endTurn: 100,
          gameState: { isActive: true, pausedAt: null, currentTurn: 60 },
        }),
      })
    );
    expect(vm.kicker).toBe("The Campaign");
  });

  it("becomes election night once the count is closing", () => {
    const vm = buildGeneralBlendViewModel(
      input({
        election: election({
          endTurn: 100,
          gameState: { isActive: true, pausedAt: null, currentTurn: 98 },
        }),
      })
    );
    expect(vm.kicker).toBe("Election Night");
  });

  it("always carries a line saying the figures are a projection", () => {
    for (const currentTurn of [60, 98, 100]) {
      const vm = buildGeneralBlendViewModel(
        input({
          election: election({
            endTurn: 100,
            gameState: { isActive: true, pausedAt: null, currentTurn },
          }),
        })
      );
      expect(vm.projectionNote).toMatch(/projection|projected/i);
    }
  });
});

describe("when the tickets table earns its place", () => {
  // The hero pair carries the top two in full — name, party, running mate,
  // electoral votes, share, popular vote, endorse. A two-way race needs no
  // table; a third ticket is what the table exists for.
  it("draws no table, and no rail pane, for a two-way race", () => {
    const twoWay = election({
      allCandidates: (election().allCandidates as unknown[]).slice(0, 2),
    } as never);
    const vm = buildGeneralBlendViewModel(input({ election: twoWay }));
    expect(vm.tickets).toHaveLength(2);
    expect(vm.showTicketsTable).toBe(false);
    expect(vm.railItems.some((i) => i.id === "tickets")).toBe(false);
  });

  it("draws it once a third ticket exists, which the hero cannot show", () => {
    // The default fixture already runs three candidates.
    const vm = buildGeneralBlendViewModel(input());
    expect(vm.tickets.length).toBeGreaterThan(2);
    expect(vm.showTicketsTable).toBe(true);
    expect(vm.railItems.some((i) => i.id === "tickets")).toBe(true);
  });
});
