"use client";

import Link from "next/link";
import Image from "next/image";
import { EmptyState } from "@/components/ui";
import { getCountryFlagUrlForEra } from "@/lib/constants";
import { useActivePreset } from "@/contexts/RegisteredCountriesContext";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { natMoney } from "@/components/national/natMoney";
import type { AuctionListing } from "@/lib/nationalization/auctionListing";

/**
 * Stock Market "Auctions" tab: one row per open privatization auction. Rows link
 * to the corporation profile (where the bid affordance lives). On the global
 * exchange a country flag is shown; a row the viewer may bid on (resident of the
 * auction's country) is tagged. Discovery only — bidding happens on the corp
 * profile → nationalization surface.
 */
export function AuctionTable({
  auctions,
  viewerCountryId,
  showFlag,
}: {
  auctions: AuctionListing[];
  viewerCountryId: string | null;
  showFlag: boolean;
}) {
  const preset = useActivePreset();
  if (auctions.length === 0) {
    return (
      <EmptyState
        title="No open auctions"
        description="Privatized state assets put up for public auction appear here. Check back when a government carves a holding to the market."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
      <div className="min-w-[720px]">
        <div className="flex items-center gap-4 border-b border-card-border bg-card-elevated px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
          <span className="flex-1">Corporation</span>
          <span className="w-28 shrink-0 text-right">Revenue/turn</span>
          <span className="w-28 shrink-0 text-right">Reserve</span>
          <span className="w-28 shrink-0 text-right">Highest</span>
          <span className="w-16 shrink-0 text-right">Bids</span>
          <span className="w-20 shrink-0 text-right">Closes</span>
        </div>
        {auctions.map((a) => {
          const canBid = viewerCountryId != null && viewerCountryId === a.countryId;
          return (
            <Link
              key={a.auctionId}
              href={`/corporation/${a.corpSequentialId}`}
              className="flex items-center gap-4 border-b border-card-border px-4 py-3 transition-colors last:border-0 hover:bg-card-elevated"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {showFlag && (
                  <Image
                    src={getCountryFlagUrlForEra(a.countryId, preset)}
                    alt={a.countryId}
                    width={24}
                    height={16}
                    unoptimized={bypassNextImageOptimization(
                      getCountryFlagUrlForEra(a.countryId, preset)
                    )}
                    className="h-4 w-6 shrink-0 rounded-sm object-cover"
                  />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{a.corpName}</span>
                    {canBid && (
                      <span className="shrink-0 rounded-full border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                        You can bid
                      </span>
                    )}
                    {a.goldenSharePercent > 0 && (
                      <span
                        className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                        title="The state keeps this share of control after privatization"
                      >
                        Golden share {a.goldenSharePercent}%
                      </span>
                    )}
                  </div>
                  <div className="truncate text-body-xs text-muted">
                    <span className="capitalize">{a.leadSectorType.replace(/_/g, " ")}</span> · HQ{" "}
                    {a.hqStateName}
                    {a.sectors.length > 1 && (
                      <span>
                        {" "}
                        · +{a.sectors.length - 1} sector{a.sectors.length - 1 === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <span className="w-28 shrink-0 text-right font-mono text-body-sm text-foreground">
                {natMoney(a.totalRevenuePerTurn, a.currency)}
              </span>
              <span className="w-28 shrink-0 text-right font-mono text-body-sm text-foreground">
                {natMoney(a.reservePrice, a.currency)}
                {a.valuationLocal > 0 && (
                  <span
                    className="block text-[10px] tabular-nums text-muted"
                    title={`Carve valuation ${natMoney(a.valuationLocal, a.currency)}`}
                  >
                    {Math.round((a.reservePrice / a.valuationLocal) * 100)}% of value
                  </span>
                )}
              </span>
              <span className="w-28 shrink-0 text-right font-mono text-body-sm text-foreground">
                {a.highestBid > 0 ? natMoney(a.highestBid, a.currency) : "—"}
                {a.highestBid > 0 && a.reservePrice > 0 && (
                  <span className="block text-[10px] tabular-nums text-muted">
                    {Math.round((a.highestBid / a.reservePrice) * 100)}% of reserve
                  </span>
                )}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums text-body-sm text-muted">
                {a.bidCount}
                {a.bidHistory.length > a.bidCount && (
                  <span
                    className="block text-[10px] tabular-nums"
                    title="All recorded bids and raises, including superseded ones"
                  >
                    {a.bidHistory.length} raises
                  </span>
                )}
              </span>
              <span className="w-20 shrink-0 text-right tabular-nums text-body-sm text-muted">
                {a.turnsLeft} turn{a.turnsLeft === 1 ? "" : "s"}
                <span className="block text-[10px] tabular-nums">T{a.closesAtTurn}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
