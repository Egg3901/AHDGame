"use client";

import { useState } from "react";
import Link from "next/link";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatRatePercent } from "@/components/banking/formatBankMoney";
import type { ShowToast } from "../types";
import { SmallButton } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";

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

  return (
    <section id="customer-banking" className="scroll-mt-6">
      <BankPanel title={`Bank with ${bankName}`} meta="as a customer">
        <div className="grid gap-x-8 gap-y-4 py-1.5 md:grid-cols-2">
          <div id="customer-deposit" className="min-w-0 space-y-1.5">
            <p className="text-xs text-muted">
              <span className="font-medium text-foreground">Deposit savings</span>
              {depositRatePercent != null && (
                <>
                  {" "}
                  at{" "}
                  <span className="font-mono text-success">
                    {formatRatePercent(depositRatePercent)}
                  </span>
                </>
              )}
              . Moves your {currency} savings to this bank, so it earns this bank&apos;s deposit
              rate. You hold one bank per currency, so this moves your whole {currency} savings
              here.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder={`Amount (${currency})`}
                aria-label={`Deposit amount in ${currency}`}
                className="h-8 w-48 rounded-md border border-card-border bg-background px-2 font-mono text-[13px] text-foreground placeholder:text-muted focus:border-foreground focus:outline-none"
              />
              <SmallButton tone="primary" disabled={busy} onClick={() => void deposit()}>
                {busy ? "…" : "Deposit"}
              </SmallButton>
            </div>
          </div>

          <div id="customer-loan" className="min-w-0 space-y-1.5">
            <p className="text-xs text-muted">
              <span className="font-medium text-foreground">Borrow from {bankName}</span>. Review a
              personal or corporation loan in the banking hub. It shows the quoted rate,
              destination, payment estimate, maximum, and approval status before you submit.
            </p>
            <Link
              href="/banking"
              className="inline-flex h-7 items-center rounded-md border border-card-border px-2.5 text-xs font-medium text-foreground hover:bg-card-elevated"
            >
              Review loan terms
            </Link>
          </div>
        </div>
      </BankPanel>
    </section>
  );
}
