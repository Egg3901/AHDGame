"use client";

import { useState } from "react";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";
import { useMarketJson } from "./useMarketJson";
import { PanelState } from "./marketUi";
import type { CommodityData } from "@/app/country/[code]/stockmarket/types";
import { SupplyOfferHeader, SupplyOfferRow, type OfferCorporation } from "./SupplyOfferRow";
import {
  DEFAULT_OFFER_FILTERS,
  SupplyFilterBar,
  offersQuery,
  type OfferFilters,
} from "./supplyOfferUi";

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

export function SupplyDealsPanel() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<OfferFilters>(DEFAULT_OFFER_FILTERS);
  const { data, error, loading, reload } = useMarketJson<SupplyOffersResponse>(
    `/api/supply-offers?${offersQuery(filters, page, SUPPLY_PAGE_SIZE)}`
  );
  const prices = useMarketJson<{ commodities?: CommodityData[] }>("/api/commodities");
  const priceOf = (id: string) =>
    prices.data?.commodities?.find((c) => c.commodity === id)?.globalPrice;
  const offers = data?.offers ?? [];

  return (
    <PanelState loading={loading} error={error}>
      {data && !data.enabled ? (
        <p className="py-6 text-sm text-muted">Supply agreements are not enabled in this world.</p>
      ) : (
        <section className="rounded-xl border border-card-border bg-card p-4 shadow-card sm:p-5">
          <SupplyFilterBar
            filters={filters}
            onChange={(next) => {
              setFilters(next);
              setPage(1);
            }}
          />
          <p className="mt-2 text-xs text-muted">
            {(data?.total ?? 0).toLocaleString()} open offers. Taking one starts a binding agreement
            at the listed terms.
          </p>
          <div className="mt-3">
            <SupplyOfferHeader />
          </div>
          {offers.length === 0 ? (
            <p className="py-4 text-sm text-muted">No offers match these filters.</p>
          ) : (
            <ul>
              {offers.map((offer) => (
                <SupplyOfferRow
                  key={offer.id}
                  offer={offer}
                  commodity={offer.commodity}
                  marketPrice={priceOf(offer.commodity)}
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
