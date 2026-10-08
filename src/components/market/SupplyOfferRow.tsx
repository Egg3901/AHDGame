"use client";

import { useState } from "react";
import Link from "next/link";
import { COMMODITY_LABELS, COMMODITY_UNITS, type CommodityType } from "@/lib/constants/commodities";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";
import { apiErrorText } from "@/lib/errors/catalog";

export interface OfferCorporation {
  id: string;
  name: string;
  countryId?: string;
}

const control =
  "h-8 rounded-md border border-card-border bg-background px-2 text-[13px] text-foreground focus:border-foreground focus:outline-none";

export function offerPremiumLabel(premium: number): string {
  const value = Math.round(premium * 1000) / 10;
  return `${value > 0 ? "+" : ""}${value}%`;
}

export function SupplyOfferRow({
  offer,
  commodity,
  showCommodity = false,
  corporations,
  onTaken,
}: {
  offer: SupplyListingView;
  commodity: CommodityType;
  /** Name the commodity in the row, for lists that span commodities. */
  showCommodity?: boolean;
  corporations: OfferCorporation[];
  onTaken: () => void;
}) {
  const takers = corporations.filter((c) => c.id !== offer.corporationId);
  const [corpId, setCorpId] = useState(takers[0]?.id ?? "");
  const [volume, setVolume] = useState(String(offer.volumeCap));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function take() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/corporations/${corpId}/supply-listings/take`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: offer.id, volume: Number(volume) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorText(data, "Could not take this offer."));
      setFailed(false);
      setMessage("Agreement started. It is active now.");
      onTaken();
    } catch (e) {
      setFailed(true);
      setMessage(e instanceof Error ? e.message : "Could not take this offer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 border-b border-card-border/60 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-foreground">
          {showCommodity && (
            <span className="mr-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
              {COMMODITY_LABELS[commodity]}
            </span>
          )}
          {offer.corporationName}
          {offer.ai && (
            <span className="ml-1.5 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
              AI
            </span>
          )}
          {offer.stateId ? ` (${offer.stateId})` : ""}
        </span>
        <span className="text-sm tabular-nums text-foreground">
          {offer.volumeCap.toLocaleString()} {COMMODITY_UNITS[commodity]} per turn at{" "}
          {offerPremiumLabel(offer.pricePremium)} to market
        </span>
      </div>
      <p className="text-xs text-muted">
        {[
          offer.corporationCountryId,
          offer.creditRating ? `rating ${offer.creditRating}` : "unrated",
          offer.durationTurns ? `${offer.durationTurns} turns` : "open-ended",
          `expires turn ${offer.expiresAtTurn}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {offer.own ? (
        <p className="text-xs text-muted">This is your offer.</p>
      ) : takers.length === 0 ? (
        <p className="text-xs text-muted">You need a corporation you run to take this offer.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          {takers.length > 1 && (
            <label className="text-xs">
              Take with
              <select
                className={`${control} block`}
                value={corpId}
                onChange={(e) => setCorpId(e.target.value)}
                disabled={busy}
              >
                {takers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs">
            Quantity to take
            <input
              className={`${control} block w-28`}
              type="number"
              min="0.000001"
              max={offer.volumeCap}
              step="any"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            disabled={busy || !corpId}
            onClick={() => void take()}
            className="inline-flex h-7 items-center rounded-md border border-primary bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Taking..." : "Take offer"}
          </button>
          <Link
            href={`/corporation/${corpId}?tab=commodities#supply-agreements`}
            className="inline-flex h-7 items-center rounded-md border border-card-border px-2.5 text-xs font-medium text-foreground hover:bg-card-elevated"
          >
            Negotiate
          </Link>
        </div>
      )}
      {message && (
        <p role={failed ? "alert" : "status"} className={failed ? "text-xs text-error" : "text-xs"}>
          {message}
        </p>
      )}
    </li>
  );
}
