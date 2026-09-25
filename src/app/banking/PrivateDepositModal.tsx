"use client";

import { useState } from "react";
import { Button, Input, useDialogA11y } from "@/components/ui";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";

type DepositBank = {
  corporationId: string;
  name: string;
  currency: CurrencyCode;
  depositRatePercent: number;
};

type ShowToast = (msg: string, type?: "success" | "error" | "info" | "warning") => void;

export function PrivateDepositModal({
  bank,
  availableCash,
  onClose,
  onChanged,
  showToast,
}: {
  bank: DepositBank;
  availableCash: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const { dialogProps, titleId } = useDialogA11y(onClose);
  const [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amount = Number(amountText);
  const canSubmit = !busy && Number.isFinite(amount) && amount > 0 && amount <= availableCash;

  const submit = async () => {
    setError("");
    if (!Number.isFinite(amount) || amount <= 0 || amount > availableCash) {
      setError(
        `Enter an amount up to your ${formatBankMoney(availableCash, bank.currency)} wallet balance.`
      );
      return;
    }

    setBusy(true);
    try {
      // Opening an existing savings account returns an error, so use this as a
      // best-effort step before the deposit route checks the account state.
      await fetch("/api/character/savings/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: bank.currency }),
      });

      const response = await fetch("/api/character/savings/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: bank.currency, amount, holder: bank.corporationId }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        holderRouted?: boolean;
        holderError?: string;
      };
      if (!response.ok) {
        setError(json.error ?? "Deposit failed.");
        return;
      }

      if (json.holderRouted === false) {
        showToast(
          `Deposited, but could not route to ${bank.name}: ${json.holderError ?? "unavailable"}`,
          "error"
        );
      } else {
        showToast(
          `Deposited ${formatBankMoney(amount, bank.currency)} with ${bank.name}.`,
          "success"
        );
      }
      await onChanged();
      onClose();
    } catch {
      setError("Deposit failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      {...dialogProps}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-card-border bg-card shadow-modal">
        <div className="flex items-start justify-between border-b border-card-border px-6 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              Deposit with {bank.name}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Savings at this bank earn {formatRatePercent(bank.depositRatePercent)}. This routes
              your {bank.currency} savings balance to this bank.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 -mt-0.5 text-muted transition-colors hover:text-foreground"
            aria-label="Close"
          >
            <span className="text-xl leading-none" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <form
          className="space-y-4 px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="rounded-xl border border-card-border bg-background/45 p-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted">Available wallet balance</span>
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {formatBankMoney(availableCash, bank.currency)}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              The deposit moves cash into savings, then sets this bank as the holder for this
              currency. Your existing savings balance stays in the account.
            </p>
          </div>

          <label className="block space-y-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Deposit amount ({bank.currency})
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              max={availableCash}
              step="any"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              placeholder="0"
              aria-label={`Deposit amount in ${bank.currency}`}
            />
          </label>

          {error && <p className="text-sm text-error">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-card-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? "Processing..." : "Deposit savings"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
