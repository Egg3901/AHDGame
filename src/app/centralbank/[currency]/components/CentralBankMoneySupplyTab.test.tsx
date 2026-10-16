/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MONEY_ACCOUNTING_VERSION } from "@/lib/moneySupply/calculate";
import type { MoneySupplyView } from "./centralBankTypes";
import messages from "../../../../../messages/en/centralBank.json";
import { CentralBankMoneySupplyTab } from "./CentralBankMoneySupplyTab";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values: Record<string, string | number> = {}) => {
      const message = key
        .split(".")
        .reduce<unknown>(
          (value, part) => (value as Record<string, unknown>)[part],
          messages.centralBank
        );
      return String(message).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
    },
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
      { target: { value: "40" } }
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
      { target: { value: "40" } }
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

it("shows non-par bond quotes and whole-order totals in native currency without a dealer spread", () => {
  render(
    <CentralBankMoneySupplyTab
      countryId="US"
      data={{
        ...data,
        currencyCode: "GBP",
        eligibleBonds: [{ ...data.eligibleBonds[0], marketPrice: 0.912346 }],
      }}
      canOperate
      onChanged={() => {}}
    />
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: "Bond units" }), {
    target: { value: "3" },
  });
  const quote = within(screen.getByRole("group", { name: "Bond quote (GBP)" }));
  expect(quote.getByText("Face value per unit")).toBeTruthy();
  expect(quote.getByText("£1,000.00")).toBeTruthy();
  expect(quote.getByText("Current market price per unit")).toBeTruthy();
  expect(quote.getByText("£912.35")).toBeTruthy();
  expect(quote.getByText("Order face value")).toBeTruthy();
  expect(quote.getByText("£3,000.00")).toBeTruthy();
  expect(quote.getByText("Estimated total consideration")).toBeTruthy();
  expect(quote.getByText("£2,737.04")).toBeTruthy();
  expect(screen.getByText(/Indicative estimate.*rechecked by the server/)).toBeTruthy();
});

it("uses the existing minimum market-price multiplier for the indicative estimate", () => {
  render(
    <CentralBankMoneySupplyTab
      countryId="US"
      data={{ ...data, eligibleBonds: [{ ...data.eligibleBonds[0], marketPrice: 0.001 }] }}
      canOperate
      onChanged={() => {}}
    />
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: "Bond units" }), {
    target: { value: "3" },
  });
  const quote = within(screen.getByRole("group", { name: "Bond quote (USD)" }));
  expect(quote.getByText("$10.00")).toBeTruthy();
  expect(quote.getByText("$30.00")).toBeTruthy();
});

it("switches from public float to central-bank holdings and blocks QT with no holdings", () => {
  const props = { countryId: "US" as const, data, canOperate: true, onChanged: () => {} };
  const { rerender } = render(<CentralBankMoneySupplyTab {...props} />);
  const quantity = screen.getByRole("spinbutton", { name: "Bond units" });
  fireEvent.change(quantity, { target: { value: "101" } });
  expect(screen.getByText("Units available to buy: 1,000")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Execute operation" }).hasAttribute("disabled")).toBe(
    false
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Operation type" }), {
    target: { value: "qt" },
  });
  expect(screen.getByText("Units available to sell: 100")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Execute operation" }).hasAttribute("disabled")).toBe(
    true
  );
  fireEvent.change(quantity, { target: { value: "100" } });
  expect(screen.getByRole("button", { name: "Execute operation" }).hasAttribute("disabled")).toBe(
    false
  );
  rerender(
    <CentralBankMoneySupplyTab
      {...props}
      data={{ ...data, eligibleBonds: [{ ...data.eligibleBonds[0], centralBankHoldings: 0 }] }}
    />
  );
  expect(screen.getByText("Units available to sell: 0")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Execute operation" }).hasAttribute("disabled")).toBe(
    true
  );
});

it("handles no eligible bonds while keeping amount operations available", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <CentralBankMoneySupplyTab
      countryId="US"
      data={{ ...data, eligibleBonds: [], lastOperationTurn: null }}
      canOperate
      onChanged={() => {}}
    />
  );
  expect(screen.getByText("No eligible bond series available.")).toBeTruthy();
  const button = screen.getByRole("button", { name: "Execute operation" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.submit(button.closest("form")!);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByText(/No previous monetary operation\./)).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Operation type" }), {
    target: { value: "treasury_advance" },
  });
  expect(screen.queryByRole("combobox", { name: "Bond series" })).toBeNull();
  expect(screen.getByRole("spinbutton", { name: "Amount (USD)" })).toBeTruthy();
  expect(button.hasAttribute("disabled")).toBe(false);
});

it("distinguishes series sharing the same issuer, coupon and maturity", () => {
  render(
    <CentralBankMoneySupplyTab
      countryId="US"
      data={{
        ...data,
        eligibleBonds: [data.eligibleBonds[0], { ...data.eligibleBonds[0], _id: "bond-2" }],
      }}
      canOperate
      onChanged={() => {}}
    />
  );
  const series = within(screen.getByRole("combobox", { name: "Bond series" }));
  expect(
    series.getByRole("option", { name: "United States Treasury · 2.50% · turn 96 · Series bond-1" })
  ).toBeTruthy();
  expect(
    series.getByRole("option", { name: "United States Treasury · 2.50% · turn 96 · Series bond-2" })
  ).toBeTruthy();
});

it.each(["qe", "qt"])(
  "guards %s submissions against invalid quantities even when the form is submitted directly",
  (type) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CentralBankMoneySupplyTab countryId="US" data={data} canOperate onChanged={() => {}} />
    );
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: type } });
    const input = screen.getByPlaceholderText("Bond units");
    const button = screen.getByRole("button", { name: "Execute operation" });
    for (const value of ["", "0", "-1", "1.5", "1001", "Infinity", "NaN", "1e309"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(button.closest("form")!);
      expect(fetchMock, value).not.toHaveBeenCalled();
      expect(button.hasAttribute("disabled"), value).toBe(true);
    }
  }
);

it("requires a new explicit selection when refreshed data removes the selected series", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const props = { countryId: "US" as const, data, canOperate: true, onChanged: () => {} };
  const { rerender } = render(<CentralBankMoneySupplyTab {...props} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Bond units" }), {
    target: { value: "2" },
  });
  rerender(
    <CentralBankMoneySupplyTab
      {...props}
      data={{
        ...data,
        eligibleBonds: [
          { ...data.eligibleBonds[0], _id: "bond-2", marketPrice: 0.9, publicFloat: 1 },
        ],
      }}
    />
  );
  const select = screen.getByRole("combobox", { name: "Bond series" }) as HTMLSelectElement;
  const button = screen.getByRole("button", { name: "Execute operation" });
  expect(select.value).toBe("");
  expect(screen.getByText("Choose a bond series")).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Bond quote (USD)" })).toBeNull();
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.submit(button.closest("form")!);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.change(select, { target: { value: "bond-2" } });
  expect(screen.getByText("Units available to buy: 1")).toBeTruthy();
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Bond units" }), {
    target: { value: "1" },
  });
  expect(screen.getAllByText("$900.00")).toHaveLength(2);
  expect(button.hasAttribute("disabled")).toBe(false);
});

it("refreshes the quote and rejects an order exceeding the refreshed availability", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const props = { countryId: "US" as const, data, canOperate: true, onChanged: () => {} };
  const { rerender } = render(<CentralBankMoneySupplyTab {...props} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Bond units" }), {
    target: { value: "3" },
  });
  rerender(
    <CentralBankMoneySupplyTab
      {...props}
      data={{
        ...data,
        eligibleBonds: [{ ...data.eligibleBonds[0], marketPrice: 0.8, publicFloat: 2 }],
      }}
    />
  );
  expect(screen.getByText("Units available to buy: 2")).toBeTruthy();
  expect(screen.getByText("$800.00")).toBeTruthy();
  const button = screen.getByRole("button", { name: "Execute operation" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.submit(button.closest("form")!);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("explains the lagged transmission and standard cooldown without adding a cooldown gate", () => {
  render(<CentralBankMoneySupplyTab countryId="US" data={data} canOperate onChanged={() => {}} />);
  expect(screen.getByText(/QE creates bond-market cash and supports bond prices/)).toBeTruthy();
  expect(
    screen.getByText(/Inflation responds to lagged M2 growth after comparable observations/)
  ).toBeTruthy();
  expect(
    screen.getByText(
      /Real growth depends on subsequent spending, investment and output and is not guaranteed/
    )
  ).toBeTruthy();
  expect(screen.getByText(/Last operation: turn 48\./)).toBeTruthy();
  expect(screen.getByText(/Standard cooldown: 6 turns.*Administrators can bypass/)).toBeTruthy();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Bond units" }), {
    target: { value: "1" },
  });
  expect(screen.getByRole("button", { name: "Execute operation" }).hasAttribute("disabled")).toBe(
    false
  );
});

it("uses a new operation identity when a failed request is changed", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("Network interrupted"));
  vi.stubGlobal("fetch", fetchMock);
  render(<CentralBankMoneySupplyTab countryId="US" data={data} canOperate onChanged={() => {}} />);
  const input = screen.getByRole("spinbutton", { name: "Bond units" });
  fireEvent.change(input, { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Execute operation" }));
  await screen.findByText("Network interrupted");
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Execute operation" }));
  await screen.findByText("Network interrupted");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  const changed = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(first.units).toBe(2);
  expect(changed.units).toBe(3);
  expect(changed.operationId).not.toBe(first.operationId);
});
