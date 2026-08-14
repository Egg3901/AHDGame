"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SectionLabel } from "@/components/ui";
import { positionBucketHex } from "@/lib/utils/politics";
import { policyUrl } from "@/lib/urls";
import { AxisSpectrumBar } from "./AxisSpectrumBar";
import { LocalTime } from "@/components/time/LocalTime";
import type { EconomicModelView } from "@/lib/economicModels/present";

const EUROPEAN_COLOUR_COUNTRIES = new Set(["UK", "DE"]);

/** JSON-serialized shapes from GET /api/country/[code]/national-axes. */
export interface NationalAxesData {
  axes: {
    economic: number | null;
    social: number | null;
    lawCount: number;
    economicCount: number;
    socialCount: number;
  };
  movers: {
    typeKey: string;
    title: string;
    enactedAt: string;
    enactedYear: number;
    economic: number | null;
    social: number | null;
    economicBefore: number | null;
    economicAfter: number | null;
    socialBefore: number | null;
    socialAfter: number | null;
  }[];
  drift: {
    points: {
      enactedAt: string;
      enactedYear: number;
      economicAvg: number | null;
      socialAvg: number | null;
    }[];
  };
}

function EnactedStamp({ enactedYear, enactedAt }: { enactedYear: number; enactedAt: string }) {
  const date = new Date(enactedAt);
  if (Number.isNaN(date.getTime())) return <>{enactedYear}</>;
  return (
    <>
      {enactedYear} · <LocalTime value={date} options={{ month: "short", day: "numeric" }} />
    </>
  );
}

const formatAvg = (value: number | null) => (value === null ? "—" : value.toFixed(1));

function AxisChip({
  axis,
  value,
  countryId,
}: {
  axis: "economic" | "social";
  value: number;
  countryId: string;
}) {
  const european = axis === "economic" && EUROPEAN_COLOUR_COUNTRIES.has(countryId);
  // Bucket ramp hex — the established chart-colour exception.
  const hex = positionBucketHex(value, axis, european);
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
      style={{ color: hex, backgroundColor: `${hex}1f` }}
    >
      {axis === "economic" ? "econ" : "social"} {value > 0 ? `+${value}` : value}
    </span>
  );
}

/**
 * The lander's National Ideology band: twin R1 spectrum bars with live drift
 * sparklines, the E1 Economic Model placeholder field, and the recent-movers
 * feed — all driven by the national-axes route (equal weight, explicit zeros).
 */
export function NationalIdeologyBand({
  countryId,
  data,
  loading,
}: {
  countryId: string;
  data: NationalAxesData | null;
  loading: boolean;
}) {
  // Fetch failure (loaded but no data) hides the band — rendering the
  // "no laws" empty state on a transient error would misreport the law book.
  if (!loading && data === null) return null;

  const axes = data?.axes ?? null;
  const hasAnyAxis = axes !== null && (axes.economic !== null || axes.social !== null);

  return (
    <section className="rounded-2xl border border-card-border bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <SectionLabel>National Ideology</SectionLabel>
        <span className="text-xs text-muted">
          {axes && axes.lawCount > 0 ? (
            <>
              Average of{" "}
              <span className="font-semibold text-foreground/80">
                {axes.lawCount} implemented national {axes.lawCount === 1 ? "law" : "laws"}
              </span>{" "}
              · equal weight ·{" "}
            </>
          ) : null}
          <Link
            href={policyUrl(countryId)}
            className="font-semibold text-primary transition-colors hover:text-primary-dark"
          >
            View National Policy →
          </Link>
        </span>
      </div>

      {loading ? (
        <div className="mt-5 grid gap-7 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.9fr]" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i}>
              <div className="mb-2 h-3 w-24 rounded bg-track" />
              <div className="h-1.5 rounded-full bg-track" />
            </div>
          ))}
          <div className="h-16 rounded-lg border border-dashed border-card-border bg-card-muted" />
        </div>
      ) : !hasAnyAxis ? (
        <div className="mt-5 grid gap-7 lg:grid-cols-[2fr_0.9fr]">
          <p className="self-center text-sm italic text-muted">
            No implemented national laws carry ideology positions yet.
          </p>
          <EconomicModelField countryId={countryId} />
        </div>
      ) : (
        <div className="mt-5 grid gap-7 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.9fr]">
          <AxisSpectrumBar
            axis="economic"
            value={axes.economic}
            countryId={countryId}
            driftSeries={data?.drift.points.map((point) => point.economicAvg)}
          />
          <AxisSpectrumBar
            axis="social"
            value={axes.social}
            countryId={countryId}
            driftSeries={data?.drift.points.map((point) => point.socialAvg)}
          />
          <EconomicModelField countryId={countryId} />
        </div>
      )}

      {!loading && (data?.movers.length ?? 0) > 0 && (
        <div className="mt-5 border-t border-card-border pt-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Recently moved the needle
            </span>
            <span className="text-xs text-muted">
              last {data!.movers.length} {data!.movers.length === 1 ? "law" : "laws"} with axis
              positions
            </span>
          </div>
          <ul>
            {data!.movers.map((mover) => {
              // Pull column shows the mover's dominant axis (larger |value|; econ on ties).
              const dominant =
                mover.social !== null &&
                (mover.economic === null || Math.abs(mover.social) > Math.abs(mover.economic))
                  ? ("social" as const)
                  : ("economic" as const);
              const before = dominant === "economic" ? mover.economicBefore : mover.socialBefore;
              const after = dominant === "economic" ? mover.economicAfter : mover.socialAfter;
              return (
                <li
                  key={`${mover.typeKey}-${mover.enactedAt}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-card-border/50 py-2 text-sm last:border-b-0 sm:grid-cols-[110px_1fr_auto_auto] sm:gap-x-4"
                >
                  <span className="order-2 font-mono text-[10px] text-muted sm:order-none">
                    <EnactedStamp enactedYear={mover.enactedYear} enactedAt={mover.enactedAt} />
                  </span>
                  <span className="order-1 truncate text-foreground/90 sm:order-none">
                    {mover.title}
                  </span>
                  <span className="order-3 flex gap-1.5 sm:order-none">
                    {mover.economic !== null && (
                      <AxisChip axis="economic" value={mover.economic} countryId={countryId} />
                    )}
                    {mover.social !== null && (
                      <AxisChip axis="social" value={mover.social} countryId={countryId} />
                    )}
                  </span>
                  <span className="order-4 font-mono text-[10px] text-muted sm:order-none">
                    avg {formatAvg(before)} → {formatAvg(after)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

const BAND_TONE: Record<string, string> = {
  Mixed: "text-muted",
  Emerging: "text-warning",
  Established: "text-primary",
  Dominant: "text-success",
};

/**
 * E1 placement (locked): dashed peer of the two axes, showing the country's
 * emergent economic model (P7) + its intensity band. Falls back to "Not yet
 * determined" only before the classification phase has run.
 */
function EconomicModelField({ countryId }: { countryId: string }) {
  const [view, setView] = useState<EconomicModelView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/country/${countryId}/economic-model`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EconomicModelView | null) => {
        if (cancelled) return;
        setView(d);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  return (
    <div className="flex flex-col justify-center rounded-lg border border-dashed border-card-border bg-card-muted px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Economic Model
        </span>
        {view && (
          <span className={`text-[11px] font-semibold ${BAND_TONE[view.band] ?? "text-muted"}`}>
            {view.band} · {view.intensity}
          </span>
        )}
      </div>
      {view ? (
        <>
          <span className="mt-1 text-sm font-semibold text-foreground">{view.currentName}</span>
          {view.effects && (
            <div className="mt-1.5 space-y-0.5 border-t border-card-border/40 pt-1.5 text-[10px] leading-snug text-muted">
              {view.signatureSectors[0] && (
                <div>
                  <span className="font-semibold text-foreground/80">
                    {view.signatureSectors[0]}
                  </span>{" "}
                  <Effect v={view.effects.corpMarginFavoredPct} suffix="% margin" /> ·{" "}
                  <Effect v={view.effects.sectorGdpWeightPct} suffix="% GDP wt" />
                </div>
              )}
              {view.signatureSectors.length > 1 && (
                <div>
                  <span className="text-foreground/70">
                    {view.signatureSectors.slice(1).join(", ")}
                  </span>{" "}
                  <Effect v={view.effects.corpMarginSecondaryPct} suffix="% margin" /> ·{" "}
                  <Effect v={view.effects.secondaryGdpWeightPct} suffix="% GDP wt" />
                </div>
              )}
              <div>
                Off-model corps <Effect v={view.effects.corpMarginOffModelPct} suffix="% margin" />
              </div>
              {view.effects.spendingEfficiencyPct !== 0 && (
                <div>
                  Coherent spending{" "}
                  <Effect v={view.effects.spendingEfficiencyPct} suffix="% effective" />
                </div>
              )}
              {view.effects.synergies.length > 0 && (
                <div className="flex flex-wrap gap-x-2">
                  {view.effects.synergies.map((s) => (
                    <span key={s.label}>
                      {s.label} <Effect v={s.delta} suffix="" />
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <span className="mt-1 text-sm italic text-muted">
          {loaded ? "Not yet determined" : "…"}
        </span>
      )}
    </div>
  );
}

/** Signed effect magnitude, colored by direction. Renders "—" (no orphan suffix)
 *  when the value is missing/non-finite. */
function Effect({ v, suffix }: { v: number | undefined; suffix: string }) {
  if (!Number.isFinite(v)) return <span className="text-muted">—</span>;
  const value = v as number;
  const tone = value > 0 ? "text-success" : value < 0 ? "text-error" : "text-muted";
  return (
    <span className={`font-semibold tabular-nums ${tone}`}>
      {value >= 0 ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
}
