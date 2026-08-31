"use client";

/**
 * Hero and Clock for the Blend detail view.
 *
 * The hero states the verdict in words before any table does: a serif
 * headline, a standfirst that explains how the seats were arrived at, and the
 * four figures that decide the race.
 */

import type { BlendClockRow, BlendDetailModel } from "@/lib/elections/blendDetailViewModel";

interface BlendDetailHeroProps {
  model: BlendDetailModel;
  countryName: string;
  regionName: string;
  year: number | null;
}

export function BlendDetailHero({ model, countryName, regionName, year }: BlendDetailHeroProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-card-border bg-card">
      <div
        className={`flex items-center gap-3 px-5 py-3 ${
          model.reporting === "Count closed" ? "bg-success" : "bg-info"
        }`}
      >
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-background">
          {model.phaseLabel}
        </span>
        <div className="flex-1" />
        <span className="text-[11px] font-extrabold uppercase tracking-[0.1em] tabular-nums text-background/75">
          {model.reporting}
        </span>
      </div>

      <div className="px-5 py-6">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted">
          {countryName} · {regionName}
          {year ? ` · ${year}` : ""}
        </div>
        <h1 className="mt-2 max-w-[900px] font-serif text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
          {model.headline}
        </h1>
        <p className="mt-3 max-w-[700px] font-serif text-lg leading-relaxed text-muted">
          {model.standfirst}
        </p>

        {model.facts.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-7 border-t border-card-border pt-4">
            {model.facts.map((f) => (
              <div key={f.key} className="min-w-0">
                <div className="whitespace-nowrap text-[9px] font-extrabold uppercase tracking-[0.18em] text-muted">
                  {f.key}
                </div>
                <div
                  className="mt-0.5 font-serif text-2xl font-bold tabular-nums"
                  style={f.color ? { color: f.color } : undefined}
                >
                  {f.value}
                </div>
                {f.sub && <div className="text-[10px] tabular-nums text-muted">{f.sub}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function BlendClock({ rows }: { rows: BlendClockRow[] }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3.5 text-[10px] font-black uppercase tracking-[0.16em] text-muted">
        Clock
      </div>
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex items-baseline justify-between gap-2.5 border-b border-card-border/50 py-2.5 last:border-b-0"
        >
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">
            {r.label}
          </span>
          <span
            className="font-serif text-[17px] font-bold tabular-nums"
            style={r.color ? { color: r.color } : undefined}
          >
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}
