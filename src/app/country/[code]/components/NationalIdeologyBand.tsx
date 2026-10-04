"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

/** How the national average on the mover's axis moved: "Average -1.1 → -1.2". */
function averageShift(before: number | null, after: number | null): string {
  if (before === null && after === null) return "No average yet";
  if (before === null) return `Average ${after!.toFixed(1)}`;
  if (after === null) return `Average ${before.toFixed(1)}`;
  return `Average ${before.toFixed(1)} → ${after.toFixed(1)}`;
}

function AxisFigure({
  axis,
  value,
  countryId,
}: {
  axis: "economic" | "social";
  value: number;
  countryId: string;
}) {
  const european = axis === "economic" && EUROPEAN_COLOUR_COUNTRIES.has(countryId);
  // Bucket ramp hex, the established chart-colour exception: the word carries
  // the lean, so it is coloured text with no tinted chip behind it.
  const hex = positionBucketHex(value, axis, european);
  return (
    <span className="font-medium tabular-nums" style={{ color: hex }}>
      {axis === "economic" ? "Economic" : "Social"} {value > 0 ? `+${value}` : value}
    </span>
  );
}

/**
 * The overview's national ideology section: twin R1 spectrum bars with live
 * drift sparklines, the E1 economic model field, and the recent movers, all
 * driven by the national-axes route (equal weight, explicit zeros). A plain
 * section under a heading, with nothing boxed inside it.
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
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-heading-lg font-semibold tracking-tight text-foreground">
          National ideology
        </h2>
        <Link
          href={policyUrl(countryId)}
          className="text-body font-medium text-foreground underline decoration-card-border underline-offset-4 transition-colors hover:decoration-foreground"
        >
          View national policy
        </Link>
      </div>
      {axes && axes.lawCount > 0 && (
        <p className="mt-1 text-body-sm text-muted">
          Average of{" "}
          <span className="font-medium text-foreground">
            {axes.lawCount} implemented national {axes.lawCount === 1 ? "law" : "laws"}
          </span>
          , equal weight.
        </p>
      )}

      {loading ? (
        <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.9fr]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="mb-2 h-3 w-24 rounded bg-track" />
              <div className="h-1.5 rounded-full bg-track" />
            </div>
          ))}
        </div>
      ) : !hasAnyAxis ? (
        <div className="mt-6 grid gap-8 lg:grid-cols-[2fr_0.9fr]">
          <p className="self-center text-body text-muted">
            No implemented national laws carry ideology positions yet.
          </p>
          <EconomicModelField countryId={countryId} />
        </div>
      ) : (
        <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.9fr]">
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
        <div className="mt-8">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-body-lg font-semibold text-foreground">
              Recently moved the needle
            </h3>
            <span className="text-body-sm text-muted">
              Last {data!.movers.length} {data!.movers.length === 1 ? "law" : "laws"} with axis
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
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-card-border/60 py-2.5 text-body last:border-b-0 sm:grid-cols-[120px_1fr_auto_auto] sm:gap-x-4"
                >
                  <span className="order-2 text-body-sm tabular-nums text-muted sm:order-none">
                    <EnactedStamp enactedYear={mover.enactedYear} enactedAt={mover.enactedAt} />
                  </span>
                  <span className="order-1 truncate font-medium text-foreground sm:order-none">
                    {mover.title}
                  </span>
                  <span className="order-3 flex gap-3 text-body-sm sm:order-none">
                    {mover.economic !== null && (
                      <AxisFigure axis="economic" value={mover.economic} countryId={countryId} />
                    )}
                    {mover.social !== null && (
                      <AxisFigure axis="social" value={mover.social} countryId={countryId} />
                    )}
                  </span>
                  <span className="order-4 text-body-sm tabular-nums text-muted sm:order-none">
                    {averageShift(before, after)}
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

/**
 * E1 placement: the third peer of the two axes, showing the country's emergent
 * economic model (P7) and its intensity band. Falls back to "Not yet
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
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body-sm text-muted">Economic model</span>
        {view && (
          <span className="text-body-sm tabular-nums text-muted">
            {view.band} · {view.intensity}
          </span>
        )}
      </div>
      {view ? (
        <>
          <p className="mt-0.5 text-body-lg font-semibold text-foreground">{view.currentName}</p>
          {view.effects && (
            <div className="mt-2 space-y-1 text-body-sm text-muted">
              {view.signatureSectors[0] && (
                <div>
                  <span className="font-medium text-foreground">{view.signatureSectors[0]}</span>{" "}
                  <Effect v={view.effects.corpMarginFavoredPct} suffix="% margin" /> ·{" "}
                  <Effect v={view.effects.sectorGdpWeightPct} suffix="% GDP wt" />
                </div>
              )}
              {view.signatureSectors.length > 1 && (
                <div>
                  <span className="text-foreground">
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
        <p className="mt-0.5 text-body-lg text-muted">{loaded ? "Not yet determined" : "…"}</p>
      )}
    </div>
  );
}

/** Signed effect magnitude, colored by direction. Renders "n/a" (no orphan
 *  suffix) when the value is missing or non-finite. */
function Effect({ v, suffix }: { v: number | undefined; suffix: string }) {
  if (!Number.isFinite(v)) return <span className="text-muted">n/a</span>;
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
