"use client";

import { useState } from "react";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/contexts/ToastContext";

function formatBalance(amount: number, currency: CurrencyCode): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  if (currency === "JPY") return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
  return `${symbol}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  currency: CurrencyCode;
  liquid: number;
  savingsBalance: number;
  accountOpened: boolean;
  apyPercent?: number;
  /** Accrued this quarter, not yet added to balance (forex). */
  pendingInterest?: number;
  /** Turns until pending is credited to balance (1–12). */
  turnsUntilCredit?: number;
  /** Estimated interest for the current turn (matches server accrual at this balance). */
  interestAccrualPerTurn?: number;
  onUpdated: () => void;
}

export function SavingsWalletBlock({
  currency,
  liquid,
  savingsBalance,
  accountOpened,
  apyPercent,
  pendingInterest,
  turnsUntilCredit,
  interestAccrualPerTurn,
  onUpdated,
}: Props) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<null | "deposit" | "withdraw">(null);
  const [amountStr, setAmountStr] = useState("");

  const run = async (path: string, body: object) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/character/savings/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error ?? "Request failed", "error");
        return;
      }
      showToast("Updated", "success");
      setPanel(null);
      setAmountStr("");
      onUpdated();
    } finally {
      setBusy(false);
    }
  };

  const onOpen = () => run("open", { currency });

  const parseAmount = (str: string) => {
    const cleaned = str.replace(/,/g, "");
    return currency === "JPY" ? parseInt(cleaned, 10) : parseFloat(cleaned);
  };

  const onConfirmDeposit = () => {
    const n = parseAmount(amountStr);
    if (!Number.isFinite(n) || n <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    void run("deposit", { currency, amount: n });
  };

  const onConfirmWithdraw = () => {
    const n = parseAmount(amountStr);
    if (!Number.isFinite(n) || n <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    void run("withdraw", { currency, amount: n });
  };

  const apyLabel =
    apyPercent !== undefined ? `${apyPercent.toFixed(2)}% APY` : "High-yield savings";

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-primary/15 bg-primary/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">
            Savings · {apyLabel}
          </div>
          <div className="text-xs text-muted">
            Yield is half of that currency&apos;s national prime rate. Interest accrues every turn;
            it is added to your savings balance every 12 turns.
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted">Balance</div>
          <div className="text-sm font-bold tabular-nums text-foreground">
            {formatBalance(savingsBalance, currency)}
          </div>
        </div>
      </div>

      {accountOpened &&
        savingsBalance > 0 &&
        interestAccrualPerTurn != null &&
        interestAccrualPerTurn > 0 &&
        turnsUntilCredit != null && (
          <p className="text-[11px] text-muted">
            About {formatBalance(interestAccrualPerTurn, currency)} interest this turn · balance
            credit in {turnsUntilCredit} turn{turnsUntilCredit === 1 ? "" : "s"}
            {pendingInterest != null && pendingInterest > 0 && (
              <> · {formatBalance(pendingInterest, currency)} accrued, not yet credited</>
            )}
          </p>
        )}

      {!accountOpened && liquid > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-md border border-dashed border-card-border bg-card/50 px-3 py-2">
          <p className="text-xs text-muted">
            Earn the rate above on cash you are not using. Open a savings account for {currency}.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="!h-9 !min-w-0 shrink-0 px-4 text-xs"
            disabled={busy}
            onClick={() => void onOpen()}
          >
            Open savings
          </Button>
        </div>
      )}

      {accountOpened && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="!h-9 !min-w-0 px-3 text-xs"
            disabled={busy || liquid <= 0}
            onClick={() => {
              setPanel(panel === "deposit" ? null : "deposit");
              setAmountStr("");
            }}
          >
            Deposit
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="!h-9 !min-w-0 px-3 text-xs"
            disabled={busy || savingsBalance <= 0}
            onClick={() => {
              setPanel(panel === "withdraw" ? null : "withdraw");
              setAmountStr("");
            }}
          >
            Withdraw
          </Button>
        </div>
      )}

      {accountOpened && panel === "deposit" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="text-[10px] font-medium uppercase text-muted">
              Amount ({currency})
            </label>
            <Input
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-[10px] text-muted">
              Available liquid: {formatBalance(liquid, currency)}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="!h-9 !min-w-0 shrink-0 px-4 text-xs"
            disabled={busy}
            onClick={onConfirmDeposit}
          >
            Confirm deposit
          </Button>
        </div>
      )}

      {accountOpened && panel === "withdraw" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="text-[10px] font-medium uppercase text-muted">
              Amount ({currency})
            </label>
            <Input
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-[10px] text-muted">
              In savings: {formatBalance(savingsBalance, currency)}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="!h-9 !min-w-0 shrink-0 px-4 text-xs"
            disabled={busy}
            onClick={onConfirmWithdraw}
          >
            Confirm withdraw
          </Button>
        </div>
      )}

      {!accountOpened && liquid <= 0 && (
        <p className="text-[11px] text-muted">
          Fund this currency to open savings and earn {apyLabel.replace(" APY", "")} annualized
          (accrues each turn; credited to balance every 12 turns).
        </p>
      )}
    </div>
  );
}
