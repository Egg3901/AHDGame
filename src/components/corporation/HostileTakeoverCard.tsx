"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { HOSTILE_TAKEOVER_PREMIUM_RATE } from "@/lib/corporations/corporateOwnership";
import type { CorporationDetail } from "./CorporationPageTypes";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface HostileTakeoverCardProps {
  corporation: CorporationDetail;
  parentCorporationId: string;
  ownershipPct: number;
  outstandingBonds: number;
  outstandingBondDebt: number;
  parentLiquidCapital: number;
  parentLiquidCurrencyCode: string;
  onMerged: () => void;
  onBondPayoff?: () => void;
}

export function HostileTakeoverCard({
  corporation,
  parentCorporationId,
  ownershipPct,
  outstandingBonds,
  outstandingBondDebt,
  parentLiquidCapital,
  parentLiquidCurrencyCode,
  onMerged,
  onBondPayoff,
}: HostileTakeoverCardProps) {
  const { formatPrice, toInternalFrom } = useCurrency();
  const [busy, setBusy] = useState(false);
  const [payoffBusy, setPayoffBusy] = useState(false);
  const [err, setErr] = useState("");
  const [payoffErr, setPayoffErr] = useState("");

  const premiumMult = 1 + HOSTILE_TAKEOVER_PREMIUM_RATE;
  // corporation.sharePrice is in target corp's liquidCurrencyCode post-v0.2.6
  // (Task 18A). Normalize to ₳ so formatPrice (which assumes ₳ input) renders
  // correctly across viewer wallet preferences.
  const pricePerShareLocal = corporation.sharePrice * premiumMult;
  const pricePerShare = corporation.liquidCurrencyCode
    ? toInternalFrom(pricePerShareLocal, corporation.liquidCurrencyCode as CurrencyCode)
    : pricePerShareLocal;
  const canAffordPayoff = parentLiquidCapital >= outstandingBondDebt;

  async function handlePayoffBonds() {
    if (
      !confirm(
        `Pay off ${outstandingBonds} outstanding bond(s) totaling ${formatPrice(outstandingBondDebt)} from your corporation's liquid capital? This cannot be undone.`
      )
    ) {
      return;
    }
    setPayoffBusy(true);
    setPayoffErr("");
    try {
      const res = await fetch(`/api/corporations/${corporation._id}/parent-bond-payoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPayoffErr(data.error || "Payoff failed");
        return;
      }
      if (onBondPayoff) {
        onBondPayoff();
      } else {
        onMerged();
      }
    } catch {
      setPayoffErr("Network error");
    } finally {
      setPayoffBusy(false);
    }
  }

  async function handleMerge() {
    if (
      !confirm(
        `Merge ${corporation.name} into your holding company? Minority shareholders receive ${Math.round(HOSTILE_TAKEOVER_PREMIUM_RATE * 100)}% over market per share (${formatPrice(pricePerShare)} per share in internal terms). Your corporation must have enough liquid capital. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/corporations/${corporation._id}/hostile-takeover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Merge failed");
        return;
      }
      onMerged();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-warning/35 bg-warning/5 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Hostile takeover — merge subsidiary
          </h3>
          <p className="text-xs text-muted mt-1">
            Your corporation holds {ownershipPct.toFixed(1)}% of outstanding shares. You can absorb
            this company and pay minority holders a{" "}
            {Math.round(HOSTILE_TAKEOVER_PREMIUM_RATE * 100)}% premium ({formatPrice(pricePerShare)}{" "}
            per share).
          </p>
        </div>
        <button
          type="button"
          onClick={handleMerge}
          disabled={busy || outstandingBonds > 0}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          title={outstandingBonds > 0 ? "Outstanding bonds must be resolved first" : undefined}
        >
          {busy ? "Working…" : "Merge corporation"}
        </button>
      </div>
      {err && <p className="text-xs text-error">{err}</p>}

      {outstandingBonds > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
          <p className="text-xs text-foreground">
            This subsidiary has <span className="font-semibold">{outstandingBonds}</span>{" "}
            outstanding bond
            {outstandingBonds !== 1 ? "s" : ""} totaling{" "}
            <span className="font-semibold">{formatPrice(outstandingBondDebt)}</span>. You must pay
            off these bonds before merging.
          </p>
          <p className="text-xs text-muted">
            Parent liquid capital: {formatPrice(parentLiquidCapital)} {parentLiquidCurrencyCode}
          </p>
          <button
            type="button"
            onClick={handlePayoffBonds}
            disabled={payoffBusy || !canAffordPayoff}
            className="rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-white hover:bg-warning/90 disabled:opacity-50"
          >
            {payoffBusy
              ? "Paying off…"
              : canAffordPayoff
                ? `Pay off bonds (${formatPrice(outstandingBondDebt)})`
                : `Insufficient capital (need ${formatPrice(outstandingBondDebt)})`}
          </button>
          {payoffErr && <p className="text-xs text-error">{payoffErr}</p>}
        </div>
      )}
    </div>
  );
}
