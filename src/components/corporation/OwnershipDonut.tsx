"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { brandShades, resolveCorpColor } from "@/lib/corporations/brandColor";
import type { CorporationDetail } from "./CorporationPageTypes";

/** Named wedges before the tail collapses into one. More is unreadable on a phone. */
const MAX_NAMED = 6;
const FLOAT_COLOR = "hsl(220, 9%, 62%)";
const SIZE = 168;
const STROKE = 26;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Shareholder = CorporationDetail["shareholders"][number];

export interface DonutSlice {
  key: string;
  label: string;
  shares: number;
  pct: number;
  color: string;
  href: string | null;
  isYou: boolean;
}

/**
 * Ranked holders to donut slices: the top few named, the tail totalled into
 * one wedge, and shares still sitting on the market as a neutral grey wedge.
 */
export function buildOwnershipSlices(
  corporation: CorporationDetail,
  holderHref: (sh: Shareholder) => string | null,
  myCharacterId: string | null
): DonutSlice[] {
  const total = corporation.totalShares;
  if (!(total > 0)) return [];
  const ranked = (corporation.shareholders ?? [])
    .filter((sh) => sh.shares > 0)
    .sort((a, b) => b.shares - a.shares);
  const head = ranked.slice(0, MAX_NAMED);
  const tail = ranked.slice(MAX_NAMED);
  const shades = brandShades(
    resolveCorpColor(corporation.brandColor, corporation._id),
    head.length + (tail.length > 0 ? 1 : 0)
  );

  const slices: DonutSlice[] = head.map((sh, i) => ({
    key: `${sh.characterId ?? sh.corporationId ?? sh.name}`,
    label: sh.name,
    shares: sh.shares,
    pct: (sh.shares / total) * 100,
    color: shades[i],
    href: holderHref(sh),
    isYou: myCharacterId != null && sh.characterId === myCharacterId,
  }));

  if (tail.length > 0) {
    const tailShares = tail.reduce((sum, sh) => sum + sh.shares, 0);
    slices.push({
      key: "tail",
      label: `${tail.length} smaller holder${tail.length === 1 ? "" : "s"}`,
      shares: tailShares,
      pct: (tailShares / total) * 100,
      color: shades[head.length],
      href: null,
      isYou: false,
    });
  }

  const held = ranked.reduce((sum, sh) => sum + sh.shares, 0);
  const onMarket = Math.max(0, total - held);
  if (onMarket / total >= 0.001) {
    slices.push({
      key: "market",
      label: "On the market",
      shares: onMarket,
      pct: (onMarket / total) * 100,
      color: FLOAT_COLOR,
      href: null,
      isYou: false,
    });
  }
  return slices;
}

/**
 * Who owns the company, as a donut you can tap. Selecting a wedge or its
 * legend row highlights both and puts that holder's stake in the centre.
 */
export function OwnershipDonut({ slices }: { slices: DonutSlice[] }) {
  const [active, setActive] = useState<string | null>(null);
  const selected = slices.find((s) => s.key === active) ?? null;

  const arcs = useMemo(
    () =>
      slices.map((slice, i) => {
        const offset = slices
          .slice(0, i)
          .reduce((sum, s) => sum + (s.pct / 100) * CIRCUMFERENCE, 0);
        return { slice, length: (slice.pct / 100) * CIRCUMFERENCE, offset };
      }),
    [slices]
  );

  if (slices.length === 0) return null;
  const toggle = (key: string) => setActive((cur) => (cur === key ? null : key));

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start lg:flex-col lg:items-center">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="-rotate-90"
          role="img"
          aria-label="Ownership breakdown"
        >
          {arcs.map(({ slice, length, offset }) => {
            const dim = selected != null && selected.key !== slice.key;
            return (
              <circle
                key={slice.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={slice.color}
                strokeWidth={selected?.key === slice.key ? STROKE + 6 : STROKE}
                // A hairline gap between wedges keeps neighbouring shades apart.
                strokeDasharray={`${Math.max(0, length - 1.5)} ${CIRCUMFERENCE}`}
                strokeDashoffset={-offset}
                opacity={dim ? 0.35 : 1}
                className="cursor-pointer transition-[opacity,stroke-width] duration-150"
                onMouseEnter={() => setActive(slice.key)}
                onMouseLeave={() => setActive(null)}
                onClick={() => toggle(slice.key)}
              >
                <title>{`${slice.label}: ${slice.pct.toFixed(1)}%`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-7 text-center">
          {selected ? (
            <>
              <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
                {selected.pct.toFixed(1)}%
              </span>
              <span className="line-clamp-2 text-[11px] leading-tight text-muted">
                {selected.label}
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
                {slices[0].pct.toFixed(0)}%
              </span>
              <span className="text-[11px] leading-tight text-muted">largest holder</span>
            </>
          )}
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-0.5">
        {slices.map((s) => {
          const isActive = selected?.key === s.key;
          return (
            <li
              key={s.key}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              onClick={() => toggle(s.key)}
              className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm transition-colors ${
                isActive ? "bg-card-border/40" : ""
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">
                {s.href ? (
                  <Link
                    href={s.href}
                    className="text-foreground hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {s.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{s.label}</span>
                )}
                {s.isYou && <span className="ml-1 text-[11px] text-muted">you</span>}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted">{s.pct.toFixed(1)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
