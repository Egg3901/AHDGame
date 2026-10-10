"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState, Skeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { CB_TH, CentralBankFigure, CentralBankSection } from "./CentralBankSection";
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
  availableBorrowFace?: number;
  poolCurrency?: CurrencyCode;
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
  policySpreadAdjustmentPercentPoints?: number;
  policyDepositBonusPercentPoints?: number;
  policyPricingProgress?: number;
  policyPricingTurnsRemaining?: number;
  policyPricingActive?: boolean;
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
          setError(apiErrorText(j, "Failed to load"));
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
        showToast(apiErrorText(j, "Failed"), "error");
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
    const storageKey = `loc-command:${data?.characterId ?? "unknown"}:${cbCurrency}:draw`;
    const quote = JSON.stringify({ currency: cbCurrency, amount: n });
    let pending: { quote: string; commandId: string } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    } catch {
      /* discard corrupt local receipt */
    }
    if (pending?.quote !== quote) pending = { quote, commandId: crypto.randomUUID() };
    sessionStorage.setItem(storageKey, JSON.stringify(pending));
    setBusy(true);
    try {
      const res = await fetch("/api/character/loc/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: cbCurrency, amount: n, commandId: pending.commandId }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status < 500) sessionStorage.removeItem(storageKey);
        showToast(apiErrorText(j, "Failed"), "error");
        return;
      }
      sessionStorage.removeItem(storageKey);
      showToast("Borrowed to wallet", "success");
      setDrawAmt("");
      requestCharacterStatsRefetch();
      void load();
    } catch {
      showToast(
        "The result could not be confirmed. Retry the same amount to check this command.",
        "error"
      );
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
    const storageKey = `loc-command:${data?.characterId ?? "unknown"}:${cbCurrency}:repay`;
    const quote = JSON.stringify({ currency: cbCurrency, amount: n });
    let pending: { quote: string; commandId: string } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    } catch {
      /* discard corrupt local receipt */
    }
    if (pending?.quote !== quote) pending = { quote, commandId: crypto.randomUUID() };
    sessionStorage.setItem(storageKey, JSON.stringify(pending));
    setBusy(true);
    try {
      const res = await fetch("/api/character/loc/repay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: cbCurrency, amount: n, commandId: pending.commandId }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status < 500) sessionStorage.removeItem(storageKey);
        showToast(apiErrorText(j, "Failed"), "error");
        return;
      }
      sessionStorage.removeItem(storageKey);
      showToast("Repayment applied", "success");
      setRepayAmt("");
      requestCharacterStatsRefetch();
      void load();
    } catch {
      showToast(
        "The result could not be confirmed. Retry the same amount to check this command.",
        "error"
      );
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
  // Rate at this CB = THIS bank's prime + the player's credit spread + the
  // shared central-bank pricing adjustment.
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
  const policySpreadAdjustment = s.policySpreadAdjustmentPercentPoints ?? 0;
  const policyDepositBonus = s.policyDepositBonusPercentPoints ?? 0;
  const baseRateHere = cbPrime + s.spreadPercentPoints + policySpreadAdjustment;
  const effectiveRateHere =
    baseRateHere + (ioSurchargeActive ? LOC_IO_SURCHARGE_PERCENT_POINTS : 0);
  const spreadSign = s.spreadPercentPoints >= 0 ? "+" : "";
  const policySpreadSign = policySpreadAdjustment >= 0 ? "+" : "";
  const policyPricingInProgress = (s.policyPricingProgress ?? 0) < 1;
  const usagePctText = (usedPct * 100).toFixed(0);
  const usageColor =
    usedPct >= 0.9 ? "bg-error" : usedPct >= 0.7 ? "bg-warning" : "bg-foreground/50";

  return (
    <div className="space-y-12 pb-16">
      {/* Figures: your rate, outstanding, available, system pool */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
        <CentralBankFigure
          label="Your rate"
          value={`${effectiveRateHere.toFixed(2)}%`}
          hint={
            ioSurchargeActive
              ? `Prime ${cbPrime.toFixed(2)}% + your credit spread ${spreadSign}${s.spreadPercentPoints.toFixed(2)}% + central-bank adjustment ${policySpreadSign}${policySpreadAdjustment.toFixed(2)}% + interest-only ${LOC_IO_SURCHARGE_PERCENT_POINTS.toFixed(2)}% · credit score ${s.composite.toFixed(0)}/100`
              : `Prime ${cbPrime.toFixed(2)}% + your credit spread ${spreadSign}${s.spreadPercentPoints.toFixed(2)}% + central-bank adjustment ${policySpreadSign}${policySpreadAdjustment.toFixed(2)}% · credit score ${s.composite.toFixed(0)}/100`
          }
          size="lg"
        />
        <CentralBankFigure
          label="Outstanding"
          value={formatAmount(s.outstandingInternal)}
          hint={arrears > 0 ? `${formatNative(arrears, cbCurrency)} in arrears` : "No arrears"}
          valueClassName={arrears > 0 ? "text-warning" : "text-foreground"}
          size="lg"
        />
        <CentralBankFigure
          label="Available credit"
          value={noIncome && !equityOnlyMode ? "-" : formatAmount(s.perPlayerAvailableInternal)}
          hint={
            equityOnlyMode
              ? "Equity-backed only"
              : noIncome
                ? "No income"
                : `${usagePctText}% of limit used`
          }
          valueClassName={noIncome ? "text-warning" : "text-foreground"}
          size="lg"
        />
        <CentralBankFigure
          label="System pool"
          value={
            s.availableBorrowFace !== undefined
              ? formatNative(s.availableBorrowFace, cbCurrency)
              : formatAmount(s.availableBorrowInternal)
          }
          hint={`This bank's lending pool, shared across all borrowers. Your credit limit is shared across every bank.`}
          size="lg"
        />
      </div>

      {s.policyPricingActive && (
        <p className="-mt-6 max-w-3xl text-body-sm leading-relaxed text-muted">
          <span className="font-semibold text-foreground">Central-bank pricing update.</span> LOCs
          currently include a {policySpreadSign}
          {policySpreadAdjustment.toFixed(2)} percentage-point central-bank adjustment. The target
          is +2.00 points over prime. Central-bank deposits currently receive an extra +
          {policyDepositBonus.toFixed(2)} points, targeting +0.25 points
          {policyPricingInProgress && (s.policyPricingTurnsRemaining ?? 0) > 0
            ? ` over the next ${s.policyPricingTurnsRemaining} turns.`
            : "."}
        </p>
      )}

      {/* Frozen / income callouts: each needs the player to act. */}
      {s.drawFrozen && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
          <p className="text-body font-semibold text-warning">Draws frozen</p>
          <p className="mt-1 text-body-sm text-muted">
            Your missed interest has accrued as arrears. Repay the balance to unfreeze borrowing.
          </p>
        </div>
      )}
      {noIncome && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
          <p className="text-body font-semibold text-warning">No qualifying income detected</p>
          <p className="mt-1 text-body-sm text-muted">
            You need a recent history of bond coupons, CEO salary, or dividends before you can
            borrow. The bank now looks at your average recurring income over the last 48 turns, not
            just a single good hour.
          </p>
        </div>
      )}

      {/* Two columns: limit and account on the left, borrow and repay on the right */}
      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-3">
        <div className="space-y-10 lg:col-span-2">
          <CentralBankSection
            title="Credit limit"
            action={
              <span className="text-body tabular-nums text-muted">
                {formatAmount(s.outstandingInternal)} /{" "}
                <span className="font-semibold text-foreground">
                  {noIncome && !equityOnlyMode ? "-" : formatAmount(s.perPlayerLimitInternal)}
                </span>
              </span>
            }
          >
            <div className="h-2 w-full overflow-hidden rounded-full bg-track">
              <div
                className={`h-full rounded-full ${usageColor}`}
                style={{ width: `${(usedPct * 100).toFixed(1)}%` }}
              />
            </div>
            {(!noIncome || equityOnlyMode) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-body-sm tabular-nums text-muted">
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
            <p className="mt-2 max-w-3xl text-body-sm text-muted">
              {equityOnlyMode
                ? "No income history yet, so you can only borrow against what you own. The income cap grows as bond coupons, salary, or dividends build up over the last 48 turns."
                : "Your limit is the lower of the two caps above. The income cap grows as bond coupons, salary, or dividends build up over the last 48 turns."}
            </p>
          </CentralBankSection>

          {/* The account is interactive (open it, choose how it pays), so it keeps a card. */}
          <div className="rounded-xl border border-card-border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-body-lg font-semibold text-foreground">{cbCurrency} account</h2>
              <span className="text-body-sm text-muted">
                {opened && <FundingBadge source={fundingSource} />}
                {opened ? "Open" : "Not opened"}
              </span>
            </div>
            {opened ? (
              <div className="grid grid-cols-2 gap-4">
                <CentralBankFigure
                  label="Principal"
                  value={formatNative(balance, cbCurrency)}
                  size="lg"
                />
                <CentralBankFigure
                  label="Arrears"
                  value={formatNative(arrears, cbCurrency)}
                  valueClassName={arrears > 0 ? "text-warning" : "text-foreground"}
                  size="lg"
                />
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-body text-muted">
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

        {/* Borrow + repay forms */}
        <div className="space-y-6">
          <div className="rounded-xl border border-card-border bg-card p-5">
            <h2 className="mb-3 text-body-lg font-semibold text-foreground">Borrow</h2>
            {!opened ? (
              <p className="text-body-sm text-muted">Open the {cbCurrency} account first.</p>
            ) : noIncome && !equityOnlyMode ? (
              <p className="text-body-sm text-muted">Qualifying income required.</p>
            ) : s.drawFrozen ? (
              <p className="text-body-sm text-warning">Frozen. Clear your arrears first.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-body-sm text-muted">Amount ({sym})</label>
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
                <p className="text-body-sm text-muted">
                  {ioSurchargeActive
                    ? `Interest builds up every hour at ${effectiveRateHere.toFixed(2)}% a year. Auto-pay covers the interest only, so what you owe stays the same until you switch back to paying down the loan.`
                    : `Interest builds up every hour at ${effectiveRateHere.toFixed(2)}% a year and auto-pays from your income.`}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-card-border bg-card p-5">
            <h2 className="mb-3 text-body-lg font-semibold text-foreground">Repay</h2>
            {!opened ? (
              <p className="text-body-sm text-muted">No account open.</p>
            ) : balance <= 0 && arrears <= 0 ? (
              <p className="text-body-sm text-muted">Nothing outstanding.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-body-sm text-muted">Amount ({sym})</label>
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
                <p className="text-body-sm text-muted">
                  Applied to arrears first, then principal. Funds drawn from your personal wallet.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <CentralBankSection
        title="Transaction history"
        meta={`Most recent ${data.ledger.length} entries`}
      >
        {data.ledger.length === 0 ? (
          <p className="py-6 text-body text-muted">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body">
              <thead>
                <tr>
                  <th scope="col" className={CB_TH}>
                    Type
                  </th>
                  <th scope="col" className={`${CB_TH} text-right`}>
                    Amount
                  </th>
                  <th scope="col" className={`${CB_TH} hidden text-right md:table-cell`}>
                    Interest
                  </th>
                  <th scope="col" className={`${CB_TH} hidden text-right md:table-cell`}>
                    Principal
                  </th>
                  <th scope="col" className={`${CB_TH} text-right`}>
                    Balance after
                  </th>
                  <th scope="col" className={`${CB_TH} hidden text-right sm:table-cell`}>
                    Turn
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((row, i) => {
                  const c = row.currencyCode as CurrencyCode;
                  const isPayment =
                    row.type === "repay" ||
                    row.type === "auto_payment" ||
                    row.type === "garnishment";
                  const negate = isPayment ? "-" : "+";
                  const hasSplit =
                    (row.type === "repay" ||
                      row.type === "auto_payment" ||
                      row.type === "garnishment") &&
                    (row.interestPortion !== undefined || row.principalPortion !== undefined);
                  return (
                    <tr key={`${row.createdAt}-${i}`} className="border-b border-card-border/60">
                      <td className="py-2 pr-4">{formatLedgerType(row.type)}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {negate}
                        {formatNative(row.amount, c)}
                      </td>
                      <td className="hidden py-2 pr-4 text-right font-mono tabular-nums text-muted md:table-cell">
                        {hasSplit ? formatNative(row.interestPortion ?? 0, c) : "-"}
                      </td>
                      <td className="hidden py-2 pr-4 text-right font-mono tabular-nums text-muted md:table-cell">
                        {hasSplit ? formatNative(row.principalPortion ?? 0, c) : "-"}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums text-muted">
                        {formatNative(row.balanceAfter, c)}
                      </td>
                      <td className="hidden py-2 pr-4 text-right font-mono tabular-nums text-muted sm:table-cell">
                        {row.turn != null ? row.turn : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CentralBankSection>

      <p className="text-body-sm text-muted">
        <Link
          href="/portfolio?section=loans"
          className="font-medium text-foreground underline decoration-card-border underline-offset-4 hover:decoration-foreground"
        >
          View loans in portfolio
        </Link>
      </p>
    </div>
  );
}

function FundingBadge({ source }: { source: LoanFundingSource }) {
  const label: Record<LoanFundingSource, string> = {
    deposits: "Deposits",
    reserves: "Reserves",
    both: "Split 50/50",
  };
  return (
    <span
      className="mr-2"
      title="Funding pool: where the money comes from when you borrow, and goes back to when you repay"
    >
      Funded: {label[source]} ·
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
        showToast(apiErrorText(j, "Failed to update"), "error");
        return;
      }
      showToast(`Funding source set to ${next}`, "success");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-card-border pt-4">
      <p className="text-body font-semibold text-foreground">Admin: funding source</p>
      <p className="mt-1 text-body-sm text-muted">
        Sets which pool later borrowing and repayments flow through. Money already taken from a pool
        is not moved. Only future flows change.
      </p>
      <div className="mt-2 inline-flex rounded-md border border-card-border bg-background p-0.5 text-body-sm font-semibold">
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
            {opt === "both" ? "50/50" : opt === "deposits" ? "Deposits" : "Reserves"}
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
        showToast(apiErrorText(j, "Failed to change mode"), "error");
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
    <div className="mt-4 border-t border-card-border pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body font-semibold text-foreground">Payment mode</p>
        <span className="text-body-sm text-muted">
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
        <div className="mt-2 text-body-sm">
          <p className="text-foreground">
            Switching <strong>{currency}</strong> to interest only. What you owe will stop going
            down, because every auto-payment goes to interest. Your rate at {bankAbbr} rises from{" "}
            <strong>{effectiveRateHerePI.toFixed(2)}%</strong> to{" "}
            <strong>{effectiveRateHereIO.toFixed(2)}%</strong>. Locked for{" "}
            {LOC_PAYMENT_MODE_COOLDOWN_TURNS} turns after the switch.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-card-border px-3 py-1 text-body-sm font-semibold text-foreground hover:bg-card-elevated"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-warning px-3 py-1 text-body-sm font-semibold text-white hover:bg-warning/90 disabled:opacity-60"
              onClick={() => void submit("io")}
              disabled={pending}
            >
              Pay interest only
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 inline-flex flex-wrap rounded-md border border-card-border bg-background p-0.5 text-body-sm font-semibold">
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
      <p className="mt-2 text-body-sm text-muted">
        Paying down the loan is the default: each turn a set share of what you owe is paid off.
        Paying interest only covers the interest and nothing more, so the debt never shrinks. You
        must wait {LOC_PAYMENT_MODE_COOLDOWN_TURNS} turns between switches.
      </p>
    </div>
  );
}
