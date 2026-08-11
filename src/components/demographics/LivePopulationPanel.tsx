"use client";

import { useState, useEffect } from "react";
import { regionApiSubUrl } from "@/lib/urls";
import { fetchJson } from "@/lib/observability/fetchJson";
import { formatPopulation } from "@/lib/utils/formatters";
import { AgePyramid } from "./AgePyramid";
import type { AgeSexVector } from "@/lib/demographics/cohortVector";

interface PopulationPayload {
  population: number | null;
  houseDistricts: number | null;
  ages: AgeSexVector | null;
  populationMetrics: {
    populationGrowth: number | null;
    medianAge: number | null;
    sexRatio: number | null;
    dependencyRatio: number | null;
    realizedMigrationRate: number | null;
  };
  censusSeatChange: { year: number; from: number; to: number; delta: number } | null;
}

const pctSigned = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const fixed = (v: number | null, d = 0) => (v == null ? "—" : v.toFixed(d));

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-widest text-muted">{label}</span>
      <span
        className={`text-sm font-bold tabular-nums ${
          tone === "up" ? "text-success" : tone === "down" ? "text-error" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function LivePopulationPanel({
  stateId,
  countryId,
}: {
  stateId: string;
  countryId: string;
}) {
  const [data, setData] = useState<PopulationPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // `loading` starts true and the panel mounts per region, so we don't re-set it
  // synchronously here (avoids a cascading-render lint); the async settle clears it.
  useEffect(() => {
    let active = true;
    fetchJson<PopulationPayload | null>(regionApiSubUrl(countryId, stateId, "population"), {
      feature: "live-population",
    })
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [countryId, stateId]);

  if (loading) {
    return <div className="h-40 animate-pulse rounded-lg border border-card-border bg-card p-6" />;
  }
  if (!data) return null;

  const m = data.populationMetrics;
  const seat = data.censusSeatChange;
  const seatMag = seat ? Math.abs(seat.delta) : 0;

  return (
    <div className="space-y-3">
      {/* census/reapportionment notice */}
      {seat && (
        <div className="rounded-lg border border-primary/25 bg-primary/10 px-4 py-2.5 text-xs text-foreground">
          <span className="font-semibold">{seat.year} Census:</span> this region{" "}
          {seat.delta > 0 ? "gained" : "lost"} {seatMag} House seat
          {seatMag === 1 ? "" : "s"} ({seat.from} &rarr; {seat.to}).
        </div>
      )}

      <div className="rounded-lg border border-card-border bg-card p-4">
        <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted">
          Live Population
        </h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            label="Population"
            value={data.population != null ? formatPopulation(data.population) : "—"}
          />
          <Stat
            label="Growth /yr"
            value={pctSigned(m.populationGrowth)}
            tone={m.populationGrowth == null ? undefined : m.populationGrowth >= 0 ? "up" : "down"}
          />
          <Stat label="Median Age" value={fixed(m.medianAge, 0)} />
          <Stat label="Sex Ratio (♂%)" value={fixed(m.sexRatio, 1)} />
          <Stat label="Dependency" value={fixed(m.dependencyRatio, 2)} />
          <Stat
            label="Net Migration /yr"
            value={pctSigned(m.realizedMigrationRate)}
            tone={
              m.realizedMigrationRate == null
                ? undefined
                : m.realizedMigrationRate >= 0
                  ? "up"
                  : "down"
            }
          />
        </div>
      </div>

      <AgePyramid ages={data.ages} />
    </div>
  );
}
