"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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
import { CB_TH, CentralBankFigure, CentralBankSection } from "./CentralBankSection";

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
  savingsHolderType?: "central-bank" | "private-bank" | "unknown";
  savingsHolderName?: string | null;
  centralBankDepositBonusPercentPoints?: number;
  centralBankPricingProgress?: number;
  centralBankPricingTurnsRemaining?: number;
  centralBankPricingActive?: boolean;
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
  const t = useTranslations("centralBank");
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
        showToast(apiErrorText(j, "Request failed"), "error");
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
  const depositBonusInProgress = (data.centralBankPricingProgress ?? 0) < 1;

  return (
    <div className="space-y-12 pb-16">
      {/* Figures */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        <CentralBankFigure
          label={
            data.savingsHolderType === "private-bank" ? t("savings.yourBankRate") : t("savings.apy")
          }
          value={data.savingsHolderType === "unknown" ? "—" : `${data.apyPercent.toFixed(2)}%`}
          hint={
            data.savingsHolderType === "private-bank"
              ? t("savings.atBank", { bank: data.savingsHolderName ?? t("savings.privateBank") })
              : data.savingsHolderType === "unknown"
                ? t("savings.holderUnknown")
                : (data.centralBankDepositBonusPercentPoints ?? 0) > 0
                  ? t("savings.centralRateWithBonus", {
                      prime: data.primeRate.toFixed(2),
                      bonus: (data.centralBankDepositBonusPercentPoints ?? 0).toFixed(2),
                    })
                  : t("savings.centralRate", { prime: data.primeRate.toFixed(2) })
          }
          size="lg"
        />
        <CentralBankFigure
          label="Your balance"
          value={formatNative(data.savingsBalance, homeCurrency)}
          hint={data.accountOpened ? "Savings account" : "Not yet opened"}
          size="lg"
        />
        <CentralBankFigure
          label="Lifetime interest"
          value={formatNative(data.lifetimeInterestEarned, homeCurrency)}
          hint="Credited to balance every 12 turns"
          size="lg"
        />
        <CentralBankFigure
          label="Accrued (uncredited)"
          value={formatNative(data.pendingInterest, homeCurrency)}
          hint="Earned; adds to balance at next credit"
          size="lg"
        />
        <CentralBankFigure
          label="This turn (est.)"
          value={
            data.estimatedAccrualThisTurn > 0
              ? formatNative(data.estimatedAccrualThisTurn, homeCurrency)
              : "-"
          }
          hint={
            data.turnsUntilCredit === 1
              ? "Next balance credit this turn"
              : `Next credit in ${data.turnsUntilCredit} turns`
          }
          size="lg"
        />
        <CentralBankFigure
          label="System deposits"
          value={formatNative(data.totalNationalSavings, homeCurrency)}
          hint={`${data.currencyCode} system-wide`}
          size="lg"
        />
      </div>

      {data.centralBankPricingActive && (
        <p className="-mt-6 max-w-3xl text-body-sm leading-relaxed text-muted">
          <span className="font-semibold text-foreground">Central-bank deposit bonus.</span>{" "}
          Central-bank deposits currently receive an extra +
          {(data.centralBankDepositBonusPercentPoints ?? 0).toFixed(2)} percentage points.{" "}
          {depositBonusInProgress ? "The bonus will reach" : "The bonus has reached"} +0.25 points
          {depositBonusInProgress && (data.centralBankPricingTurnsRemaining ?? 0) > 0
            ? ` over the next ${data.centralBankPricingTurnsRemaining} turns.`
            : "."}
        </p>
      )}

      {/* Manage account + chart */}
      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-3">
        {/* The account is the one interactive object on the tab, so it keeps a card. */}
        <div className="space-y-4 self-start rounded-xl border border-card-border bg-card p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-body-lg font-semibold text-foreground">Your account</h2>
            <span className="text-body-sm text-muted">
              {data.accountOpened ? "Open" : "Not opened"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <CentralBankFigure
              label="Cash (liquid)"
              value={formatNative(data.liquidBalance, homeCurrency)}
            />
            <CentralBankFigure
              label="In savings"
              value={formatNative(data.savingsBalance, homeCurrency)}
            />
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
            <div className="space-y-3 border-t border-card-border pt-3">
              <label className="block text-body-sm text-muted">
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

          <p className="text-body-sm text-muted">
            Yield is credited each game turn. Funds stay in your wallet ledger until you withdraw.
          </p>
        </div>

        <CentralBankSection
          title="Balance over time"
          meta="Shown in the same money units as the cash history on your portfolio."
          className="lg:col-span-2"
        >
          {chartHistory.length >= 2 ? (
            <PortfolioChart history={chartHistory} view="savings" />
          ) : (
            <p className="py-10 text-center text-body text-muted">
              Not enough history yet. The chart appears after a few turns of activity.
            </p>
          )}
        </CentralBankSection>
      </div>

      <CentralBankSection
        title="Transaction ledger"
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
                  <th scope="col" className={`${CB_TH} text-right`}>
                    Balance after
                  </th>
                  <th scope="col" className={`${CB_TH} hidden text-right sm:table-cell`}>
                    Turn
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((row, i) => (
                  <tr key={`${row.createdAt}-${i}`} className="border-b border-card-border/60">
                    <td className="py-2 pr-4">{formatLedgerType(row.type)}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">
                      {row.type === "withdraw" ? "-" : "+"}
                      {formatNative(row.amount, homeCurrency)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums text-muted">
                      {formatNative(row.balanceAfter, homeCurrency)}
                    </td>
                    <td className="hidden py-2 pr-4 text-right font-mono tabular-nums text-muted sm:table-cell">
                      {row.turn != null ? row.turn : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CentralBankSection>

      <p className="text-body-sm text-muted">
        <Link
          href="/portfolio?section=cash"
          className="font-medium text-foreground underline decoration-card-border underline-offset-4 hover:decoration-foreground"
        >
          Currency wallet in portfolio
        </Link>
        {" · "}
        <span>{formatAmount(data.savingsBalance)} in display units</span>
      </p>
    </div>
  );
}
