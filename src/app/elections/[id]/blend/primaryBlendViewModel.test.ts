import { describe, it, expect } from "vitest";
import type {
  ElectionDetail,
  PartyGroup,
  CandidateDetail,
} from "../components/ElectionDetailTypes";
import { buildPrimaryBlendViewModel, type PrimaryBlendInput } from "./primaryBlendViewModel";
import type { PrimaryPartyDetail } from "@/lib/elections/dto/primaryPartyDetail";

function candidate(over: Partial<CandidateDetail> = {}): CandidateDetail {
  return {
    id: "c1",
    characterId: "ch1",
    characterName: "First Filer",
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
    sharePct: 40.3,
    enteredAt: new Date().toISOString(),
    endorsements: [],
    isYou: false,
    ...over,
  } as CandidateDetail;
}

function party(over: Partial<PartyGroup> = {}): PartyGroup {
  return {
    partyId: "1",
    partyName: "Democratic Party",
    partyColor: "#2563eb",
    countryId: "US",
    partyEcon: -34,
    partySocial: 41,
    hasCompetitivePrimary: true,
    candidates: [
      candidate({ id: "c1", characterName: "First Filer", sharePct: 40.3, isYou: true }),
      candidate({ id: "c2", characterName: "Second Filer", sharePct: 28.4 }),
      candidate({ id: "c3", characterName: "Third Filer", sharePct: 19.5 }),
      candidate({ id: "c4", characterName: "Fourth Filer", sharePct: 11.8, isNPP: true }),
    ],
    projectedDelegates: { c1: 1946, c2: 1372, c3: 942, c4: 573 },
    totalDelegates: 4833,
    delegateMajority: 2417,
    ...over,
  } as PartyGroup;
}

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
    endTurn: 4220,
    primaryEndTurn: 4193,
    durationHours: null,
    primaryDurationHours: null,
    inPrimary: true,
    isEnded: false,
    isUpcoming: false,
    inGeneral: false,
    primaryAdvanceCount: 1,
    byParty: [party()],
    allCandidates: party().candidates,
    snapshotHistory: [],
    generalVotes: null,
    myCharId: "ch1",
    myEndorsedCandidateId: null,
    gameState: { isActive: true, pausedAt: null, currentTurn: 4182 },
    primaryCalendar: [
      { label: "Tier 1, early states", turnsRemaining: 5, states: ["IA"], status: "complete" },
      { label: "Tier 2, Super Tuesday", turnsRemaining: 4, states: ["CA"], status: "complete" },
      { label: "Tier 3, industrial belt", turnsRemaining: 3, states: ["OH"], status: "upcoming" },
    ],
    ...over,
  } as ElectionDetail;
}

function input(over: Partial<PrimaryBlendInput> = {}): PrimaryBlendInput {
  return {
    election: election(),
    selectedPartyId: "1",
    wire: [],
    ...over,
  };
}

describe("countdown", () => {
  it("counts turns from the primary end turn", () => {
    // 4193 - 4182 = 11 turns.
    expect(buildPrimaryBlendViewModel(input()).closesIn).toBe(11);
    expect(buildPrimaryBlendViewModel(input()).closesText).toContain("11");
  });

  it("says the primary is closing rather than showing a negative countdown", () => {
    const past = election({ primaryEndTurn: 4180 });
    const vm = buildPrimaryBlendViewModel(input({ election: past }));
    expect(vm.closesIn).toBe(0);
    expect(vm.closesText).toMatch(/closing/i);
  });

  it("omits the countdown when the turn is unknown", () => {
    const noTurn = election({ gameState: null });
    expect(buildPrimaryBlendViewModel(input({ election: noTurn })).closesIn).toBeNull();
  });
});

describe("party rail", () => {
  it("lists each party with its filed count and leader", () => {
    const vm = buildPrimaryBlendViewModel(input());
    expect(vm.parties).toHaveLength(1);
    expect(vm.parties[0].filed).toBe(4);
    expect(vm.parties[0].leader).toBe("First Filer");
  });

  it("strips the trailing Party from the selected name", () => {
    expect(buildPrimaryBlendViewModel(input()).selectedName).toBe("Democratic");
  });

  it("falls back to the first party when the selection is unknown", () => {
    const vm = buildPrimaryBlendViewModel(input({ selectedPartyId: "nope" }));
    expect(vm.parties[0].selected).toBe(true);
  });
});

describe("the field", () => {
  it("ranks candidates and carries their raw delegate counts", () => {
    const vm = buildPrimaryBlendViewModel(input());
    expect(vm.field[0].name).toBe("First Filer");
    expect(vm.field[0].rank).toBe(1);
    expect(vm.field[0].delegates).toBe("1,946");
  });

  it("advances exactly primaryAdvanceCount candidates", () => {
    const vm = buildPrimaryBlendViewModel(input());
    expect(vm.field.filter((c) => c.advancing)).toHaveLength(1);
    expect(vm.field[0].advancing).toBe(true);
    expect(vm.field[1].advancing).toBe(false);
  });

  it("advances the top three where redistricting says so", () => {
    // US House primaries advance top-3; the mockup hardcodes 1.
    const three = election({ primaryAdvanceCount: 3 });
    const vm = buildPrimaryBlendViewModel(input({ election: three }));
    expect(vm.field.filter((c) => c.advancing)).toHaveLength(3);
    expect(vm.advanceText).toContain("3");
  });

  it("labels a non-player candidate as one", () => {
    const vm = buildPrimaryBlendViewModel(input());
    expect(vm.field[3].isNPP).toBe(true);
  });

  it("reads the share as a percentage of the delegate pool", () => {
    const vm = buildPrimaryBlendViewModel(input());
    expect(vm.field[0].pct).toBe("40.3");
  });
});

describe("delegate race", () => {
  it("sizes each segment by delegates over the pool", () => {
    const race = buildPrimaryBlendViewModel(input()).delegateRace;
    expect(race).not.toBeNull();
    // 1946 / 4833 = 40.26%
    expect(race!.segments[0].widthPct).toBeCloseTo(40.26, 1);
  });

  it("adds a remainder segment for undecided delegates", () => {
    const race = buildPrimaryBlendViewModel(input()).delegateRace;
    const awarded = 1946 + 1372 + 942 + 573;
    expect(race!.remainderPct).toBeCloseTo(((4833 - awarded) / 4833) * 100, 1);
  });

  it("places the clinch marker at the majority, not at the halfway point", () => {
    const race = buildPrimaryBlendViewModel(input()).delegateRace;
    // 2417 / 4833 = 50.01%, which is a hair past half.
    expect(race!.clinchMarkerPct).toBeCloseTo(50.01, 1);
    expect(race!.clinchText).toBe("2,417");
  });

  it("is absent when the race has no delegate model", () => {
    const noDelegates = election({
      byParty: [party({ projectedDelegates: undefined, totalDelegates: undefined })],
    });
    expect(buildPrimaryBlendViewModel(input({ election: noDelegates })).delegateRace).toBeNull();
  });
});

describe("your standing", () => {
  it("reports share, rank, lead and delegates for your own candidate", () => {
    const vm = buildPrimaryBlendViewModel(input());
    expect(vm.you?.share).toBe("40.3%");
    expect(vm.you?.rankText).toBe("1 of 4");
    expect(vm.you?.lead).toBe("+11.9 pts");
    expect(vm.you?.delegates).toBe("1,946");
  });

  it("counts what is still needed to clinch", () => {
    const vm = buildPrimaryBlendViewModel(input());
    // 2417 - 1946 = 471.
    expect(vm.you?.toClinch).toBe("471");
  });

  it("clamps to clinched rather than showing a negative", () => {
    const clinched = election({
      byParty: [party({ projectedDelegates: { c1: 3000, c2: 1372, c3: 942, c4: 573 } })],
    });
    const vm = buildPrimaryBlendViewModel(input({ election: clinched }));
    expect(vm.you?.toClinch).toBe("0");
  });

  it("says you are not filed rather than showing a zero", () => {
    // `isYou` is stamped per candidate server-side, so "not filed" means no
    // candidate in the selected party carries the flag.
    const notMine = election({
      byParty: [
        party({
          candidates: party().candidates.map((c) => ({ ...c, isYou: false })),
        }),
      ],
    });
    const vm = buildPrimaryBlendViewModel(input({ election: notMine }));
    expect(vm.you).toBeNull();
    expect(vm.standingNote).toMatch(/not filed/i);
  });

  it("reports a trailing candidate as trailing", () => {
    const trailing = election({
      byParty: [
        party({
          candidates: [
            candidate({ id: "c1", characterName: "Leader", sharePct: 50 }),
            candidate({ id: "c2", characterName: "You", sharePct: 20, isYou: true }),
          ],
          projectedDelegates: { c1: 2400, c2: 900 },
        }),
      ],
    });
    const vm = buildPrimaryBlendViewModel(input({ election: trailing }));
    expect(vm.you?.advancing).toBe(false);
    expect(vm.you?.statusText).toMatch(/trailing/i);
  });
});

describe("campaign link", () => {
  it("points at your own campaign when you have one", () => {
    const withCampaign = election({
      byParty: [
        party({
          candidates: [
            candidate({ id: "c1", characterName: "You", isYou: true, campaignId: "camp1" }),
          ],
          projectedDelegates: { c1: 100 },
        }),
      ],
    });
    const vm = buildPrimaryBlendViewModel(input({ election: withCampaign }));
    expect(vm.campaignHref).toBe("/campaign/camp1");
  });

  it("is absent when you have no campaign in this party", () => {
    expect(buildPrimaryBlendViewModel(input()).campaignHref).toBeNull();
  });
});

describe("calendar", () => {
  it("passes each wave through with its status", () => {
    const vm = buildPrimaryBlendViewModel(input());
    expect(vm.calendar).toHaveLength(3);
    expect(vm.calendar[0].statusText).toBe("COMPLETE");
    // Wave 3 fires with 3 turns left on a primary that closes in 11, so it is
    // 8 turns away, not 3.
    expect(vm.calendar[2].statusText).toBe("IN 8 TURNS");
  });

  it("is empty when the race has no stagger calendar", () => {
    const none = election({ primaryCalendar: undefined });
    expect(buildPrimaryBlendViewModel(input({ election: none })).calendar).toEqual([]);
  });
});

describe("copy", () => {
  it("never emits an em or en dash", () => {
    const vm = buildPrimaryBlendViewModel(input());
    const strings = [
      vm.headline,
      vm.standfirst,
      vm.closesText,
      vm.advanceText,
      vm.standingNote ?? "",
      vm.delegateRace?.lede ?? "",
      ...vm.field.map((c) => c.statusText),
      ...vm.calendar.map((c) => `${c.label} ${c.statusText}`),
    ];
    for (const s of strings) expect(s).not.toMatch(/[–—]/);
  });
});

// ── The state board, carve-up and campaign block ──────────────────────────────

function boardElection(): ElectionDetail {
  return election({
    primaryCalendar: [
      {
        label: "Tier 1, early states",
        turnsRemaining: 5,
        states: ["IA", "NH"],
        status: "complete",
      },
      { label: "Tier 2, Super Tuesday", turnsRemaining: 4, states: ["CA"], status: "complete" },
      {
        label: "Tier 3, industrial belt",
        turnsRemaining: 3,
        states: ["OH", "TX"],
        status: "upcoming",
      },
    ],
  });
}

const DETAIL: PrimaryPartyDetail = {
  partyId: "1",
  partyName: "Democratic Party",
  partyColor: "#2563eb",
  candidates: [
    { id: "c1", name: "First Filer", color: "#2563eb" },
    { id: "c2", name: "Second Filer", color: "#dc2626" },
  ],
  byState: {
    IA: { c1: 700, c2: 300 },
    NH: { c1: 400, c2: 600 },
    CA: { c1: 900, c2: 100 },
    OH: { c1: 500, c2: 100 },
    TX: {},
  },
  stateNameById: { IA: "Iowa", NH: "New Hampshire", CA: "California", OH: "Ohio", TX: "Texas" },
  votedStateIds: ["IA", "NH", "CA"],
  viewerCampaign: null,
};

function boardInput(over: Partial<PrimaryBlendInput> = {}): PrimaryBlendInput {
  return input({ election: boardElection(), detail: DETAIL, ...over });
}

function tile(vm: ReturnType<typeof buildPrimaryBlendViewModel>, stateId: string) {
  const found = vm.board.find((t) => t.stateId === stateId);
  if (!found) throw new Error(`no tile for ${stateId}`);
  return found;
}

describe("the state board", () => {
  it("puts one tile on the board for every state in the calendar, in calendar order", () => {
    const vm = buildPrimaryBlendViewModel(boardInput());
    expect(vm.board.map((t) => t.stateId)).toEqual(["IA", "NH", "CA", "OH", "TX"]);
  });

  it("colours each tile by the leading candidate", () => {
    const vm = buildPrimaryBlendViewModel(boardInput());
    expect(tile(vm, "IA").leaderId).toBe("c1");
    expect(tile(vm, "NH").leaderId).toBe("c2");
  });

  it("renders a state that has voted at the leader's full strength", () => {
    const vm = buildPrimaryBlendViewModel(boardInput());
    const iowa = tile(vm, "IA");
    expect(iowa.voted).toBe(true);
    // Full strength means the leader's own colour, undamped.
    const leaderSegment = vm.delegateRace?.segments.find((s) => s.id === iowa.leaderId);
    expect(iowa.background.toLowerCase()).toBe(leaderSegment!.color.toLowerCase());
  });

  it("paints a candidate the same colour on the tiles and in the delegate bar", () => {
    // A four-way primary with no campaign colours set used to draw four
    // identical party-blue segments, while the board, coloured server-side,
    // used a distinct palette. The same candidate could be two colours on one
    // screen.
    const vm = buildPrimaryBlendViewModel(boardInput());
    const segments = vm.delegateRace!.segments;
    expect(new Set(segments.map((s) => s.color)).size).toBe(segments.length);

    for (const t of vm.board) {
      if (!t.leaderId || !t.voted) continue;
      const segment = segments.find((s) => s.id === t.leaderId);
      if (segment) expect(t.background.toLowerCase()).toBe(segment.color.toLowerCase());
    }
  });

  it("gives each candidate in the field their own colour, not the party's", () => {
    const vm = buildPrimaryBlendViewModel(boardInput());
    const colors = vm.field.map((f) => f.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("damps a state that has only been projected, keeping the leader's hue", () => {
    const vm = buildPrimaryBlendViewModel(boardInput());
    const projected = tile(vm, "OH");
    expect(projected.voted).toBe(false);
    expect(projected.leaderId).toBe("c1");
    // Same candidate, visibly quieter: neither the full colour nor the empty track.
    expect(projected.background.toLowerCase()).not.toBe("#2563eb");
    expect(projected.background).not.toBe(tile(vm, "TX").background);
  });

  it("keeps every tile's label readable against its own fill", () => {
    const vm = buildPrimaryBlendViewModel(boardInput());
    for (const t of vm.board) {
      expect(t.ink).toBeTruthy();
      expect(t.ink).not.toBe(t.background);
    }
  });

  it("picks the same leader every time when two candidates are level", () => {
    // The board repaints on every 60s poll. An unstable tiebreak would make a
    // level state flicker between two colours with nothing having changed.
    const tied = {
      ...DETAIL,
      byState: { ...DETAIL.byState, OH: { c2: 500, c1: 500 } },
    };
    const first = buildPrimaryBlendViewModel(boardInput({ detail: tied }));
    const second = buildPrimaryBlendViewModel(boardInput({ detail: tied }));
    expect(tile(first, "OH").leaderId).toBe(tile(second, "OH").leaderId);
    expect(tile(first, "OH").leaderId).toBe("c1");
  });

  it("gives a state with no projected votes no leader", () => {
    const vm = buildPrimaryBlendViewModel(boardInput());
    expect(tile(vm, "TX").leaderId).toBeNull();
    expect(tile(vm, "TX").leaderName).toBeNull();
  });

  it("names the state and the leader in the title, so colour is never the only signal", () => {
    const vm = buildPrimaryBlendViewModel(boardInput());
    expect(tile(vm, "IA").title).toContain("Iowa");
    expect(tile(vm, "IA").title).toContain("First Filer");
  });

  it("says a state is still to vote rather than naming a winner too early", () => {
    const vm = buildPrimaryBlendViewModel(boardInput());
    expect(tile(vm, "OH").title.toLowerCase()).toContain("projected");
    expect(tile(vm, "IA").title.toLowerCase()).not.toContain("projected");
  });

  it("renders no board at all when the detail has not loaded", () => {
    const vm = buildPrimaryBlendViewModel(boardInput({ detail: null }));
    expect(vm.board).toEqual([]);
    expect(vm.carveUp).toBeNull();
    expect(vm.campaign).toBeNull();
  });

  it("renders no board when the race has no calendar to lay one out on", () => {
    const vm = buildPrimaryBlendViewModel(
      boardInput({ election: election({ primaryCalendar: [] }) })
    );
    expect(vm.board).toEqual([]);
  });
});

describe("the carve-up", () => {
  it("breaks the selected state down by candidate, largest first", () => {
    const vm = buildPrimaryBlendViewModel(boardInput({ selectedStateId: "IA" }));
    expect(vm.carveUp?.stateName).toBe("Iowa");
    expect(vm.carveUp?.slices.map((s) => s.candidateId)).toEqual(["c1", "c2"]);
    expect(vm.carveUp?.slices[0].pct).toBeCloseTo(70, 5);
    expect(vm.carveUp!.slices.reduce((sum, s) => sum + s.pct, 0)).toBeCloseTo(100, 5);
  });

  it("defaults to the first state of the next wave still to vote", () => {
    const vm = buildPrimaryBlendViewModel(boardInput({ selectedStateId: null }));
    expect(vm.selectedStateId).toBe("OH");
  });

  it("falls back to the first state on the calendar once every wave has voted", () => {
    const allDone = election({
      primaryCalendar: [
        { label: "Tier 1", turnsRemaining: 5, states: ["IA"], status: "complete" },
        { label: "Tier 2", turnsRemaining: 4, states: ["CA"], status: "complete" },
      ],
    });
    const vm = buildPrimaryBlendViewModel(boardInput({ election: allDone, selectedStateId: null }));
    expect(vm.selectedStateId).toBe("IA");
  });

  it("ignores a selection that is not on this party's calendar", () => {
    // Switching party must not leave the previous party's state selected.
    const vm = buildPrimaryBlendViewModel(boardInput({ selectedStateId: "ZZ" }));
    expect(vm.selectedStateId).toBe("OH");
  });

  it("shows no slices for a state nobody has any votes in", () => {
    const vm = buildPrimaryBlendViewModel(boardInput({ selectedStateId: "TX" }));
    expect(vm.carveUp?.stateName).toBe("Texas");
    expect(vm.carveUp?.slices).toEqual([]);
  });
});

describe("the calendar rows", () => {
  it("expands each wave to its states, marking the selected one", () => {
    const vm = buildPrimaryBlendViewModel(boardInput({ selectedStateId: "IA" }));
    const wave = vm.calendar.find((w) => w.states.some((s) => s.id === "IA"));
    expect(wave?.states.map((s) => s.id)).toEqual(["IA", "NH"]);
    expect(wave?.states.find((s) => s.id === "IA")?.selected).toBe(true);
    expect(wave?.states.find((s) => s.id === "NH")?.selected).toBe(false);
  });

  it("names the states so a chip reads as a place, not a code", () => {
    const vm = buildPrimaryBlendViewModel(boardInput());
    const wave = vm.calendar.find((w) => w.states.some((s) => s.id === "IA"));
    expect(wave?.states.find((s) => s.id === "IA")?.name).toBe("Iowa");
  });

  it("still lists the wave's states before the detail loads", () => {
    const vm = buildPrimaryBlendViewModel(boardInput({ detail: null }));
    const wave = vm.calendar.find((w) => w.states.some((s) => s.id === "IA"));
    expect(wave?.states.map((s) => s.id)).toEqual(["IA", "NH"]);
    expect(wave?.states.find((s) => s.id === "IA")?.name).toBe("IA");
  });
});

describe("the viewer's campaign block", () => {
  const campaign = {
    currentCampaignState: "IA",
    currentTicks: 3,
    tickCap: 5,
    homeState: "IA",
    surgeUsed: false,
    playerActions: 25,
    playerFunds: 250_000,
    surgeCostFunds: 25_000,
    surgeCostActions: 3,
    surgeBoost: 15,
    states: [{ id: "IA", name: "Iowa", actionCost: 3 }],
  };

  it("passes the viewer's campaign through so the view never reads the detail itself", () => {
    const vm = buildPrimaryBlendViewModel(
      boardInput({ detail: { ...DETAIL, viewerCampaign: campaign } })
    );
    expect(vm.campaign?.currentCampaignState).toBe("IA");
    expect(vm.campaign?.currentTicks).toBe(3);
    expect(vm.campaign?.surgeBoost).toBe(15);
  });

  it("is null for a viewer with no candidate in this party", () => {
    expect(buildPrimaryBlendViewModel(boardInput()).campaign).toBeNull();
  });
});

describe("waves whose record disagrees with the board", () => {
  // `primaryStaggerWavesRun` counts waves; `primaryWaveHistory` lists the states
  // that voted. This screen shows both at once, so a wave the counter has not
  // caught up with must not read as upcoming beside a board that has settled it.
  const staleCounter = () =>
    election({
      primaryCalendar: [
        { label: "Tier 1", turnsRemaining: 5, states: ["IA", "NH"], status: "complete" },
        { label: "Tier 2", turnsRemaining: 4, states: ["CA"], status: "upcoming" },
        { label: "Tier 3", turnsRemaining: 3, states: ["OH", "TX"], status: "upcoming" },
      ],
    });

  it("reads a wave as complete once every one of its states has voted", () => {
    const vm = buildPrimaryBlendViewModel(boardInput({ election: staleCounter() }));
    expect(vm.calendar.find((w) => w.label === "Tier 2")?.statusText).toBe("COMPLETE");
  });

  it("does not offer a settled wave as the next contest to look at", () => {
    const vm = buildPrimaryBlendViewModel(
      boardInput({ election: staleCounter(), selectedStateId: null })
    );
    expect(vm.selectedStateId).toBe("OH");
  });

  it("leaves a part-voted wave upcoming, since it still has contests to run", () => {
    const partly = election({
      primaryCalendar: [
        { label: "Tier 1", turnsRemaining: 5, states: ["IA", "ZZ"], status: "upcoming" },
        { label: "Tier 3", turnsRemaining: 3, states: ["OH"], status: "upcoming" },
      ],
    });
    const vm = buildPrimaryBlendViewModel(boardInput({ election: partly, selectedStateId: null }));
    expect(vm.calendar.find((w) => w.label === "Tier 1")?.statusText).not.toBe("COMPLETE");
    expect(vm.selectedStateId).toBe("IA");
  });
});

describe("projected delegates versus delegates won", () => {
  // The field's headline number forecasts where the primary ENDS. For most of a
  // primary nothing has been awarded at all, so an unlabelled figure beside a
  // name reads as a running score.
  function withParty(over: Partial<PartyGroup>) {
    return buildPrimaryBlendViewModel(input({ election: election({ byParty: [party(over)] }) }));
  }

  it("reports nothing won before the first wave has fired", () => {
    const vm = withParty({ awardedDelegates: { c1: 0, c2: 0, c3: 0, c4: 0 } });
    expect(vm.field[0].delegates).toBe("1,946");
    expect(vm.field[0].delegatesAwarded).toBeNull();
  });

  it("reports nothing won when the payload carries no awarded figures at all", () => {
    // Every caller that predates this field must keep behaving as it did.
    const vm = buildPrimaryBlendViewModel(input());
    expect(vm.field[0].delegatesAwarded).toBeNull();
  });

  it("separates what is locked in once waves start awarding", () => {
    const vm = withParty({ awardedDelegates: { c1: 312, c2: 96, c3: 0, c4: 0 } });
    expect(vm.field[0].delegates).toBe("1,946");
    expect(vm.field[0].delegatesAwarded).toBe("312");
  });

  it("shows a zero for a candidate who has won none while others have", () => {
    // Blank here would read as "not yet counted" rather than "beaten so far".
    const vm = withParty({ awardedDelegates: { c1: 312, c2: 96, c3: 0, c4: 0 } });
    expect(vm.field[2].delegatesAwarded).toBe("0");
  });
});
