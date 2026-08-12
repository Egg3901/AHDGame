"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PortfolioChart } from "@/components/charts/PortfolioChart";
import { type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState, Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/contexts/ToastContext";

interface LedgerRow {
  type: string;
  amount: number;
  balanceAfter: number;
  turn?: number;
  createdAt: string;
  currencyCode: string;
}

interface SavingsApiResponse {
  countryId: string;
  currencyCode: CurrencyCode;
  primeRate: number;
  apyPercent: number;
  totalNationalSavings: number;
  liquidBalance: number;
  savingsBalance: number;
  lifetimeInterestEarned: number;
  pendingInterest: number;
  estimatedAccrualThisTurn: number;
  turnsUntilCredit: number;
  accountOpened: boolean;
  ledger: LedgerRow[];
  savingsHistory: {
    turn: number;
    savingsCashValue: number;
    exchangeRatesSnapshot?: Partial<Record<CurrencyCode, number>>;
  }[];
  error?: string;
}

function formatLedgerType(t: string): string {
  if (t === "interest") return "Interest";
  if (t === "deposit") return "Deposit";
  if (t === "withdraw") return "Withdraw";
  if (t === "open") return "Account opened";
  return t;
}

function formatNative(amount: number, currency: CurrencyCode): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? "$";
  if (currency === "JPY") return `${sym}${Math.round(amount).toLocaleString("en-US")}`;
  return `${sym}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  countryId: CountryId;
}

export function CentralBankSavingsTab({ countryId }: Props) {
  const homeCurrency = COUNTRY_CURRENCY_MAP[countryId];
  const sym = CURRENCY_SYMBOLS[homeCurrency] ?? "$";
  const { formatAmount } = useCurrency();
  const { showToast } = useToast();
  const [data, setData] = useState<SavingsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<null | "deposit" | "withdraw">(null);
  const [amountStr, setAmountStr] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    void fetch(`/api/country/${countryId.toLowerCase()}/central-bank/savings`)
      .then(async (r) => {
        const j = (await r.json()) as SavingsApiResponse;
        if (!r.ok) {
          setError(j.error ?? "Failed to load");
          setData(null);
          return;
        }
        setError(null);
        setData(j);
      })
      .catch(() => {
        setError("Failed to load");
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [countryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (path: "open" | "deposit" | "withdraw", body: object) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/character/savings/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(j.error ?? "Request failed", "error");
        return;
      }
      showToast("Updated", "success");
      setPanel(null);
      setAmountStr("");
      void load();
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = () => {
    if (!panel) return;
    const n = homeCurrency === "JPY" ? parseInt(amountStr, 10) : parseFloat(amountStr);
    if (!Number.isFinite(n) || n <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    void runAction(panel, { currency: homeCurrency, amount: n });
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        title="Savings unavailable"
        description={error ?? "This central bank's savings facility is not active."}
      />
    );
  }

  const chartHistory = data.savingsHistory.map((h) => ({
    turn: h.turn,
    totalValue: h.savingsCashValue,
    savingsCashValue: h.savingsCashValue,
    exchangeRatesSnapshot: h.exchangeRatesSnapshot,
  }));

  return (
    <div className="space-y-6">
      {/* Stat strip */}
      <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y divide-card-border sm:divide-y-0 sm:divide-x">
          <StatCell
            label="APY"
            value={`${data.apyPercent.toFixed(2)}%`}
            sub={`half of ${data.primeRate.toFixed(2)}% prime`}
            tone="primary"
          />
          <StatCell
            label="Your Balance"
            value={formatNative(data.savingsBalance, homeCurrency)}
            sub={data.accountOpened ? "savings account" : "not yet opened"}
          />
          <StatCell
            label="Lifetime Interest"
            value={formatNative(data.lifetimeInterestEarned, homeCurrency)}
            sub="credited to balance every 12 turns"
            tone={data.lifetimeInterestEarned > 0 ? "success" : "default"}
          />
          <StatCell
            label="Accrued (uncredited)"
            value={formatNative(data.pendingInterest, homeCurrency)}
            sub="earned; adds to balance at next credit"
            tone={data.pendingInterest > 0 ? "success" : "default"}
          />
          <StatCell
            label="This Turn (est.)"
            value={
              data.estimatedAccrualThisTurn > 0
                ? formatNative(data.estimatedAccrualThisTurn, homeCurrency)
                : "-"
            }
            sub={
              data.turnsUntilCredit === 1
                ? "next balance credit this turn"
                : `next credit in ${data.turnsUntilCredit} turns`
            }
          />
          <StatCell
            label="System Deposits"
            value={formatNative(data.totalNationalSavings, homeCurrency)}
            sub={`${data.currencyCode} system-wide`}
          />
        </div>
      </div>

      {/* Manage account + chart */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Your account</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                data.accountOpened
                  ? "bg-success/10 text-success border border-success/30"
                  : "bg-card-elevated text-muted border border-card-border"
              }`}
            >
              {data.accountOpened ? "Open" : "Not opened"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted font-medium">
                Cash (liquid)
              </p>
              <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">
                {formatNative(data.liquidBalance, homeCurrency)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted font-medium">
                In savings
              </p>
              <p className="mt-0.5 text-base font-bold tabular-nums text-foreground">
                {formatNative(data.savingsBalance, homeCurrency)}
              </p>
            </div>
          </div>

          {!data.accountOpened ? (
            <Button
              type="button"
              className="w-full"
              disabled={busy}
              onClick={() => void runAction("open", { currency: homeCurrency })}
            >
              Open savings account
            </Button>
          ) : panel ? (
            <div className="space-y-3 rounded-lg border border-card-border bg-card-elevated p-3">
              <label className="text-[10px] uppercase tracking-wider text-muted font-medium block">
                {panel === "deposit" ? "Deposit amount" : "Withdraw amount"} ({sym})
              </label>
              <Input
                placeholder={homeCurrency === "JPY" ? "100000" : "100"}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="button" disabled={busy} onClick={onConfirm} className="flex-1">
                  Confirm {panel}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setPanel(null);
                    setAmountStr("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPanel("deposit");
                  setAmountStr("");
                }}
              >
                Deposit
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || data.savingsBalance <= 0}
                onClick={() => {
                  setPanel("withdraw");
                  setAmountStr("");
                }}
              >
                Withdraw
              </Button>
            </div>
          )}

          <p className="text-[10px] text-muted">
            Yield is credited each game turn. Funds stay in your wallet ledger until you withdraw.
          </p>
        </div>

        {/* Chart */}
        <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-semibold text-foreground">Balance over time</h3>
          <p className="mb-3 text-xs text-muted">
            Shown in the same money units as the cash history on your portfolio.
          </p>
          {chartHistory.length >= 2 ? (
            <PortfolioChart history={chartHistory} view="savings" />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-lg bg-card-elevated/30 text-xs text-muted">
              Not enough history yet. The chart appears after a few turns of activity.
            </div>
          )}
        </div>
      </div>

      {/* Ledger */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
        <div className="border-b border-card-border bg-card-elevated px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Transaction ledger</h3>
          <p className="text-xs text-muted">Most recent {data.ledger.length} entries</p>
        </div>
        {data.ledger.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-card-elevated/40 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-right">Balance after</th>
                  <th className="px-4 py-2 text-right hidden sm:table-cell">Turn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/50">
                {data.ledger.map((row, i) => (
                  <tr key={`${row.createdAt}-${i}`} className="hover:bg-card-elevated/30">
                    <td className="px-4 py-2">{formatLedgerType(row.type)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {row.type === "withdraw" ? "−" : "+"}
                      {formatNative(row.amount, homeCurrency)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">
                      {formatNative(row.balanceAfter, homeCurrency)}
                    </td>
                    <td className="px-4 py-2 text-right text-muted hidden sm:table-cell">
                      {row.turn != null ? `T${row.turn}` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted">
        <Link href="/portfolio?section=cash" className="text-primary hover:underline">
          Currency wallet in portfolio →
        </Link>
        {" · "}
        <span className="text-muted/60">{formatAmount(data.savingsBalance)} in display units</span>
      </p>
    </div>
  );
}

function StatCell({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "primary" | "success";
}) {
  const valueClass =
    tone === "primary" ? "text-primary" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="px-5 py-4">
      <p className="text-[10px] uppercase tracking-widest text-muted font-semibold">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}
