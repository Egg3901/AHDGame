import { describe, expect, it } from "vitest";
import { bankMayManageFunds, fundBankCharter, fundSponsorEligibility } from "./eligibility";

describe("fund sponsorship and bank charters", () => {
  it("treats a revoked charter as no charter, so the company sponsors like any financial corporation", () => {
    const revoked = { status: "revoked" as const, type: "investment" as const };
    expect(fundBankCharter(revoked)).toBeUndefined();
    expect(fundSponsorEligibility({ hasFinancialSector: true, bankCharter: revoked })).toBeNull();
  });

  it("keeps active banks on the bank rule and still blocks retail and failed charters", () => {
    const active = { status: "active" as const, type: "investment" as const };
    expect(fundBankCharter(active)).toBe(active);
    expect(fundSponsorEligibility({ hasFinancialSector: true, bankCharter: active })).toBeNull();
    expect(
      fundSponsorEligibility({
        hasFinancialSector: true,
        bankCharter: { status: "active", type: "retail" },
      })
    ).toMatch(/active investment or universal/);
    expect(
      fundSponsorEligibility({
        hasFinancialSector: true,
        bankCharter: { status: "failed", type: "investment" },
      })
    ).toMatch(/active investment or universal/);
    expect(bankMayManageFunds(fundBankCharter({ status: "revoked", type: "investment" }))).toBe(
      false
    );
  });

  it("still needs a financial sector", () => {
    expect(fundSponsorEligibility({ hasFinancialSector: false })).toMatch(/financial sector/);
  });
});
