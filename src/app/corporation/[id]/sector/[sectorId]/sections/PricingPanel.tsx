"use client";

import { useState } from "react";
import { InfoTooltip } from "@/components/InfoTooltip";
import { GOUGE_JUMP, CONSISTENCY_BAND } from "@/lib/market/brandLoyalty";
import type { PricingData } from "../types";

const POSTURE_STEPS = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2] as const;

function postureLabel(p: number): string {
  if (p === 0) return "Market";
  return `${p > 0 ? "+" : ""}${Math.round(p * 100)}%`;
}

interface PricingPanelProps {
  corporationId: string;
  sectorId: string;
  isCeo: boolean;
  pricing: PricingData;
}

/**
 * Posted-price pricing posture (marketSystemMode >= "clearing", audit t806
 * Fix 2). Undercut to fill your order book first; skim for margin and risk
 * selling last. Self-contained: manages its own draft/save state.
 */
export default function PricingPanel({
  corporationId,
  sectorId,
  isCeo,
  pricing,
}: PricingPanelProps) {
  const [draft, setDraft] = useState<number | null>(pricing.posture);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const save = async (value: number | null) => {
    setSaving(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch(`/api/corporations/${corporationId}/sectors/${sectorId}/pricing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricingPosture: value }),
      });
      const data = (await res.json()) as { error?: string; pricingPosture?: number | null };
      if (!res.ok) {
        setIsError(true);
        setMessage(data.error || "Failed to update pricing");
        return;
      }
      setDraft(data.pricingPosture ?? null);
      setMessage(
        data.pricingPosture == null
          ? "Pricing set to automatic."
          : `Posted price set to ${postureLabel(data.pricingPosture)} vs market.`
      );
    } catch {
      setIsError(true);
      setMessage("Network error");
    } finally {
      setSaving(false);
    }
  };

  const sold = pricing.soldFraction;

  // Brand loyalty (Package A): warn the CEO before a sharp upward reprice away
  // from the corp's own price identity. Only when the norm is exposed (owner).
  const norm = pricing.brandPostureNorm;
  const pending = draft;
  const brandWarning: "gouge" | "drift" | null =
    norm != null && pending != null
      ? pending > norm + GOUGE_JUMP
        ? "gouge"
        : Math.abs(pending - norm) > CONSISTENCY_BAND
          ? "drift"
          : null
      : null;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-bold text-foreground">Pricing Posture</h2>
        {sold != null && (
          <InfoTooltip
            trigger={
              <span
                className={`text-xs font-semibold tabular-nums underline decoration-dotted underline-offset-2 ${
                  sold >= 0.995 ? "text-success" : sold >= 0.7 ? "text-warning" : "text-error"
                }`}
              >
                {Math.round(sold * 100)}% sold last turn (all outputs)
              </span>
            }
            width={260}
          >
            <p className="text-muted text-xs">
              Share of this sector&apos;s output that found a buyer last turn, blended across every
              commodity it makes and weighted by output rate. Cheaper sellers fill first. A sector
              with two outputs can sell one out completely and the other hardly at all and still
              land in the middle here — see Commodity Flows for the per-output rates.
            </p>
          </InfoTooltip>
        )}
      </div>
      <p className="text-xs text-muted mb-4">
        Your posted price relative to the market. Demand fills the cheapest sellers first — undercut
        to sell out ahead of rivals, or skim for margin and risk holding unsold output.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {POSTURE_STEPS.map((p) => {
          const active = draft === p;
          return (
            <button
              key={p}
              type="button"
              disabled={!isCeo || saving}
              onClick={() => void save(p)}
              title={
                p < 0
                  ? "Undercut the market: thinner margin per unit, but your order book fills first."
                  : p > 0
                    ? "Premium: more revenue per unit sold, but you sell last — in a glut this output can go unsold."
                    : "Sell at the market price."
              }
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors disabled:opacity-50 ${
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-card-border bg-background hover:bg-card"
              }`}
            >
              {postureLabel(p)}
            </button>
          );
        })}
        <button
          type="button"
          disabled={!isCeo || saving || draft === null}
          onClick={() => void save(null)}
          title="Let the sector position itself: skim mild premiums into shortages, undercut into gluts."
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            draft === null
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-card-border bg-background hover:bg-card"
          }`}
        >
          Auto
        </button>
      </div>

      {message ? (
        <p className={`text-xs mb-2 ${isError ? "text-error" : "text-success"}`} role="status">
          {message}
        </p>
      ) : null}

      {brandWarning ? (
        <p
          className={`text-xs mb-2 ${brandWarning === "gouge" ? "text-warning" : "text-muted"}`}
          role="status"
        >
          {brandWarning === "gouge"
            ? "This sharp price hike will damage brand loyalty."
            : "Pricing away from your norm slows loyalty growth."}
        </p>
      ) : null}

      <div className="pt-3 border-t border-card-border flex items-center justify-between text-sm">
        <InfoTooltip
          trigger={
            <span className="text-muted border-b border-dotted border-muted/40 cursor-default">
              Clearing result (last turn)
            </span>
          }
          width={300}
        >
          <p className="text-muted text-xs">
            Realized revenue = sold share × your posted price × the market price level, faded in
            over 5 game years so repositioning never causes a revenue cliff.
            {pricing.effectivePosture != null && (
              <>
                {" "}
                Effective posture used:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {postureLabel(pricing.effectivePosture)}
                </span>
                {pricing.posture == null ? " (automatic)" : ""}.
              </>
            )}
          </p>
        </InfoTooltip>
        <span
          className={`font-bold tabular-nums ${
            pricing.clearingFactor == null || Math.abs(pricing.clearingFactor - 1) < 0.005
              ? "text-muted"
              : pricing.clearingFactor > 1
                ? "text-success"
                : "text-error"
          }`}
        >
          {pricing.clearingFactor == null ? "—" : `×${pricing.clearingFactor.toFixed(2)}`}
        </span>
      </div>

      {pricing.clearingFactor == null && (
        <p className="mt-2 text-[11px] italic text-muted">
          Clearing figures appear after the next turn.
        </p>
      )}
    </div>
  );
}
