"use client";

import Link from "next/link";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { Avatar } from "@/components/Avatar";
import { COMMODITY_LABELS, COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";

export type OfferKindFilter = "player" | "npp" | "all";
export type OfferSideFilter = "both" | "sell" | "buy";
export type OfferSortKey = "newest" | "volume" | "premium";

export interface OfferFilters {
  kind: OfferKindFilter;
  side: OfferSideFilter;
  /** Empty means every commodity. */
  commodity: CommodityType | "";
  sort: OfferSortKey;
}

export const DEFAULT_OFFER_FILTERS: OfferFilters = {
  kind: "player",
  side: "both",
  commodity: "",
  sort: "newest",
};

/** Query string for GET /api/supply-offers; omits anything left at its default. */
export function offersQuery(filters: OfferFilters, page?: number, pageSize?: number): string {
  const params = new URLSearchParams();
  if (page) params.set("page", String(page));
  if (pageSize) params.set("pageSize", String(pageSize));
  params.set("kind", filters.kind);
  if (filters.side !== "both") params.set("side", filters.side);
  if (filters.commodity) params.set("commodity", filters.commodity);
  params.set("sort", filters.sort);
  return params.toString();
}

/** Whole numbers with separators; 10,000 and up shrink to 12.5K style. */
export function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (Math.abs(value) >= 10_000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
      value
    );
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 2 });
}

export function offerPremiumLabel(premium: number): string {
  const value = Math.round(premium * 1000) / 10;
  if (value === 0) return "At market";
  return `${value > 0 ? "+" : ""}${value}%`;
}

/** Estimated value of one turn of the offer at the current market price, or null without a price. */
export function offerValuePerTurn(
  offer: Pick<SupplyListingView, "volumeCap" | "pricePremium">,
  marketPrice: number | undefined
): number | null {
  if (marketPrice == null || !Number.isFinite(marketPrice)) return null;
  return offer.volumeCap * marketPrice * (1 + offer.pricePremium);
}

/**
 * Premium chip. A discount is green and a premium is red from the buyer's
 * side of the table, which is the taker's side for a sell offer. On a buy
 * request the colors flip, since a higher price is what the supplier wants.
 */
export function PremiumChip({ premium, side }: { premium: number; side: "buy" | "sell" }) {
  const favourable = side === "sell" ? premium < 0 : premium > 0;
  const tone =
    Math.abs(premium) < 0.0005
      ? "bg-card-elevated text-muted"
      : favourable
        ? "bg-success/15 text-success"
        : "bg-error/15 text-error";
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${tone}`}
    >
      {offerPremiumLabel(premium)}
    </span>
  );
}

export function SideBadge({ side }: { side: "buy" | "sell" }) {
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${
        side === "sell" ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning"
      }`}
    >
      {side === "sell" ? "Offering" : "Seeking"}
    </span>
  );
}

export function NppBadge() {
  return (
    <span className="rounded bg-card-elevated px-1.5 py-0.5 text-[11px] font-medium text-muted">
      NPP
    </span>
  );
}

/** Corporation logo and name, plus the CEO's picture for player-run corporations. */
export function OfferIdentity({ offer }: { offer: SupplyListingView }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <CorporationLogo
        logoUrl={offer.corporationLogoUrl}
        name={offer.corporationName}
        size="h-8 w-8"
        className="rounded-md"
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/corporation/${offer.corporationId}`}
            className="truncate text-sm font-semibold text-foreground hover:underline"
          >
            {offer.corporationName}
          </Link>
          {offer.ai && <NppBadge />}
        </div>
        {!offer.ai && offer.ceoName && (
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
            <Avatar url={offer.ceoAvatarUrl} name={offer.ceoName} size="h-4 w-4" />
            <span className="truncate">{offer.ceoName}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  prominent = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  prominent?: boolean;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md border font-medium ${
            prominent ? "h-9 px-4 text-sm" : "h-8 px-2.5 text-xs"
          } ${
            value === o.value
              ? "border-primary bg-primary text-white"
              : "border-card-border text-foreground hover:bg-card-elevated"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const selectCls =
  "h-8 rounded-md border border-card-border bg-background px-2 text-xs text-foreground focus:border-foreground focus:outline-none";

export function SupplyFilterBar({
  filters,
  onChange,
  showCommodity = true,
}: {
  filters: OfferFilters;
  onChange: (next: OfferFilters) => void;
  /** Hidden on a single-commodity page. */
  showCommodity?: boolean;
}) {
  const set = <K extends keyof OfferFilters>(key: K, value: OfferFilters[K]) =>
    onChange({ ...filters, [key]: value });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="search">
      <Segmented
        prominent
        label="Offer source"
        value={filters.kind}
        onChange={(v) => set("kind", v)}
        options={[
          { value: "player", label: "Players" },
          { value: "npp", label: "NPPs" },
          { value: "all", label: "All" },
        ]}
      />
      <Segmented
        label="Offer side"
        value={filters.side}
        onChange={(v) => set("side", v)}
        options={[
          { value: "sell", label: "Offering (sell)" },
          { value: "buy", label: "Seeking (buy)" },
          { value: "both", label: "Both" },
        ]}
      />
      {showCommodity && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Commodity
          <select
            className={selectCls}
            value={filters.commodity}
            onChange={(e) => set("commodity", e.target.value as CommodityType | "")}
          >
            <option value="">All commodities</option>
            {COMMODITY_TYPES.map((c) => (
              <option key={c} value={c}>
                {COMMODITY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-1.5 text-xs text-muted">
        Sort by
        <select
          className={selectCls}
          value={filters.sort}
          onChange={(e) => set("sort", e.target.value as OfferSortKey)}
        >
          <option value="newest">Newest</option>
          <option value="volume">Volume</option>
          <option value="premium">Price vs market</option>
        </select>
      </label>
    </div>
  );
}
