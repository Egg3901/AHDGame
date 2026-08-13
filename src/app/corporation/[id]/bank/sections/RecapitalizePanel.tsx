"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  assessCapital,
  capitalShortfall,
  type BankBorrowings,
} from "@/lib/banking/capitalAdequacy";
import type { ShowToast } from "../types";

export function RecapitalizePanel({
  corporationId,
  currency,
  postedCapital,
  liquidCapital,
  totalLoans,
  propBookMarkValue,
  borrowings,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  postedCapital: number;
  liquidCapital: number;
  totalLoans: number;
  propBookMarkValue: number;
  borrowings: BankBorrowings;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const position = assessCapital({
    postedCapital,
    liquidCapital,
    totalLoans,
    borrowings,
    propBookMarkValue,
  });
  const shortfall = capitalShortfall(position);
  const [amount, setAmount] = useState(shortfall > 0 ? String(shortfall) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (shortfall > 0) setAmount(String(shortfall));
  }, [shortfall]);

  const submit = async () => {
    const a = parseFloat(amount);
    if (!(a > 0)) {
      showToast("Positive amount required", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/recapitalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: a }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not post capital", "error");
        return;
      }
      showToast(json.message ?? "Capital posted", "success");
      setAmount("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4 max-w-xl">
      <div>
        <h3 className="text-base font-semibold text-foreground">Capital adequacy</h3>
        <p className="text-sm text-muted">
          Posted capital absorbs losses before depositors do. Moving treasury cash into posted
          capital cures a supervisory capital shortfall.
        </p>
      </div>
      <div className="text-sm space-y-1">
        <p className="font-mono tabular-nums text-foreground">
          Posted {formatBankMoney(postedCapital, currency)} · ratio{" "}
          {(position.capitalRatio * 100).toFixed(1)}%
        </p>
        {shortfall > 0 ? (
          <p className="text-error">
            Undercapitalized. Post {formatBankMoney(shortfall, currency)} to clear the minimum.
          </p>
        ) : (
          <p className="text-muted">
            Standing: {position.standing}. No capital shortfall at current book values.
          </p>
        )}
      </div>
      {canMutate && (
        <>
          <label className="block space-y-1 text-xs text-muted max-w-xs">
            Amount from treasury
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Recapitalization amount"
            />
          </label>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Posting..." : "Post capital"}
          </Button>
        </>
      )}
    </section>
  );
}
