"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui";

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
    <div className="space-y-3 rounded-xl border border-card-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold">Discipline watch</h3>
        <p className="mt-0.5 text-[11px] text-muted">
          NPPs with loyalty below {data?.threshold ?? 40}. These members are most likely to ignore a
          party whip - the same threshold the cross-pressure resolver uses.
        </p>
      </div>

      {loading && (
        <div className="min-h-[10rem] divide-y divide-card-border/40">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between gap-2 py-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-12 rounded-full" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-error">{error}</p>}

      {data && data.items.length === 0 && (
        <p className="text-xs text-muted">
          No NPPs below the threshold. Caucus discipline is solid for now.
        </p>
      )}

      {data && data.items.length > 0 && (
        <ul className="divide-y divide-card-border/40">
          {data.items.map((row) => (
            <li
              key={row.id}
              className="grid gap-2 py-3 text-xs md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/politicians/npp/${row.sequentialId ?? row.id}`}
                  className="block truncate text-sm font-medium hover:text-primary"
                >
                  {row.name}
                </Link>
                <p className="truncate text-[11px] text-muted">
                  {row.homeState.replace(/^.+_/, "")}
                  {row.currentOffice ? ` | ${row.currentOffice}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider md:justify-end">
                <Stat label="loyalty" value={row.loyalty} tone="loyalty" />
                <Stat label="amb" value={row.ambition} tone="ambition" />
                <Stat label="stub" value={row.stubbornness} tone="stubbornness" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "loyalty" | "ambition" | "stubbornness" | "neutral";
}) {
  const clsByTone = {
    loyalty: "border-amber-500/40 bg-amber-500/15 text-amber-300",
    ambition: "border-sky-500/40 bg-sky-500/15 text-sky-300",
    stubbornness: "border-rose-500/40 bg-rose-500/15 text-rose-300",
    neutral: "border-card-border bg-background text-muted",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${clsByTone[tone]}`}
    >
      <span className="opacity-70">{label}</span>{" "}
      <span className="text-foreground tabular-nums">{value.toFixed(1)}</span>
    </span>
  );
}
