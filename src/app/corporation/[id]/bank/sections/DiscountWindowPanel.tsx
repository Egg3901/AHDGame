"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Input, Skeleton } from "@/components/ui";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { perTurnInterestOn } from "@/lib/banking/rules/loans";
import { DISCOUNT_WINDOW_STIGMA } from "@/lib/banking/rules/discountWindow";
import type { DiscountWindowQuote, ShowToast } from "../types";
import { mergeState } from "../lib/helpers";
import { Eyebrow } from "../components/BankSection";
import { StatCell } from "../components/StatCell";

/**
 * Draws above half the remaining capacity ask first: the debt is cheap to take
 * and slow to shake, because the confidence penalty scales with how much of
 * the limit is used and only decays as the debt is repaid.
 */
const LARGE_DRAW_FRACTION = 0.5;

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
  const t = useTranslations("corporations.bankConsole");
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
    if (action === "draw" && quote && (quote.headroomAnchor ?? 0) > 0) {
      const headroom = quote.headroomAnchor ?? 0;
      if (a > headroom) {
        showToast(
          `That draw exceeds the ${formatBankMoney(headroom, currency)} the window will still lend`,
          "error"
        );
        return;
      }
      // Hard-to-reverse funding with a confidence cost: confirm large draws,
      // the way charter switches confirm before returning the deposit book.
      if (a > LARGE_DRAW_FRACTION * headroom) {
        const ok = window.confirm(
          `Draw ${formatBankMoney(a, currency)} from the discount window? It adds a confidence penalty that only fades once the debt is repaid, and next turn charges interest at the penalty rate.`
        );
        if (!ok) return;
      }
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
      if (action === "draw" && quote) {
        const owed = quote.outstanding + a;
        const remaining = Math.max(0, (quote.headroomAnchor ?? 0) - a);
        const rate = quote.ratePercent ?? 0;
        showToast(
          `Drew ${formatBankMoney(a, currency)}: now owes ${formatBankMoney(owed, currency)} at ${formatRatePercent(rate)}, costing about ${formatBankMoney(perTurnInterestOn(owed, rate), currency)} next turn, with ${formatBankMoney(remaining, currency)} capacity left.`,
          "success"
        );
      } else if (quote) {
        const owed = Math.max(0, quote.outstanding - a);
        showToast(
          `Repaid ${formatBankMoney(a, currency)}: owes ${formatBankMoney(owed, currency)}. The confidence penalty eases as the debt clears.`,
          "success"
        );
      } else {
        showToast(
          action === "draw" ? "Discount window drawn" : "Discount window repaid",
          "success"
        );
      }
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

  // Consequence preview for the entered amount, from the same rule the window
  // enforces (rules/discountWindow): the penalty scales with the share of the
  // limit drawn, and next turn's interest divides the annual penalty rate by
  // TURNS_PER_YEAR, as the turn's facility servicing does.
  const entered = parseFloat(amount);
  const validDraw =
    Number.isFinite(entered) &&
    entered > 0 &&
    entered <= (quote.headroomAnchor ?? 0) &&
    (quote.capAnchor ?? 0) > 0;
  const postDrawUsage = validDraw
    ? Math.min(1, (quote.outstanding + entered) / (quote.capAnchor ?? 1))
    : null;
  const postDrawStigma = postDrawUsage != null ? DISCOUNT_WINDOW_STIGMA * postDrawUsage : null;
  const postDrawInterest =
    validDraw && quote.ratePercent != null
      ? perTurnInterestOn(quote.outstanding + entered, quote.ratePercent)
      : null;

  return (
    <section className="space-y-4">
      <div>
        <Eyebrow kind="ceoControl" />
        <h3 className="text-base font-semibold text-foreground">Discount window</h3>
        <p className="text-sm text-muted">
          Emergency central bank cash for banks that take deposits. Drawing carries a confidence
          penalty that fades once the debt is repaid, and the penalty rate prices above the market.
        </p>
      </div>
      <div className="rounded-xl border border-card-border bg-card grid grid-cols-2 sm:grid-cols-4 divide-x divide-card-border max-w-2xl">
        <StatCell
          label="Outstanding"
          value={formatBankMoney(quote.outstanding, currency)}
          tooltip={t("tooltips.discountOutstanding")}
        />
        <StatCell
          label="Rate"
          value={quote.ratePercent != null ? formatRatePercent(quote.ratePercent) : "-"}
          sub="penalty over prime"
          tooltip={t("tooltips.discountRate")}
        />
        <StatCell
          label="Remaining capacity"
          value={formatBankMoney(quote.headroomAnchor ?? 0, currency)}
          sub={`cap ${formatBankMoney(quote.capAnchor ?? 0, currency)}`}
          tooltip={t("tooltips.discountCapacity")}
        />
        <StatCell
          label="Confidence penalty"
          value={`${(quote.currentStigma * 100).toFixed(1)}%`}
          sub={`fades on repayment, max ${(quote.maxStigma * 100).toFixed(0)}%`}
          tooltip={t("tooltips.discountStigma")}
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
          {validDraw && postDrawStigma != null && postDrawInterest != null && (
            <p className="text-[11px] text-muted">
              Drawing {formatBankMoney(entered, currency)} sets the penalty to{" "}
              {(postDrawStigma * 100).toFixed(1)}% of confidence, costs about{" "}
              {formatBankMoney(postDrawInterest, currency)} next turn, and leaves{" "}
              {formatBankMoney((quote.headroomAnchor ?? 0) - entered, currency)} of capacity. Draws
              above half the remaining capacity ask first. Interest accrues every turn (about every
              hour) until repaid.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => void act("draw")}
              disabled={busy || !validDraw}
              title={
                validDraw ? undefined : "Enter an amount within the remaining capacity to draw"
              }
            >
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
