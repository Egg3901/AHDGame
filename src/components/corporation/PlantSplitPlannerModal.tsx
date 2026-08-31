"use client";

import { AlertTriangle, ArrowRight, ShieldAlert } from "lucide-react";
import { Modal } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { formatMarketingStrength } from "@/lib/utils/formatters";
import type { PlantSectorSplitQuote } from "@/lib/corporations/plantSectorSplit";

interface PlantSplitPlannerModalProps {
  open: boolean;
  targetName: string;
  defenderPlantCount: number;
  quote: PlantSectorSplitQuote;
  userLiquidCapitalAnchor: number;
  userMarketingStrength: number;
  submitting: boolean;
  errorMessage?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function PlantSplitPlannerModal({
  open,
  targetName,
  defenderPlantCount,
  quote,
  userLiquidCapitalAnchor,
  userMarketingStrength,
  submitting,
  errorMessage,
  onClose,
  onConfirm,
}: PlantSplitPlannerModalProps) {
  const { formatAmount } = useCurrency();
  const sharePercent = quote.seizureFraction * 100;
  const chancePercent = quote.successProbability * 100;
  const cashAffordable = userLiquidCapitalAnchor >= quote.cashCostAnchor;
  const msAffordable = userMarketingStrength >= quote.marketingStrengthCost;
  const canConfirm = quote.plantsAtRisk > 0 && cashAffordable && msAffordable && !submitting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div>
          <p className="text-lg font-semibold text-foreground">Plan sector split</p>
          <p className="mt-0.5 text-xs font-normal text-muted">Target: {targetName}</p>
        </div>
      }
      maxWidthClass="max-w-xl"
      closeOnEscape={!submitting}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Automatic share
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-primary">
                {sharePercent.toFixed(sharePercent % 1 === 0 ? 0 : 1)}%
              </p>
            </div>
            <div className="border-x border-card-border/60 px-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Plants at risk
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {quote.plantsAtRisk.toLocaleString("en-US")}
              </p>
              <p className="text-[10px] text-muted">
                of {defenderPlantCount.toLocaleString("en-US")}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Success chance
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {chancePercent.toFixed(1)}%
              </p>
            </div>
          </div>
          <p className="mt-3 border-t border-card-border/60 pt-3 text-center text-xs text-muted">
            The percentage is calculated from relative MS. It is not selectable.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-success/25 bg-success/5 p-3">
            <p className="text-xs font-semibold text-success">If it succeeds</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {quote.plantsAtRisk.toLocaleString("en-US")} whole plants transfer intact with their
              productive capacity, condition, and paid basis.
            </p>
          </div>
          <div className="rounded-lg border border-error/25 bg-error/5 p-3">
            <p className="text-xs font-semibold text-error">If it fails</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              No plants transfer. The cash and MS committed below are still spent.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-card-border bg-background/50 p-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Committed cost
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted">Cash</p>
              <p
                className={`font-semibold tabular-nums ${cashAffordable ? "text-foreground" : "text-error"}`}
              >
                {formatAmount(quote.cashCostAnchor)}
              </p>
              <p className="text-[10px] text-muted">
                Available: {formatAmount(userLiquidCapitalAnchor)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Marketing Strength</p>
              <p
                className={`font-semibold tabular-nums ${msAffordable ? "text-foreground" : "text-error"}`}
              >
                {quote.marketingStrengthCost} MS
              </p>
              <p className="text-[10px] text-muted">
                Available: {formatMarketingStrength(userMarketingStrength)} MS
              </p>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="flex gap-2 rounded-lg border border-error/30 bg-error/10 p-3 text-xs text-error">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <span>{errorMessage}</span>
          </div>
        )}

        {(!cashAffordable || !msAffordable) && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            {!cashAffordable && !msAffordable
              ? "You do not have enough cash or MS for this attempt."
              : !cashAffordable
                ? "You do not have enough cash for this attempt."
                : "You do not have enough MS for this attempt."}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="inline-flex items-center gap-2 rounded-lg border border-error/40 bg-error/15 px-4 py-2 text-sm font-semibold text-error hover:bg-error/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Resolving..." : "Confirm sector split"}
            {!submitting && <ArrowRight className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>
    </Modal>
  );
}
