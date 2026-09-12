"use client";

import { useState } from "react";
import Link from "next/link";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatRatePercent } from "@/components/banking/formatBankMoney";
import type { ShowToast } from "../types";

/**
 * Customer-facing actions on a bank's own page: deposit into this bank, or open
 * the shared credit review in /banking. Shown to any viewer (the CEO manages
 * the bank through the other panels). Deposit routes this currency's savings
 * to this bank.
 */
export function CustomerBankPanel({
  corporationId,
  bankName,
  currency,
  depositTaking,
  depositRatePercent,
  onChanged,
  showToast,
}: {
  corporationId: string;
  bankName: string;
  currency: CurrencyCode;
  depositTaking: boolean;
  depositRatePercent: number | null;
  onChanged: () => void;
  showToast: ShowToast;
}) {
  const [depositAmount, setDepositAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const deposit = async () => {
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter a deposit amount", "error");
      return;
    }
    setBusy(true);
    try {
      // Make sure the currency bucket exists; an already-open account returns a
      // harmless 400, so this is deliberately best-effort.
      try {
        await fetch("/api/character/savings/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currency }),
        });
      } catch {
        // Non-fatal: the deposit below reports the real error if the bucket is missing.
      }
      const res = await fetch("/api/character/savings/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency, amount, holder: corporationId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error ?? "Deposit failed", "error");
        return;
      }
      if (json.holderRouted === false) {
        showToast(
          `Deposited, but could not route to ${bankName}: ${json.holderError ?? "unavailable"}`,
          "error"
        );
      } else {
        showToast(
          `Deposited ${amount.toLocaleString("en-US")} ${currency} with ${bankName}`,
          "success"
        );
      }
      setDepositAmount("");
      onChanged();
    } catch {
      showToast("Deposit failed", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!depositTaking) {
    // Investment charters do not take retail deposits or lend to individuals.
    return null;
  }

  const inputClass =
    "w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-mono tabular-nums focus:border-accent focus:outline-none";
  const btnClass =
    "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section id="customer-banking" className="grid scroll-mt-6 gap-4 sm:grid-cols-2">
      <div id="customer-deposit" className="rounded-xl border border-card-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Deposit savings at {bankName}</h3>
          {depositRatePercent != null && (
            <span className="font-mono text-xs font-semibold tabular-nums text-success">
              {formatRatePercent(depositRatePercent)} deposit rate
            </span>
          )}
        </div>
        <p className="mt-1 mb-3 text-xs text-muted">
          Moves your {currency} savings to this bank, so it earns this bank&apos;s deposit rate. You
          hold one bank per currency, so this moves your whole {currency} savings here.
        </p>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder={`Amount (${currency})`}
            aria-label={`Deposit amount in ${currency}`}
            className={inputClass}
          />
          <button type="button" disabled={busy} onClick={() => void deposit()} className={btnClass}>
            {busy ? "…" : "Deposit"}
          </button>
        </div>
      </div>

      <div id="customer-loan" className="rounded-xl border border-card-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Apply for a loan from {bankName}</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Review a personal or corporation loan in the banking hub. It shows the quoted rate,
          destination, payment estimate, maximum, and approval status before you submit.
        </p>
        <Link
          href="/banking"
          className="inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90"
        >
          Review loan terms
        </Link>
      </div>
    </section>
  );
}
