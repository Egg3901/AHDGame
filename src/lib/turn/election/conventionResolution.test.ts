import { describe, expect, it } from "vitest";
import { resolveNominationForParty } from "./conventionResolution";

// Positions on the -5..+5 (EP, SP) plane. Same party throughout (intra-party
// nomination), so coalition overlap is neutral and ideological affinity drives
// the delegate release deterministically.
const LEFT = { charEP: -5, charSP: -5, party: "democrat" };
const RIGHT = { charEP: 5, charSP: 5, party: "democrat" };
const CENTRE = { charEP: 0, charSP: 0, party: "democrat" };

const enrichedFor = (rows: Array<{ candidateId: string } & typeof LEFT>) => rows;

describe("resolveNominationForParty", () => {
  it("nominates a first-ballot delegate majority holder (no convention)", () => {
    // Dem majority threshold is ~1990; 2000 clears it outright.
    const res = resolveNominationForParty({
      partyCandidates: [{ candidateId: "a" }, { candidateId: "b" }],
      partyDelegates: { a: 2000, b: 500 },
      family: "dem",
      enriched: enrichedFor([
        { candidateId: "a", ...LEFT },
        { candidateId: "b", ...RIGHT },
      ]),
      ruleset: { conventionEnabled: true },
    });
    expect(res).not.toBeNull();
    expect(res!.mode).toBe("delegate_majority");
    expect(res!.winnerCandidateId).toBe("a");
    expect(res!.firstBallotLeaderId).toBe("a");
    expect(res!.ballots).toBeUndefined();
  });

  it("runs a multi-ballot convention and converges when no first-ballot majority", () => {
    // None of these clears the ~1990 first-ballot threshold.
    const res = resolveNominationForParty({
      partyCandidates: [{ candidateId: "a" }, { candidateId: "b" }, { candidateId: "c" }],
      partyDelegates: { a: 900, b: 850, c: 800 },
      family: "dem",
      enriched: enrichedFor([
        { candidateId: "a", ...RIGHT },
        { candidateId: "b", ...LEFT },
        { candidateId: "c", ...LEFT }, // identical to b -> its delegates flow to b
      ]),
      ruleset: { conventionEnabled: true },
    });
    expect(res!.mode).toBe("convention");
    expect(res!.winnerCandidateId).toBe("b");
    // Ballot 1 drops the lowest (c); ballot 2 seats the survivor with a majority.
    expect(res!.ballots!.length).toBe(2);
    expect(res!.ballots![0].eliminatedCandidateId).toBe("c");
    expect(res!.ballots![1].eliminatedCandidateId).toBeUndefined();
  });

  it("releases an eliminated candidate's delegates to the closest survivor by affinity", () => {
    const res = resolveNominationForParty({
      partyCandidates: [{ candidateId: "a" }, { candidateId: "b" }, { candidateId: "c" }],
      partyDelegates: { a: 900, b: 850, c: 800 },
      family: "dem",
      enriched: enrichedFor([
        { candidateId: "a", ...RIGHT },
        { candidateId: "b", ...LEFT },
        { candidateId: "c", ...LEFT },
      ]),
      ruleset: { conventionEnabled: true },
    });
    // c (identical to b) is dropped first; all 800 of its delegates flow to b.
    expect(res!.ballots![1].tallies.b).toBe(1650);
    expect(res!.ballots![1].tallies.a).toBe(900);
  });

  it("lets an eliminated candidate's endorsement tip a symmetric release", () => {
    // a and b are equidistant from centrist c, so affinity alone splits c's
    // delegates evenly and the id-tiebreak would seat b. c endorsing a shifts
    // enough of the release to a to flip the outcome.
    const base = {
      partyCandidates: [{ candidateId: "a2" }, { candidateId: "a1" }, { candidateId: "c" }],
      partyDelegates: { a2: 900, a1: 900, c: 800 },
      family: "dem" as const,
      enriched: enrichedFor([
        { candidateId: "a2", ...RIGHT },
        { candidateId: "a1", ...LEFT },
        { candidateId: "c", ...CENTRE },
      ]),
      ruleset: { conventionEnabled: true },
    };

    const withoutEndorsement = resolveNominationForParty(base);
    const withEndorsement = resolveNominationForParty({
      ...base,
      endorsements: new Map([["c", "a2"]]),
    });

    expect(withoutEndorsement!.winnerCandidateId).toBe("a1");
    expect(withEndorsement!.winnerCandidateId).toBe("a2");
  });

  it("is deterministic: identical inputs yield identical ballots and winner", () => {
    const params = {
      partyCandidates: [{ candidateId: "a" }, { candidateId: "b" }, { candidateId: "c" }],
      partyDelegates: { a: 900, b: 850, c: 800 },
      family: "dem" as const,
      enriched: enrichedFor([
        { candidateId: "a", ...RIGHT },
        { candidateId: "b", ...LEFT },
        { candidateId: "c", ...LEFT },
      ]),
      ruleset: { conventionEnabled: true },
      now: new Date("2026-01-01T00:00:00Z"),
    };
    const first = resolveNominationForParty(params);
    const second = resolveNominationForParty(params);
    expect(second!.winnerCandidateId).toBe(first!.winnerCandidateId);
    expect(second!.ballots).toEqual(first!.ballots);
  });

  it("v1/v2 identity: with conventions disabled and no majority it returns null (plurality fallback)", () => {
    const res = resolveNominationForParty({
      partyCandidates: [{ candidateId: "a" }, { candidateId: "b" }, { candidateId: "c" }],
      partyDelegates: { a: 900, b: 850, c: 800 },
      family: "dem",
      enriched: enrichedFor([
        { candidateId: "a", ...RIGHT },
        { candidateId: "b", ...LEFT },
        { candidateId: "c", ...LEFT },
      ]),
      ruleset: { conventionEnabled: false },
    });
    expect(res).toBeNull();
  });

  it("still reports a first-ballot majority even when conventions are disabled", () => {
    const res = resolveNominationForParty({
      partyCandidates: [{ candidateId: "a" }, { candidateId: "b" }],
      partyDelegates: { a: 2000, b: 500 },
      family: "dem",
      enriched: enrichedFor([
        { candidateId: "a", ...LEFT },
        { candidateId: "b", ...RIGHT },
      ]),
      ruleset: { conventionEnabled: false },
    });
    expect(res!.mode).toBe("delegate_majority");
    expect(res!.winnerCandidateId).toBe("a");
  });
});
