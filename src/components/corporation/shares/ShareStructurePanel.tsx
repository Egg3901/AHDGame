"use client";

import {
  SHARE_CONSOLIDATION_MIN_TOTAL_SHARES,
  MAX_FORWARD_SHARE_SPLIT_MULTIPLIER,
  SHARE_STRUCTURE_COOLDOWN_TURNS,
  CEO_INITIAL_SHARES,
} from "@/lib/constants/corporations";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorporationDetail } from "../CorporationPageTypes";
import { DenseSection, SmallButton } from "../dense/DenseKit";

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

  const reverseRange = `${minTotalShares.toLocaleString("en-US")} to ${(corporation.totalShares - 1).toLocaleString("en-US")}`;
  const forwardRange = `${(corporation.totalShares + 1).toLocaleString("en-US")} to ${maxForwardTotal.toLocaleString("en-US")}`;

  return (
    <DenseSection title="Stock split" meta="CEO">
      <div className="space-y-2 py-1">
        <p className="text-xs text-muted">
          Set a new total share count. Every holding and the public float scale in proportion, so
          market capitalization stays the same. Reverse splits stop at{" "}
          {minTotalShares.toLocaleString("en-US")} shares; forward splits at{" "}
          {MAX_FORWARD_SHARE_SPLIT_MULTIPLIER}x current shares. Once every{" "}
          {SHARE_STRUCTURE_COOLDOWN_TURNS} turns.
        </p>
        {!ceoEligibleForShareStructure && (
          <p className="text-xs text-muted">Not available for state-owned corporations.</p>
        )}
        {ceoEligibleForShareStructure && shareStructureOnCooldown && (
          <p className="text-xs text-warning">
            Available again in {shareStructureCooldownTurnsRemaining} turn
            {shareStructureCooldownTurnsRemaining === 1 ? "" : "s"} (last change turn{" "}
            {corporation.lastShareStructureTurn ?? "unknown"}).
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            aria-label="New total shares"
            value={consolidateTarget === "" ? "" : consolidateTarget}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setConsolidateTarget("");
                return;
              }
              setConsolidateTarget(Math.max(0, Math.floor(Number(raw))));
            }}
            placeholder="New total shares"
            disabled={!canEditShareStructureTarget}
            className="h-7 w-40 rounded-md border border-card-border bg-background px-2 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none disabled:opacity-50"
          />
          <SmallButton
            disabled={!canEditShareStructureTarget}
            onClick={() =>
              setConsolidateTarget(
                Math.max(minTotalShares, Math.floor(corporation.totalShares / 10))
              )
            }
          >
            10:1 reverse
          </SmallButton>
          <SmallButton
            disabled={!canEditShareStructureTarget || corporation.totalShares * 2 > maxForwardTotal}
            onClick={() => setConsolidateTarget(corporation.totalShares * 2)}
          >
            2:1 forward
          </SmallButton>
          <SmallButton
            disabled={
              !canEditShareStructureTarget ||
              foundingShares >= corporation.totalShares ||
              foundingShares < minTotalShares
            }
            onClick={() => setConsolidateTarget(foundingShares)}
          >
            Founding size ({foundingShares.toLocaleString("en-US")})
          </SmallButton>
          <SmallButton
            tone="primary"
            onClick={handleConsolidateShares}
            disabled={loading || !shareStructureTargetValid}
          >
            {loading ? "Applying" : "Apply"}
          </SmallButton>
        </div>
        {consolidateTargetNum > 0 &&
          !shareStructurePricePreview &&
          consolidateTargetNum !== corporation.totalShares &&
          canEditShareStructureTarget && (
            <p className="text-xs text-error">
              Reverse: {reverseRange}. Forward: {forwardRange}.
            </p>
          )}
        {newPriceAfterShareStructure != null && (
          <p className="text-xs tabular-nums text-muted">
            Indicative new price about{" "}
            {formatPrice(toAnchor(newPriceAfterShareStructure), liquidCode)} (market cap{" "}
            {formatAmount(toAnchor(corporation.sharePrice * corporation.totalShares), liquidCode)}
            ).
          </p>
        )}
      </div>
    </DenseSection>
  );
}
