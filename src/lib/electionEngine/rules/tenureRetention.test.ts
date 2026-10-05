import { describe, expect, it } from "vitest";
import { personalStatTenureRetention } from "../electionFormulaFactors";
import { personalStatTenureRetentionForCandidate } from "./tenureRetention";

describe("personalStatTenureRetentionForCandidate", () => {
  it("selects the executive's held-term count by incumbent party", () => {
    const context = { executivePartyId: "A", executiveConsecutiveTerms: 6 };
    expect(
      personalStatTenureRetentionForCandidate({ candidateId: "a", partyId: "A" }, context)
    ).toBe(personalStatTenureRetention(6));
    expect(
      personalStatTenureRetentionForCandidate({ candidateId: "b", partyId: "B" }, context)
    ).toBe(1);
  });

  it("normalizes the Senate sought-term count to terms already held", () => {
    expect(
      personalStatTenureRetentionForCandidate(
        { candidateId: "senator", partyId: "A" },
        { legislativePartyId: "A", legislativeTenureTermsSought: 7 }
      )
    ).toBe(personalStatTenureRetention(6));
  });

  it("selects House tenure by election candidate ID and leaves new nominees neutral", () => {
    const context = { houseTenureTermsByCandidateId: new Map([["house-a", 6]]) };
    expect(
      personalStatTenureRetentionForCandidate({ candidateId: "house-a", partyId: "A" }, context)
    ).toBe(personalStatTenureRetention(6));
    expect(
      personalStatTenureRetentionForCandidate({ candidateId: "house-b", partyId: "A" }, context)
    ).toBe(1);
  });
});
