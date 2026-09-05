import { describe, it, expect } from "vitest";
import { projectPrimaryByState } from "./primaryProjection";
import type { EnrichedCandidate } from "@/lib/electionEngine";
import type { DemographicCategory, State, StateDemographics } from "@/lib/db/types";

function makeCandidate(id: string, overrides: Partial<EnrichedCandidate> = {}): EnrichedCandidate {
  return {
    candidateId: id,
    characterId: id,
    characterName: `Candidate ${id}`,
    party: "democrat",
    isNPP: false,
    charEP: -2,
    charSP: -2,
    partyEcon: -2,
    partySocial: -2,
    favorability: 60,
    politicalInfluence: 50,
    nationalInfluence: 50,
    ...overrides,
  };
}

function makeState(id: string, population = 10_000_000): State {
  return {
    _id: id,
    countryId: "US",
    name: id,
    population,
    gdp: 0,
    houseDistricts: 1,
    region: "Northeast",
  } as State;
}

function makeDemographics(id: string): StateDemographics {
  return {
    _id: id,
    countryId: "US",
    categoryWeights: { voterGroups: 100 },
    groups: {
      all: {
        population: 10_000_000,
        economicLean: -1,
        socialLean: -1,
        turnout: 60,
      },
    },
    lastUpdated: new Date(),
  };
}

const categories: DemographicCategory[] = [
  {
    _id: "voterGroups",
    name: "Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "all",
        name: "All voters",
        defaultEconomicLean: -1,
        defaultSocialLean: -1,
        defaultTurnout: 60,
      },
    ],
  } as unknown as DemographicCategory,
];

const partyPosition = { economicPosition: -2, socialPosition: -2 };

describe("projectPrimaryByState — GE-style per-state simulation", () => {
  // Regression: same-party candidates whose character ideology genuinely
  // differs must produce a meaningful spread in per-state vote shares. The
  // old `useAveragedPositions: true` + `partyPositionWeight: 3` collapsed
  // intra-party rivals to ~50/50 because the (shared) party position
  // dominated 75% of each candidate's effective ideology — that's the "85%
  // delegate share with 50/50 state pages" pattern. Primary math now uses
  // raw candidate ideology (no party-position averaging) since every
  // candidate in a primary shares the same party anyway.
  it("differentiates same-party candidates by character ideology", () => {
    // Both candidates are Democrats (party EP/SP = -2). Centrist matches the
    // electorate (lean -1) much more closely than the leftist (-4 / -4).
    const centrist = makeCandidate("centrist", { charEP: -1, charSP: -1 });
    const leftist = makeCandidate("leftist", { charEP: -4, charSP: -4 });

    const stateMap = new Map([["CA", makeState("CA")]]);
    const demographicsMap = new Map([["CA", makeDemographics("CA")]]);

    const result = projectPrimaryByState({
      candidates: [centrist, leftist],
      candidateMeta: [
        { candidateId: "centrist", isNPP: false },
        { candidateId: "leftist", isNPP: false },
      ],
      stateIds: ["CA"],
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: new Map(),
      partyPosition,
    });

    const c = result.byState.CA.centrist ?? 0;
    const l = result.byState.CA.leftist ?? 0;
    const total = c + l;
    expect(total).toBeGreaterThan(0);
    const centristShare = c / total;
    // With raw candidate ideology driving the demographic-distance math, a
    // candidate whose policy genuinely matches the electorate should clear
    // the rival by a meaningful margin — not a 49.9/50.1 coin flip.
    expect(centristShare).toBeGreaterThan(0.6);
  });

  it("assigns a winner when intra-party candidates differ in stats", () => {
    const a = makeCandidate("a", { nationalInfluence: 80, favorability: 70 });
    const b = makeCandidate("b", { nationalInfluence: 10, favorability: 40 });
    const stateMap = new Map([["CA", makeState("CA")]]);
    const demographicsMap = new Map([["CA", makeDemographics("CA")]]);
    const orgs = new Map([["CA_democrat", 50]]);

    const result = projectPrimaryByState({
      candidates: [a, b],
      candidateMeta: [
        { candidateId: "a", isNPP: false },
        { candidateId: "b", isNPP: false },
      ],
      stateIds: ["CA"],
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: orgs,
      partyPosition,
    });

    expect(result.stateWinners.CA).toBe("a");
    expect(result.byState.CA.a).toBeGreaterThan(result.byState.CA.b);
  });

  it("gives the home-state candidate a boost in their own state", () => {
    // Both candidates identical — home state alone should decide.
    const ohCandidate = makeCandidate("oh");
    const txCandidate = makeCandidate("tx");
    const stateMap = new Map([
      ["OH", makeState("OH")],
      ["TX", makeState("TX")],
    ]);
    const demographicsMap = new Map([
      ["OH", makeDemographics("OH")],
      ["TX", makeDemographics("TX")],
    ]);

    const result = projectPrimaryByState({
      candidates: [ohCandidate, txCandidate],
      candidateMeta: [
        { candidateId: "oh", isNPP: false, homeState: "OH" },
        { candidateId: "tx", isNPP: false, homeState: "TX" },
      ],
      stateIds: ["OH", "TX"],
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: new Map(),
      partyPosition,
    });

    // Each candidate wins their own home state.
    expect(result.stateWinners.OH).toBe("oh");
    expect(result.stateWinners.TX).toBe("tx");
  });

  it("applies the in-state campaigning tick bonus", () => {
    const camper = makeCandidate("camp");
    const rival = makeCandidate("rival");
    const stateMap = new Map([["IA", makeState("IA")]]);
    const demographicsMap = new Map([["IA", makeDemographics("IA")]]);

    const result = projectPrimaryByState({
      candidates: [camper, rival],
      candidateMeta: [
        {
          candidateId: "camp",
          isNPP: false,
          primaryCampaignState: "IA",
          primaryCampaignTicks: 5,
        },
        { candidateId: "rival", isNPP: false },
      ],
      stateIds: ["IA"],
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: new Map(),
      partyPosition,
    });

    expect(result.stateWinners.IA).toBe("camp");
  });

  it("returns empty maps for states missing demographics", () => {
    const a = makeCandidate("a");
    const result = projectPrimaryByState({
      candidates: [a],
      candidateMeta: [{ candidateId: "a", isNPP: false }],
      stateIds: ["XX"],
      stateMap: new Map(),
      demographicsMap: new Map(),
      categories,
      statePartyOrgs: new Map(),
      partyPosition,
    });
    expect(result.byState.XX).toEqual({});
    expect(result.stateWinners.XX).toBeNull();
  });
});

describe("home-state surge", () => {
  // The surge charges funds and actions for a boost in the candidate's own
  // home state. Nothing read the flag it set, so it moved no votes at all.
  const stateMap = new Map([
    ["IA", makeState("IA")],
    ["OH", makeState("OH")],
  ]);
  const demographicsMap = new Map([
    ["IA", makeDemographics("IA")],
    ["OH", makeDemographics("OH")],
  ]);

  function project(meta: Record<string, unknown>) {
    return projectPrimaryByState({
      candidates: [makeCandidate("surger"), makeCandidate("rival")],
      candidateMeta: [
        { candidateId: "surger", isNPP: false, homeState: "IA", ...meta },
        { candidateId: "rival", isNPP: false, homeState: "OH" },
      ],
      stateIds: ["IA", "OH"],
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: new Map(),
      partyPosition,
    });
  }

  it("lifts the surging candidate in their own home state", () => {
    const before = project({});
    const after = project({ primarySurgeUsed: true, primarySurgeBoost: 15 });
    expect(after.byState.IA.surger).toBeGreaterThan(before.byState.IA.surger);
    expect(after.byState.IA.surger / before.byState.IA.surger).toBeCloseTo(1.15, 2);
  });

  it("leaves every other state alone", () => {
    const before = project({});
    const after = project({ primarySurgeUsed: true, primarySurgeBoost: 15 });
    expect(after.byState.OH.surger).toBe(before.byState.OH.surger);
    expect(after.byState.IA.rival).toBe(before.byState.IA.rival);
  });

  it("does nothing once the primary has reset the flag", () => {
    // Primary resolution clears primarySurgeUsed but leaves the stored rate, so
    // reading the rate alone would keep boosting a candidate for ever.
    const before = project({});
    const after = project({ primarySurgeUsed: false, primarySurgeBoost: 15 });
    expect(after.byState.IA.surger).toBe(before.byState.IA.surger);
  });

  it("honours the rate the surge was bought at", () => {
    const before = project({});
    const after = project({ primarySurgeUsed: true, primarySurgeBoost: 30 });
    expect(after.byState.IA.surger / before.byState.IA.surger).toBeCloseTo(1.3, 2);
  });

  it("does nothing for a candidate with no home state", () => {
    const result = projectPrimaryByState({
      candidates: [makeCandidate("nomad"), makeCandidate("rival")],
      candidateMeta: [
        { candidateId: "nomad", isNPP: false, primarySurgeUsed: true, primarySurgeBoost: 15 },
        { candidateId: "rival", isNPP: false, homeState: "OH" },
      ],
      stateIds: ["IA"],
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: new Map(),
      partyPosition,
    });
    const plain = projectPrimaryByState({
      candidates: [makeCandidate("nomad"), makeCandidate("rival")],
      candidateMeta: [
        { candidateId: "nomad", isNPP: false },
        { candidateId: "rival", isNPP: false, homeState: "OH" },
      ],
      stateIds: ["IA"],
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: new Map(),
      partyPosition,
    });
    expect(result.byState.IA.nomad).toBe(plain.byState.IA.nomad);
  });
});

describe("vote suppression", () => {
  // Rivals paying to remove a slice of a candidate's vote in one state. The
  // board runs the same helper the wave does, so it cannot show a lead the
  // stagger is about to take away.
  const stateMap = new Map([
    ["IA", makeState("IA")],
    ["OH", makeState("OH")],
  ]);
  const demographicsMap = new Map([
    ["IA", makeDemographics("IA")],
    ["OH", makeDemographics("OH")],
  ]);

  function suppressionRow(over: Record<string, unknown> = {}) {
    return {
      _id: "row1",
      electionId: "e1",
      actorCandidateId: "rival",
      targetCandidateId: "target",
      targetCharacterId: "target",
      stateId: "IA",
      kind: "voteSuppression",
      magnitude: 2.5,
      shieldApplied: 0,
      appliedTurn: 10,
      expiresTurn: 18,
      createdAt: new Date(),
      ...over,
    } as never;
  }

  function project(extra: Record<string, unknown> = {}) {
    return projectPrimaryByState({
      candidates: [makeCandidate("target"), makeCandidate("rival")],
      candidateMeta: [
        { candidateId: "target", isNPP: false, homeState: "IA" },
        { candidateId: "rival", isNPP: false, homeState: "OH" },
      ],
      stateIds: ["IA", "OH"],
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: new Map(),
      partyPosition,
      ...extra,
    });
  }

  it("shows the hit before the wave delivers it", () => {
    const before = project();
    const after = project({ currentTurn: 12, stateActions: [suppressionRow()] });
    expect(after.byState.IA.target).toBeLessThan(before.byState.IA.target);
    expect(after.byState.IA.target / before.byState.IA.target).toBeCloseTo(0.975, 2);
  });

  it("leaves every other candidate and every other state alone", () => {
    const before = project();
    const after = project({ currentTurn: 12, stateActions: [suppressionRow()] });
    expect(after.byState.IA.rival).toBe(before.byState.IA.rival);
    expect(after.byState.OH.target).toBe(before.byState.OH.target);
  });

  it("ignores a favourability attack, which campaignTurn already applies", () => {
    const before = project();
    const after = project({
      currentTurn: 12,
      stateActions: [suppressionRow({ kind: "localFavorability" })],
    });
    expect(after.byState.IA.target).toBe(before.byState.IA.target);
  });

  it("ignores a row that has expired", () => {
    const before = project();
    const after = project({
      currentTurn: 12,
      stateActions: [suppressionRow({ expiresTurn: 12 })],
    });
    expect(after.byState.IA.target).toBe(before.byState.IA.target);
  });

  it("is a strict no-op when a caller passes no rows", () => {
    // Every existing caller omits both fields; none of them may move.
    expect(project({ currentTurn: 12 })).toEqual(project());
    expect(project({ stateActions: [] })).toEqual(project());
  });

  it("ignores rows when the caller gave no turn to measure them against", () => {
    // Guessing a window would make an expired attack live again.
    expect(project({ stateActions: [suppressionRow()] })).toEqual(project());
  });
});

describe("turnout modifiers", () => {
  // GOTV, canvassing and turnout suppression all reach the vote through
  // `stateDemographicTurnout`. The stagger has always read it; the board never
  // did, so every one of those effects moved the result and left the
  // projection showing the old number.
  const stateMap = new Map([["IA", makeState("IA")]]);
  const demographicsMap = new Map([["IA", makeDemographics("IA")]]);

  function project(extra: Record<string, unknown> = {}) {
    return projectPrimaryByState({
      candidates: [makeCandidate("a"), makeCandidate("b")],
      candidateMeta: [
        { candidateId: "a", isNPP: false },
        { candidateId: "b", isNPP: false },
      ],
      stateIds: ["IA"],
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: new Map(),
      partyPosition,
      ...extra,
    });
  }

  it("responds when a group's turnout is pulled down", () => {
    // The fixture has one group, so this scales the whole state's pool rather
    // than shifting the balance between candidates. The point is that the
    // projection reads the channel at all.
    const base = project();
    const damped = project({ liveTurnouts: { IA: { all: 10 } } });
    expect(damped.byState.IA.a).toBeLessThan(base.byState.IA.a);
  });

  it("is unchanged when no turnout map is passed", () => {
    // Every caller that has not been updated must behave exactly as before.
    expect(project({ liveTurnouts: undefined })).toEqual(project());
  });

  it("ignores a turnout map that names no state the projection is running", () => {
    expect(project({ liveTurnouts: { NH: { all: 10 } } })).toEqual(project());
  });
});
