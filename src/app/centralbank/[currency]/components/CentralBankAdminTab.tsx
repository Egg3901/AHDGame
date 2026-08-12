"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import type { CountryId } from "@/lib/constants/countries";
import { centralBankApiUrl } from "@/lib/urls";
import { Button } from "@/components/ui";
import { EmptyState, Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { LocSnapshot } from "@/lib/lineOfCredit/buildSnapshot";

interface BorrowerRow {
  characterId: string;
  sequentialId?: number;
  name: string;
  avatarUrl?: string;
  creditLimitInternal: number;
  outstandingInternal: number;
  utilization: number;
  paymentStatus: string;
  turnsToRepay: number | null;
  drawFrozen: boolean;
}

interface SavingsAccountRow {
  characterId: string;
  sequentialId?: number;
  name: string;
  avatarUrl?: string;
  savingsBalanceFace: number;
  walletBalanceFace: number;
  pendingInterestFace: number;
  lifetimeInterestEarnedFace: number;
}

interface TrackerResponse {
  countryId: string;
  currencyCode: string;
  borrowers: BorrowerRow[];
}

interface SavingsTrackerResponse {
  countryId: string;
  currencyCode: string;
  accounts: SavingsAccountRow[];
}

interface DepositDetailResponse {
  kind: "deposit";
  currencyCode: CurrencyCode;
  primeRate: number;
  apyPercent: number;
  character: {
    characterId: string;
    sequentialId?: number;
    name: string;
    avatarUrl?: string;
  };
  savingsBalance: number;
  liquidBalance: number;
  lifetimeInterestEarned: number;
  pendingInterest: number;
  estimatedAccrualThisTurn: number;
  turnsUntilCredit: number;
  accountOpened: boolean;
  ledger: Array<{
    type: string;
    amount: number;
    balanceAfter: number;
    turn?: number;
    createdAt: string;
    currencyCode: string;
  }>;
}

interface LoanDetailResponse {
  kind: "loan";
  currencyCode: CurrencyCode;
  primeRate: number;
  character: {
    characterId: string;
    sequentialId?: number;
    name: string;
    avatarUrl?: string;
  };
  snapshot: LocSnapshot | null;
  principalFace: number;
  arrearsFace: number;
  drawFrozen: boolean;
  effectiveRatePercent: number;
  ledger: Array<{
    type: string;
    amount: number;
    interestPortion?: number;
    principalPortion?: number;
    balanceAfter: number;
    arrearsAfter: number;
    turn?: number;
    createdAt: string;
    currencyCode: string;
  }>;
}

type AccountSelection = { kind: "deposit" | "loan"; characterId: string };

interface Props {
  countryId: CountryId;
}

function formatNative(amount: number, currency: CurrencyCode): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? "$";
  if (currency === "JPY") return `${sym}${Math.round(amount).toLocaleString("en-US")}`;
  return `${sym}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSavingsLedgerType(t: string): string {
  if (t === "interest") return "Interest";
  if (t === "deposit") return "Deposit";
  if (t === "withdraw") return "Withdraw";
  if (t === "open") return "Opened";
  return t;
}

function formatLocLedgerType(t: string): string {
  if (t === "interest") return "Interest";
  if (t === "auto_payment") return "Auto-pay";
  if (t === "garnishment") return "Garnishment";
  if (t === "distress_drain") return "Distress Drain";
  if (t === "draw") return "Borrow";
  if (t === "repay") return "Repay";
  if (t === "open") return "Opened";
  if (t === "freeze") return "Frozen";
  if (t === "unfreeze") return "Unfrozen";
  if (t === "admin_forgive") return "Admin Forgive";
  return t;
}

const LOC_PAYMENT_TYPES = new Set(["repay", "auto_payment", "garnishment", "distress_drain"]);

export function CentralBankAdminTab({ countryId }: Props) {
  const { formatAmount } = useCurrency();
  const [pendingRate, setPendingRate] = useState<number | null>(null);
  const [primeRate, setPrimeRate] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  const [chairLocked, setChairLocked] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const [tracker, setTracker] = useState<TrackerResponse | null>(null);
  const [trackerLoading, setTrackerLoading] = useState(true);
  const [trackerError, setTrackerError] = useState<string | null>(null);

  const [savingsTracker, setSavingsTracker] = useState<SavingsTrackerResponse | null>(null);
  const [savingsLoading, setSavingsLoading] = useState(true);
  const [savingsError, setSavingsError] = useState<string | null>(null);

  const [selection, setSelection] = useState<AccountSelection | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [depositDetail, setDepositDetail] = useState<DepositDetailResponse | null>(null);
  const [loanDetail, setLoanDetail] = useState<LoanDetailResponse | null>(null);

  const loadCbMeta = useCallback(async () => {
    try {
      const res = await fetch(centralBankApiUrl(countryId));
      if (!res.ok) throw new Error("Failed to load bank");
      const j = await res.json();
      setPrimeRate(j.primeRate as number);
      setPendingRate(null);
      setChairLocked(j.chairControlsLocked === true);
    } catch {
      setPrimeRate(null);
    }
  }, [countryId]);

  const loadTracker = useCallback(async () => {
    setTrackerLoading(true);
    setTrackerError(null);
    try {
      const res = await fetch(
        `/api/admin/country/${countryId.toLowerCase()}/central-bank/loan-tracker`
      );
      const j = (await res.json()) as TrackerResponse & { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Failed to load loan tracker");
      setTracker(j);
    } catch (e) {
      setTracker(null);
      setTrackerError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setTrackerLoading(false);
    }
  }, [countryId]);

  const loadSavingsTracker = useCallback(async () => {
    setSavingsLoading(true);
    setSavingsError(null);
    try {
      const res = await fetch(
        `/api/admin/country/${countryId.toLowerCase()}/central-bank/savings-tracker`
      );
      const j = (await res.json()) as SavingsTrackerResponse & { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Failed to load deposit accounts");
      setSavingsTracker(j);
    } catch (e) {
      setSavingsTracker(null);
      setSavingsError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setSavingsLoading(false);
    }
  }, [countryId]);

  const loadAccountDetail = useCallback(
    async (sel: AccountSelection) => {
      setDetailLoading(true);
      setDetailError(null);
      setDepositDetail(null);
      setLoanDetail(null);
      try {
        const qs = new URLSearchParams({
          characterId: sel.characterId,
          type: sel.kind === "deposit" ? "deposit" : "loan",
        });
        const res = await fetch(
          `/api/admin/country/${countryId.toLowerCase()}/central-bank/account/detail?${qs}`
        );
        const j = await res.json();
        if (!res.ok) throw new Error((j as { error?: string }).error ?? "Failed to load account");
        if (sel.kind === "deposit") {
          setDepositDetail(j as DepositDetailResponse);
        } else {
          setLoanDetail(j as LoanDetailResponse);
        }
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setDetailLoading(false);
      }
    },
    [countryId]
  );

  useEffect(() => {
    void loadCbMeta();
  }, [loadCbMeta]);

  useEffect(() => {
    void loadTracker();
  }, [loadTracker]);

  useEffect(() => {
    void loadSavingsTracker();
  }, [loadSavingsTracker]);

  useEffect(() => {
    if (selection) void loadAccountDetail(selection);
  }, [selection, loadAccountDetail]);

  const handleRateSubmit = async () => {
    if (pendingRate === null || primeRate === null) return;
    setSubmitting(true);
    setRateError(null);
    try {
      const res = await fetch(`${centralBankApiUrl(countryId)}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rate: pendingRate,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to update rate");
      }
      await loadCbMeta();
      setReason("");
      await loadTracker();
      await loadSavingsTracker();
    } catch (err) {
      setRateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLock = async () => {
    setLockBusy(true);
    setLockError(null);
    try {
      const res = await fetch(
        `/api/admin/country/${countryId.toLowerCase()}/central-bank/admin/chair-controls`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locked: !chairLocked }),
        }
      );
      const j = (await res.json()) as { error?: string; chairControlsLocked?: boolean };
      if (!res.ok) throw new Error(j.error ?? "Failed to update lock");
      setChairLocked(j.chairControlsLocked === true);
      await loadCbMeta();
    } catch (e) {
      setLockError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLockBusy(false);
    }
  };

  const selectDeposit = (characterId: string) => {
    setSelection({ kind: "deposit", characterId });
  };

  const selectLoan = (characterId: string) => {
    setSelection({ kind: "loan", characterId });
  };

  const clearSelection = () => {
    setSelection(null);
    setDepositDetail(null);
    setLoanDetail(null);
    setDetailError(null);
  };

  const handleLoanAction = useCallback(
    async (action: "forgive_arrears" | "unfreeze") => {
      if (!loanDetail || !selection) return;
      const res = await fetch("/api/admin/loc/forgive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: selection.characterId,
          currency: loanDetail.currencyCode,
          action,
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Action failed");
      await loadAccountDetail(selection);
      void loadTracker();
    },
    [loanDetail, selection, loadAccountDetail, loadTracker]
  );

  const currentRate = pendingRate ?? primeRate ?? 0;
  const currencyCode = tracker?.currencyCode ?? savingsTracker?.currencyCode ?? "USD";

  const refreshAll = () => {
    void loadTracker();
    void loadSavingsTracker();
    if (selection) void loadAccountDetail(selection);
  };

  return (
    <div className="space-y-8 pb-16">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">
            Prime rate (admin)
          </h2>
          <p className="mb-4 text-xs text-muted">
            Same effect as the chair control, and logged on the central bank history. You do not
            need to hold the chair seat.
          </p>
          {primeRate === null ? (
            <Skeleton className="h-32 w-full rounded-xl" />
          ) : (
            <>
              <p className="text-3xl font-bold text-foreground tabular-nums">
                {primeRate.toFixed(2)}%
              </p>
              <div className="mt-4 space-y-3 border-t border-card-border pt-4">
                <label className="text-xs font-medium text-muted">Set rate</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingRate(Math.max(0, (pendingRate ?? primeRate) - 0.25))}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-card-elevated text-foreground hover:bg-primary/10 hover:border-primary/30 transition-colors"
                    disabled={submitting}
                  >
                    −
                  </button>
                  <span className="min-w-[4rem] text-center text-lg font-semibold text-foreground tabular-nums">
                    {currentRate.toFixed(2)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingRate(Math.min(25, (pendingRate ?? primeRate) + 0.25))}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-card-elevated text-foreground hover:bg-primary/10 hover:border-primary/30 transition-colors"
                    disabled={submitting}
                  >
                    +
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={200}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-primary/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleRateSubmit()}
                  disabled={submitting || pendingRate === null || pendingRate === primeRate}
                  className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {submitting ? "Updating..." : "Apply rate"}
                </button>
                {rateError && <p className="text-xs text-error">{rateError}</p>}
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-card-border bg-card p-5">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted">
            Chair controls
          </h2>
          <p className="mb-4 text-xs text-muted">
            When locked, the seated chair cannot change the prime rate from the Overview tab (you
            can still adjust it here).
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                chairLocked
                  ? "bg-warning/15 text-warning border border-warning/30"
                  : "bg-success/10 text-success border border-success/30"
              }`}
            >
              {chairLocked ? "Locked for chair" : "Chair may adjust"}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={lockBusy}
              onClick={() => void toggleLock()}
            >
              {lockBusy
                ? "Saving..."
                : chairLocked
                  ? "Unlock chair controls"
                  : "Lock chair controls"}
            </Button>
          </div>
          {lockError && <p className="mt-2 text-xs text-error">{lockError}</p>}
        </div>
      </div>

      {/* Deposit accounts */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
        <div className="border-b border-card-border bg-card-elevated px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Deposit accounts</h2>
            <p className="text-xs text-muted">
              Savings accounts opened at this central bank ({currencyCode}). Click a row for ledger
              and balances.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void loadSavingsTracker()}
            disabled={savingsLoading}
          >
            Refresh
          </Button>
        </div>

        {savingsLoading && !savingsTracker ? (
          <div className="p-6">
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : savingsError ? (
          <div className="p-6 text-sm text-error">{savingsError}</div>
        ) : !savingsTracker?.accounts.length ? (
          <div className="p-6">
            <EmptyState
              title="No deposit accounts"
              description="No opened savings in this currency."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-card-elevated/40 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2">Account holder</th>
                  <th className="px-4 py-2 text-right tabular-nums">Savings balance</th>
                  <th className="px-4 py-2 text-right tabular-nums">Wallet ({currencyCode})</th>
                  <th className="px-4 py-2 text-right tabular-nums">Pending interest</th>
                  <th className="px-4 py-2 text-right tabular-nums">Lifetime interest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/50">
                {savingsTracker.accounts.map((a) => {
                  const isSelected =
                    selection?.kind === "deposit" && selection.characterId === a.characterId;
                  return (
                    <tr
                      key={a.characterId}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectDeposit(a.characterId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectDeposit(a.characterId);
                        }
                      }}
                      className={`cursor-pointer hover:bg-card-elevated/40 ${
                        isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""
                      }`}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar url={a.avatarUrl} name={a.name} size="h-8 w-8" />
                          <span className="font-medium text-foreground truncate max-w-[220px]">
                            {a.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatNative(a.savingsBalanceFace, currencyCode as CurrencyCode)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">
                        {formatNative(a.walletBalanceFace, currencyCode as CurrencyCode)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">
                        {formatNative(a.pendingInterestFace, currencyCode as CurrencyCode)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">
                        {formatNative(a.lifetimeInterestEarnedFace, currencyCode as CurrencyCode)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Loan tracker */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
        <div className="border-b border-card-border bg-card-elevated px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Loan accounts</h2>
            <p className="text-xs text-muted">
              Outstanding player loans in this currency. Click a row for the details and ledger.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void loadTracker()}
            disabled={trackerLoading}
          >
            Refresh
          </Button>
        </div>

        {trackerLoading && !tracker ? (
          <div className="p-6">
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : trackerError ? (
          <div className="p-6 text-sm text-error">{trackerError}</div>
        ) : !tracker?.borrowers.length ? (
          <div className="p-6">
            <EmptyState
              title="No loan accounts"
              description="No loan balances or arrears in this currency."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-card-elevated/40 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2">Borrower</th>
                  <th className="px-4 py-2 text-right tabular-nums">Outstanding</th>
                  <th className="px-4 py-2 text-right tabular-nums">Credit limit</th>
                  <th className="px-4 py-2 text-right">Utilization</th>
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2 text-right tabular-nums">Turns to repay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/50">
                {tracker.borrowers.map((b) => {
                  const utilPct = (b.utilization * 100).toFixed(0);
                  const repayLabel =
                    b.turnsToRepay === null
                      ? "-"
                      : b.turnsToRepay >= 50000
                        ? "50k+"
                        : String(b.turnsToRepay);
                  const statusClass =
                    b.paymentStatus === "Distressed"
                      ? "text-error"
                      : b.paymentStatus === "At risk"
                        ? "text-warning"
                        : "text-success";
                  const isSelected =
                    selection?.kind === "loan" && selection.characterId === b.characterId;
                  return (
                    <tr
                      key={b.characterId}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectLoan(b.characterId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectLoan(b.characterId);
                        }
                      }}
                      className={`cursor-pointer hover:bg-card-elevated/40 ${
                        isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""
                      }`}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar url={b.avatarUrl} name={b.name} size="h-8 w-8" />
                          <span className="font-medium text-foreground truncate max-w-[200px]">
                            {b.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatAmount(b.outstandingInternal)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {b.creditLimitInternal > 0 ? formatAmount(b.creditLimitInternal) : "-"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{utilPct}%</td>
                      <td className={`px-4 py-2 text-xs font-semibold ${statusClass}`}>
                        {b.paymentStatus}
                        {b.drawFrozen ? " · frozen" : ""}
                      </td>
                      <td className="px-4 py-2 text-right text-muted tabular-nums">{repayLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-card-border px-4 py-3 text-[11px] text-muted">
          Payment status compares next scheduled auto-pay to wallet balance in this currency
          (Distressed = draws frozen). Turns to repay assumes ideal auto-pay each turn at current
          rates. Real wallets may pay it off sooner or later.
        </p>
      </div>

      {/* Account detail */}
      {selection && (
        <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {selection.kind === "deposit" ? "Deposit account" : "Loan account"}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Admin view: the same data players see on Savings and Line of Credit, plus ledgers.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => refreshAll()}>
                Refresh data
              </Button>
              <Button type="button" variant="secondary" onClick={() => clearSelection()}>
                Close
              </Button>
            </div>
          </div>

          {detailLoading && (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          )}

          {detailError && <p className="text-sm text-error">{detailError}</p>}

          {!detailLoading && depositDetail && selection.kind === "deposit" && (
            <DepositDetailPanel detail={depositDetail} formatNative={formatNative} />
          )}

          {!detailLoading && loanDetail && selection.kind === "loan" && (
            <LoanDetailPanel
              detail={loanDetail}
              formatAmount={formatAmount}
              formatNative={formatNative}
              onAdminAction={handleLoanAction}
            />
          )}
        </div>
      )}
    </div>
  );
}

function DepositDetailPanel({
  detail,
  formatNative,
}: {
  detail: DepositDetailResponse;
  formatNative: (amount: number, currency: CurrencyCode) => string;
}) {
  const c = detail.currencyCode;
  const href = `/character/${detail.character.sequentialId ?? detail.character.characterId}`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar url={detail.character.avatarUrl} name={detail.character.name} size="h-10 w-10" />
        <div>
          <Link href={href} className="text-base font-semibold text-foreground hover:text-primary">
            {detail.character.name}
          </Link>
          <p className="text-xs text-muted">
            APY {detail.apyPercent.toFixed(2)}% (½ real rate · prime {detail.primeRate.toFixed(2)}%)
            · Credit in {turnsUntilLabel(detail.turnsUntilCredit)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatBox label="Savings balance" value={formatNative(detail.savingsBalance, c)} />
        <StatBox label="Wallet (liquid)" value={formatNative(detail.liquidBalance, c)} />
        <StatBox label="Pending interest" value={formatNative(detail.pendingInterest, c)} />
        <StatBox label="Lifetime interest" value={formatNative(detail.lifetimeInterestEarned, c)} />
      </div>
      <p className="text-[11px] text-muted">
        Est. accrual this turn: {formatNative(detail.estimatedAccrualThisTurn, c)} · Account opened:{" "}
        {detail.accountOpened ? "yes" : "no"}
      </p>

      <div className="overflow-x-auto rounded-lg border border-card-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-card-elevated/40 text-[10px] font-semibold uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Balance after</th>
              <th className="px-3 py-2 text-right hidden sm:table-cell">Turn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border/50">
            {detail.ledger.map((row, i) => (
              <tr key={`${row.createdAt}-${i}`}>
                <td className="px-3 py-2">{formatSavingsLedgerType(row.type)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatNative(row.amount, row.currencyCode as CurrencyCode)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">
                  {formatNative(row.balanceAfter, row.currencyCode as CurrencyCode)}
                </td>
                <td className="px-3 py-2 text-right text-muted hidden sm:table-cell">
                  {row.turn != null ? `T${row.turn}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted text-center">
        The savings history chart uses portfolio snapshots. Open the player Savings tab for the
        graph.
      </p>
    </div>
  );
}

function LoanDetailPanel({
  detail,
  formatAmount,
  formatNative,
  onAdminAction,
}: {
  detail: LoanDetailResponse;
  formatAmount: (n: number) => string;
  formatNative: (amount: number, currency: CurrencyCode) => string;
  onAdminAction: (action: "forgive_arrears" | "unfreeze") => Promise<void>;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = async (action: "forgive_arrears" | "unfreeze") => {
    setActionLoading(action);
    setActionError(null);
    try {
      await onAdminAction(action);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const c = detail.currencyCode;
  const href = `/character/${detail.character.sequentialId ?? detail.character.characterId}`;
  const snap = detail.snapshot;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar url={detail.character.avatarUrl} name={detail.character.name} size="h-10 w-10" />
        <div>
          <Link href={href} className="text-base font-semibold text-foreground hover:text-primary">
            {detail.character.name}
          </Link>
          <p className="text-xs text-muted">
            Effective {detail.effectiveRatePercent.toFixed(2)}% at this bank (prime{" "}
            {detail.primeRate.toFixed(2)}%
            {snap ? ` + spread ${snap.spreadPercentPoints.toFixed(2)}%` : ""})
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatBox label="Principal" value={formatNative(detail.principalFace, c)} />
        <StatBox label="Arrears" value={formatNative(detail.arrearsFace, c)} />
        <StatBox
          label="Draws"
          value={detail.drawFrozen ? "Frozen" : "Active"}
          valueClass={detail.drawFrozen ? "text-warning" : "text-success"}
        />
        {snap ? (
          <>
            <StatBox
              label="Outstanding (internal)"
              value={formatAmount(snap.outstandingInternal)}
            />
            <StatBox
              label="Credit limit (internal)"
              value={formatAmount(snap.perPlayerLimitInternal)}
            />
            <StatBox label="Composite" value={snap.composite.toFixed(0)} />
          </>
        ) : (
          <StatBox label="Snapshot" value="Unavailable" />
        )}
      </div>

      {(detail.arrearsFace > 0 || detail.drawFrozen) && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 space-y-3">
          <p className="text-xs font-semibold text-warning uppercase tracking-wide">
            Admin actions
          </p>
          <div className="flex flex-wrap gap-2">
            {detail.arrearsFace > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleAction("forgive_arrears")}
                disabled={actionLoading !== null}
              >
                {actionLoading === "forgive_arrears"
                  ? "Forgiving…"
                  : `Forgive ${formatNative(detail.arrearsFace, c)} arrears`}
              </Button>
            )}
            {detail.drawFrozen && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleAction("unfreeze")}
                disabled={actionLoading !== null}
              >
                {actionLoading === "unfreeze" ? "Unfreezing…" : "Force-unfreeze draws"}
              </Button>
            )}
          </div>
          {actionError && <p className="text-xs text-error">{actionError}</p>}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-card-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-card-elevated/40 text-[10px] font-semibold uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right hidden md:table-cell">Interest</th>
              <th className="px-3 py-2 text-right hidden md:table-cell">Principal</th>
              <th className="px-3 py-2 text-right">Principal after</th>
              <th className="px-3 py-2 text-right">Arrears after</th>
              <th className="px-3 py-2 text-right hidden sm:table-cell">Turn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border/50">
            {detail.ledger.map((row, i) => {
              const cc = row.currencyCode as CurrencyCode;
              const isPayment = LOC_PAYMENT_TYPES.has(row.type);
              const negate = isPayment ? "−" : "+";
              const hasSplit =
                isPayment &&
                (row.interestPortion !== undefined || row.principalPortion !== undefined);
              return (
                <tr key={`${row.createdAt}-${i}`}>
                  <td className="px-3 py-2">{formatLocLedgerType(row.type)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {negate}
                    {formatNative(row.amount, cc)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted hidden md:table-cell">
                    {hasSplit ? formatNative(row.interestPortion ?? 0, cc) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted hidden md:table-cell">
                    {hasSplit ? formatNative(row.principalPortion ?? 0, cc) : "-"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {formatNative(row.balanceAfter, cc)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {formatNative(row.arrearsAfter, cc)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted hidden sm:table-cell">
                    {row.turn != null ? `T${row.turn}` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-card-border/60 bg-card-muted px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted font-semibold">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${valueClass ?? "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function turnsUntilLabel(n: number): string {
  if (n <= 1) return "the next turn";
  return `${n} turns`;
}
