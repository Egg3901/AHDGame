"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { Button, Input, Skeleton } from "@/components/ui";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { DiscountWindowQuote, ShowToast } from "../types";
import { mergeState } from "../lib/helpers";
import { StatCell } from "../components/StatCell";

export function DiscountWindowPanel({
  corporationId,
  currency,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [{ quote, loading, error }, updateWindowState] = useReducer(
    mergeState<{ quote: DiscountWindowQuote | null; loading: boolean; error: string | null }>,
    { quote: null, loading: true, error: null }
  );
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const loadQuote = useCallback(async () => {
    updateWindowState({ loading: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/discount-window`);
      const json = (await res.json().catch(() => ({}))) as DiscountWindowQuote & {
        error?: string;
      };
      if (!res.ok) {
        updateWindowState({ error: json.error ?? "Failed to load discount window", quote: null });
        return;
      }
      updateWindowState({ error: null, quote: json });
    } catch {
      updateWindowState({ error: "Failed to load discount window", quote: null });
    } finally {
      updateWindowState({ loading: false });
    }
  }, [corporationId]);

  useEffect(() => {
    void loadQuote();
  }, [loadQuote]);

  const act = async (action: "draw" | "repay") => {
    const a = parseFloat(amount);
    if (!(a > 0)) {
      showToast("Positive amount required", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/discount-window`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, amount: a }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? `Could not ${action} from the window`, "error");
        return;
      }
      showToast(action === "draw" ? "Discount window drawn" : "Discount window repaid", "success");
      setAmount("");
      await loadQuote();
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (loading && !quote) {
    return <Skeleton className="h-24 w-full max-w-xl rounded-xl" />;
  }
  if (error || !quote || !quote.available) return null;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">Discount window</h3>
        <p className="text-sm text-muted">
          Emergency central bank liquidity for deposit-taking banks. Drawing carries a confidence
          stigma that fades once the debt is repaid.
        </p>
      </div>
      <div className="rounded-xl border border-card-border bg-card grid grid-cols-2 sm:grid-cols-4 divide-x divide-card-border max-w-2xl">
        <StatCell label="Outstanding" value={formatBankMoney(quote.outstanding, currency)} />
        <StatCell
          label="Rate"
          value={quote.ratePercent != null ? formatRatePercent(quote.ratePercent) : "-"}
          sub="penalty over prime"
        />
        <StatCell
          label="Remaining capacity"
          value={formatBankMoney(quote.headroomAnchor ?? 0, currency)}
          sub={`cap ${formatBankMoney(quote.capAnchor ?? 0, currency)}`}
        />
        <StatCell
          label="Stigma"
          value={`${(quote.currentStigma * 100).toFixed(1)}%`}
          sub={`confidence penalty, max ${(quote.maxStigma * 100).toFixed(0)}%`}
        />
      </div>
      {canMutate && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3 max-w-xl">
          <p className="text-sm text-muted">Draw against the window, or repay outstanding debt.</p>
          <label className="block space-y-1 text-xs text-muted max-w-xs">
            Amount
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Discount window amount"
            />
          </label>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void act("draw")} disabled={busy}>
              Draw
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void act("repay")}
              disabled={busy}
            >
              Repay
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
