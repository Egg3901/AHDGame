"use client";

import { useMemo, useState } from "react";
import { positionBucketHex } from "@/lib/utils/politics";
import { dominantAxis, formatEnactedStamp, type RecordPayload } from "./policyView";

const EUROPEAN_COLOUR_COUNTRIES = new Set(["UK", "DE"]);

const WIDTH = 900;
const HEIGHT = 240;

/** value −5…+5 → chart y (top = +5 right/traditional, bottom = −5 left/liberal). */
function toY(value: number): number {
  return HEIGHT / 2 - (value / 5) * (HEIGHT / 2 - 14);
}

/**
 * The Living Code — Record view (locked as the Code | Record toggle): every
 * enactment plotted on the running national-average lines, with the current
 * administration's era shaded when its start date is known. The average is
 * replayed retroactively from enacted-law history (no snapshot), so the
 * series is labeled "since first recorded law".
 */
export function RecordView({
  countryId,
  record,
}: {
  countryId: string;
  /** undefined = still loading; null = fetch failed; payload = loaded. */
  record: RecordPayload | null | undefined;
}) {
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const events = useMemo(() => record?.events ?? [], [record]);
  const points = record?.points ?? [];
  const era = record?.era ?? null;

  const xFor = (index: number) =>
    events.length <= 1 ? WIDTH / 2 : 30 + (index / (events.length - 1)) * (WIDTH - 60);

  const eraStartIndex = useMemo(() => {
    if (!era?.sinceDate) return null;
    const since = new Date(era.sinceDate).getTime();
    const index = events.findIndex((event) => new Date(event.enactedAt).getTime() >= since);
    return index === -1 ? null : index;
  }, [era, events]);

  const eraLawCount = eraStartIndex === null ? null : events.length - eraStartIndex;

  if (record === undefined) {
    return (
      <div
        className="h-64 animate-pulse rounded-xl border border-card-border bg-card"
        aria-hidden
      />
    );
  }

  // Fetch failure (null payload) is not an empty law book — say so honestly.
  if (record === null) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-10 text-center text-sm italic text-muted">
        The Record is unavailable right now — try again shortly.
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-10 text-center text-sm italic text-muted">
        No recorded enactments yet — the Record view fills in as laws with axis positions are
        enacted.
      </div>
    );
  }

  const economicSeries = points
    .map((point, index) => ({ index, value: point.economicAvg }))
    .filter((entry): entry is { index: number; value: number } => entry.value !== null);
  const socialSeries = points
    .map((point, index) => ({ index, value: point.socialAvg }))
    .filter((entry): entry is { index: number; value: number } => entry.value !== null);
  const lastEconomic = economicSeries[economicSeries.length - 1]?.value ?? 0;
  const lastSocial = socialSeries[socialSeries.length - 1]?.value ?? 0;
  const european = EUROPEAN_COLOUR_COUNTRIES.has(countryId);
  // Bucket ramp hexes — the established chart-colour exception.
  const economicColor = positionBucketHex(lastEconomic, "economic", european);
  const socialColor = positionBucketHex(lastSocial, "social");
  const pinned = pinnedIndex !== null ? events[pinnedIndex] : null;
  const pinnedLean = pinned ? dominantAxis(pinned.economic, pinned.social) : null;

  return (
    <div className="space-y-3.5">
      <div className="overflow-hidden rounded-xl border border-card-border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-card-border bg-card-muted px-4 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            The Record · since first recorded law
          </span>
          <span className="flex gap-4 font-mono text-[10px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3.5" style={{ background: economicColor }} />
              economic average
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3.5" style={{ background: socialColor }} />
              social average
            </span>
          </span>
        </div>
        <div className="overflow-x-auto px-3 pt-3">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="block h-60 w-full min-w-[560px]"
            role="img"
            aria-label="National ideology averages over enactment history"
          >
            {eraStartIndex !== null && (
              <rect
                x={xFor(eraStartIndex) - 8}
                y={0}
                width={WIDTH - (xFor(eraStartIndex) - 8)}
                height={HEIGHT}
                fill="var(--primary)"
                opacity={0.05}
              />
            )}
            <line
              x1="0"
              y1={toY(0)}
              x2={WIDTH}
              y2={toY(0)}
              stroke="var(--card-border)"
              strokeDasharray="4 5"
            />
            {economicSeries.length >= 2 && (
              <polyline
                points={economicSeries
                  .map((entry) => `${xFor(entry.index)},${toY(entry.value)}`)
                  .join(" ")}
                fill="none"
                stroke={economicColor}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {socialSeries.length >= 2 && (
              <polyline
                points={socialSeries
                  .map((entry) => `${xFor(entry.index)},${toY(entry.value)}`)
                  .join(" ")}
                fill="none"
                stroke={socialColor}
                strokeWidth="2"
                opacity="0.85"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {events.map((event, index) => {
              const lean = dominantAxis(event.economic, event.social);
              if (!lean) return null;
              const isPinned = pinnedIndex === index;
              return (
                <circle
                  key={`${event.typeKey}-${event.enactedAt}`}
                  cx={xFor(index)}
                  cy={toY(lean.value)}
                  r={isPinned ? 7 : 5}
                  fill={positionBucketHex(
                    lean.value,
                    lean.axis,
                    lean.axis === "economic" && european
                  )}
                  stroke="var(--card)"
                  strokeWidth="2"
                  className="cursor-pointer"
                  onClick={() => setPinnedIndex(isPinned ? null : index)}
                >
                  <title>{event.title}</title>
                </circle>
              );
            })}
          </svg>
        </div>
        <div className="flex justify-between px-4 pb-2 font-mono text-[9px] text-muted/60">
          <span>{events[0].enactedYear}</span>
          <span>{events[events.length - 1].enactedYear}</span>
        </div>
        {pinned && pinnedLean && (
          <div className="border-t border-card-border/50 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-bold">{pinned.title}</span>
              <span className="font-mono text-[10px] text-muted">
                {formatEnactedStamp(pinned.enactedYear, pinned.enactedAt)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 font-mono text-[11px] text-muted">
              {pinned.economic !== null && (
                <span>
                  econ {pinned.economic > 0 ? "+" : ""}
                  {pinned.economic} · avg {pinned.economicBefore?.toFixed(1) ?? "—"} →{" "}
                  {pinned.economicAfter?.toFixed(1) ?? "—"}
                </span>
              )}
              {pinned.social !== null && (
                <span>
                  social {pinned.social > 0 ? "+" : ""}
                  {pinned.social} · avg {pinned.socialBefore?.toFixed(1) ?? "—"} →{" "}
                  {pinned.socialAfter?.toFixed(1) ?? "—"}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {era && (
        <div className="rounded-xl border border-card-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">
              {era.label}
            </span>
            <span className="font-mono text-[10px] text-muted">
              {eraLawCount !== null
                ? `${eraLawCount} ${eraLawCount === 1 ? "law" : "laws"} this era`
                : era.sinceTurn !== null
                  ? `formed T ${era.sinceTurn}`
                  : ""}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Earlier administrations render unbanded — era history accrues as governments change from
            here on.
          </p>
        </div>
      )}
    </div>
  );
}
