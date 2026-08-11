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
