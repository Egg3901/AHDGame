"use client";

import { useState } from "react";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ShowToast } from "../types";

/**
 * Customer-facing actions on a bank's own page: deposit into this bank, or take
 * out a loan from it — without going to the separate /banking hub. Shown to any
 * viewer (the CEO manages the bank through the other panels). Borrow posts as a
 * character borrower; deposit routes this currency's savings to this bank.
 */
export function CustomerBankPanel({
  corporationId,
  bankName,
  currency,
  depositTaking,
  onChanged,
  showToast,
}: {
  corporationId: string;
  bankName: string;
  currency: CurrencyCode;
  depositTaking: boolean;
  onChanged: () => void;
  showToast: ShowToast;
}) {
  const [depositAmount, setDepositAmount] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [loanTerm, setLoanTerm] = useState("12");
  const [busy, setBusy] = useState<"deposit" | "borrow" | null>(null);

  const deposit = async () => {
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Enter a deposit amount", "error");
      return;
    }
    setBusy("deposit");
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
      setBusy(null);
    }
  };

  const borrow = async () => {
    const principal = Number(loanAmount);
    const termTurns = Number(loanTerm);
    if (!Number.isFinite(principal) || principal <= 0) {
      showToast("Enter a loan amount", "error");
      return;
    }
    if (!Number.isInteger(termTurns) || termTurns < 4 || termTurns > 120) {
      showToast("Term must be 4 to 120 turns", "error");
      return;
    }
    setBusy("borrow");
    try {
      const res = await fetch("/api/banking/loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankCorporationId: corporationId,
          borrowerType: "character",
          principal,
          termTurns,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error ?? "Loan request failed", "error");
        return;
      }
      showToast(
        json.pending
          ? "Loan requested — awaiting the bank's approval"
          : `Loan of ${principal.toLocaleString("en-US")} ${currency} granted`,
        "success"
      );
      setLoanAmount("");
      onChanged();
    } catch {
      showToast("Loan request failed", "error");
    } finally {
      setBusy(null);
    }
  };

  if (!depositTaking) {
    // Investment charters don't take retail deposits or lend to individuals.
    return null;
  }

  const inputClass =
    "w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-mono tabular-nums focus:border-accent focus:outline-none";
  const btnClass =
    "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-card-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Deposit with {bankName}</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Moves your {currency} savings to this bank, so it earns this bank&apos;s deposit rate. You
          hold one bank per currency, so this moves your whole {currency} savings here.
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder={`Amount (${currency})`}
            className={inputClass}
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void deposit()}
            className={btnClass}
          >
            {busy === "deposit" ? "…" : "Deposit"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">Borrow from {bankName}</h3>
        <p className="mt-1 mb-3 text-xs text-muted">
          Request a personal loan in {currency}. Some banks approve automatically; others review
          each request.
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={loanAmount}
            onChange={(e) => setLoanAmount(e.target.value)}
            placeholder={`Amount (${currency})`}
            className={inputClass}
          />
          <input
            type="number"
            inputMode="numeric"
            min="4"
            max="120"
            value={loanTerm}
            onChange={(e) => setLoanTerm(e.target.value)}
            placeholder="Turns"
            className={`${inputClass} w-24`}
            aria-label="Loan term in turns"
          />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void borrow()}
            className={btnClass}
          >
            {busy === "borrow" ? "…" : "Borrow"}
          </button>
        </div>
      </div>
    </section>
  );
}
