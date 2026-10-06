import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import {
  applyIndependenceDesireNudge,
  loadFirstMinisterBonusContexts,
  maybeApplyIndependenceDesireHook,
  type CandidateLite,
} from "@/lib/turn/election/independenceDesireHook";
import { highDesireElectionBonus } from "@/lib/constants/devolution";
import { applyFirstMinisterHighDesireBonus } from "@/lib/turn/election/rules/highDesireElectionBonus";

function cand(party: string): CandidateLite {
  return { _id: new ObjectId(), party };
}

function map(...entries: Array<[string, string]>): Map<string, string> {
  return new Map(entries);
}

describe("applyIndependenceDesireNudge", () => {
  it("no-ops when region is not SCO/WAL/NIR", () => {
    const c = cand("100");
    const result = applyIndependenceDesireNudge({
      effectiveVotes: { [c._id.toString()]: 1000 },
      candidates: [c],
      partyBySeq: map([c.party, "uk_snp"]),
      desire: 80,
      totalVotes: 1000,
      region: "LON",
    });
    expect(result.nudgeApplied).toBe(0);
    expect(result.adjustedVotes[c._id.toString()]).toBe(1000);
  });

  it("no-ops when desire is exactly 50 (neutral)", () => {
    const snp = cand("100");
    const con = cand("200");
    const result = applyIndependenceDesireNudge({
      effectiveVotes: {
        [snp._id.toString()]: 500,
        [con._id.toString()]: 500,
      },
      candidates: [snp, con],
      partyBySeq: map([snp.party, "uk_snp"], [con.party, "uk_conservative"]),
      desire: 50,
      totalVotes: 1000,
      region: "SCO",
    });
    expect(result.nudgeApplied).toBe(0);
  });

  it("boosts pro-indy and penalizes rivals proportionally in SCO at desire=100", () => {
    const snp = cand("100");
    const con = cand("200");
    const lab = cand("300"); // neutral — not affected
    const before = {
      [snp._id.toString()]: 500,
      [con._id.toString()]: 300,
      [lab._id.toString()]: 200,
    };
    const result = applyIndependenceDesireNudge({
      effectiveVotes: before,
      candidates: [snp, con, lab],
      partyBySeq: map(
        [snp.party, "uk_snp"],
        [con.party, "uk_conservative"],
        [lab.party, "uk_labour"]
      ),
      desire: 100,
      totalVotes: 1000,
      region: "SCO",
    });
    // Nudge = (100-50)*0.001 = 0.05 → +5pp bonus to SNP, -5pp to Con
    expect(result.nudgeApplied).toBeCloseTo(0.05, 5);
    expect(result.adjustedVotes[snp._id.toString()]).toBeCloseTo(550, 5); // +50
    expect(result.adjustedVotes[con._id.toString()]).toBeCloseTo(250, 5); // -50
    expect(result.adjustedVotes[lab._id.toString()]).toBeCloseTo(200, 5); // unchanged
    // Total preserved
    const total =
      result.adjustedVotes[snp._id.toString()] +
      result.adjustedVotes[con._id.toString()] +
      result.adjustedVotes[lab._id.toString()];
    expect(total).toBeCloseTo(1000, 5);
  });

  it("clamps nudge to ±5pp even at desire=0 (penalty direction)", () => {
    const snp = cand("100");
    const con = cand("200");
    const result = applyIndependenceDesireNudge({
      effectiveVotes: {
        [snp._id.toString()]: 500,
        [con._id.toString()]: 500,
      },
      candidates: [snp, con],
      partyBySeq: map([snp.party, "uk_snp"], [con.party, "uk_conservative"]),
      desire: 0,
      totalVotes: 1000,
      region: "SCO",
    });
    // Nudge = (0-50)*0.001 = -0.05 → -5pp to SNP, +5pp to Con
    expect(result.nudgeApplied).toBeCloseTo(-0.05, 5);
    expect(result.adjustedVotes[snp._id.toString()]).toBeCloseTo(450, 5);
    expect(result.adjustedVotes[con._id.toString()]).toBeCloseTo(550, 5);
  });

  it("splits NIR penalty across DUP + UUP rivals when reunification high", () => {
    const sf = cand("100");
    const dup = cand("200");
    const uup = cand("300");
    const result = applyIndependenceDesireNudge({
      effectiveVotes: {
        [sf._id.toString()]: 400,
        [dup._id.toString()]: 400,
        [uup._id.toString()]: 200,
      },
      candidates: [sf, dup, uup],
      partyBySeq: map([sf.party, "uk_sf"], [dup.party, "uk_dup"], [uup.party, "uk_uup"]),
      desire: 100, // +5pp to SF, -2.5pp each to DUP/UUP
      totalVotes: 1000,
      region: "NIR",
    });
    expect(result.nudgeApplied).toBeCloseTo(0.05, 5);
    expect(result.adjustedVotes[sf._id.toString()]).toBeCloseTo(450, 5); // +50
    expect(result.adjustedVotes[dup._id.toString()]).toBeCloseTo(375, 5); // -25
    expect(result.adjustedVotes[uup._id.toString()]).toBeCloseTo(175, 5); // -25
  });

  it("no-ops when no pro-indy candidate is running", () => {
    const con = cand("200");
    const lab = cand("300");
    const before = {
      [con._id.toString()]: 500,
      [lab._id.toString()]: 500,
    };
    const result = applyIndependenceDesireNudge({
      effectiveVotes: before,
      candidates: [con, lab],
      partyBySeq: map([con.party, "uk_conservative"], [lab.party, "uk_labour"]),
      desire: 100,
      totalVotes: 1000,
      region: "SCO",
    });
    expect(result.nudgeApplied).toBe(0);
    expect(result.adjustedVotes).toEqual(before);
  });

  it("distributes within a party proportional to existing votes", () => {
    // Two SNP candidates with unequal vote counts — bigger share gets more boost
    const snp1 = cand("100");
    const snp2 = cand("100"); // same party
    const con = cand("200");
    const result = applyIndependenceDesireNudge({
      effectiveVotes: {
        [snp1._id.toString()]: 300,
        [snp2._id.toString()]: 100,
        [con._id.toString()]: 600,
      },
      candidates: [snp1, snp2, con],
      partyBySeq: map([snp1.party, "uk_snp"], [con.party, "uk_conservative"]),
      desire: 100, // +50 total bonus to SNP
      totalVotes: 1000,
      region: "SCO",
    });
    // SNP1 gets 300/400 of 50 = 37.5; SNP2 gets 100/400 of 50 = 12.5
    expect(result.adjustedVotes[snp1._id.toString()]).toBeCloseTo(337.5, 5);
    expect(result.adjustedVotes[snp2._id.toString()]).toBeCloseTo(112.5, 5);
    expect(result.adjustedVotes[con._id.toString()]).toBeCloseTo(550, 5);
  });

  it("clamps individual candidate vote counts to >= 0", () => {
    // Extreme case: tiny rival vote share + large penalty
    const snp = cand("100");
    const con = cand("200");
    const result = applyIndependenceDesireNudge({
      effectiveVotes: {
        [snp._id.toString()]: 999,
        [con._id.toString()]: 1, // basically nothing
      },
      candidates: [snp, con],
      partyBySeq: map([snp.party, "uk_snp"], [con.party, "uk_conservative"]),
      desire: 100,
      totalVotes: 1000,
      region: "SCO",
    });
    // Penalty to Con is -50 but Con only has 1 vote → clamped to 0
    expect(result.adjustedVotes[con._id.toString()]).toBe(0);
    expect(result.adjustedVotes[snp._id.toString()]).toBeCloseTo(1049, 5);
  });
});

describe("highDesireElectionBonus", () => {
  it.each([
    [0, 0],
    [50, 0],
    [59, 0],
    [60, 0.015],
    [65, 0.015],
    [69, 0.015],
    [70, 0.03],
    [79, 0.03],
    [80, 0.045],
    [89, 0.045],
    [90, 0.06],
    [99, 0.06],
    [100, 0.075],
  ])("desire=%i → %f", (desire, expected) => {
    expect(highDesireElectionBonus(desire)).toBeCloseTo(expected, 5);
  });

  it("returns 0 for non-finite inputs (defensive)", () => {
    expect(highDesireElectionBonus(Number.NaN)).toBe(0);
    expect(highDesireElectionBonus(Number.POSITIVE_INFINITY)).toBe(0);
    expect(highDesireElectionBonus(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("clamps oversize desire values at the max band", () => {
    // Should not happen in practice (drift clamps to [0, 100]) but defensive.
    expect(highDesireElectionBonus(150)).toBeCloseTo(0.075, 5);
  });
});

describe("applyFirstMinisterHighDesireBonus", () => {
  it("no-ops when desire is below 60", () => {
    const incumbent = cand("777");
    const before = { [incumbent._id.toString()]: 500 };
    const result = applyFirstMinisterHighDesireBonus({
      effectiveVotes: before,
      candidates: [{ id: incumbent._id.toString(), partyId: incumbent.party }],
      desire: 59,
      region: "SCO",
      firstMinisterPartyId: incumbent.party,
      devolutionPolicy: "independence",
    });
    expect(result.bonusApplied).toBe(0);
    expect(result.adjustedVotes).toEqual(before);
  });

  it.each(["SCO", "WAL", "NIR"])(
    "applies +1.5%% to a custom First Minister party at desire=60 in %s",
    (region) => {
      const incumbent = cand("777");
      const legacyParty = cand("100");
      const before = {
        [incumbent._id.toString()]: 500,
        [legacyParty._id.toString()]: 500,
      };
      const result = applyFirstMinisterHighDesireBonus({
        effectiveVotes: before,
        candidates: [
          { id: incumbent._id.toString(), partyId: incumbent.party },
          { id: legacyParty._id.toString(), partyId: legacyParty.party },
        ],
        desire: 60,
        region,
        firstMinisterPartyId: incumbent.party,
        devolutionPolicy: "independence",
      });
      expect(result.bonusApplied).toBeCloseTo(0.015, 5);
      expect(result.adjustedVotes[incumbent._id.toString()]).toBeCloseTo(507.5, 5);
      expect(result.adjustedVotes[legacyParty._id.toString()]).toBe(500);
    }
  );

  it.each(["anti", "pro"] as const)(
    "does not grant the bonus under the %s policy",
    (devolutionPolicy) => {
      const incumbent = cand("777");
      const before = { [incumbent._id.toString()]: 1000 };
      const result = applyFirstMinisterHighDesireBonus({
        effectiveVotes: before,
        candidates: [{ id: incumbent._id.toString(), partyId: incumbent.party }],
        desire: 100,
        region: "SCO",
        firstMinisterPartyId: incumbent.party,
        devolutionPolicy,
      });
      expect(result.bonusApplied).toBe(0);
      expect(result.adjustedVotes).toEqual(before);
    }
  );

  it("no-ops when there is no current First Minister party", () => {
    const candidate = cand("777");
    const before = { [candidate._id.toString()]: 1000 };
    const result = applyFirstMinisterHighDesireBonus({
      effectiveVotes: before,
      candidates: [{ id: candidate._id.toString(), partyId: candidate.party }],
      desire: 100,
      region: "SCO",
      firstMinisterPartyId: null,
      devolutionPolicy: "independence",
    });
    expect(result.bonusApplied).toBe(0);
    expect(result.adjustedVotes).toEqual(before);
  });

  it("does not treat independent candidates as a First Minister party", () => {
    const independent = cand("independent");
    const before = { [independent._id.toString()]: 1000 };
    const result = applyFirstMinisterHighDesireBonus({
      effectiveVotes: before,
      candidates: [{ id: independent._id.toString(), partyId: independent.party }],
      desire: 100,
      region: "WAL",
      firstMinisterPartyId: "independent",
      devolutionPolicy: "independence",
    });
    expect(result.bonusApplied).toBe(0);
    expect(result.adjustedVotes).toEqual(before);
  });

  it("applies the bonus to every candidate in the First Minister's party", () => {
    const incumbent1 = cand("777");
    const incumbent2 = cand("777");
    const rival = cand("100");
    const result = applyFirstMinisterHighDesireBonus({
      effectiveVotes: {
        [incumbent1._id.toString()]: 600,
        [incumbent2._id.toString()]: 400,
        [rival._id.toString()]: 1000,
      },
      candidates: [
        { id: incumbent1._id.toString(), partyId: incumbent1.party },
        { id: incumbent2._id.toString(), partyId: incumbent2.party },
        { id: rival._id.toString(), partyId: rival.party },
      ],
      desire: 100,
      region: "SCO",
      firstMinisterPartyId: incumbent1.party,
      devolutionPolicy: "independence",
    });
    expect(result.bonusApplied).toBeCloseTo(0.075, 5);
    expect(result.adjustedVotes[incumbent1._id.toString()]).toBeCloseTo(645, 5);
    expect(result.adjustedVotes[incumbent2._id.toString()]).toBeCloseTo(430, 5);
    expect(result.adjustedVotes[rival._id.toString()]).toBe(1000);
  });

  it("uses the same independence policy value for NIR reunification", () => {
    const incumbent = cand("777");
    const result = applyFirstMinisterHighDesireBonus({
      effectiveVotes: { [incumbent._id.toString()]: 400 },
      candidates: [{ id: incumbent._id.toString(), partyId: incumbent.party }],
      desire: 70,
      region: "NIR",
      firstMinisterPartyId: incumbent.party,
      devolutionPolicy: "independence",
    });
    expect(result.bonusApplied).toBeCloseTo(0.03, 5);
    expect(result.adjustedVotes[incumbent._id.toString()]).toBeCloseTo(412, 5);
  });

  it("ignores unknown region", () => {
    const c = cand("100");
    const before = { [c._id.toString()]: 1000 };
    const result = applyFirstMinisterHighDesireBonus({
      effectiveVotes: before,
      candidates: [{ id: c._id.toString(), partyId: c.party }],
      desire: 100,
      region: "LON",
      firstMinisterPartyId: c.party,
      devolutionPolicy: "independence",
    });
    expect(result.bonusApplied).toBe(0);
    expect(result.adjustedVotes).toEqual(before);
  });
});

function makeHookDb(desire: number): Db {
  const collection = vi.fn((name: string) => {
    if (name === "macroMetrics") {
      return { findOne: vi.fn().mockResolvedValue({ independenceDesire: { value: desire } }) };
    }
    if (name === "politicalParties") {
      return {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        }),
      };
    }
    throw new Error(`Unexpected collection: ${name}`);
  });

  return { collection } as unknown as Db;
}

describe("maybeApplyIndependenceDesireHook", () => {
  it("applies a batched qualifying context to the First Minister's custom party", async () => {
    const candidate = cand("777");

    const result = await maybeApplyIndependenceDesireHook(makeHookDb(60), {
      countryId: "UK",
      electionType: "regionalCouncil",
      state: "sco",
      effectiveVotes: { [candidate._id.toString()]: 1000 },
      candidates: [candidate],
      totalVotes: 1000,
      bonusContext: {
        firstMinisterPartyId: candidate.party,
        devolutionPolicy: "independence",
      },
    });

    expect(result.firstMinisterBonusApplied).toBeCloseTo(0.015, 5);
    expect(result.adjustedVotes[candidate._id.toString()]).toBeCloseTo(1015, 5);
  });

  it("does not grant the bonus under the ordinary pro-devolution policy", async () => {
    const candidate = cand("777");

    const result = await maybeApplyIndependenceDesireHook(makeHookDb(100), {
      countryId: "UK",
      electionType: "commons",
      state: "WAL",
      effectiveVotes: { [candidate._id.toString()]: 1000 },
      candidates: [candidate],
      totalVotes: 1000,
      bonusContext: {
        firstMinisterPartyId: candidate.party,
        devolutionPolicy: "pro",
      },
    });

    expect(result.firstMinisterBonusApplied).toBe(0);
    expect(result.adjustedVotes[candidate._id.toString()]).toBe(1000);
  });

  it("does not grant the bonus without a batched office context", async () => {
    const candidate = cand("777");

    const result = await maybeApplyIndependenceDesireHook(makeHookDb(100), {
      countryId: "UK",
      electionType: "governor",
      state: "NIR",
      effectiveVotes: { [candidate._id.toString()]: 1000 },
      candidates: [candidate],
      totalVotes: 1000,
    });

    expect(result.firstMinisterBonusApplied).toBe(0);
    expect(result.adjustedVotes[candidate._id.toString()]).toBe(1000);
  });
});

describe("loadFirstMinisterBonusContexts", () => {
  it("loads all qualifying regional office inputs in two projected batch reads", async () => {
    const electedOfficialsFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { state: "SCO", party: "777" },
        { state: "NIR", party: "888" },
      ]),
    });
    const officeStateFind = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { stateId: "SCO", devolutionPolicy: "independence" },
        { stateId: "NIR", devolutionPolicy: "pro" },
      ]),
    });
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "electedOfficials") return { find: electedOfficialsFind };
        if (name === "governorOfficeState") return { find: officeStateFind };
        throw new Error(`Unexpected collection: ${name}`);
      }),
    } as unknown as Db;

    const contexts = await loadFirstMinisterBonusContexts(db, ["sco", "SCO", "NIR", "LON"]);

    expect(electedOfficialsFind).toHaveBeenCalledWith(
      {
        countryId: "UK",
        officeType: "governor",
        state: { $in: ["SCO", "NIR"] },
      },
      { projection: { state: 1, party: 1 } }
    );
    expect(officeStateFind).toHaveBeenCalledWith(
      { countryId: "UK", stateId: { $in: ["SCO", "NIR"] } },
      { projection: { stateId: 1, devolutionPolicy: 1 } }
    );
    expect(contexts.get("SCO")).toEqual({
      firstMinisterPartyId: "777",
      devolutionPolicy: "independence",
    });
    expect(contexts.get("NIR")).toEqual({
      firstMinisterPartyId: "888",
      devolutionPolicy: "pro",
    });
  });
});
