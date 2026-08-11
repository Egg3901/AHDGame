"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import {
  CURRENCY_SYMBOLS,
  FOREX_ACTIVE_CURRENCIES,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { formatCompactNumber } from "@/lib/utils/formatters";
import { RESERVE_POOL_TRANSFER_MAX_FRACTION } from "@/lib/centralBank/reservePoolTransfer";
import type { BalanceSheet, BankFinancials } from "./centralBankTypes";
import { formatNativeCurrency } from "./centralBankUtils";

function Row({
  label,
  amount,
  note,
  highlight,
  fmt,
}: {
  label: string;
  amount: number;
  note?: string;
  highlight?: "success" | "warning" | "error";
  fmt: (n: number) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-card-border/50 last:border-0">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
      <span
        className={`tabular-nums text-sm font-semibold ${
          highlight === "success"
            ? "text-success"
            : highlight === "warning"
              ? "text-warning"
              : highlight === "error"
                ? "text-error"
                : "text-foreground"
        }`}
      >
        {fmt(amount)}
      </span>
    </div>
  );
}

function IncomeRow({
  label,
  amount,
  note,
  tone,
  fmt,
}: {
  label: string;
  amount: number;
  note?: string;
  tone?: "expense" | "income" | "neutral";
  fmt: (n: number) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-card-border/50 last:border-0">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
      <span
        className={`tabular-nums text-sm font-semibold ${
          tone === "expense" ? "text-error" : tone === "income" ? "text-success" : "text-foreground"
        }`}
      >
        {tone === "expense" ? "−" : tone === "income" ? "+" : ""}
        {fmt(Math.abs(amount))}
      </span>
    </div>
  );
}

type ReserveEntry = BalanceSheet["reservePortfolio"]["entries"][number];

function resolveDisplayPreferenceLabel(
  preference: string,
  viewerHomeCurrency: CurrencyCode,
  centralBankHomeCurrency: CurrencyCode
): { label: string; differsFromBankHome: boolean } {
  if (preference === "internal") return { label: "Base", differsFromBankHome: true };
  if (preference === "local") {
    return { label: centralBankHomeCurrency, differsFromBankHome: false };
  }
  if (preference === "home") {
    return {
      label: viewerHomeCurrency,
      differsFromBankHome: viewerHomeCurrency !== centralBankHomeCurrency,
    };
  }
  const pinned = preference as CurrencyCode;
  return { label: pinned, differsFromBankHome: pinned !== centralBankHomeCurrency };
}

const PIE_COLORS = [
  "var(--primary)",
  "var(--secondary)",
  "var(--success)",
  "var(--warning)",
  "var(--gold)",
  "var(--info)",
];

function buildPieGradient(entries: ReserveEntry[]): string {
  const total = entries.reduce((sum, entry) => sum + entry.valueInHomeCurrency, 0);
  if (total <= 0) return "var(--card-elevated)";

  let cursor = 0;
  const segments = entries.map((entry, index) => {
    const start = cursor;
    const end = cursor + (entry.valueInHomeCurrency / total) * 100;
    cursor = end;
    return `${PIE_COLORS[index % PIE_COLORS.length]} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `conic-gradient(${segments.join(", ")})`;
}

function ReservePortfolioPanel({
  countryId,
  balanceSheet,
  canExchange,
  onChanged,
}: {
  countryId: CountryId;
  balanceSheet: BalanceSheet;
  canExchange: boolean;
  onChanged: () => void;
}) {
  const {
    currencyCode: viewerHomeCurrency,
    displayCurrencyPreference,
    formatAmount,
    forexRates,
    toInternalFrom,
  } = useCurrency();
  const { homeCurrency, reservePortfolio } = balanceSheet;
  const { label: displayLabel, differsFromBankHome } = resolveDisplayPreferenceLabel(
    displayCurrencyPreference,
    viewerHomeCurrency,
    homeCurrency
  );
  const canShowDisplayPreference = differsFromBankHome && !!forexRates;
  const valueForDisplay = (homeValue: number) =>
    canShowDisplayPreference && displayCurrencyPreference === "internal"
      ? `Base ${formatCompactNumber(toInternalFrom(homeValue, homeCurrency))}`
      : canShowDisplayPreference
        ? formatAmount(toInternalFrom(homeValue, homeCurrency), homeCurrency)
        : formatNativeCurrency(homeValue, homeCurrency);
  const valueColumnLabel = canShowDisplayPreference
    ? `Value (${displayLabel})`
    : `Value (${homeCurrency})`;

  // Two distinct pools. Only the FX (spread-fee) reserves are exchangeable; the
  // home lending reserve backs LOC capacity and is shown separately — never as a
  // sell option (it would otherwise dominate the mix and offer balances the
  // reserve-exchange route rejects). A home-currency spread reserve, if any, is
  // a real exchangeable FX balance and is folded into the FX pool.
  const lendingReserve = reservePortfolio.homeReserveBalance;
  const homeSpreadReserve = reservePortfolio.spreadFeeReserveBalances?.[homeCurrency] ?? 0;
  const fxEntries = [
    ...reservePortfolio.foreignEntries,
    ...(homeSpreadReserve > 0
      ? [
          {
            currencyCode: homeCurrency,
            balance: homeSpreadReserve,
            valueInHomeCurrency: homeSpreadReserve,
            shareOfSpreadFeeReserves: 0,
          },
        ]
      : []),
  ]
    .filter((entry) => entry.balance > 0)
    .sort((a, b) => b.valueInHomeCurrency - a.valueInHomeCurrency);
  const allEntries = fxEntries;
  const totalValue = fxEntries.reduce((sum, entry) => sum + entry.valueInHomeCurrency, 0);
  const fromOptions = fxEntries;
  const [fromCurrency, setFromCurrency] = useState<CurrencyCode | "">(
    fromOptions[0]?.currencyCode ?? ""
  );
  const effectiveFromCurrency =
    fromOptions.find((entry) => entry.currencyCode === fromCurrency)?.currencyCode ??
    fromOptions[0]?.currencyCode ??
    "";
  const firstToCurrency =
    FOREX_ACTIVE_CURRENCIES.find((currency) => currency !== effectiveFromCurrency) ?? "USD";
  const [toCurrency, setToCurrency] = useState<CurrencyCode>(firstToCurrency);
  const effectiveToCurrency = toCurrency !== effectiveFromCurrency ? toCurrency : firstToCurrency;
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitExchange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const parsedAmount = Number(amount);
    if (!effectiveFromCurrency || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a positive reserve amount.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/country/${countryId}/central-bank/reserve-exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCurrency: effectiveFromCurrency,
          toCurrency: effectiveToCurrency,
          amount: parsedAmount,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error ?? "Reserve exchange failed.");
        return;
      }
      setMessage(
        `Converted ${formatNativeCurrency(json.spentAmount, effectiveFromCurrency)} to ${formatNativeCurrency(
          json.receivedAmount,
          effectiveToCurrency
        )}.`
      );
      setAmount("");
      onChanged();
    } catch (exchangeError) {
      setError(exchangeError instanceof Error ? exchangeError.message : "Reserve exchange failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            Bank reserves
          </h2>
          <p className="mt-1 max-w-md text-xs text-muted">
            Two separate pools. <span className="font-medium text-foreground/70">FX reserves</span>{" "}
            (spread fees collected from trades) are exchangeable below. The{" "}
            <span className="font-medium text-foreground/70">lending reserve</span> is home cash
            that backs line of credit lending. You cannot exchange it.
          </p>
        </div>
        <div className="flex gap-6 text-left sm:text-right">
          <div>
            <p className="font-mono text-xl font-bold tabular-nums text-foreground">
              {valueForDisplay(totalValue)}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-muted">FX reserves</p>
          </div>
          <div>
            <p className="font-mono text-xl font-bold tabular-nums text-foreground/70">
              {valueForDisplay(lendingReserve)}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-muted">Lending reserve</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-lg border border-card-border bg-card-elevated/30 p-4">
          <div
            className="h-36 w-36 rounded-full border border-card-border shadow-inner"
            style={{ background: buildPieGradient(allEntries) }}
            aria-label="Reserve currency mix"
          />
          <p className="mt-3 text-center text-xs text-muted">
            {allEntries.length > 0
              ? `Total reserves: ${formatNativeCurrency(totalValue, homeCurrency)}`
              : "No reserves yet."}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-left">
                <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-muted">
                  Currency
                </th>
                <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-muted">
                  Balance
                </th>
                <th className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-muted">
                  {valueColumnLabel}
                </th>
                <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                  Mix
                </th>
              </tr>
            </thead>
            <tbody>
              {allEntries.length === 0 ? (
                <tr>
                  <td className="py-4 text-muted" colSpan={4}>
                    Reserves will appear here as trading accrues.
                  </td>
                </tr>
              ) : (
                allEntries.map((entry, index) => (
                  <tr
                    key={entry.currencyCode}
                    className="border-b border-card-border/50 last:border-0"
                  >
                    <td className="py-2.5 pr-4 font-semibold text-foreground">
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                        style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}
                      />
                      {entry.currencyCode}
                    </td>
                    <td className="py-2.5 pr-4 font-mono tabular-nums">
                      {formatNativeCurrency(entry.balance, entry.currencyCode)}
                    </td>
                    <td className="py-2.5 pr-4 font-mono tabular-nums">
                      {valueForDisplay(entry.valueInHomeCurrency)}
                    </td>
                    <td className="py-2.5 font-mono tabular-nums text-muted">
                      {totalValue > 0
                        ? `${Math.round((entry.valueInHomeCurrency / totalValue) * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canExchange && fromOptions.length > 0 && (
        <form
          onSubmit={submitExchange}
          className="mt-5 rounded-lg border border-card-border bg-background/30 p-4"
        >
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
            Exchange reserve balances
          </h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label className="text-xs font-medium text-muted">
              Sell
              <select
                value={effectiveFromCurrency}
                onChange={(event) => setFromCurrency(event.target.value as CurrencyCode)}
                className="mt-1 w-full rounded-md border border-card-border bg-card px-2 py-2 text-sm text-foreground"
                disabled={submitting}
              >
                {fromOptions.map((entry) => (
                  <option key={entry.currencyCode} value={entry.currencyCode}>
                    {CURRENCY_SYMBOLS[entry.currencyCode] ?? ""} {entry.currencyCode}
                  </option>
                ))}
              </select>
              <span className="mt-1 block font-mono text-[10px] tabular-nums text-muted">
                Available:{" "}
                {formatNativeCurrency(
                  fromOptions.find((entry) => entry.currencyCode === effectiveFromCurrency)
                    ?.balance ?? 0,
                  effectiveFromCurrency || homeCurrency
                )}
              </span>
            </label>
            <label className="text-xs font-medium text-muted">
              Buy
              <select
                value={effectiveToCurrency}
                onChange={(event) => setToCurrency(event.target.value as CurrencyCode)}
                className="mt-1 w-full rounded-md border border-card-border bg-card px-2 py-2 text-sm text-foreground"
                disabled={submitting}
              >
                {FOREX_ACTIVE_CURRENCIES.filter(
                  (currency) => currency !== effectiveFromCurrency
                ).map((currency) => (
                  <option key={currency} value={currency}>
                    {CURRENCY_SYMBOLS[currency] ?? ""} {currency}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-muted">
              Amount
              <input
                type="number"
                min={1}
                step={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-1 w-full rounded-md border border-card-border bg-card px-2 py-2 text-sm text-foreground"
                disabled={submitting}
              />
            </label>
            <Button type="submit" disabled={submitting || !effectiveFromCurrency}>
              {submitting ? "Exchanging..." : "Exchange"}
            </Button>
          </div>
          {message && <p className="mt-2 text-xs text-success">{message}</p>}
          {error && <p className="mt-2 text-xs text-error">{error}</p>}
        </form>
      )}
    </div>
  );
}

export function CentralBankFinancialsTab({
  countryId,
  balanceSheet,
  bankFinancials,
  isChair,
  isAdmin,
  chairControlsLocked,
  onChanged,
}: {
  countryId: CountryId;
  balanceSheet: BalanceSheet;
  bankFinancials: BankFinancials | null;
  isChair: boolean;
  isAdmin: boolean;
  chairControlsLocked: boolean;
  onChanged: () => void;
}) {
  const {
    homeCurrency,
    totalDeposits,
    bankReserves,
    forexRevenue,
    totalLoansOutstanding,
    systemCap,
    availableCapacity,
    reservePoolTransferMaxToLending = 0,
    reservePoolTransferMaxToForex = 0,
    reservePoolTransferCooldownRemaining = 0,
  } = balanceSheet;

  const fmt = (amount: number) => formatNativeCurrency(amount, homeCurrency);
  const utilization = systemCap > 0 ? Math.min(1, totalLoansOutstanding / systemCap) : 0;
  const canExchange = isAdmin || (isChair && !chairControlsLocked);
  const canTransferPools = canExchange;
  const [transferDirection, setTransferDirection] = useState<"toLending" | "toForex">("toLending");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  const transferCap =
    transferDirection === "toLending"
      ? reservePoolTransferMaxToLending
      : reservePoolTransferMaxToForex;
  const transferReady = isAdmin || reservePoolTransferCooldownRemaining <= 0;
  const maxFractionPct = Math.floor(RESERVE_POOL_TRANSFER_MAX_FRACTION * 100);

  async function submitPoolTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransferMessage(null);
    setTransferError(null);
    const parsedAmount = Number(transferAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setTransferError("Enter a positive transfer amount.");
      return;
    }
    setTransferSubmitting(true);
    try {
      const response = await fetch(`/api/country/${countryId}/central-bank/reserve-pool-transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: transferDirection,
          amount: Math.floor(parsedAmount),
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        setTransferError(json.error ?? "Reserve pool transfer failed.");
        return;
      }
      const moved = formatNativeCurrency(json.amount, homeCurrency);
      setTransferMessage(
        transferDirection === "toLending"
          ? `Moved ${moved} from forex spread revenue into lending reserves.`
          : `Moved ${moved} from lending reserves into forex spread revenue.`
      );
      setTransferAmount("");
      onChanged();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : "Reserve pool transfer failed.");
    } finally {
      setTransferSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 pb-16">
      {bankFinancials && (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">
            Income statement ({homeCurrency}) · all time
          </h2>
          <p className="mb-4 text-xs text-muted">
            These are amounts earned and owed, not cash that has moved. Interest charged on lines of
            credit is what the bank earns. Interest paid to savers is what it costs. The difference
            is the bank&apos;s profit on lending.
          </p>
          <IncomeRow
            label="Line of credit interest charged (income)"
            amount={bankFinancials.locInterestAccruedLifetime}
            note="All interest charged on money players have borrowed"
            tone="income"
            fmt={fmt}
          />
          <IncomeRow
            label="Deposit interest paid (expense)"
            amount={bankFinancials.savingsInterestExpenseLifetime}
            note="Cumulative interest credited to savings accounts"
            tone="expense"
            fmt={fmt}
          />
          <div className="flex items-center justify-between gap-4 pt-2 border-t border-card-border">
            <p className="text-sm font-semibold text-foreground">Net interest income (lifetime)</p>
            <span
              className={`tabular-nums text-sm font-bold ${
                bankFinancials.netInterestIncomeLifetime >= 0 ? "text-success" : "text-error"
              }`}
            >
              {bankFinancials.netInterestIncomeLifetime >= 0 ? "+" : "−"}
              {fmt(Math.abs(bankFinancials.netInterestIncomeLifetime))}
            </span>
          </div>
          <IncomeRow
            label="Line of credit interest actually received"
            amount={bankFinancials.locInterestReceivedLifetime}
            note="Interest portion of repayments and auto-payments"
            tone="neutral"
            fmt={fmt}
          />
        </div>
      )}

      <ReservePortfolioPanel
        countryId={countryId}
        balanceSheet={balanceSheet}
        canExchange={canExchange}
        onChanged={onChanged}
      />

      <div className="rounded-xl border border-card-border bg-card p-5">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">
          Balance sheet · lending capacity ({homeCurrency})
        </h2>
        <p className="mb-4 text-xs text-muted">
          The exchange can lend up to 70% of total deposits + reserves. Outstanding loans and
          remaining capacity are shown below.
        </p>

        <Row
          label="Total deposits (savings)"
          amount={totalDeposits}
          note="National savings balance in this currency"
          fmt={fmt}
        />
        <Row
          label="Lending reserves"
          amount={bankReserves}
          note="Home-currency reserves that back lending. Spread-fee reserves are tracked above"
          highlight={bankReserves > 0 ? "success" : undefined}
          fmt={fmt}
        />
        <Row
          label="Forex spread revenue"
          amount={forexRevenue}
          note="Cumulative 40% of spread fees collected by this central bank"
          highlight={forexRevenue > 0 ? "success" : undefined}
          fmt={fmt}
        />
        <Row
          label="Lending pool (70% of deposits + reserves)"
          amount={systemCap}
          note="How much this bank can lend out in total"
          fmt={fmt}
        />

        <div className="py-3 border-b border-card-border/50">
          <div className="flex items-center justify-between gap-4 mb-2">
            <div>
              <p className="text-sm font-medium text-foreground">Loans outstanding</p>
              <p className="text-xs text-muted">Total principal + arrears across all borrowers</p>
            </div>
            <span
              className={`tabular-nums text-sm font-semibold ${
                utilization > 0.85
                  ? "text-error"
                  : utilization > 0.6
                    ? "text-warning"
                    : "text-foreground"
              }`}
            >
              {fmt(totalLoansOutstanding)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-background">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                utilization > 0.85 ? "bg-error" : utilization > 0.6 ? "bg-warning" : "bg-primary"
              }`}
              style={{ width: `${Math.round(utilization * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-muted text-right">
            {Math.round(utilization * 100)}% of pool utilized
          </p>
        </div>

        <Row
          label="Available capacity"
          amount={availableCapacity}
          note="What is left for new borrowing"
          highlight={availableCapacity > 0 ? "success" : "error"}
          fmt={fmt}
        />

        {canTransferPools && (
          <form
            onSubmit={submitPoolTransfer}
            className="mt-5 rounded-lg border border-card-border bg-background/30 p-4"
          >
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">
              Reallocate reserve pools
            </h3>
            <p className="mb-3 text-xs text-muted">
              Once per day, move up to {maxFractionPct}% of forex spread revenue into lending
              reserves, which lets the bank lend more, or move it the other way. You cannot push the
              lending pool below the loans already out.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="text-xs font-medium text-muted">
                Direction
                <select
                  value={transferDirection}
                  onChange={(event) =>
                    setTransferDirection(event.target.value as "toLending" | "toForex")
                  }
                  className="mt-1 w-full rounded-md border border-card-border bg-card px-2 py-2 text-sm text-foreground"
                  disabled={transferSubmitting || !transferReady}
                >
                  <option value="toLending">
                    Forex → lending (max {fmt(reservePoolTransferMaxToLending)})
                  </option>
                  <option value="toForex">
                    Lending → forex (max {fmt(reservePoolTransferMaxToForex)})
                  </option>
                </select>
              </label>
              <label className="text-xs font-medium text-muted">
                Amount ({homeCurrency})
                <input
                  type="number"
                  min={1}
                  step={1}
                  max={transferCap > 0 ? transferCap : undefined}
                  value={transferAmount}
                  onChange={(event) => setTransferAmount(event.target.value)}
                  className="mt-1 w-full rounded-md border border-card-border bg-card px-2 py-2 text-sm text-foreground"
                  disabled={transferSubmitting || !transferReady || transferCap <= 0}
                />
                <span className="mt-1 block font-mono text-[10px] tabular-nums text-muted">
                  Available this action: {fmt(transferCap)}
                </span>
              </label>
              <Button
                type="submit"
                disabled={
                  transferSubmitting || !transferReady || transferCap <= 0 || !transferAmount
                }
              >
                {transferSubmitting ? "Transferring..." : "Transfer"}
              </Button>
            </div>
            {!transferReady && (
              <p className="mt-2 text-xs text-warning">
                Next transfer available in {reservePoolTransferCooldownRemaining} turn
                {reservePoolTransferCooldownRemaining === 1 ? "" : "s"}.
              </p>
            )}
            {transferMessage && <p className="mt-2 text-xs text-success">{transferMessage}</p>}
            {transferError && <p className="mt-2 text-xs text-error">{transferError}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
