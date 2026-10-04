"use client";

import { useState } from "react";
import Link from "next/link";
import { PartyLogo } from "@/components/PartyLogo";
import type { CountryId } from "@/lib/constants/countries";
import { regionPartyUrl } from "@/lib/urls";

/**
 * One slice of an Overview pool (Organization or Registration).
 *
 * Party slices carry `partyId` (the party's sequentialId string): the legend
 * row then shows the party logo and links to the party's page in this region.
 * Non-party buckets (Unaffiliated, Independent, Unregistered) have no logo and
 * no link.
 */
export interface PoolSlice {
  key: string;
  /** Full party name, or the bucket label. */
  label: string;
  /** Party abbreviation; shown in the donut centre and the slice tooltip. */
  abbr?: string;
  partyId?: string;
  color: string;
  /** Percentage share, 0..100. */
  value: number;
}

const SIZE = 160;
const OUTER = 76;
const INNER = 50;
const FULL_TURN = Math.PI * 2;

/**
 * Annular sector from angle `t0` to `t1`. A slice that covers the whole ring
 * is drawn as two half-turn arcs, because a single SVG arc whose start and end
 * points coincide renders nothing.
 */
function ringPath(t0: number, t1: number): string {
  const c = SIZE / 2;
  if (t1 - t0 >= FULL_TURN - 1e-6) {
    return `${ringPath(t0, t0 + Math.PI)} ${ringPath(t0 + Math.PI, t0 + FULL_TURN)}`;
  }
  const large = t1 - t0 > Math.PI ? 1 : 0;
  const p = (r: number, t: number) => `${c + r * Math.cos(t)},${c + r * Math.sin(t)}`;
  return [
    `M${p(OUTER, t0)}`,
    `A${OUTER},${OUTER} 0 ${large} 1 ${p(OUTER, t1)}`,
    `L${p(INNER, t1)}`,
    `A${INNER},${INNER} 0 ${large} 0 ${p(INNER, t0)}`,
    "Z",
  ].join(" ");
}

function sliceName(s: PoolSlice): string {
  return s.abbr ?? s.label;
}

/**
 * Donut plus legend for one pool, sharing a hover state: pointing at a legend
 * row or a slice brings that slice forward, dims the rest and puts its share in
 * the centre. With nothing hovered the centre shows `focusKey` (the viewer's
 * party, or the leader).
 */
export function PoolBreakdown({
  title,
  slices,
  focusKey,
  countryId,
  stateId,
  emptyMessage,
  children,
}: {
  title: string;
  slices: PoolSlice[];
  focusKey: string | null;
  countryId: CountryId;
  stateId: string;
  /** Shown instead of the chart when every slice is zero. */
  emptyMessage: string;
  /** Rendered under the legend (the Build Org control on the Organization pool). */
  children?: React.ReactNode;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const visible = slices.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  const centre =
    visible.find((s) => s.key === activeKey) ??
    visible.find((s) => s.key === focusKey) ??
    [...visible].sort((a, b) => b.value - a.value)[0] ??
    null;

  const arcs: Array<{ slice: PoolSlice; t0: number; t1: number }> = [];
  for (const s of visible) {
    const t0 = arcs.length > 0 ? arcs[arcs.length - 1].t1 : -Math.PI / 2;
    arcs.push({ slice: s, t0, t1: t0 + (s.value / total) * FULL_TURN });
  }

  return (
    <section aria-label={title} className="min-w-0">
      <h3 className="text-body-lg font-semibold text-foreground">{title}</h3>
      {total <= 0 ? (
        <div>
          <p className="mt-3 text-body text-muted">{emptyMessage}</p>
          {children}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="h-32 w-32 shrink-0 self-center sm:self-start"
            role="img"
            aria-label={`${title}: ${visible.map((s) => `${sliceName(s)} ${s.value.toFixed(1)}%`).join(", ")}`}
            onMouseLeave={() => setActiveKey(null)}
          >
            {arcs.map(({ slice, t0, t1 }) => (
              <path
                key={slice.key}
                d={ringPath(t0, t1)}
                fill={slice.color}
                fillRule="evenodd"
                stroke="var(--background)"
                strokeWidth={1.5}
                opacity={activeKey && activeKey !== slice.key ? 0.3 : 1}
                className="cursor-default transition-opacity duration-150"
                onMouseEnter={() => setActiveKey(slice.key)}
              >
                {/* One template-string child: an array child renders an empty
                    <title> on the server and breaks hydration (#418). */}
                <title>{`${sliceName(slice)} ${slice.value.toFixed(1)}%`}</title>
              </path>
            ))}
            {centre && (
              <>
                <text
                  x={SIZE / 2}
                  y={SIZE / 2 - 6}
                  textAnchor="middle"
                  fontSize={12}
                  fontWeight={500}
                  fill="var(--muted)"
                >
                  {sliceName(centre)}
                </text>
                <text
                  x={SIZE / 2}
                  y={SIZE / 2 + 16}
                  textAnchor="middle"
                  fontSize={22}
                  fontWeight={600}
                  fill="var(--foreground)"
                  className="tabular-nums"
                >
                  {`${centre.value.toFixed(1)}%`}
                </text>
              </>
            )}
          </svg>

          <div className="min-w-0 flex-1">
            <ul className="divide-y divide-card-border">
              {visible.map((s) => {
                const dimmed = activeKey !== null && activeKey !== s.key;
                const label = (
                  <>
                    {s.partyId ? (
                      <PartyLogo
                        partyId={s.partyId}
                        partyColor={s.color}
                        countryId={countryId}
                        size="h-5 w-5"
                        className="shrink-0"
                      />
                    ) : (
                      <span
                        className="mx-[5px] h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: s.color }}
                        aria-hidden
                      />
                    )}
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={s.abbr ? `${s.label} (${s.abbr})` : s.label}
                    >
                      {s.label}
                    </span>
                  </>
                );
                return (
                  <li
                    key={s.key}
                    onMouseEnter={() => setActiveKey(s.key)}
                    onMouseLeave={() => setActiveKey(null)}
                    onFocus={() => setActiveKey(s.key)}
                    onBlur={() => setActiveKey(null)}
                    className={`flex items-center gap-2 py-2 text-body transition-opacity duration-150 ${
                      dimmed ? "opacity-50" : ""
                    }`}
                  >
                    {s.partyId ? (
                      <Link
                        href={regionPartyUrl(countryId, stateId, s.partyId)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-foreground hover:underline underline-offset-4"
                      >
                        {label}
                      </Link>
                    ) : (
                      <span className="flex min-w-0 flex-1 items-center gap-2 text-muted">
                        {label}
                      </span>
                    )}
                    <span className="w-14 shrink-0 text-right font-medium tabular-nums text-foreground">
                      {s.value.toFixed(1)}%
                    </span>
                  </li>
                );
              })}
            </ul>
            {children}
          </div>
        </div>
      )}
    </section>
  );
}
