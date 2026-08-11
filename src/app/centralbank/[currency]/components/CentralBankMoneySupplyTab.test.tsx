/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MoneySupplyView } from "./centralBankTypes";
import { CentralBankMoneySupplyTab } from "./CentralBankMoneySupplyTab";

afterEach(cleanup);

const data = {
  turn: 48,
  currencyCode: "USD",
  m1: 1_000,
  m2: 1_500,
  annualizedM2GrowthPct: 4.25,
  householdLiquid: 100,
  campaignLiquid: 50,
  nppLiquid: 75,
  corporateLiquid: 200,
  partyLiquid: 25,
  governmentLiquid: 300,
  fundLiquid: 100,
  organizationLiquid: 150,
  householdSavings: 250,
  externalBroadMoney: 250,
  bankReserves: 80,
  creditOutstanding: 400,
  sovereignBondsOutstanding: 2_000,
  centralBankBondHoldings: 200,
  netMoneyCreatedLifetime: 40,
  lastOperationTurn: 48,
  lastPolicyEvaluation: {
    turn: 48,
    decision: "qe",
    rationale: "Inflation is below target and growth is weak; support demand through QE",
    inflation: 0.5,
    targetInflation: 2,
    gdpGrowth: 0,
    annualizedM2GrowthPct: 4.25,
    moneyGrowthReliable: true,
    bankReserves: 80,
    gdp: 10_000,
  },
  operations: [
    {
      type: "qe",
      turn: 48,
      amount: 100,
      moneySupplyDelta: 100,
      reserveDelta: 0,
      actorName: "Federal Reserve Monetary Committee",
      reason: "Inflation is below target",
    },
  ],
  eligibleBonds: [
    {
      _id: "bond-1",
      issuerName: "United States Treasury",
      couponRate: 2.5,
      maturityTurn: 96,
      marketPrice: 1,
      publicFloat: 1_000,
      centralBankHoldings: 100,
    },
  ],
} as MoneySupplyView;

describe("CentralBankMoneySupplyTab", () => {
  it("surfaces economy-wide composition and the autonomous committee rationale", () => {
    render(
      <CentralBankMoneySupplyTab
        countryId="US"
        data={data}
        canOperate={false}
        onChanged={() => {}}
      />
    );

    expect(screen.getByText("M2 · spendable money plus savings")).toBeTruthy();
    expect(screen.getByText("International organization cash")).toBeTruthy();
    expect(screen.getByText(/support demand through QE/i)).toBeTruthy();
    expect(screen.getByText(/^qe$/i)).toBeTruthy();
  });

  it("shows all four policy tools to an authorized chair", () => {
    render(
      <CentralBankMoneySupplyTab countryId="US" data={data} canOperate onChanged={() => {}} />
    );

    expect(screen.getByRole("option", { name: /Buy government bonds \(QE\)/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Sell government bonds \(QT\)/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Lend directly to the Treasury/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Lend more to banks/i })).toBeTruthy();
  });
});
