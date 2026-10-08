"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { COMMODITY_LABELS, type CommodityType } from "@/lib/constants/commodities";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";
import { apiErrorText } from "@/lib/errors/catalog";
import { SupplyOfferRow, type OfferCorporation } from "@/components/market/SupplyOfferRow";

interface OffersResponse {
  enabled: boolean;
  offers: SupplyListingView[];
  myCorporations: OfferCorporation[];
  currentTurn: number;
}

function Section({
  title,
  help,
  offers,
  ...rest
}: {
  title: string;
  help: string;
  offers: SupplyListingView[];
  commodity: CommodityType;
  corporations: OfferCorporation[];
  onTaken: () => void;
}) {
  return (
    <section className="rounded-xl border border-card-border bg-card p-6 shadow-card">
      <h2 className="text-heading-sm font-bold text-foreground">{title}</h2>
      <p className="mb-2 mt-1 text-body-sm text-muted">{help}</p>
      {offers.length === 0 ? (
        <p className="py-2 text-xs text-muted">None open right now.</p>
      ) : (
        <ul>
          {offers.map((offer) => (
            <SupplyOfferRow key={offer.id} offer={offer} {...rest} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CommodityOffersClient({ commodity }: { commodity: CommodityType }) {
  const [data, setData] = useState<OffersResponse | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/supply-offers?commodity=${commodity}`, { signal: controller.signal })
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
  }, [commodity, revision]);

  const label = COMMODITY_LABELS[commodity];
  const sells = data?.offers.filter((o) => o.side === "sell") ?? [];
  const buys = data?.offers.filter((o) => o.side === "buy") ?? [];

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-8 sm:px-6">
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
          <>
            <Section
              title="Sell offers"
              help="Corporations offering to supply you."
              offers={sells}
              commodity={commodity}
              corporations={data.myCorporations}
              onTaken={reload}
            />
            <Section
              title="Buy requests"
              help="Corporations asking for a supplier. Taking one makes you the supplier, within your plant capacity."
              offers={buys}
              commodity={commodity}
              corporations={data.myCorporations}
              onTaken={reload}
            />
          </>
        )}
      </main>
    </div>
  );
}
