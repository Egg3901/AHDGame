"use client";

import { useEffect, useState } from "react";
import type { SeanadComposition } from "@/lib/ireland/seanadComposition";

function PartySeatBar({
  total,
  segments,
}: {
  total: number;
  segments: { partyId: string; partyName: string; partyColor: string; seats: number }[];
}) {
  if (total === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full border border-card-border bg-card">
        {segments.map((s) => {
          const pct = (s.seats / total) * 100;
          return (
            <div
              key={s.partyId}
              style={{ width: `${pct}%`, backgroundColor: s.partyColor }}
              title={`${s.partyName} — ${s.seats} seat${s.seats === 1 ? "" : "s"}`}
            />
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {segments.map((s) => (
          <li key={s.partyId} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.partyColor }}
            />
            <span className="text-foreground">{s.partyName}</span>
            <span>· {s.seats}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IESeanadCompositionPanel() {
  const [data, setData] = useState<SeanadComposition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/country/ie/legislature/seanad/composition")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch failed"))))
      .then((json) => {
        if (!cancelled) setData(json as SeanadComposition);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load Seanad composition.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-card/60 animate-pulse" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return <p className="py-12 text-center text-sm text-muted">{error ?? "No data."}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border/40 bg-card-muted/30 p-4">
        <p className="text-xs leading-relaxed text-muted">
          <strong className="text-foreground">Advisory chamber — not in legislative loop.</strong>{" "}
          The Seanad sits alongside the Dáil but does not vote on the bills tracked here. This panel
          reconstructs its 60-seat composition from the current Dáil seat-share, sitting cabinet,
          and a static university placeholder.
        </p>
      </div>

      <section className="rounded-xl border border-card-border bg-card p-5">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground">Vocational Panels</h3>
          <span className="text-xs text-muted">{data.totals.vocational} / 43</span>
        </header>
        <p className="mb-3 text-xs text-muted">
          Derived proportionally from the Dáil seat-share (Hamilton allocation). Mirrors how Irish
          vocational-panel senators are chosen indirectly by an electorate of councillors, outgoing
          TDs, and senators in real life.
        </p>
        {data.vocational.length === 0 ? (
          <p className="text-sm text-muted">No Dáil is currently seated.</p>
        ) : (
          <PartySeatBar total={data.totals.vocational} segments={data.vocational} />
        )}
      </section>

      <section className="rounded-xl border border-card-border bg-card p-5">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground">Taoiseach Nominees</h3>
          <span className="text-xs text-muted">{data.totals.taoiseachPicks} / 11</span>
        </header>
        <p className="mb-3 text-xs text-muted">
          11 senators are nominated directly by the Taoiseach. Sitting cabinet ministers fill these
          slots first; any leftover slots are filled with governing-party loyalists.
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {data.taoiseachPicks.map((p, i) => (
            <li
              key={`${p.characterId ?? "filler"}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-card-border bg-card-muted/40 px-3 py-2 text-sm"
            >
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: p.partyColor }}
              />
              <span className="min-w-0 flex-1 truncate">
                {p.characterName ?? (
                  <span className="italic text-muted">Loyalist nominee ({p.partyName})</span>
                )}
              </span>
              <span className="text-xs text-muted">{p.partyName}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-card-border bg-card p-5">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground">University Constituencies</h3>
          <span className="text-xs text-muted">{data.totals.university} / 6</span>
        </header>
        <p className="text-xs text-muted">
          6 senators are elected by graduates of Trinity College Dublin (3) and the National
          University of Ireland (3). Modelled here as a static placeholder; a full
          graduate-electorate mechanic is tracked in the backlog (§5.1 Option D).
        </p>
      </section>
    </div>
  );
}
