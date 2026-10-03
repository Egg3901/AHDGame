/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MONEY_ACCOUNTING_VERSION } from "@/lib/moneySupply/calculate";
import type { MoneySupplyView } from "./centralBankTypes";
import messages from "../../../../../messages/en/centralBank.json";
import { CentralBankMoneySupplyTab } from "./CentralBankMoneySupplyTab";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key
      .split(".")
      .reduce<unknown>(
        (value, part) => (value as Record<string, unknown>)[part],
        messages.centralBank
      ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const data = {
  accountingVersion: MONEY_ACCOUNTING_VERSION,
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
    accountingVersion: MONEY_ACCOUNTING_VERSION,
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

it.each([undefined, 2, MONEY_ACCOUNTING_VERSION])(
  "preserves an unavailable growth observation for accounting version %s",
  (accountingVersion) => {
    render(
      <CentralBankMoneySupplyTab
        countryId="US"
        data={{
          ...data,
          accountingVersion,
          annualizedM2GrowthPct: null,
          bankDeposits: 33,
          bondPoolCash: 44,
          excludedBondPoolCash: 66,
          equityPoolCash: 55,
        }}
        canOperate={false}
        onChanged={() => {}}
      />
    );
    expect(screen.getByText("Collecting 12 turns of comparable data")).toBeTruthy();
    expect(screen.getByText("NPC bank deposits")).toBeTruthy();
    expect(screen.getByText("Bond market cash")).toBeTruthy();
    expect(screen.getByText("Bond settlement cash (outside M2)")).toBeTruthy();
    expect(screen.getByText("Equity market cash")).toBeTruthy();
  }
);

it.each(["liquidity_injection", "treasury_advance", "qe", "qt"])(
  "reuses a %s command after a network failure and renews it after success",
  async (type) => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network interrupted"))
      .mockResolvedValue({ ok: true, json: async () => ({ operation: { amount: 400 } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CentralBankMoneySupplyTab countryId="US" data={data} canOperate onChanged={() => {}} />
    );
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: type },
    });
    fireEvent.change(
      screen.getByPlaceholderText(type === "qe" || type === "qt" ? "Bond units" : "Amount (USD)"),
      { target: { value: "400" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /Execute operation/i }));
    await screen.findByText("Network interrupted");
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.operationId).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Execute operation/i }));
    await screen.findByText(new RegExp(`^${type.replaceAll("_", " ")} completed`, "i"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).operationId).toBe(firstBody.operationId);
    fireEvent.change(
      screen.getByPlaceholderText(type === "qe" || type === "qt" ? "Bond units" : "Amount (USD)"),
      { target: { value: "400" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /Execute operation/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).operationId).not.toBe(firstBody.operationId);
    await waitFor(() =>
      expect(
        (
          screen.getByPlaceholderText(
            type === "qe" || type === "qt" ? "Bond units" : "Amount (USD)"
          ) as HTMLInputElement
        ).value
      ).toBe("")
    );
  }
);
