import { describe, it, expect } from "vitest";
import type {
  ElectionDetail,
  PartyGroup,
  CandidateDetail,
} from "../components/ElectionDetailTypes";
import { buildPrimaryBlendViewModel, type PrimaryBlendInput } from "./primaryBlendViewModel";

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
