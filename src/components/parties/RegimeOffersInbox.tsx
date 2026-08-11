"use client";

/**
 * Read-only inbox of regime-level notifications addressed to a party.
 *
 * Currently surfaces Stage-2 "selective concession" legalization events
 * — the ruling-party leader legalized this party in exchange for
 * cooling unrest. The party's leaders see "You were legalized" without
 * needing access to the ruling party's diagnostic scalars.
 *
 * Info-asymmetry: the API filter is keyed by partyId; the response
 * shape strips any leader-side diagnostic fields. Renders nothing when
 * there are no offers (so non-regime party pages stay clean).
 */
import { useEffect, useState } from "react";

interface Offer {
  turn: number;
  title: string;
  at: string;
  subtype: string | null;
}

interface ApiResponse {
  countryId: string;
  partyId: string;
  offers: Offer[];
}

interface Props {
  countryCode: string;
  /** Party sequentialId. Must be a numeric-string. */
  partySequentialId: string;
}

const SUBTYPE_LABEL: Record<string, string> = {
  selective_concession: "Legalized via selective concession",
};

export function RegimeOffersInbox({ countryCode, partySequentialId }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/country/${countryCode}/parties/${partySequentialId}/regime-offers`
        );
        if (!res.ok) return;
        const body = (await res.json()) as ApiResponse;
        if (!cancelled) setData(body);
      } catch {
        /* swallow */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [countryCode, partySequentialId]);

  if (!data || data.offers.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-card-border bg-card p-4"
      data-testid="regime-offers-inbox"
    >
      <h3 className="text-sm font-semibold text-foreground">Regime notifications</h3>
      <ul className="mt-2 space-y-2">
        {data.offers.map((o) => (
          <li
            key={`${o.turn}-${o.subtype ?? "event"}`}
            className="rounded border border-card-border/60 bg-background/40 p-2"
            data-testid="regime-offer-item"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-foreground">{o.title}</div>
                {o.subtype && (
                  <div className="mt-0.5 text-xs text-muted">
                    {SUBTYPE_LABEL[o.subtype] ?? o.subtype}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted">Turn {o.turn}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
