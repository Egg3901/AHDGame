"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState, Skeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { LoanFundingSource, LocPaymentMode } from "@/lib/db/types/character";
import {
  LOC_PAYMENT_MODE_COOLDOWN_TURNS,
  LOC_IO_SURCHARGE_PERCENT_POINTS,
} from "@/lib/lineOfCredit/locMath";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";

interface LedgerRow {
  type: string;
  amount: number;
  /** Interest component of a payment (repay / auto_payment). Undefined for other types or legacy rows. */
  interestPortion?: number;
  /** Principal component of a payment (repay / auto_payment). Undefined for other types or legacy rows. */
  principalPortion?: number;
  balanceAfter: number;
  arrearsAfter: number;
  turn?: number;
  createdAt: string;
  currencyCode: string;
}

interface Snapshot {
  composite: number;
  spreadPercentPoints: number;
  grossAssetsInternal: number;
  locDebtInternal: number;
  netWorthInternal: number;
  maxDebtInternal: number;
  outstandingInternal: number;
  availableBorrowInternal: number;
  balances: Partial<Record<CurrencyCode, number>>;
  arrears: Partial<Record<CurrencyCode, number>>;
  accountsOpened: Partial<Record<CurrencyCode, boolean>>;
  fundingSource: Partial<Record<CurrencyCode, LoanFundingSource>>;
  paymentMode: Partial<Record<CurrencyCode, LocPaymentMode>>;
  paymentModeChangedAtTurn: Partial<Record<CurrencyCode, number>>;
  currentTurn: number;
  drawFrozen: boolean;
  incomeScore: number;
  netWorthScore: number;
  hasCeoCorp: boolean;
  homePrimePercent: number;
  debtToAssetsRatio: number;
  effectiveRatePercent: number;
  incomePerTurnFace: number;
  dtiLimitInternal: number;
  netWorthLimitInternal: number;
  perPlayerLimitInternal: number;
  perPlayerAvailableInternal: number;
}

interface LocApiResponse {
  countryId: string;
  currencyCode: CurrencyCode;
  primeRate: number;
  /** Active regular character whose LOC data is shown (matches `getCharacterByUserId`). */
  characterId?: string;
  snapshot: Snapshot | null;
  ledger: LedgerRow[];
  isAdmin?: boolean;
  error?: string;
}

function formatLedgerType(t: string): string {
  if (t === "interest") return "Interest";
  if (t === "auto_payment") return "Auto-pay";
  if (t === "draw") return "Borrow";
  if (t === "repay") return "Repay";
  if (t === "garnishment") return "Income garnished";
  if (t === "open") return "Account opened";
  if (t === "freeze") return "Frozen";
  if (t === "unfreeze") return "Unfrozen";
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

export function CentralBankLoanTab({ countryId }: Props) {
  const config = getCountryConfig(countryId);
  const cbCurrency = COUNTRY_CURRENCY_MAP[countryId];
  const sym = CURRENCY_SYMBOLS[cbCurrency] ?? "$";
  const { formatAmount } = useCurrency();
  const { showToast } = useToast();
  const { user: authUser } = useAuthMe();
  const [data, setData] = useState<LocApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawAmt, setDrawAmt] = useState("");
  const [repayAmt, setRepayAmt] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    void fetch(`/api/country/${countryId.toLowerCase()}/central-bank/loc`)
      .then(async (r) => {
        const j = (await r.json()) as LocApiResponse & { error?: string };
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

  const runOpen = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/character/loc/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: cbCurrency }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(j.error ?? "Failed", "error");
        return;
      }
      showToast("Account opened", "success");
      void load();
    } finally {
      setBusy(false);
    }
  };

  const runDraw = async () => {
    const n = cbCurrency === "JPY" ? parseInt(drawAmt, 10) : parseFloat(drawAmt);
    if (!Number.isFinite(n) || n <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/character/loc/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: cbCurrency, amount: n }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(j.error ?? "Failed", "error");
        return;
      }
      showToast("Borrowed to wallet", "success");
      setDrawAmt("");
      requestCharacterStatsRefetch();
      void load();
    } finally {
      setBusy(false);
    }
  };

  const runRepay = async () => {
    const n = cbCurrency === "JPY" ? parseInt(repayAmt, 10) : parseFloat(repayAmt);
    if (!Number.isFinite(n) || n <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/character/loc/repay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: cbCurrency, amount: n }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(j.error ?? "Failed", "error");
        return;
      }
      showToast("Repayment applied", "success");
      setRepayAmt("");
      requestCharacterStatsRefetch();
      void load();
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data || !data.snapshot) {
    return (
      <EmptyState
        title="Line of credit unavailable"
        description={error ?? "This central bank's lending facility is not active."}
      />
    );
  }

  const s = data.snapshot;
  const opened = !!s.accountsOpened[cbCurrency];
  const balance = s.balances[cbCurrency] ?? 0;
  const arrears = s.arrears[cbCurrency] ?? 0;
  const fundingSource: LoanFundingSource = s.fundingSource[cbCurrency] ?? "both";
  const isAdmin = data.isAdmin === true;
  const characterIdForAdmin =
    data.characterId ?? (authUser?.character?.id as string | undefined) ?? "";
  const usedPct =
    s.perPlayerLimitInternal > 0
      ? Math.min(1, s.outstandingInternal / s.perPlayerLimitInternal)
      : 0;
  const noIncome = s.incomePerTurnFace <= 0;
  // Equity-only mode: player has no income history but positive equity cap.
  // They can still borrow against equity; noIncome is informational only.
  const equityOnlyMode = noIncome && s.perPlayerAvailableInternal > 0;
  // Rate at this CB = THIS bank's prime + the player's universal credit spread.
  // The snapshot ships its home-country prime as homePrimePercent; we recompose
  // with data.primeRate so a US character at the BoJ sees BoJ prime, not Fed prime.
  const cbPrime = data.primeRate;
  const paymentMode: LocPaymentMode = s.paymentMode[cbCurrency] ?? "pi";
  const lastChangedTurn = s.paymentModeChangedAtTurn[cbCurrency];
  const turnsSinceChange =
    typeof lastChangedTurn === "number" ? s.currentTurn - lastChangedTurn : Infinity;
  const onCooldown = turnsSinceChange < LOC_PAYMENT_MODE_COOLDOWN_TURNS;
  const turnsLeftOnCooldown = onCooldown ? LOC_PAYMENT_MODE_COOLDOWN_TURNS - turnsSinceChange : 0;
  const ioSurchargeActive = paymentMode === "io";
  const baseRateHere = cbPrime + s.spreadPercentPoints;
  const effectiveRateHere =
    baseRateHere + (ioSurchargeActive ? LOC_IO_SURCHARGE_PERCENT_POINTS : 0);
  const spreadSign = s.spreadPercentPoints >= 0 ? "+" : "";
  const usagePctText = (usedPct * 100).toFixed(0);
  const usageColor = usedPct >= 0.9 ? "bg-error" : usedPct >= 0.7 ? "bg-warning" : "bg-primary";

  return (
    <div className="space-y-6">
      {/* Stat strip - your rate, outstanding, available, system pool */}
      <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y divide-card-border sm:divide-y-0 sm:divide-x">
          <StatCell
            label="Your Rate"
            value={`${effectiveRateHere.toFixed(2)}%`}
            sub={
              ioSurchargeActive
                ? `prime ${cbPrime.toFixed(2)}% + your credit spread ${spreadSign}${s.spreadPercentPoints.toFixed(2)}% + interest-only ${LOC_IO_SURCHARGE_PERCENT_POINTS.toFixed(2)}% · credit score ${s.composite.toFixed(0)}/100`
                : `prime ${cbPrime.toFixed(2)}% + your credit spread ${spreadSign}${s.spreadPercentPoints.toFixed(2)}% · credit score ${s.composite.toFixed(0)}/100`
            }
            tone="primary"
          />
          <StatCell
            label="Outstanding"
            value={formatAmount(s.outstandingInternal)}
            sub={arrears > 0 ? `${formatNative(arrears, cbCurrency)} in arrears` : "no arrears"}
            tone={arrears > 0 ? "warning" : "default"}
          />
          <StatCell
            label="Available Credit"
            value={noIncome && !equityOnlyMode ? "-" : formatAmount(s.perPlayerAvailableInternal)}
            sub={
              equityOnlyMode
                ? "equity-backed only"
                : noIncome
                  ? "no income"
                  : `${usagePctText}% of limit used`
            }
            tone={noIncome ? "warning" : "default"}
          />
          <StatCell
            label="System Pool"
            value={formatAmount(s.availableBorrowInternal)}
            sub="shared across all borrowers"
          />
        </div>
      </div>

      {/* Frozen / income callouts */}
      {s.drawFrozen && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm font-semibold text-warning">Draws frozen</p>
          <p className="mt-1 text-xs text-muted">
            Your missed interest has accrued as arrears. Repay the balance to unfreeze borrowing.
          </p>
        </div>
      )}
      {noIncome && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm font-semibold text-warning">No qualifying income detected</p>
          <p className="mt-1 text-xs text-muted">
            You need a recent history of bond coupons, CEO salary, or dividends before you can
            borrow. The bank now looks at your average recurring income over the last 48 turns, not
            just a single good hour.
          </p>
        </div>
      )}

      {/* Two-column layout: usage/account on left, actions on right */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Credit limit + account status (spans 2 cols) */}
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Credit limit</h3>
              <span className="text-xs text-muted tabular-nums">
                {formatAmount(s.outstandingInternal)} <span className="text-muted/60">/</span>{" "}
                <span className="text-foreground font-medium">
                  {noIncome && !equityOnlyMode ? "-" : formatAmount(s.perPlayerLimitInternal)}
                </span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-background">
              <div
                className={`h-full rounded-full transition-all duration-500 ${usageColor}`}
                style={{ width: `${(usedPct * 100).toFixed(1)}%` }}
              />
            </div>
            {(!noIncome || equityOnlyMode) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-muted tabular-nums">
                <span>
                  Income cap:{" "}
                  <span
                    className={
                      !noIncome && s.dtiLimitInternal <= s.netWorthLimitInternal
                        ? "font-semibold text-foreground"
                        : ""
                    }
                  >
                    {noIncome ? "-" : formatAmount(s.dtiLimitInternal)}
                  </span>
                </span>
                <span>
                  Equity cap:{" "}
                  <span
                    className={
                      noIncome || s.netWorthLimitInternal < s.dtiLimitInternal
                        ? "font-semibold text-foreground"
                        : ""
                    }
                  >
                    {formatAmount(s.netWorthLimitInternal)}
                  </span>
                </span>
              </div>
            )}
            <p className="mt-1.5 text-[10px] text-muted">
              {equityOnlyMode
                ? "No income history yet, so you can only borrow against what you own. The income cap grows as bond coupons, salary, or dividends build up over the last 48 turns."
                : "Your limit is the lower of the two caps below. The income cap grows as bond coupons, salary, or dividends build up over the last 48 turns."}
            </p>
          </div>

          <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-foreground">{cbCurrency} account</h3>
              <div className="flex items-center gap-2">
                {opened && <FundingBadge source={fundingSource} />}
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    opened
                      ? "bg-success/10 text-success border border-success/30"
                      : "bg-card-elevated text-muted border border-card-border"
                  }`}
                >
                  {opened ? "Open" : "Not opened"}
                </span>
              </div>
            </div>
            {opened ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted font-medium">
                    Principal
                  </p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
                    {formatNative(balance, cbCurrency)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted font-medium">
                    Arrears
                  </p>
                  <p
                    className={`mt-0.5 text-lg font-bold tabular-nums ${arrears > 0 ? "text-warning" : "text-foreground"}`}
                  >
                    {formatNative(arrears, cbCurrency)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">
                  Open a {cbCurrency} loan account at {config.centralBank.abbreviation} to start
                  borrowing.
                </p>
                <Button type="button" disabled={busy} onClick={() => void runOpen()}>
                  Open account
                </Button>
              </div>
            )}
            {opened && (
              <PaymentModePicker
                currency={cbCurrency}
                mode={paymentMode}
                onCooldown={onCooldown}
                turnsLeftOnCooldown={turnsLeftOnCooldown}
                effectiveRateHerePI={baseRateHere}
                effectiveRateHereIO={baseRateHere + LOC_IO_SURCHARGE_PERCENT_POINTS}
                bankAbbr={config.centralBank.abbreviation}
                busy={busy}
                onChanged={() => void load()}
              />
            )}
            {opened && isAdmin && (
              <AdminFundingPicker
                currency={cbCurrency}
                characterId={characterIdForAdmin}
                value={fundingSource}
                disabled={busy}
                onChanged={() => void load()}
              />
            )}
          </div>
        </div>

        {/* Borrow + repay actions */}
        <div className="space-y-4">
          <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-3">Borrow</h3>
            {!opened ? (
              <p className="text-xs text-muted">Open the {cbCurrency} account first.</p>
            ) : noIncome && !equityOnlyMode ? (
              <p className="text-xs text-muted">Qualifying income required.</p>
            ) : s.drawFrozen ? (
              <p className="text-xs text-warning">Frozen. Clear your arrears first.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted font-medium block mb-1">
                    Amount ({sym})
                  </label>
                  <Input
                    placeholder={cbCurrency === "JPY" ? "500000" : "1000"}
                    value={drawAmt}
                    onChange={(e) => setDrawAmt(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void runDraw()}
                >
                  Borrow to wallet
                </Button>
                <p className="text-[10px] text-muted">
                  {ioSurchargeActive
                    ? `Interest builds up every hour at ${effectiveRateHere.toFixed(2)}% a year. Auto-pay covers the interest only, so what you owe stays the same until you switch back to paying down the loan.`
                    : `Interest builds up every hour at ${effectiveRateHere.toFixed(2)}% a year and auto-pays from your income.`}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-3">Repay</h3>
            {!opened ? (
              <p className="text-xs text-muted">No account open.</p>
            ) : balance <= 0 && arrears <= 0 ? (
              <p className="text-xs text-muted">Nothing outstanding.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted font-medium block mb-1">
                    Amount ({sym})
                  </label>
                  <Input
                    placeholder="Amount"
                    value={repayAmt}
                    onChange={(e) => setRepayAmt(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void runRepay()}
                >
                  Repay
                </Button>
                <p className="text-[10px] text-muted">
                  Applied to arrears first, then principal. Funds drawn from your personal wallet.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Ledger */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
        <div className="border-b border-card-border bg-card-elevated px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Transaction history</h3>
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
                  <th className="px-4 py-2 text-right hidden md:table-cell">Interest</th>
                  <th className="px-4 py-2 text-right hidden md:table-cell">Principal</th>
                  <th className="px-4 py-2 text-right">Balance after</th>
                  <th className="px-4 py-2 text-right hidden sm:table-cell">Turn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/50">
                {data.ledger.map((row, i) => {
                  const c = row.currencyCode as CurrencyCode;
                  const isPayment =
                    row.type === "repay" ||
                    row.type === "auto_payment" ||
                    row.type === "garnishment";
                  const negate = isPayment ? "−" : "+";
                  const hasSplit =
                    (row.type === "repay" ||
                      row.type === "auto_payment" ||
                      row.type === "garnishment") &&
                    (row.interestPortion !== undefined || row.principalPortion !== undefined);
                  return (
                    <tr key={`${row.createdAt}-${i}`} className="hover:bg-card-elevated/30">
                      <td className="px-4 py-2">{formatLedgerType(row.type)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {negate}
                        {formatNative(row.amount, c)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted hidden md:table-cell">
                        {hasSplit ? formatNative(row.interestPortion ?? 0, c) : "-"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted hidden md:table-cell">
                        {hasSplit ? formatNative(row.principalPortion ?? 0, c) : "-"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">
                        {formatNative(row.balanceAfter, c)}
                      </td>
                      <td className="px-4 py-2 text-right text-muted hidden sm:table-cell">
                        {row.turn != null ? `T${row.turn}` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted">
        <Link href="/portfolio?section=loans" className="text-primary hover:underline">
          View loans in portfolio →
        </Link>
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
  tone?: "default" | "primary" | "warning";
}) {
  const valueClass =
    tone === "primary" ? "text-primary" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="px-5 py-4">
      <p className="text-[10px] uppercase tracking-widest text-muted font-semibold">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function FundingBadge({ source }: { source: LoanFundingSource }) {
  // Color coding mirrors the bank balance sheet's mental model: deposits = blue,
  // reserves = amber, split = primary. Helps an admin scan many loans at a glance.
  const meta: Record<LoanFundingSource, { label: string; cls: string }> = {
    deposits: {
      label: "Deposits",
      cls: "bg-secondary/10 text-secondary border border-secondary/30",
    },
    reserves: {
      label: "Reserves",
      cls: "bg-warning/10 text-warning border border-warning/30",
    },
    both: {
      label: "Split 50/50",
      cls: "bg-primary/10 text-primary border border-primary/30",
    },
  };
  const m = meta[source];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${m.cls}`}
      title="Funding pool: where the money comes from when you borrow, and goes back to when you repay"
    >
      Funded: {m.label}
    </span>
  );
}

function AdminFundingPicker({
  currency,
  characterId,
  value,
  disabled,
  onChanged,
}: {
  currency: CurrencyCode;
  characterId: string;
  value: LoanFundingSource;
  disabled: boolean;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const setSource = async (next: LoanFundingSource) => {
    if (next === value) return;
    if (!characterId) {
      showToast("Cannot resolve character id for admin update", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/loc/funding-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId, currency, source: next }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(j.error ?? "Failed to update", "error");
        return;
      }
      showToast(`Funding source set to ${next}`, "success");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-warning">
        Admin · Funding source
      </p>
      <p className="mt-1 text-[11px] text-muted">
        Sets which pool later borrowing and repayments flow through. Money already taken from a pool
        is not moved. Only future flows change.
      </p>
      <div className="mt-2 inline-flex rounded-md border border-card-border bg-background p-0.5 text-[11px] font-semibold">
        {(["deposits", "reserves", "both"] as LoanFundingSource[]).map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={busy || disabled}
            onClick={() => void setSource(opt)}
            className={`rounded px-2 py-0.5 transition-colors ${
              value === opt ? "bg-primary text-white" : "text-muted hover:text-foreground"
            } ${busy || disabled ? "opacity-50" : ""}`}
          >
            {opt === "both" ? "50/50" : opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function PaymentModePicker({
  currency,
  mode,
  onCooldown,
  turnsLeftOnCooldown,
  effectiveRateHerePI,
  effectiveRateHereIO,
  bankAbbr,
  busy,
  onChanged,
}: {
  currency: CurrencyCode;
  mode: LocPaymentMode;
  onCooldown: boolean;
  turnsLeftOnCooldown: number;
  effectiveRateHerePI: number;
  effectiveRateHereIO: number;
  bankAbbr: string;
  busy: boolean;
  onChanged: () => void;
}) {
  const { showToast } = useToast();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const submit = async (next: LocPaymentMode) => {
    if (next === mode) return;
    setPending(true);
    try {
      const res = await fetch("/api/character/loc/payment-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency, mode: next }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(j.error ?? "Failed to change mode", "error");
        return;
      }
      showToast(next === "pi" ? "Now paying down the loan" : "Now paying interest only", "success");
      onChanged();
    } finally {
      setPending(false);
      setConfirming(false);
    }
  };

  const disabled = busy || pending || onCooldown;

  return (
    <div className="mt-4 rounded-lg border border-card-border bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Payment mode
        </p>
        <span className="text-[11px] text-muted">
          Current:{" "}
          <span className="font-semibold text-foreground">
            {mode === "pi" ? "Paying down the loan" : "Paying interest only"}
          </span>
          {onCooldown && (
            <>
              {" · "}
              <span className="text-warning">Next change in {turnsLeftOnCooldown}h</span>
            </>
          )}
        </span>
      </div>
      {confirming ? (
        <div className="mt-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
          <p className="text-foreground">
            Switching <strong>{currency}</strong> to interest only. What you owe will stop going
            down, because every auto-payment goes to interest. Your rate at {bankAbbr} rises from{" "}
            <strong>{effectiveRateHerePI.toFixed(2)}%</strong> to{" "}
            <strong>{effectiveRateHereIO.toFixed(2)}%</strong>. Locked for{" "}
            {LOC_PAYMENT_MODE_COOLDOWN_TURNS} turns after the switch.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="rounded border border-card-border bg-card px-2 py-0.5 text-[11px] font-semibold text-muted hover:text-foreground"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded bg-warning px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-warning/90 disabled:opacity-60"
              onClick={() => void submit("io")}
              disabled={pending}
            >
              Pay interest only
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 inline-flex rounded-md border border-card-border bg-background p-0.5 text-[11px] font-semibold">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void submit("pi")}
            className={`rounded px-2 py-0.5 transition-colors ${
              mode === "pi" ? "bg-primary text-white" : "text-muted hover:text-foreground"
            } ${disabled ? "opacity-50" : ""}`}
          >
            Pay down the loan
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (mode === "io") return;
              setConfirming(true);
            }}
            className={`rounded px-2 py-0.5 transition-colors ${
              mode === "io" ? "bg-primary text-white" : "text-muted hover:text-foreground"
            } ${disabled ? "opacity-50" : ""}`}
          >
            Pay interest only (+{LOC_IO_SURCHARGE_PERCENT_POINTS.toFixed(2)}%)
          </button>
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted">
        Paying down the loan is the default: each turn a set share of what you owe is paid off.
        Paying interest only covers the interest and nothing more, so the debt never shrinks. You
        must wait {LOC_PAYMENT_MODE_COOLDOWN_TURNS} turns between switches.
      </p>
    </div>
  );
}
