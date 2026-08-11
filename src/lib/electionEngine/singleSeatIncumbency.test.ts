import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { makeInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import {
  isSingleSeatLegislativeRace,
  computeConsecutiveTermsFromWinners,
  resolveSingleSeatLegislativeIncumbent,
  resolveHouseIncumbentTenures,
} from "./singleSeatIncumbency";
import type { Election } from "@/lib/db/types";

function senateElection(overrides: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    countryId: "US",
    electionType: "senate",
    state: "AK",
    senateClass: 2,
    cycle: 2030,
    status: "upcoming",
    ...overrides,
  } as unknown as Election;
}

describe("isSingleSeatLegislativeRace", () => {
  it("is true for senate, false for house/governor/president", () => {
    expect(isSingleSeatLegislativeRace(senateElection())).toBe(true);
    expect(isSingleSeatLegislativeRace(senateElection({ electionType: "house" }))).toBe(false);
    expect(isSingleSeatLegislativeRace(senateElection({ electionType: "governor" }))).toBe(false);
    expect(isSingleSeatLegislativeRace(senateElection({ electionType: "president" }))).toBe(false);
  });
});

describe("computeConsecutiveTermsFromWinners", () => {
  it("counts the current term plus leading same-identity wins, stopping at a flip", () => {
    expect(computeConsecutiveTermsFromWinners("me", [])).toBe(1);
    expect(computeConsecutiveTermsFromWinners("me", ["me", "me"])).toBe(3);
    expect(computeConsecutiveTermsFromWinners("me", ["me", "other", "me"])).toBe(2);
    expect(computeConsecutiveTermsFromWinners("me", ["other"])).toBe(1);
    expect(computeConsecutiveTermsFromWinners("me", [null, "me"])).toBe(1);
  });
});

describe("resolveSingleSeatLegislativeIncumbent", () => {
  // Plain string ids: makeInMemoryStore structuredClones seed docs, which does
  // not preserve ObjectId instances. The helper only ever compares `.toString()`
  // values, so strings are behaviourally identical and clone cleanly.
  const incumbentCharId = "char-incumbent";

  function seedStore(opts: { priorWinnerIsIncumbent: boolean }) {
    const priorElectionId = "elec-prior";
    const priorWinnerCandId = "cand-winner";
    const priorWinnerCharId = opts.priorWinnerIsIncumbent ? incumbentCharId : "char-other";
    return makeInMemoryStore({
      electedOfficials: [
        {
          _id: "off-1",
          officeType: "senate",
          state: "AK",
          countryId: "US",
          senateClass: 2,
          characterId: incumbentCharId,
          party: "dem",
        },
      ],
      elections: [
        {
          _id: priorElectionId,
          countryId: "US",
          electionType: "senate",
          state: "AK",
          senateClass: 2,
          cycle: 2024,
          status: "resolved",
        },
      ],
      electionVoteTallies: [
        {
          _id: "tally-prior",
          electionId: priorElectionId,
          finalized: true,
          totalVotes: { [priorWinnerCandId]: 100, "cand-loser": 40 },
        },
      ],
      electionCandidates: [
        {
          _id: priorWinnerCandId,
          electionId: priorElectionId,
          characterId: priorWinnerCharId,
          party: "dem",
        },
      ],
    });
  }

  it("returns partyId + tenure when the incumbent is running (prior win → 2 terms)", async () => {
    const { db } = seedStore({ priorWinnerIsIncumbent: true });
    const running = new Set([incumbentCharId]);
    const result = await resolveSingleSeatLegislativeIncumbent(senateElection(), running, db);
    expect(result).toEqual({ incumbentPartyId: "dem", tenureTerms: 2 });
  });

  it("returns null (open seat) when the incumbent is not among candidates", async () => {
    const { db } = seedStore({ priorWinnerIsIncumbent: true });
    const running = new Set(["char-someone-else"]);
    const result = await resolveSingleSeatLegislativeIncumbent(senateElection(), running, db);
    expect(result).toBeNull();
  });

  it("counts only 1 term when the prior seat winner was someone else", async () => {
    const { db } = seedStore({ priorWinnerIsIncumbent: false });
    const running = new Set([incumbentCharId]);
    const result = await resolveSingleSeatLegislativeIncumbent(senateElection(), running, db);
    expect(result).toEqual({ incumbentPartyId: "dem", tenureTerms: 1 });
  });

  it("returns null for a non-senate race", async () => {
    const { db } = seedStore({ priorWinnerIsIncumbent: true });
    const running = new Set([incumbentCharId]);
    const result = await resolveSingleSeatLegislativeIncumbent(
      senateElection({ electionType: "house" }),
      running,
      db
    );
    expect(result).toBeNull();
  });
});

describe("resolveHouseIncumbentTenures", () => {
  function houseElection(overrides: Partial<Election> = {}): Election {
    return {
      _id: "elec-current",
      countryId: "US",
      electionType: "house",
      state: "CA",
      cycle: 2020,
      status: "upcoming",
      ...overrides,
    } as unknown as Election;
  }

  // Three resolved prior cycles on the same CA house seat, newest → oldest:
  // 2018, 2016, 2014. minShare("house") = 20%, so a candidate clears the
  // multi-seat "held a seat" proxy at >= 20% of that cycle's total votes.
  //   charA: 70% (2018), 60% (2016), 50% (2014) — clears every cycle → 3 terms.
  //   charB: 25% (2018), 20% (2016, exactly at the gate) — clears both, then
  //          10% (2014) — misses, so the walk-back stops there → 2 terms.
  //   charC: 5% (2018) only — never clears → no entry at all (not merely 0).
  function seedHouseStore() {
    return makeInMemoryStore({
      elections: [
        {
          _id: "elec-2018",
          countryId: "US",
          electionType: "house",
          state: "CA",
          cycle: 2018,
          status: "resolved",
        },
        {
          _id: "elec-2016",
          countryId: "US",
          electionType: "house",
          state: "CA",
          cycle: 2016,
          status: "resolved",
        },
        {
          _id: "elec-2014",
          countryId: "US",
          electionType: "house",
          state: "CA",
          cycle: 2014,
          status: "resolved",
        },
      ],
      electionVoteTallies: [
        {
          _id: "tally-2018",
          electionId: "elec-2018",
          finalized: true,
          totalVotes: { "cand-2018-a": 70, "cand-2018-b": 25, "cand-2018-c": 5 },
        },
        {
          _id: "tally-2016",
          electionId: "elec-2016",
          finalized: true,
          totalVotes: { "cand-2016-a": 60, "cand-2016-b": 20, "cand-2016-other": 20 },
        },
        {
          _id: "tally-2014",
          electionId: "elec-2014",
          finalized: true,
          totalVotes: { "cand-2014-a": 50, "cand-2014-b": 10, "cand-2014-other": 40 },
        },
      ],
      electionCandidates: [
        { _id: "cand-2018-a", electionId: "elec-2018", characterId: "charA", party: "dem" },
        { _id: "cand-2018-b", electionId: "elec-2018", characterId: "charB", party: "rep" },
        { _id: "cand-2018-c", electionId: "elec-2018", characterId: "charC", party: "grn" },
        { _id: "cand-2016-a", electionId: "elec-2016", characterId: "charA", party: "dem" },
        { _id: "cand-2016-b", electionId: "elec-2016", characterId: "charB", party: "rep" },
        {
          _id: "cand-2016-other",
          electionId: "elec-2016",
          characterId: "char-other-2016",
          party: "ind",
        },
        { _id: "cand-2014-a", electionId: "elec-2014", characterId: "charA", party: "dem" },
        { _id: "cand-2014-b", electionId: "elec-2014", characterId: "charB", party: "rep" },
        {
          _id: "cand-2014-other",
          electionId: "elec-2014",
          characterId: "char-other-2014",
          party: "ind",
        },
      ],
    });
  }

  it("counts consecutive terms per candidate identity, stopping at the first cycle they missed the seat-share gate", async () => {
    const { db } = seedHouseStore();
    const running = new Map([
      ["charA", "cand-now-a"],
      ["charB", "cand-now-b"],
    ]);
    const result = await resolveHouseIncumbentTenures(houseElection(), running, db);
    expect(result.get("cand-now-a")).toBe(3);
    expect(result.get("cand-now-b")).toBe(2);
  });

  it("omits a candidate who never cleared the seat-share gate (no entry, not 0)", async () => {
    const { db } = seedHouseStore();
    const running = new Map([["charC", "cand-now-c"]]);
    const result = await resolveHouseIncumbentTenures(houseElection(), running, db);
    expect(result.has("cand-now-c")).toBe(false);
  });

  it("a fresh nominee (never seen before) gets no fatigue even though their party kept the seat", async () => {
    const { db } = seedHouseStore();
    const running = new Map([["char-brand-new", "cand-now-fresh"]]);
    const result = await resolveHouseIncumbentTenures(houseElection(), running, db);
    expect(result.has("cand-now-fresh")).toBe(false);
  });

  it("several simultaneous incumbents in the same race each carry their own term count", async () => {
    const { db } = seedHouseStore();
    const running = new Map([
      ["charA", "cand-now-a"],
      ["charB", "cand-now-b"],
      ["char-brand-new", "cand-now-fresh"],
    ]);
    const result = await resolveHouseIncumbentTenures(houseElection(), running, db);
    expect(result.size).toBe(2); // fresh nominee excluded
    expect(result.get("cand-now-a")).toBe(3);
    expect(result.get("cand-now-b")).toBe(2);
  });

  it("returns an empty map for a non-house race", async () => {
    const { db } = seedHouseStore();
    const running = new Map([["charA", "cand-now-a"]]);
    const result = await resolveHouseIncumbentTenures(
      houseElection({ electionType: "senate" }),
      running,
      db
    );
    expect(result.size).toBe(0);
  });

  it("returns an empty map when there is no prior resolved cycle on this seat", async () => {
    const { db } = makeInMemoryStore({});
    const running = new Map([["charA", "cand-now-a"]]);
    const result = await resolveHouseIncumbentTenures(houseElection(), running, db);
    expect(result.size).toBe(0);
  });
});
