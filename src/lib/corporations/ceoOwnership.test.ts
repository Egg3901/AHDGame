import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { ceoOwnershipFraction, insiderConcentrationPenaltyApplies } from "./ceoOwnership";

const ceoId = new ObjectId();

function corp(overrides: Record<string, unknown> = {}) {
  return {
    ceoType: "character",
    ceoId,
    totalShares: 1000,
    shareholders: [{ characterId: ceoId, shares: 700 }],
    ...overrides,
  };
}

describe("ceoOwnershipFraction", () => {
  it("returns the CEO's share of totalShares", () => {
    expect(ceoOwnershipFraction(corp())).toBeCloseTo(0.7);
  });

  it("returns 0 for NPP and imperial CEOs", () => {
    expect(ceoOwnershipFraction(corp({ ceoType: "npp" }))).toBe(0);
    expect(ceoOwnershipFraction(corp({ ceoType: "imperial" }))).toBe(0);
  });

  it("returns 0 when the CEO holds no position", () => {
    expect(ceoOwnershipFraction(corp({ shareholders: [] }))).toBe(0);
  });

  it("returns 0 rather than dividing by zero on a corp with no shares", () => {
    expect(ceoOwnershipFraction(corp({ totalShares: 0 }))).toBe(0);
  });
});

describe("insiderConcentrationPenaltyApplies", () => {
  it("applies above 65% on a public corp", () => {
    expect(insiderConcentrationPenaltyApplies(corp())).toBe(true);
  });

  it("does not apply at or below the threshold", () => {
    expect(
      insiderConcentrationPenaltyApplies(
        corp({ shareholders: [{ characterId: ceoId, shares: 650 }] })
      )
    ).toBe(false);
  });

  it("never applies to a private corp", () => {
    expect(insiderConcentrationPenaltyApplies(corp({ isPrivate: true }))).toBe(false);
  });
});
