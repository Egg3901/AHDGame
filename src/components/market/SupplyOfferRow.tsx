"use client";

import { useState } from "react";
import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import { COMMODITY_LABELS, COMMODITY_UNITS } from "@/lib/constants/commodities";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";
import { apiErrorText } from "@/lib/errors/catalog";
import {
  OfferIdentity,
  PremiumChip,
  SideBadge,
  formatVolume,
  offerValuePerTurn,
} from "./supplyOfferUi";

export { offerPremiumLabel } from "./supplyOfferUi";

export interface OfferCorporation {
  id: string;
  name: string;
  countryId?: string;
}

const control =
  "h-8 rounded-md border border-card-border bg-background px-2 text-[13px] text-foreground focus:border-foreground focus:outline-none";

/** Column template shared by the header and every row (md and up). */
export const OFFER_GRID =
  "md:grid md:grid-cols-[minmax(11rem,1.6fr)_5.5rem_minmax(7rem,1fr)_minmax(6rem,0.9fr)_minmax(6rem,0.9fr)_5.5rem_minmax(7rem,1fr)] md:items-center md:gap-3";

export function SupplyOfferHeader() {
  const cell = "text-[11px] font-semibold uppercase tracking-wide text-muted";
  return (
    <div className={`hidden border-b border-card-border pb-1.5 ${OFFER_GRID}`} aria-hidden>
      <span className={cell}>Company</span>
      <span className={cell}>Side</span>
      <span className={cell}>Commodity</span>
      <span className={`${cell} text-right`}>Volume / turn</span>
      <span className={`${cell} text-right`}>Est. value / turn</span>
      <span className={cell}>Vs market</span>
      <span className={cell}>Term</span>
    </div>
  );
}

export function SupplyOfferRow({
  offer,
  commodity,
  marketPrice,
  corporations,
  onTaken,
}: {
  offer: SupplyListingView;
  commodity: SupplyListingView["commodity"];
  /** Current market price per unit, for the value estimate. */
  marketPrice?: number;
  corporations: OfferCorporation[];
  onTaken: () => void;
}) {
  const { formatAmount } = useCurrency();
  const takers = corporations.filter((c) => c.id !== offer.corporationId);
  const [corpId, setCorpId] = useState(takers[0]?.id ?? "");
  const [volume, setVolume] = useState(String(offer.volumeCap));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const value = offerValuePerTurn(offer, marketPrice);

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
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${OFFER_GRID}`}>
        <OfferIdentity offer={offer} />
        <span>
          <SideBadge side={offer.side} />
        </span>
        <span className="text-sm font-semibold text-foreground">
          {COMMODITY_LABELS[commodity]}
          {offer.stateId ? <span className="font-normal text-muted"> ({offer.stateId})</span> : ""}
        </span>
        <span className="text-sm font-semibold tabular-nums text-foreground md:text-right">
          {formatVolume(offer.volumeCap)}{" "}
          <span className="text-xs font-normal text-muted">{COMMODITY_UNITS[commodity]}/turn</span>
        </span>
        <span className="text-sm tabular-nums text-foreground md:text-right">
          {value == null ? "n/a" : `~${formatAmount(Math.round(value))}`}
        </span>
        <span>
          <PremiumChip premium={offer.pricePremium} side={offer.side} />
        </span>
        <span className="text-xs text-muted">
          {offer.durationTurns ? `${offer.durationTurns} turns` : "Open-ended"}
          <br />
          {[
            offer.corporationCountryId,
            offer.creditRating ? `rated ${offer.creditRating}` : "unrated",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
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
            className="inline-flex h-8 items-center rounded-md border border-primary bg-primary px-3 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Taking..." : "Take offer"}
          </button>
          <Link
            href={`/corporation/${corpId}?tab=commodities#supply-agreements`}
            className="inline-flex h-8 items-center rounded-md border border-card-border px-3 text-xs font-medium text-foreground hover:bg-card-elevated"
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
