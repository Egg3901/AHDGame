import { describe, expect, it } from "vitest";
import {
  blendPhase,
  buildBlendRegionCards,
  buildBlendWire,
  hareQuota,
  isMultiSeatRace,
} from "./blendRegionViewModel";
import type { ElectionDisplay } from "@/lib/db/types";

const parties = {
  abbr: (id: string) => ({ "1": "DEM", "2": "REP" })[id] ?? id.toUpperCase(),
  name: (id: string) => ({ "1": "Democratic Party", "2": "Republican Party" })[id] ?? id,
  color: (id: string) => ({ "1": "#3B82F6", "2": "#EF4444" })[id] ?? "#9CA3AF",
};

function candidate(id: string, name: string, party: string) {
  return {
    id,
    characterId: `char-${id}`,
    characterName: name,
    avatarUrl: undefined,
    party,
    partyName: parties.name(party),
    partyColor: parties.color(party),
    isNPP: false,
    endorsements: [],
  };
}

/** A counted, multi-seat US House race: 10 seats, two candidates, two turns. */
function houseRace(overrides: Partial<ElectionDisplay> = {}): ElectionDisplay {
  return {
    id: "e-house",
    electionType: "house",
    state: "GA",
    countryId: "US",
    cycle: 1,
    status: "active",
    totalSeats: 10,
    candidates: [candidate("c1", "Ada Wren", "1"), candidate("c2", "Bo Marsh", "2")],
    seatsEstimate: { c1: 6, c2: 4 },
    generalTally: {
      totalVotes: { c1: 60_000, c2: 40_000 },
      turnSnapshots: [
        { turn: 1, sharesPct: { c1: 55, c2: 45 }, cumulativeVotes: { c1: 27_500, c2: 22_500 } },
        { turn: 2, sharesPct: { c1: 58, c2: 42 }, cumulativeVotes: { c1: 60_000, c2: 40_000 } },
      ],
    },
    ...overrides,
  } as ElectionDisplay;
}

/** A single-winner US Senate race (fptp), same two candidates. */
function senateRace(overrides: Partial<ElectionDisplay> = {}): ElectionDisplay {
  return {
    id: "e-senate",
    electionType: "senate",
    state: "GA",
    countryId: "US",
    cycle: 1,
    status: "active",
    totalSeats: 1,
    candidates: [candidate("s1", "Cleo Vance", "2"), candidate("s2", "Dax Hale", "1")],
    generalTally: {
      totalVotes: { s1: 30_000, s2: 20_000 },
      turnSnapshots: [
        { turn: 2, sharesPct: { s1: 60, s2: 40 }, cumulativeVotes: { s1: 30_000, s2: 20_000 } },
      ],
    },
    ...overrides,
  } as ElectionDisplay;
}

const baseInput = {
  countryId: "US" as const,
  regionName: "Georgia",
  parties,
};

describe("blendPhase", () => {
  it("reports a completed race as final regardless of the primary flag", () => {
    expect(blendPhase(houseRace({ status: "completed", inPrimary: true }))).toBe("final");
  });

  it("reports an in-primary race as primary", () => {
    expect(blendPhase(houseRace({ inPrimary: true }))).toBe("primary");
  });

  it("takes upcoming from the server-derived status, not from missing votes", () => {
    // A counted race whose tally simply was not loaded (summary mode) must not
    // silently regress to "upcoming" and start advertising filing.
    expect(blendPhase(houseRace({ status: "upcoming", generalTally: undefined }))).toBe("upcoming");
    expect(blendPhase(houseRace({ status: "active", generalTally: undefined }))).toBe("general");
  });

  it("reports a counted race as general", () => {
    expect(blendPhase(houseRace())).toBe("general");
  });
});

describe("isMultiSeatRace", () => {
  it("reads the configured method, not the seat count", () => {
    // US lowerChamber is pr_hareQuota, upperChamber is fptp.
    expect(isMultiSeatRace(houseRace(), "US")).toBe(true);
    expect(isMultiSeatRace(senateRace(), "US")).toBe(false);
  });

  it("follows the engine's type list when the configured method is fptp (soviet delegations)", () => {
    // RU/UKR/BLR/BAL lower chambers are "fptp" by config, yet allocateSeats
    // seats the whole delegation for every MULTI_SEAT_TYPES race.
    expect(
      isMultiSeatRace(
        houseRace({ electionType: "nationalitiesDeputy", countryId: "RU", totalSeats: 25 }),
        "RU"
      )
    ).toBe(true);
    expect(
      isMultiSeatRace(
        houseRace({ electionType: "supremeSoviet", countryId: "BLR", totalSeats: 89 }),
        "BLR"
      )
    ).toBe(true);
    // A Nigerian senate zone carries several seats under the single-seat US type.
    expect(isMultiSeatRace(senateRace({ countryId: "NG", totalSeats: 3 }), "NG")).toBe(true);
  });

  it("treats the electoral college as single-winner — it awards no seats by share", () => {
    expect(isMultiSeatRace(houseRace({ electionType: "president" }), "US")).toBe(false);
  });
});

describe("hareQuota", () => {
  it("returns votes-per-seat for a Hare-quota race", () => {
    expect(hareQuota(houseRace(), "US")).toBe(10_000);
  });

  it("returns null for a first-past-the-post race — there is no quota to quote", () => {
    expect(hareQuota(senateRace(), "US")).toBeNull();
  });

  it("returns null before any ballots are counted", () => {
    expect(hareQuota(houseRace({ generalTally: undefined }), "US")).toBeNull();
  });
});

describe("buildBlendRegionCards", () => {
  it("computes shares from cumulative votes and sorts the field", () => {
    const [card] = buildBlendRegionCards({ ...baseInput, elections: [houseRace()] });
    expect(card.rows.map((r) => r.name)).toEqual(["Ada Wren", "Bo Marsh"]);
    expect(card.rows[0].pctStr).toBe("60.0");
    expect(card.rows[1].pctStr).toBe("40.0");
    expect(card.ballots).toBe(100_000);
  });

  it("differences the last two turn snapshots for the +/- Turn column", () => {
    const [card] = buildBlendRegionCards({ ...baseInput, elections: [houseRace()] });
    // Cumulative share is 60.0; the previous snapshot read 55.0.
    expect(card.rows[0].deltaPts).toBeCloseTo(5, 5);
    expect(card.rows[0].deltaStr).toBe("+5.0");
    expect(card.rows[1].deltaStr).toBe("-5.0");
  });

  it("leaves the delta null on the first counted turn rather than printing +0.0", () => {
    const [card] = buildBlendRegionCards({ ...baseInput, elections: [senateRace()] });
    expect(card.rows[0].deltaPts).toBeNull();
    expect(card.rows[0].deltaStr).toBe("—");
  });

  it("omits the turnout chip when the region has no electorate figure", () => {
    const [card] = buildBlendRegionCards({ ...baseInput, elections: [houseRace()] });
    expect(card.meta.map((m) => m.key)).toEqual(["Votes in"]);
  });

  it("reports turnout against the electorate when one is supplied", () => {
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace()],
      electorate: { count: 400_000, basis: "eligible" },
    });
    const turnout = card.meta.find((m) => m.key === "Turnout");
    expect(turnout?.value).toBe("25.0%");
    expect(turnout?.sub).toBe("of est. 400K eligible");
  });

  it("says whether the denominator is an electorate or a population", () => {
    // A world with no cohort vectors has no eligible count and falls back to
    // total population. That is a materially bigger number, so the card must
    // not present it as the electorate.
    const eligible = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace()],
      electorate: { count: 400_000, basis: "eligible" },
    })[0];
    expect(eligible.meta.find((m) => m.key === "Turnout")?.sub).toBe("of est. 400K eligible");

    const residents = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace()],
      electorate: { count: 550_000, basis: "residents" },
    })[0];
    const chip = residents.meta.find((m) => m.key === "Turnout");
    expect(chip?.sub).toBe("of est. 550K residents");
    // Same ballots, bigger denominator, so a visibly lower figure.
    expect(chip?.value).toBe("18.2%");
  });

  it("labels a primary's turnout as primary turnout, not plain turnout", () => {
    const race = houseRace({
      inPrimary: true,
      generalTally: undefined,
      primaryVotes: { c1: 60_000, c2: 40_000 },
    });
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [race],
      electorate: { count: 400_000, basis: "eligible" },
    });
    // A primary draws its own, smaller electorate: calling it plain "Turnout"
    // invites comparison with a general figure it is not comparable to.
    expect(card.meta.map((m) => m.key)).toEqual(["Primary votes", "Primary turnout"]);
  });

  it("gives the primary standfirst the actual count, not boilerplate", () => {
    const race = houseRace({
      inPrimary: true,
      candidates: [
        candidate("c1", "Ada Wren", "1"),
        candidate("c3", "Eve Lark", "1"),
        candidate("c2", "Bo Marsh", "2"),
      ],
      generalTally: undefined,
      primaryVotes: { c1: 60_000, c3: 20_000, c2: 30_000 },
    });
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [race],
      viewerPartyId: "1",
    });
    // 60k of the Democratic field's own 80k.
    expect(card.standfirst).toContain(
      "Ada Wren carries 75.0% of the 80,000 votes cast in the Democratic Party primary, with Eve Lark on 25.0%."
    );
    expect(card.standfirst).toContain("nothing is settled against the Georgia total");
  });

  it("reports a down-ballot primary on shares alone before any ballots accrue", () => {
    // The general tally window is anchored at primaryEndTurn ("general votes
    // only accrue after the primary") and primaryResolution decides the
    // nomination on candidate scores. So a real down-ballot primary has shares
    // and no votes at all; printing "0 votes" would invent a count.
    const race = houseRace({
      inPrimary: true,
      generalTally: undefined,
      candidates: [
        candidate("c1", "Ada Wren", "1"),
        candidate("c3", "Eve Lark", "1"),
        candidate("c2", "Bo Marsh", "2"),
      ],
      polling: {
        leaderId: "c1",
        leaderName: "Ada Wren",
        leaderParty: "1",
        sharesPct: { c1: 41, c2: 36, c3: 23 },
        candidateNames: {},
        candidateParties: {},
        source: "primary",
      },
    });
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [race],
      electorate: { count: 400_000, basis: "eligible" },
      viewerPartyId: "1",
    });
    expect(card.hasBallots).toBe(false);
    // No vote count, no turnout: neither exists to report.
    expect(card.meta).toEqual([]);
    expect(card.standfirst).not.toMatch(/\d votes/);
    expect(card.standfirst).toContain("leads the Democratic Party primary on");
    expect(card.primaryGroups.every((g) => g.partyVotes === 0)).toBe(true);
  });

  it("says so when a primary field is uncontested", () => {
    const race = houseRace({
      inPrimary: true,
      generalTally: undefined,
      primaryVotes: { c1: 60_000, c2: 40_000 },
    });
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [race],
      viewerPartyId: "1",
    });
    expect(card.standfirst).toContain(
      "Ada Wren is unopposed in the Democratic Party primary on 60,000 votes."
    );
  });

  it("reports each race's share of the region's whole ballot", () => {
    const cards = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace(), senateRace()],
    });
    // 100,000 of 150,000 ballots cast across the two races.
    expect(cards[0].meta[0].sub).toBe("66.7% of Georgia ballots");
  });

  it("shows a seat column only for a multi-seat method", () => {
    const cards = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace(), senateRace()],
    });
    expect(cards[0].showSeats).toBe(true);
    expect(cards[0].rows[0].seatsCell).toBe("6");
    expect(cards[1].showSeats).toBe(false);
  });

  it("writes a party-level verdict for a seat race and a candidate one for a single winner", () => {
    const cards = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace(), senateRace()],
      titleById: { "e-house": "U.S. House", "e-senate": "U.S. Senate" },
    });
    expect(cards[0].verdict).toBe("DEM on track for 6 of 10");
    expect(cards[1].verdict).toBe("Cleo Vance leads U.S. Senate");
  });

  it("quotes the quota in the standfirst only where the game allocates on one", () => {
    const cards = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace(), senateRace()],
      titleById: { "e-house": "U.S. House", "e-senate": "U.S. Senate" },
    });
    expect(cards[0].standfirst).toContain("at a quota of 10,000");
    expect(cards[1].standfirst).not.toContain("quota");
    expect(cards[1].standfirst).toContain("a margin of 20.0 points");
    // Project rule: no em/en dashes in player-facing copy.
    expect(cards[0].standfirst).not.toMatch(/[—–]/);
    expect(cards[1].standfirst).not.toMatch(/[—–]/);
    expect(cards[0].verdict).not.toMatch(/[—–]/);
  });

  it("marks the viewer's own candidacy", () => {
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace()],
      viewerCharacterId: "char-c2",
    });
    expect(card.rows.find((r) => r.isYou)?.name).toBe("Bo Marsh");
  });

  it("normalizes a primary against each party's own vote, not the region total", () => {
    const race = houseRace({
      inPrimary: true,
      candidates: [
        candidate("c1", "Ada Wren", "1"),
        candidate("c3", "Eve Lark", "1"),
        candidate("c2", "Bo Marsh", "2"),
      ],
      generalTally: undefined,
      primaryVotes: { c1: 60_000, c3: 20_000, c2: 40_000 },
    });
    const [card] = buildBlendRegionCards({ ...baseInput, elections: [race] });
    expect(card.isPrimary).toBe(true);
    const dem = card.primaryGroups.find((g) => g.label === "Democratic Party");
    // 60k of the Democratic field's own 80k, NOT of the 120k region total.
    expect(dem?.candidates[0].pctStr).toBe("75.0");
    const rep = card.primaryGroups.find((g) => g.label === "Republican Party");
    expect(rep?.candidates[0].pctStr).toBe("100.0");
  });

  it("falls back to polling shares when summary mode omits the tally", () => {
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [
        houseRace({
          generalTally: undefined,
          polling: {
            leaderId: "c2",
            leaderName: "Bo Marsh",
            leaderParty: "2",
            sharesPct: { c1: 42, c2: 58 },
            candidateNames: {},
            candidateParties: {},
            source: "general",
          },
        }),
      ],
    });
    expect(card.rows[0].name).toBe("Bo Marsh");
    expect(card.rows[0].pctStr).toBe("58.0");
    // No vote counts exist to report, so the chips drop rather than show zero.
    expect(card.meta).toEqual([]);
    expect(card.hasBallots).toBe(false);
    expect(card.rows[0].deltaStr).toBe("—");
  });

  it("headlines the viewer's own party field in a primary", () => {
    const race = houseRace({
      inPrimary: true,
      candidates: [
        candidate("c1", "Ada Wren", "1"),
        candidate("c3", "Eve Lark", "1"),
        candidate("c2", "Bo Marsh", "2"),
        candidate("c4", "Cal Reed", "2"),
      ],
      generalTally: {
        // DEM draws the larger primary vote, so without a viewer it headlines DEM.
        totalVotes: { c1: 60_000, c3: 20_000, c2: 30_000, c4: 10_000 },
        turnSnapshots: [],
      },
    });
    const signedOut = buildBlendRegionCards({ ...baseInput, elections: [race] })[0];
    expect(signedOut.verdict).toBe("Ada Wren leads the Democratic Party field");

    // A Republican viewer gets their own field, not the bigger one.
    const rep = buildBlendRegionCards({
      ...baseInput,
      elections: [race],
      viewerPartyId: "2",
    })[0];
    expect(rep.verdict).toBe("Bo Marsh leads your Republican Party field");

    // A Democratic viewer gets theirs, phrased as their own.
    const dem = buildBlendRegionCards({
      ...baseInput,
      elections: [race],
      viewerPartyId: "1",
    })[0];
    expect(dem.verdict).toBe("Ada Wren leads your Democratic Party field");
  });

  it("falls back to the largest field when the viewer's party is not standing", () => {
    const race = houseRace({
      inPrimary: true,
      generalTally: undefined,
      primaryVotes: { c1: 60_000, c2: 40_000 },
    });
    // Party "9" contests nothing here.
    const card = buildBlendRegionCards({
      ...baseInput,
      elections: [race],
      viewerPartyId: "9",
    })[0];
    expect(card.verdict).toBe("Ada Wren leads the Democratic Party field");
  });

  it("lists the declared slate and no tally before any ballots exist", () => {
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [
        houseRace({ status: "upcoming", generalTally: undefined, seatsEstimate: undefined }),
      ],
    });
    expect(card.showSlate).toBe(true);
    expect(card.showTally).toBe(false);
    expect(card.slate.map((c) => c.name)).toContain("Ada Wren");
    expect(card.meta).toEqual([]);
  });

  it("badges only the region's leader in a winner-take-all race", () => {
    // seatsEstimate on a presidency holds NATIONAL electoral votes, so both
    // candidates carry some. Only the one who led THIS region won it.
    const pres = houseRace({
      id: "e-pres",
      electionType: "president",
      status: "completed",
      seatsEstimate: { c1: 232, c2: 306 },
    });
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [pres],
      regionElectoralVotes: 16,
    });
    expect(card.rows.filter((r) => r.isWinner).map((r) => r.name)).toEqual(["Ada Wren"]);
    expect(card.rows[1].seatsCell).toBe("—");
    expect(card.seatLine).toBe("16 EV");
    expect(card.verdict).toBe("Ada Wren carries Georgia");
    expect(card.standfirst).toContain("all 16 of Georgia's electoral votes");
  });

  it("counts a nationwide race by the region's own votes when they are supplied", () => {
    const pres = houseRace({ id: "e-pres", electionType: "president" });
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [pres],
      // National tally says 60/40; Georgia actually split 30/70.
      regionVotesByElectionId: { "e-pres": { c1: 30_000, c2: 70_000 } },
      regionElectoralVotes: 16,
    });
    expect(card.rows[0].name).toBe("Bo Marsh");
    expect(card.rows[0].pctStr).toBe("70.0");
    // Region-scoped totals carry no turn snapshots, so there is no delta to show.
    expect(card.rows[0].deltaStr).toBe("—");
  });

  it("never divides a nationwide count by one region's electorate", () => {
    // The presidency during its primary is counted nationally and has no
    // per-state breakdown at all. A turnout chip here would be a fabrication.
    const pres = houseRace({
      id: "e-pres",
      electionType: "president",
      state: "US",
      inPrimary: true,
    });
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [pres],
      regionCode: "GA",
      electorate: { count: 400_000, basis: "eligible" },
    });
    expect(card.regionScoped).toBe(false);
    expect(card.meta.find((m) => m.key === "Turnout")).toBeUndefined();
    // A presidential primary carries no down-ballot primaryVotes, so there is
    // no count to report at all — the meta strip drops rather than printing a
    // national figure against this region.
    expect(card.hasBallots).toBe(false);
    expect(card.meta).toEqual([]);
    expect(card.standfirst).toContain("national totals");
    expect(card.standfirst).not.toContain("against the Georgia total");
  });

  it("keeps a nationwide race out of the region-ballots denominator", () => {
    const pres = houseRace({ id: "e-pres", electionType: "president", state: "US" });
    const cards = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace(), pres],
      regionCode: "GA",
    });
    // The GA house race is the only race counted in GA, so it is 100% of the
    // region's ballots — the national presidential total must not dilute it.
    expect(cards[0].meta[0].sub).toBe("100.0% of Georgia ballots");
    expect(cards[1].meta[0].sub).toBe("counted nationwide");
  });

  it("treats a nationwide race as region-scoped once region votes are supplied", () => {
    const pres = houseRace({ id: "e-pres", electionType: "president", state: "US" });
    const [card] = buildBlendRegionCards({
      ...baseInput,
      elections: [pres],
      regionCode: "GA",
      electorate: { count: 400_000, basis: "eligible" },
      regionVotesByElectionId: { "e-pres": { c1: 30_000, c2: 70_000 } },
      regionElectoralVotes: 16,
    });
    expect(card.regionScoped).toBe(true);
    expect(card.meta.find((m) => m.key === "Turnout")?.value).toBe("25.0%");
    expect(card.verdict).toBe("Bo Marsh leads Georgia");
  });

  it("ignores tally votes for candidates the general no longer lists", () => {
    const race = houseRace({
      generalTally: {
        totalVotes: { c1: 60_000, c2: 40_000, droppedPrimaryLoser: 400_000 },
        turnSnapshots: [],
      },
    });
    const [card] = buildBlendRegionCards({ ...baseInput, elections: [race] });
    expect(card.rows.map((r) => r.pctStr)).toEqual(["60.0", "40.0"]);
    expect(card.ballots).toBe(100_000);
  });

  it("marks winners only once the race is final", () => {
    const live = buildBlendRegionCards({ ...baseInput, elections: [houseRace()] })[0];
    expect(live.rows.every((r) => !r.isWinner)).toBe(true);
    const done = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace({ status: "completed" })],
    })[0];
    expect(done.rows[0].isWinner).toBe(true);
  });
});

describe("buildBlendWire", () => {
  it("returns nothing when there are no races", () => {
    expect(buildBlendWire([], { regionName: "Georgia" })).toEqual([]);
  });

  it("leads on the race with the most ballots and carries its quota", () => {
    const cards = buildBlendRegionCards({
      ...baseInput,
      elections: [senateRace(), houseRace()],
    });
    const wire = buildBlendWire(cards, {
      regionName: "Georgia",
      quotaByElectionId: { "e-house": 10_000, "e-senate": null },
    });
    expect(wire[0].text).toContain("DEM Ada Wren");
    expect(wire.some((w) => w.text === "Quota 10,000 votes per seat")).toBe(true);
  });

  it("omits the turnout line when there is no electorate to divide by", () => {
    const cards = buildBlendRegionCards({ ...baseInput, elections: [houseRace()] });
    const wire = buildBlendWire(cards, { regionName: "Georgia" });
    expect(wire.some((w) => w.text.includes("turnout"))).toBe(false);
  });

  it("reports a margin instead of a quota for a single-winner race", () => {
    const cards = buildBlendRegionCards({ ...baseInput, elections: [senateRace()] });
    const wire = buildBlendWire(cards, { regionName: "Georgia" });
    expect(wire.some((w) => w.text === "Single seat · margin 20.0 pts over the runner-up")).toBe(
      true
    );
  });

  it("keeps em and en dashes out of every wire line", () => {
    const cards = buildBlendRegionCards({
      ...baseInput,
      elections: [houseRace(), senateRace()],
    });
    const wire = buildBlendWire(cards, {
      regionName: "Georgia",
      electorate: { count: 400_000, basis: "eligible" },
    });
    expect(wire.every((w) => !/[—–]/.test(w.text))).toBe(true);
  });
});
