import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  applyIndependenceDesireNudge,
  applyProIndyHighDesireBonus,
  type CandidateLite,
} from "@/lib/turn/election/independenceDesireHook";
import { proIndyHighDesireBonus } from "@/lib/constants/devolution";

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

describe("proIndyHighDesireBonus", () => {
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
    expect(proIndyHighDesireBonus(desire)).toBeCloseTo(expected, 5);
  });

  it("returns 0 for non-finite inputs (defensive)", () => {
    expect(proIndyHighDesireBonus(Number.NaN)).toBe(0);
    expect(proIndyHighDesireBonus(Number.POSITIVE_INFINITY)).toBe(0);
    expect(proIndyHighDesireBonus(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("clamps oversize desire values at the max band", () => {
    // Should not happen in practice (drift clamps to [0, 100]) but defensive.
    expect(proIndyHighDesireBonus(150)).toBeCloseTo(0.075, 5);
  });
});

describe("applyProIndyHighDesireBonus", () => {
  it("no-ops when desire is below 60", () => {
    const snp = cand("100");
    const con = cand("200");
    const before = { [snp._id.toString()]: 500, [con._id.toString()]: 500 };
    const result = applyProIndyHighDesireBonus({
      effectiveVotes: before,
      candidates: [snp, con],
      partyBySeq: map([snp.party, "uk_snp"], [con.party, "uk_conservative"]),
      desire: 59,
      region: "SCO",
    });
    expect(result.bonusApplied).toBe(0);
    expect(result.adjustedVotes).toEqual(before);
  });

  it("applies +1.5% only to pro-indy at desire=60 in SCO", () => {
    const snp = cand("100");
    const con = cand("200");
    const before = { [snp._id.toString()]: 500, [con._id.toString()]: 500 };
    const result = applyProIndyHighDesireBonus({
      effectiveVotes: before,
      candidates: [snp, con],
      partyBySeq: map([snp.party, "uk_snp"], [con.party, "uk_conservative"]),
      desire: 60,
      region: "SCO",
    });
    expect(result.bonusApplied).toBeCloseTo(0.015, 5);
    expect(result.adjustedVotes[snp._id.toString()]).toBeCloseTo(507.5, 5); // +1.5%
    expect(result.adjustedVotes[con._id.toString()]).toBe(500); // unchanged
  });

  it("stays at +1.5% across the 60–69 band (no interpolation)", () => {
    const snp = cand("100");
    const before = { [snp._id.toString()]: 1000 };
    const at60 = applyProIndyHighDesireBonus({
      effectiveVotes: before,
      candidates: [snp],
      partyBySeq: map([snp.party, "uk_snp"]),
      desire: 60,
      region: "SCO",
    });
    const at69 = applyProIndyHighDesireBonus({
      effectiveVotes: before,
      candidates: [snp],
      partyBySeq: map([snp.party, "uk_snp"]),
      desire: 69,
      region: "SCO",
    });
    expect(at60.adjustedVotes[snp._id.toString()]).toEqual(at69.adjustedVotes[snp._id.toString()]);
    expect(at60.bonusApplied).toBe(at69.bonusApplied);
  });

  it("applies +7.5% at desire=100", () => {
    const snp = cand("100");
    const result = applyProIndyHighDesireBonus({
      effectiveVotes: { [snp._id.toString()]: 1000 },
      candidates: [snp],
      partyBySeq: map([snp.party, "uk_snp"]),
      desire: 100,
      region: "SCO",
    });
    expect(result.bonusApplied).toBeCloseTo(0.075, 5);
    expect(result.adjustedVotes[snp._id.toString()]).toBeCloseTo(1075, 5);
  });

  it("targets uk_plaid in WAL", () => {
    const plaid = cand("100");
    const con = cand("200");
    const result = applyProIndyHighDesireBonus({
      effectiveVotes: { [plaid._id.toString()]: 200, [con._id.toString()]: 800 },
      candidates: [plaid, con],
      partyBySeq: map([plaid.party, "uk_plaid"], [con.party, "uk_conservative"]),
      desire: 80,
      region: "WAL",
    });
    expect(result.bonusApplied).toBeCloseTo(0.045, 5);
    expect(result.adjustedVotes[plaid._id.toString()]).toBeCloseTo(209, 5); // +4.5%
    expect(result.adjustedVotes[con._id.toString()]).toBe(800);
  });

  it("targets uk_sf in NIR with no rival penalty", () => {
    const sf = cand("100");
    const dup = cand("200");
    const uup = cand("300");
    const result = applyProIndyHighDesireBonus({
      effectiveVotes: {
        [sf._id.toString()]: 400,
        [dup._id.toString()]: 400,
        [uup._id.toString()]: 200,
      },
      candidates: [sf, dup, uup],
      partyBySeq: map([sf.party, "uk_sf"], [dup.party, "uk_dup"], [uup.party, "uk_uup"]),
      desire: 70,
      region: "NIR",
    });
    expect(result.bonusApplied).toBeCloseTo(0.03, 5);
    expect(result.adjustedVotes[sf._id.toString()]).toBeCloseTo(412, 5); // +3%
    expect(result.adjustedVotes[dup._id.toString()]).toBe(400); // unchanged
    expect(result.adjustedVotes[uup._id.toString()]).toBe(200); // unchanged
  });

  it("no-ops when no pro-indy candidate is running", () => {
    const con = cand("200");
    const before = { [con._id.toString()]: 1000 };
    const result = applyProIndyHighDesireBonus({
      effectiveVotes: before,
      candidates: [con],
      partyBySeq: map([con.party, "uk_conservative"]),
      desire: 100,
      region: "SCO",
    });
    expect(result.bonusApplied).toBe(0);
    expect(result.adjustedVotes).toEqual(before);
  });

  it("ignores unknown region", () => {
    const c = cand("100");
    const before = { [c._id.toString()]: 1000 };
    const result = applyProIndyHighDesireBonus({
      effectiveVotes: before,
      candidates: [c],
      partyBySeq: map([c.party, "uk_snp"]),
      desire: 100,
      region: "LON", // not a devolution region
    });
    expect(result.bonusApplied).toBe(0);
    expect(result.adjustedVotes).toEqual(before);
  });
});
