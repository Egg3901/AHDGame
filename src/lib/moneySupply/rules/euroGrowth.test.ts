import { describe, expect, it } from "vitest";
import { planEuroSettlement } from "@/lib/currency/euro/rules";
import { euroMoneyGrowth, type EuroMoneyObservation } from "./euroGrowth";
import { annualizedMoneyGrowthPct, MONEY_ACCOUNTING_VERSION } from "./calculate";

function union() {
  const result = planEuroSettlement({
    year: 1999,
    turn: 100,
    preset: "1991-default",
    europeanMembers: ["DE", "IE", "UK"],
    consentedCountries: ["DE", "IE", "UK"],
    rates: { EUR: 1, IEP: 0.5, GBP: 0.8 },
  }).union;
  if (!result) throw new Error("Expected settled union");
  return result;
}
function rows(): EuroMoneyObservation[] {
  return [100, 112].flatMap((turn) =>
    [
      { currencyCode: "EUR" as const, m2: turn === 100 ? 100 : 110 },
      { currencyCode: "IEP" as const, m2: 50 },
      { currencyCode: "GBP" as const, m2: 80 },
    ].map((row) => ({ ...row, turn, accountingVersion: MONEY_ACCOUNTING_VERSION }))
  );
}

describe("comparable common-area broad money", () => {
  it("normalizes stocks at locked ratios instead of averaging national growth", () => {
    expect(euroMoneyGrowth(union(), rows(), 112)).toBeCloseTo(
      annualizedMoneyGrowthPct(300, 310, 12)!
    );
  });
  it("does not treat transfers between member ledgers as money creation", () => {
    const observations = rows();
    observations.find((row) => row.turn === 112 && row.currencyCode === "IEP")!.m2 = 45;
    expect(euroMoneyGrowth(union(), observations, 112)).toBe(0);
  });
  it("waits for a complete post-accession comparison window", () => {
    const settlement = union();
    settlement.members.UK!.joinedTurn = 105;
    expect(euroMoneyGrowth(settlement, rows(), 112)).toBeNull();
  });
  it.each(["missing", "old-method", "invalid", "duplicate"])(
    "rejects %s observations",
    (problem) => {
      const observations = rows();
      if (problem === "missing") observations.pop();
      if (problem === "old-method")
        observations[5].accountingVersion = MONEY_ACCOUNTING_VERSION - 1;
      if (problem === "invalid") observations[5].m2 = Number.NaN;
      if (problem === "duplicate") observations.push({ ...observations[5] });
      expect(euroMoneyGrowth(union(), observations, 112)).toBeNull();
    }
  );
  it("does not act on a stale complete observation", () => {
    expect(euroMoneyGrowth(union(), rows(), 114)).toBeNull();
  });
  it("counts a shared EUR ledger once", () => {
    const settlement = union();
    settlement.members.IE!.ledgerCurrency = "EUR";
    settlement.members.IE!.ledgerUnitsPerAnchorUnit = 1;
    const observations = rows().filter((row) => row.currencyCode !== "IEP");
    expect(euroMoneyGrowth(settlement, observations, 112)).toBeCloseTo(
      annualizedMoneyGrowthPct(200, 210, 12)!
    );
  });
});
