"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { COMMODITY_LABELS, COMMODITY_UNITS, type CommodityType } from "@/lib/constants/commodities";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";
import { apiErrorText } from "@/lib/errors/catalog";

interface OffersResponse {
  enabled: boolean;
  offers: SupplyListingView[];
  myCorporations: { id: string; name: string; countryId?: string }[];
  currentTurn: number;
}

const control =
  "h-8 rounded-md border border-card-border bg-background px-2 text-[13px] text-foreground focus:border-foreground focus:outline-none";

function pct(premium: number): string {
  const value = Math.round(premium * 1000) / 10;
  return `${value > 0 ? "+" : ""}${value}%`;
}

function OfferRow({
  offer,
  commodity,
  corporations,
  onTaken,
}: {
  offer: SupplyListingView;
  commodity: CommodityType;
  corporations: OffersResponse["myCorporations"];
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
          {offer.corporationName}
          {offer.ai ? " (AI)" : ""}
          {offer.stateId ? ` (${offer.stateId})` : ""}
        </span>
        <span className="text-sm tabular-nums text-foreground">
          {offer.volumeCap.toLocaleString()} {COMMODITY_UNITS[commodity]} per turn at{" "}
          {pct(offer.pricePremium)} to market
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
  corporations: OffersResponse["myCorporations"];
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
            <OfferRow key={offer.id} offer={offer} {...rest} />
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
