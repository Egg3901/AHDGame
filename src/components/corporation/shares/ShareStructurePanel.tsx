"use client";

import {
  SHARE_CONSOLIDATION_MIN_TOTAL_SHARES,
  MAX_FORWARD_SHARE_SPLIT_MULTIPLIER,
  SHARE_STRUCTURE_COOLDOWN_TURNS,
  CEO_INITIAL_SHARES,
} from "@/lib/constants/corporations";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorporationDetail } from "../CorporationPageTypes";

interface ShareStructurePanelProps {
  corporation: CorporationDetail;
  trading: {
    consolidateTarget: number | "";
    setConsolidateTarget: React.Dispatch<React.SetStateAction<number | "">>;
    consolidateTargetNum: number;
    maxForwardTotal: number;
    isReverseTarget: boolean;
    isForwardTarget: boolean;
    shareStructureTargetValid: boolean;
    shareStructurePricePreview: boolean;
    newPriceAfterShareStructure: number | null;
    shareStructureOnCooldown: boolean;
    ceoEligibleForShareStructure: boolean;
    canEditShareStructureTarget: boolean;
    loading: boolean;
    handleConsolidateShares: () => Promise<void>;
  };
}

export default function ShareStructurePanel({ corporation, trading }: ShareStructurePanelProps) {
  const { formatAmount, formatPrice, toInternalFrom } = useCurrency();
  // Post-v0.2.6: sharePrice is in the corp's liquidCurrencyCode; normalize to ₳
  // and pass code so formatPrice / formatAmount honor wallet-pref display.
  const liquidCode =
    (corporation.liquidCurrencyCode as
      import("@/lib/constants/currencies").CurrencyCode | undefined) ?? undefined;
  const toAnchor = (val: number) => (liquidCode ? toInternalFrom(val, liquidCode) : val);
  const {
    consolidateTarget,
    setConsolidateTarget,
    consolidateTargetNum,
    maxForwardTotal,
    shareStructureTargetValid,
    shareStructurePricePreview,
    newPriceAfterShareStructure,
    shareStructureOnCooldown,
    ceoEligibleForShareStructure,
    canEditShareStructureTarget,
    loading,
    handleConsolidateShares,
  } = trading;

  const shareStructureCooldownTurnsRemaining =
    corporation.shareStructureCooldownTurnsRemaining ?? 0;
  // Share COUNTS deflate with the era, so both the reverse-split floor and the
  // "founding size" shortcut come from the server (which knows the preset).
  // Fall back to the modern constants for a payload written before this field
  // existed, which is exactly the modern behaviour those constants encode.
  const minTotalShares =
    corporation.shareConsolidationMinTotalShares ?? SHARE_CONSOLIDATION_MIN_TOTAL_SHARES;
  const foundingShares = corporation.foundingTotalShares ?? CEO_INITIAL_SHARES;

  return (
    <div className="rounded-xl border border-card-border bg-card-elevated/40 p-6">
      <h2 className="text-lg font-bold text-foreground mb-1">Stock split & reverse split</h2>
      <p className="text-sm text-muted mb-4">
        Set a new total share count. All shareholders and the public float are adjusted in
        proportion so{" "}
        <span className="text-foreground font-medium">market capitalization stays the same</span>.
        Reverse splits cannot go below {minTotalShares.toLocaleString("en-US")} shares; forward
        splits are capped at {MAX_FORWARD_SHARE_SPLIT_MULTIPLIER}× current shares. At most once
        every {SHARE_STRUCTURE_COOLDOWN_TURNS} turns.
      </p>
      {!ceoEligibleForShareStructure && (
        <p className="text-xs text-muted mb-3">Not available for state-owned corporations.</p>
      )}
      {ceoEligibleForShareStructure && shareStructureOnCooldown && (
        <p className="text-sm text-warning mb-3">
          Share structure cooldown: {shareStructureCooldownTurnsRemaining} turn(s) remaining (last
          change turn {corporation.lastShareStructureTurn ?? "—"}).
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">New total shares</label>
          <input
            type="number"
            value={consolidateTarget === "" ? "" : consolidateTarget}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setConsolidateTarget("");
                return;
              }
              setConsolidateTarget(Math.max(0, Math.floor(Number(raw))));
            }}
            placeholder={`Reverse ${minTotalShares.toLocaleString("en-US")}–${(corporation.totalShares - 1).toLocaleString("en-US")} · forward ${(corporation.totalShares + 1).toLocaleString("en-US")}–${maxForwardTotal.toLocaleString("en-US")}`}
            disabled={!canEditShareStructureTarget}
            className="w-full max-w-md rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canEditShareStructureTarget}
            onClick={() =>
              setConsolidateTarget(
                Math.max(minTotalShares, Math.floor(corporation.totalShares / 10))
              )
            }
            className="rounded-lg border border-card-border px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            10:1 reverse
          </button>
          <button
            type="button"
            disabled={!canEditShareStructureTarget || corporation.totalShares * 2 > maxForwardTotal}
            onClick={() => setConsolidateTarget(corporation.totalShares * 2)}
            className="rounded-lg border border-card-border px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            2:1 forward
          </button>
          <button
            type="button"
            disabled={
              !canEditShareStructureTarget ||
              foundingShares >= corporation.totalShares ||
              foundingShares < minTotalShares
            }
            onClick={() => setConsolidateTarget(foundingShares)}
            className="rounded-lg border border-card-border px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            {foundingShares.toLocaleString("en-US")} (founding size)
          </button>
        </div>
        <button
          type="button"
          onClick={handleConsolidateShares}
          disabled={loading || !shareStructureTargetValid}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? "..." : "Apply"}
        </button>
      </div>
      {consolidateTargetNum > 0 &&
        !shareStructurePricePreview &&
        consolidateTargetNum !== corporation.totalShares &&
        canEditShareStructureTarget && (
          <p className="text-xs text-error mt-2">
            Reverse: {minTotalShares.toLocaleString("en-US")}–
            {(corporation.totalShares - 1).toLocaleString("en-US")}. Forward:{" "}
            {(corporation.totalShares + 1).toLocaleString("en-US")}–
            {maxForwardTotal.toLocaleString("en-US")}.
          </p>
        )}
      {newPriceAfterShareStructure != null && (
        <p className="text-xs text-muted mt-3 tabular-nums">
          Indicative new price ~{formatPrice(toAnchor(newPriceAfterShareStructure), liquidCode)}{" "}
          (market cap{" "}
          {formatAmount(toAnchor(corporation.sharePrice * corporation.totalShares), liquidCode)})
        </p>
      )}
    </div>
  );
}
