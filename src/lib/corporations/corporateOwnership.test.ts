import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  acquirerOwnershipPercent,
  getControllingCorporateParent,
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT,
  SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT,
} from "./corporateOwnership";

function baseCorp(over: Partial<Corporation> = {}): Corporation {
  const id = new ObjectId();
  return {
    _id: id,
    name: "Test",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    countryId: "US",
    headquartersState: "CA",
    liquidCapital: 0,
    marketingBudget: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    totalShares: 100,
    sharePrice: 10,
    shareholders: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Corporation;
}

describe("getControllingCorporateParent", () => {
  it("returns parent when one corp holds >50%", () => {
    const parentId = new ObjectId();
    const c = baseCorp({
      totalShares: 100,
      shareholders: [{ corporationId: parentId, shares: 60 }],
    });
    const r = getControllingCorporateParent(c);
    expect(r?.corporationId.equals(parentId)).toBe(true);
    expect(r?.ownershipPct).toBe(60);
  });

  it("returns null at exactly 50%", () => {
    const parentId = new ObjectId();
    const c = baseCorp({
      totalShares: 100,
      shareholders: [{ corporationId: parentId, shares: 50 }],
    });
    expect(getControllingCorporateParent(c)).toBeNull();
  });
});

describe("acquirerOwnershipPercent", () => {
  it("matches subsidiary and takeover thresholds constants", () => {
    expect(SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT).toBe(50);
    expect(HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT).toBe(75);
    const acquirer = new ObjectId();
    const c = baseCorp({
      totalShares: 1000,
      shareholders: [{ corporationId: acquirer, shares: 800 }],
    });
    expect(acquirerOwnershipPercent(acquirer, c)).toBeCloseTo(80, 5);
  });
});
