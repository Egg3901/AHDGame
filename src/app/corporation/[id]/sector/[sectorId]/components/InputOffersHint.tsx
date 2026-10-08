"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/observability/fetchJson";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";
import type { CommodityFlow } from "../types";

/**
 * Points a sector at the supply offers for its costliest input. Renders
 * nothing while loading, when supply agreements are off, or when nobody is
 * selling, so it never adds a dead end to the panel.
 */
export default function InputOffersHint({ flow }: { flow: CommodityFlow }) {
  const [sellers, setSellers] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ enabled?: boolean; offers?: SupplyListingView[] }>(
      `/api/supply-offers?commodity=${encodeURIComponent(flow.commodity)}`,
      { signal: controller.signal, feature: "supply-offers-hint" }
    )
      .then((data) => {
        if (controller.signal.aborted || !data.enabled) return;
        setSellers((data.offers ?? []).filter((o) => o.side === "sell" && !o.own).length);
      })
      .catch(() => {
        // A discovery hint must never break the panel; a failed load just hides it.
        if (!controller.signal.aborted) setSellers(0);
      });
    return () => controller.abort();
  }, [flow.commodity]);

  if (sellers === 0) return null;
  return (
    <p className="mt-2 text-body-xs text-muted">
      {flow.label} is your costliest input.{" "}
      <Link
        href={`/commodity/${flow.commodity}/offers`}
        className="text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
      >
        {sellers} {sellers === 1 ? "seller" : "sellers"} offering
      </Link>
    </p>
  );
}
