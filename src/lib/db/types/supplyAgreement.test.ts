import { describe, expect, it } from "vitest";
import {
  SUPPLY_AGREEMENT_PRICE_BAND,
  clampAgreementPremium,
  isAgreementPremiumLegal,
} from "./supplyAgreement";

describe("supply agreement price band (±35%)", () => {
  it("accepts premiums inside the band", () => {
    expect(isAgreementPremiumLegal(0)).toBe(true);
    expect(isAgreementPremiumLegal(0.35)).toBe(true);
    expect(isAgreementPremiumLegal(-0.35)).toBe(true);
    expect(isAgreementPremiumLegal(0.2)).toBe(true);
  });
  it("rejects premiums outside the band", () => {
    expect(isAgreementPremiumLegal(0.36)).toBe(false);
    expect(isAgreementPremiumLegal(-0.5)).toBe(false);
    expect(isAgreementPremiumLegal(Number.NaN)).toBe(false);
  });
  it("clamps to the band", () => {
    expect(clampAgreementPremium(0.9)).toBe(SUPPLY_AGREEMENT_PRICE_BAND);
    expect(clampAgreementPremium(-0.9)).toBe(-SUPPLY_AGREEMENT_PRICE_BAND);
    expect(clampAgreementPremium(0.1)).toBeCloseTo(0.1, 10);
    expect(clampAgreementPremium(Number.NaN)).toBe(0);
  });
});
