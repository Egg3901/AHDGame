import { describe, it, expect } from "vitest";
import type { NPP } from "@/lib/db/types";
import {
  identifyOppositionParty,
  computeOppositionVoteForce,
  OPPOSITION_BIAS_BASE,
} from "../oppositionBehavior";

function npp(over: Partial<NPP>): NPP {
  return {
    party: "3",
    personality: { loyalty: 100, stubbornness: 0, ambition: 50 },
    ...over,
  } as NPP;
}

describe("identifyOppositionParty", () => {
  it("returns the largest non-governing party", () => {
    const opp = identifyOppositionParty({ "1": 120, "2": 90, "3": 30 }, "1");
    expect(opp).toEqual({ partyId: "2", seats: 90 });
  });

  it("breaks ties on the lower party id, deterministically", () => {
    const opp = identifyOppositionParty({ "1": 100, "4": 50, "2": 50 }, "1");
    expect(opp?.partyId).toBe("2");
  });

  it("returns null when only the governing party has seats", () => {
    expect(identifyOppositionParty({ "1": 100 }, "1")).toBeNull();
  });
});

describe("computeOppositionVoteForce", () => {
  const params = { sponsorParty: "1", governingPartyId: "1", oppositionPartyId: "2" };

  it("opposes a government bill when the voter is in the opposition party", () => {
    const force = computeOppositionVoteForce(npp({ party: "2" }), params);
    // Full-compliance opposition NPP (loyalty 100, stubbornness 0) → full bias.
    expect(force).toBe(-OPPOSITION_BIAS_BASE);
  });

  it("scales the opposition by compliance (low loyalty opposes weakly)", () => {
    const strong = computeOppositionVoteForce(
      npp({ party: "2", personality: { loyalty: 100, stubbornness: 0, ambition: 50 } }),
      params
    );
    const weak = computeOppositionVoteForce(
      npp({ party: "2", personality: { loyalty: 0, stubbornness: 100, ambition: 50 } }),
      params
    );
    expect(Math.abs(weak)).toBeLessThan(Math.abs(strong));
  });

  it("does not oppose for a co-governing NPP, or for a non-government bill", () => {
    expect(computeOppositionVoteForce(npp({ party: "1" }), params)).toBe(0);
    expect(computeOppositionVoteForce(npp({ party: "2" }), { ...params, sponsorParty: "2" })).toBe(
      0
    );
  });
});

describe("computeOppositionVoteForce — difficulty coordination", () => {
  const oppositionNpp = {
    party: "2",
    personality: { loyalty: 100, ambition: 50, stubbornness: 50 },
  } as unknown as NPP;
  const params = { sponsorParty: "1", governingPartyId: "1", oppositionPartyId: "2" };

  it("an omitted multiplier is the shipped bias exactly", () => {
    expect(computeOppositionVoteForce(oppositionNpp, params)).toBe(
      computeOppositionVoteForce(oppositionNpp, { ...params, coordination: 1 })
    );
  });

  it("a disciplined opposition opposes harder, a loose one more weakly", () => {
    const loose = computeOppositionVoteForce(oppositionNpp, { ...params, coordination: 0.6 });
    const shipped = computeOppositionVoteForce(oppositionNpp, { ...params, coordination: 1 });
    const disciplined = computeOppositionVoteForce(oppositionNpp, {
      ...params,
      coordination: 1.35,
    });
    // Forces are negative: more negative is stronger opposition.
    expect(loose).toBeGreaterThan(shipped);
    expect(disciplined).toBeLessThan(shipped);
  });

  it("clamps an out-of-range multiplier instead of scaling by it", () => {
    expect(computeOppositionVoteForce(oppositionNpp, { ...params, coordination: 99 })).toBe(
      computeOppositionVoteForce(oppositionNpp, { ...params, coordination: 1.5 })
    );
    expect(computeOppositionVoteForce(oppositionNpp, { ...params, coordination: 0 })).toBe(
      computeOppositionVoteForce(oppositionNpp, { ...params, coordination: 0.5 })
    );
  });

  it("cannot conscript a non-opposition NPP at any coordination", () => {
    const governmentNpp = { ...oppositionNpp, party: "1" } as unknown as NPP;
    expect(computeOppositionVoteForce(governmentNpp, { ...params, coordination: 1.5 })).toBe(0);
  });
});
