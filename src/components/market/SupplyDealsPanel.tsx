"use client";

import { useState } from "react";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";
import { useMarketJson } from "./useMarketJson";
import { PanelState } from "./marketUi";
import { SupplyOfferRow, type OfferCorporation } from "./SupplyOfferRow";

export const SUPPLY_PAGE_SIZE = 20;

export interface SupplyOffersResponse {
  enabled: boolean;
  offers: SupplyListingView[];
  myCorporations: OfferCorporation[];
  currentTurn: number;
  page: number;
  hasMore: boolean;
  total: number;
}

type Side = "all" | "sell" | "buy";

export function SupplyDealsPanel() {
  const [page, setPage] = useState(1);
  const [side, setSide] = useState<Side>("all");
  const { data, error, loading, reload } = useMarketJson<SupplyOffersResponse>(
    `/api/supply-offers?page=${page}&pageSize=${SUPPLY_PAGE_SIZE}`
  );
  const offers = (data?.offers ?? []).filter((o) => side === "all" || o.side === side);

  return (
    <PanelState loading={loading} error={error}>
      {data && !data.enabled ? (
        <p className="py-6 text-sm text-muted">Supply agreements are not enabled in this world.</p>
      ) : (
        <section className="rounded-xl border border-card-border bg-card p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">
              {(data?.total ?? 0).toLocaleString()} open offers across all commodities. Taking one
              starts a binding agreement at the listed terms.
            </p>
            <div className="flex gap-1" role="group" aria-label="Offer side">
              {(["all", "sell", "buy"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={side === s}
                  onClick={() => setSide(s)}
                  className={`h-7 rounded-md border px-2.5 text-xs font-medium ${
                    side === s
                      ? "border-primary bg-primary text-white"
                      : "border-card-border text-foreground hover:bg-card-elevated"
                  }`}
                >
                  {s === "all" ? "All" : s === "sell" ? "Sell offers" : "Buy requests"}
                </button>
              ))}
            </div>
          </div>
          {offers.length === 0 ? (
            <p className="py-4 text-sm text-muted">No offers on this page.</p>
          ) : (
            <ul className="mt-2">
              {offers.map((offer) => (
                <SupplyOfferRow
                  key={offer.id}
                  offer={offer}
                  commodity={offer.commodity}
                  showCommodity
                  corporations={data?.myCorporations ?? []}
                  onTaken={reload}
                />
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="h-7 rounded-md border border-card-border px-2.5 text-foreground disabled:opacity-40"
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              type="button"
              disabled={!data?.hasMore}
              onClick={() => setPage((p) => p + 1)}
              className="h-7 rounded-md border border-card-border px-2.5 text-foreground disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </section>
      )}
    </PanelState>
  );
}
