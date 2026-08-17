import { describe, expect, it } from "vitest";
import { GAP_TURNS, defect, estimateGapCredit } from "./AHD-1102-uk-vat-revenue-gap";

const TURNS_PER_YEAR = 48;

describe("AHD-1102 gap credit estimate", () => {
  it("extrapolates per-turn revenue from the post-fix snapshot", () => {
    // The real UK:FY1957 figures.
    const snapshot = {
      _id: "UK:FY1957",
      budget: { revenue: { salesTax: 288_707_890.95, tariffs: 63_999_299.81 } },
    };
    const expected = Math.round(((288_707_890.95 + 63_999_299.81) / TURNS_PER_YEAR) * GAP_TURNS);
    expect(estimateGapCredit(snapshot, GAP_TURNS)).toBe(expected);
    // Sanity on the order of magnitude so a future refactor cannot quietly
    // turn this into a billion.
    expect(estimateGapCredit(snapshot, GAP_TURNS)).toBeGreaterThan(400_000_000);
    expect(estimateGapCredit(snapshot, GAP_TURNS)).toBeLessThan(600_000_000);
  });

  it("credits nothing when the reference snapshot shows no revenue", () => {
    expect(
      estimateGapCredit(
        { _id: "UK:FY1957", budget: { revenue: { salesTax: 0, tariffs: 0 } } },
        GAP_TURNS
      )
    ).toBe(0);
  });

  it("credits nothing when the snapshot is missing entirely", () => {
    expect(estimateGapCredit(null, GAP_TURNS)).toBe(0);
  });

  it("credits nothing for a zero-length gap", () => {
    const snapshot = { _id: "UK:FY1957", budget: { revenue: { salesTax: 1_000, tariffs: 0 } } };
    expect(estimateGapCredit(snapshot, 0)).toBe(0);
  });
});

describe("AHD-1102 defect registration", () => {
  it("declares that it mints money and therefore drops the money-conserving guard", () => {
    // This heal recreates revenue that was never collected. Saying so is what
    // lets the runner allow a non-zero moneyDelta instead of refusing it.
    expect(defect.mintsMoney).toBe(true);
    expect(defect.guards).not.toContain("money-conserving");
  });

  it("is idempotent and capped at the single UK budget document", () => {
    expect(defect.idempotent).toBe(true);
    expect(defect.guards).toContain("max-affected:1");
    expect(defect.guards).toContain("turn-lock-free");
  });

  it("pins the code fix so it cannot heal an environment the fix has not reached", () => {
    expect(defect.codeFix?.requiredCommit).toBe("c36e18dda9c8edb4af735619eb605a75a622326e");
  });

  it("answers the seed question rather than leaving it unknown", () => {
    expect(defect.seedFix.status).toBe("not-needed");
    expect(defect.seedFix.note).toBeTruthy();
  });
});
