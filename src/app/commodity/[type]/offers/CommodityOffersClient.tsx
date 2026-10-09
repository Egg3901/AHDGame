"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { COMMODITY_LABELS, type CommodityType } from "@/lib/constants/commodities";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";
import { apiErrorText } from "@/lib/errors/catalog";
import {
  SupplyOfferHeader,
  SupplyOfferRow,
  type OfferCorporation,
} from "@/components/market/SupplyOfferRow";
import {
  DEFAULT_OFFER_FILTERS,
  SupplyFilterBar,
  offersQuery,
  type OfferFilters,
} from "@/components/market/supplyOfferUi";

interface OffersResponse {
  enabled: boolean;
  offers: SupplyListingView[];
  myCorporations: OfferCorporation[];
  currentTurn: number;
}

export default function CommodityOffersClient({ commodity }: { commodity: CommodityType }) {
  const [data, setData] = useState<OffersResponse | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState<OfferFilters>(DEFAULT_OFFER_FILTERS);
  const [price, setPrice] = useState<number | undefined>();
  const reload = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/supply-offers?${offersQuery({ ...filters, commodity })}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(apiErrorText(body, "Could not load offers."));
        if (!controller.signal.aborted) setData(body as OffersResponse);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Could not load offers.");
        }
      });
    return () => controller.abort();
  }, [commodity, filters, revision]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/commodities", { signal: controller.signal })
      .then((r) => r.json())
      .then((body: { commodities?: { commodity: string; globalPrice: number }[] }) => {
        if (!controller.signal.aborted) {
          setPrice(body.commodities?.find((c) => c.commodity === commodity)?.globalPrice);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [commodity]);

  const label = COMMODITY_LABELS[commodity];

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-8 sm:px-6">
        <nav className="flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
          <Link
            href="/country/us/stockmarket?tab=commodities"
            className="transition-colors hover:text-foreground"
          >
            Commodities
          </Link>
          <span aria-hidden>/</span>
          <Link
            href={`/commodity/${commodity}`}
            className="transition-colors hover:text-foreground"
          >
            {label}
          </Link>
          <span aria-hidden>/</span>
          <span className="font-medium text-foreground">Supply offers</span>
        </nav>
        <p className="max-w-2xl text-sm text-muted">
          Standing offers to buy or sell {label.toLowerCase()} on a supply agreement. Taking an
          offer starts a binding agreement at the listed terms: a premium or discount to the market
          price, for the quantity you choose, with priority in clearing. Related corporations and
          corporations in countries with a closed trade lane cannot contract.
        </p>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <p role="status">Loading offers...</p>}
        {data && !data.enabled && (
          <p className="text-sm text-muted">Supply agreements are not enabled in this world.</p>
        )}
        {data?.enabled && (
          <section className="rounded-xl border border-card-border bg-card p-4 shadow-card sm:p-5">
            <SupplyFilterBar filters={filters} onChange={setFilters} showCommodity={false} />
            <div className="mt-3">
              <SupplyOfferHeader />
            </div>
            {data.offers.length === 0 ? (
              <p className="py-4 text-sm text-muted">No offers match these filters.</p>
            ) : (
              <ul>
                {data.offers.map((offer) => (
                  <SupplyOfferRow
                    key={offer.id}
                    offer={offer}
                    commodity={commodity}
                    marketPrice={price}
                    corporations={data.myCorporations}
                    onTaken={reload}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
