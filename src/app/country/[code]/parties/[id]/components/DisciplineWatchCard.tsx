"use client";

import { InlineError } from "@/components/ui/InlineError";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import { PARTY_SECTION_HEADING_CLASS } from "@/components/party/partyPageStyles";

/**
 * Overview card listing NPPs in this party with low loyalty (default <40).
 * Read-only surface that points the chair at NPPs the cross-pressure resolver
 * is most likely to send "off-script" - the same `personality.loyalty` value
 * drives both this list and the resolver's compliance gate.
 */

interface WatchRow {
  id: string;
  sequentialId: number | null;
  name: string;
  homeState: string;
  currentOffice: string | null;
  loyalty: number;
  ambition: number;
  stubbornness: number;
}

interface WatchResponse {
  threshold: number;
  items: WatchRow[];
}

interface Props {
  countryCode: string;
  partyId: string;
}

export function DisciplineWatchCard({ countryCode, partyId }: Props) {
  const [data, setData] = useState<WatchResponse | null>(null);
  /**
   * `items` read defensively rather than trusted.
   *
   * The value comes straight off a fetch, and a response that parses but
   * carries no `items` array (an error envelope, a truncated payload)
   * used to throw on `.length` here and take the whole party hub down
   * with it, not just this card.
   */
  const items = Array.isArray(data?.items) ? data.items : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/country/${countryCode}/parties/${partyId}/discipline-watch`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Failed to load watch (${res.status})`);
        }
        if (!cancelled) setData((await res.json()) as WatchResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load watch");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [countryCode, partyId]);

  return (
    <section className="min-w-0 space-y-4">
      <div>
        <h2 className={PARTY_SECTION_HEADING_CLASS}>Discipline watch</h2>
        <p className="mt-1 text-body text-muted">
          NPPs with loyalty below {data?.threshold ?? 40}. These members are most likely to ignore a
          party whip, at the same threshold the cross-pressure resolver uses.
        </p>
      </div>

      {loading && (
        <div className="min-h-[10rem] divide-y divide-card-border">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between gap-2 py-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <div className="flex gap-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          ))}
        </div>
      )}
      <InlineError error={error} className="text-body-sm text-error" />

      {items && items.length === 0 && (
        <p className="text-body text-muted">
          No NPPs below the threshold. Caucus discipline is solid for now.
        </p>
      )}

      {items && items.length > 0 && (
        <ul className="divide-y divide-card-border border-y border-card-border">
          {items.map((row) => (
            <li
              key={row.id}
              className="grid gap-1.5 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/politicians/npp/${row.sequentialId ?? row.id}`}
                  className="block truncate text-body font-medium text-foreground hover:underline"
                >
                  {row.name}
                </Link>
                <p className="truncate text-body-sm text-muted">
                  {row.homeState.replace(/^.+_/, "")}
                  {row.currentOffice ? ` | ${row.currentOffice}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-body-sm md:justify-end">
                <Stat label="Loyalty" value={row.loyalty} />
                <Stat label="Ambition" value={row.ambition} />
                <Stat label="Stubbornness" value={row.stubbornness} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value.toFixed(1)}</span>
    </span>
  );
}
