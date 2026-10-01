"use client";

import { useEffect, useState } from "react";
import type { ExchangeData } from "./types";

/** Keep the headline, ticker and listings on the same cadence as the live chart. */
export function useExchangeQuotes(exchange: string, currentTurn: number) {
  const [data, setData] = useState<ExchangeData | null>(null);
  const [failure, setFailure] = useState<{ exchange: string; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    async function refresh() {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/stock-exchange?exchange=${exchange}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Unable to refresh stock quotes. Retrying every minute.");
        const next = (await res.json()) as ExchangeData;
        if (controller.signal.aborted) return;
        if (next.exchange?.toLowerCase() !== exchange || !Array.isArray(next.listings))
          throw new Error("Invalid stock quote response");
        setData((previous) =>
          previous?.exchange === next.exchange && next.asOf && previous.asOf === next.asOf
            ? previous
            : next
        );
        setFailure(null);
      } catch {
        if (!controller.signal.aborted)
          setFailure({
            exchange,
            message: "Unable to refresh stock quotes. Retrying every minute.",
          });
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [exchange, currentTurn]);

  const visible = data?.exchange?.toLowerCase() === exchange ? data : null;
  const error = failure?.exchange === exchange ? failure.message : "";
  return { data: visible, error, loading: !visible && !error };
}
