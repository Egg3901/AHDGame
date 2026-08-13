import { describe, it, expect } from "vitest";
import {
  ARMS_LENGTH_TOLERANCE,
  TRANSFER_PRICING_AUDIT_THRESHOLD_ANCHOR,
  TRANSFER_PRICING_PENALTY_RATE,
  assessIfDue,
  isTransferPricingPosition,
  shiftDirection,
  type IntraGroupPosition,
} from "./transferPricing";

const position = (over: Partial<IntraGroupPosition> = {}): IntraGroupPosition => ({
  agreementId: "agreement-1",
  supplierCorpId: "supplier",
  buyerCorpId: "buyer",
  supplierCountryId: "US",
  buyerCountryId: "UK",
  pricePremium: 0.25,
  premiumAnchor: 1_000_000,
  ...over,
});

describe("isTransferPricingPosition", () => {
  it("recognises an off-market intra-group contract across a border", () => {
    expect(isTransferPricingPosition(position(), true)).toBe(true);
  });

  it("ignores a contract between unrelated corporations", () => {
    // Two strangers negotiating a premium is commerce, not a tax position.
    expect(isTransferPricingPosition(position(), false)).toBe(false);
  });

  it("ignores intra-group pricing inside one country", () => {
    // Same treasury on both sides: no base moves, and C4 group relief already
    // nets the two positions. Nothing to audit.
    expect(isTransferPricingPosition(position({ buyerCountryId: "US" }), true)).toBe(false);
  });

  it("ignores a price that is materially at market", () => {
    expect(isTransferPricingPosition(position({ pricePremium: ARMS_LENGTH_TOLERANCE }), true)).toBe(
      false
    );
    expect(
      isTransferPricingPosition(position({ pricePremium: -ARMS_LENGTH_TOLERANCE }), true)
    ).toBe(false);
    expect(
      isTransferPricingPosition(position({ pricePremium: ARMS_LENGTH_TOLERANCE + 0.001 }), true)
    ).toBe(true);
  });
});

describe("shiftDirection", () => {
  it("sends the profit to the supplier when the buyer overpays", () => {
    const shift = shiftDirection(position({ premiumAnchor: 1_000_000 }));
    expect(shift).toEqual({
      gainerCorpId: "supplier",
      claimantCountryId: "UK",
      shiftedBaseAnchor: 1_000_000,
    });
  });

  it("mirrors when the supplier underprices", () => {
    const shift = shiftDirection(position({ premiumAnchor: -1_000_000 }));
    expect(shift).toEqual({
      gainerCorpId: "buyer",
      claimantCountryId: "US",
      shiftedBaseAnchor: 1_000_000,
    });
  });

  it("returns nothing for a zero or malformed premium", () => {
    expect(shiftDirection(position({ premiumAnchor: 0 }))).toBeNull();
    expect(shiftDirection(position({ premiumAnchor: Number.NaN }))).toBeNull();
  });
});

describe("assessIfDue", () => {
  const base = {
    agreementId: "agreement-1",
    gainerCorpId: "supplier",
    claimantCountryId: "UK",
    effectiveTaxRate: 0.4,
  };

  it("does not fire below the published threshold", () => {
    expect(
      assessIfDue({
        ...base,
        accruedExposureAnchor: TRANSFER_PRICING_AUDIT_THRESHOLD_ANCHOR - 1,
      })
    ).toBeNull();
  });

  it("fires exactly at the threshold", () => {
    const assessment = assessIfDue({
      ...base,
      accruedExposureAnchor: TRANSFER_PRICING_AUDIT_THRESHOLD_ANCHOR,
    });
    expect(assessment).not.toBeNull();
  });

  it("charges the tax that was avoided plus a surcharge", () => {
    const exposure = 10_000_000;
    const assessment = assessIfDue({ ...base, accruedExposureAnchor: exposure })!;
    const avoidedTax = exposure * 0.4;
    expect(assessment.assessmentAnchor).toBe(
      Math.round(avoidedTax * (1 + TRANSFER_PRICING_PENALTY_RATE))
    );
    // The surcharge is what stops an audit being a free option: without it the
    // worst case is paying exactly the tax you owed anyway, later.
    expect(assessment.assessmentAnchor).toBeGreaterThan(avoidedTax);
  });

  it("assesses nothing where the claimant levies no corporate tax", () => {
    // A zero-rate jurisdiction lost no revenue, so it has no claim.
    expect(
      assessIfDue({ ...base, effectiveTaxRate: 0, accruedExposureAnchor: 50_000_000 })
    ).toBeNull();
  });

  it("names the gaining corporation as liable and the losing treasury as claimant", () => {
    const assessment = assessIfDue({ ...base, accruedExposureAnchor: 20_000_000 })!;
    expect(assessment.liableCorpId).toBe("supplier");
    expect(assessment.claimantCountryId).toBe("UK");
    expect(assessment.shiftedBaseAnchor).toBe(20_000_000);
  });

  it("is deterministic — the same position always assesses the same amount", () => {
    const runs = new Set(
      Array.from(
        { length: 20 },
        () => assessIfDue({ ...base, accruedExposureAnchor: 12_345_678 })!.assessmentAnchor
      )
    );
    expect(runs.size).toBe(1);
  });
});
