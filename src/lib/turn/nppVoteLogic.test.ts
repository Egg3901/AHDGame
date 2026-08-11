import { describe, it, expect } from "vitest";
import { calculateBaseVote, calculateWhippedVote } from "./nppVoteLogic";
import type { NPP, Bill } from "@/lib/db/types";
import { ObjectId } from "mongodb";

// Helper to create minimal NPP for testing
function createTestNPP(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "CA",
    party: "democrat",
    politicalInfluence: 50,
    favorability: 50,
    policies: {
      economic: 0,
      social: 0,
      domainPositions: {},
    },
    currentOffice: null,
    personality: {
      loyalty: 50,
      ambition: 50,
      stubbornness: 50,
    },
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Helper to create minimal Bill for testing
function createTestBill(overrides: Partial<Bill> = {}): Bill {
  return {
    _id: new ObjectId(),
    title: "Test Bill",
    summary: "A test bill",
    status: "active",
    originChamber: "house",
    currentChamber: "house",
    sponsorId: null,
    sponsorName: "Test Sponsor",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    proposedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Bill;
}

describe("calculateBaseVote", () => {
  it("should return abstain when random falls below abstain chance", () => {
    const npp = createTestNPP({ personality: { loyalty: 0, ambition: 50, stubbornness: 50 } });
    const bill = createTestBill();

    // With loyalty=0, abstainChance = max(0.05, (1-0)*0.25) = 0.25
    // Random = 0.1 < 0.25 should abstain
    const result = calculateBaseVote(npp, bill, () => 0.1);
    expect(result).toBe("abstain");
  });

  it("should return for when random favors support", () => {
    const npp = createTestNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 50 } });
    const bill = createTestBill();

    // With loyalty=100, abstainChance = max(0.05, 0) = 0.05
    // supportChance base = 0.5
    // Random = 0.06 (past abstain), normalized = (0.06-0.05)/(1-0.05) ≈ 0.01 < 0.5
    const result = calculateBaseVote(npp, bill, () => 0.06);
    expect(result).toBe("for");
  });

  it("should return against when random disfavors support", () => {
    const npp = createTestNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 50 } });
    const bill = createTestBill();

    // Random = 0.9, normalized = (0.9-0.05)/(1-0.05) ≈ 0.89 > 0.5
    const result = calculateBaseVote(npp, bill, () => 0.9);
    expect(result).toBe("against");
  });

  it("should bias toward support when NPP aligns with bill direction", () => {
    const npp = createTestNPP({
      personality: { loyalty: 100, ambition: 50, stubbornness: 50 },
      policies: { economic: 0, social: 0, domainPositions: { "tax-policy": 5 } },
    });
    const bill = createTestBill({
      legislationTypeId: "tax-policy",
      effectDirection: 1, // Positive direction
    });

    // NPP position = 5, effectDirection = 1
    // alignment = (5/5) * 1 = 1
    // supportChance = 0.5 + 1 * 0.35 = 0.85
    // Random 0.8 normalized ≈ 0.79 < 0.85 should support
    const result = calculateBaseVote(npp, bill, () => 0.8);
    expect(result).toBe("for");
  });
});

describe("calculateWhippedVote", () => {
  it("should follow whip when compliance check passes", () => {
    const npp = createTestNPP({
      personality: { loyalty: 100, ambition: 50, stubbornness: 0 },
    });
    const bill = createTestBill();
    const whip = { direction: "for" as const };

    // compliance = (100/100)*0.7 + (1-0/100)*0.3 = 0.7 + 0.3 = 1.0
    // Random 0.5 < 1.0, should comply
    const result = calculateWhippedVote(npp, bill, whip, () => 0.5);
    expect(result).toBe("for");
  });

  it("should ignore whip when compliance check fails", () => {
    const npp = createTestNPP({
      personality: { loyalty: 0, ambition: 50, stubbornness: 100 },
    });
    const bill = createTestBill();
    const whip = { direction: "for" as const };

    // compliance = (0/100)*0.7 + (1-100/100)*0.3 = 0 + 0 = 0
    // Random 0.5 > 0, should NOT comply, falls back to base vote
    // Base vote with random 0.5: abstainChance = 0.25, 0.5 > 0.25
    // normalized = (0.5-0.25)/(1-0.25) = 0.33 < 0.5, returns "for"
    const result = calculateWhippedVote(npp, bill, whip, () => 0.5);
    expect(result).toBe("for"); // Base vote happens to be "for" too
  });

  it("should return base vote when non-compliant (whip differs from base)", () => {
    const npp = createTestNPP({
      personality: { loyalty: 10, ambition: 50, stubbornness: 95 },
    });
    const bill = createTestBill();
    const whip = { direction: "against" as const };

    // compliance = (10/100)*0.7 + (1-95/100)*0.3 = 0.07 + 0.015 = 0.085
    // Random 0.5 > 0.085, should NOT comply
    // For base vote, use random value that produces "for"
    // abstainChance = max(0.05, (1-10/100)*0.25) = max(0.05, 0.225) = 0.225
    // Random 0.3 > 0.225, so past abstain check
    // normalized = (0.3-0.225)/(1-0.225) ≈ 0.097 < 0.5, returns "for"
    const result = calculateWhippedVote(npp, bill, whip, () => 0.3);
    expect(result).toBe("for"); // Base vote "for", NOT whip "against"
  });

  it("should return base vote when no whip provided", () => {
    const npp = createTestNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 50 } });
    const bill = createTestBill();

    const result = calculateWhippedVote(npp, bill, null, () => 0.06);
    expect(result).toBe("for");
  });
});
