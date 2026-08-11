"use client";

import type { OverviewViewModel } from "@/lib/states/overview/types";

/**
 * Donut chart of all-party Org% in this state, with one slice per party
 * plus an "Unaffiliated" remainder. The focus party's slice is exploded
 * outward by ~6px and stroked in its own color for emphasis. The donut
 * inner hole shows the focus party's abbreviation + Org%.
 *
 * Pure SVG (no Recharts dep) — keeps build size low and matches the
 * design's CSS-only approach.
 *
 * See plan Task 1.5 and design bundle screens/StateOverview.jsx (V4).
 */

const SIZE = 240;
const RADIUS = 96;
const INNER = 56;
const EXPLODE_OFFSET = 6;
const UNAFFILIATED_COLOR = "var(--card-border)";

export function AllPartyOrgPie({ vm }: { vm: OverviewViewModel }) {
  // Build slice list: every party with a non-zero Org row + the Unaffiliated remainder.
  const partySlices = vm.partyOrg
    .filter((p) => p.orgPct > 0)
    .map((p) => ({ id: p.id, value: p.orgPct, color: p.color, label: p.abbr }));
  const slices = [...partySlices];
  if (vm.unaffiliatedPct > 0) {
    slices.push({
      id: "unaffiliated",
      value: vm.unaffiliatedPct,
      color: UNAFFILIATED_COLOR,
      label: "Unaffiliated",
    });
  }

  const total = slices.reduce((s, x) => s + x.value, 0);

  // Empty edge case — show a flat ring.
  if (total <= 0) {
    return (
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full max-w-[240px]"
        aria-hidden="true"
      >
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill={UNAFFILIATED_COLOR} />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={INNER} fill="var(--background)" />
      </svg>
    );
  }

  // Single-slice edge case — SVG arc paths are degenerate at exactly 360°
  // (start and end angles coincide). Render as a full circle instead so the
  // slice fills the donut.
  if (slices.length === 1) {
    const only = slices[0];
    const isFocus = only.id === vm.pieFocusPartyId;
    return (
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full max-w-[240px]"
        role="img"
        aria-label={`All-party organization breakdown for ${vm.stateId}`}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill={only.color}
          stroke={isFocus ? only.color : "transparent"}
          strokeWidth={2}
        >
          {/* React SSR renders <title> empty when children is an array (multi-expression
              JSX) — hydration then mismatches (#418). Keep a single template-string child. */}
          <title>{`${only.label} ${only.value.toFixed(1)}%`}</title>
        </circle>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={INNER} fill="var(--background)" />
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 4}
          textAnchor="middle"
          fontWeight={700}
          fontSize={12}
          fill="var(--muted)"
        >
          {vm.focusPartyAbbr || "—"}
        </text>
        <text
          x={SIZE / 2}
          y={SIZE / 2 + 14}
          textAnchor="middle"
          fontWeight={800}
          fontSize={20}
          fill={vm.focusPartyColor}
        >
          {vm.focusPartyOrgPct.toFixed(1)}%
        </text>
      </svg>
    );
  }

  let theta = -Math.PI / 2;
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-auto w-full max-w-[240px]"
      role="img"
      aria-label={`All-party organization breakdown for ${vm.stateId}`}
    >
      {slices.map((s) => {
        const t1 = theta;
        const arc = (s.value / total) * 2 * Math.PI;
        theta += arc;
        const isFocus = s.id === vm.pieFocusPartyId;
        const explode = isFocus ? EXPLODE_OFFSET : 0;
        const cx = SIZE / 2 + Math.cos(t1 + arc / 2) * explode;
        const cy = SIZE / 2 + Math.sin(t1 + arc / 2) * explode;
        const path = arcPath(cx, cy, RADIUS, t1, t1 + arc);
        const stroke = isFocus ? s.color : "transparent";
        return (
          <path key={s.id} d={path} fill={s.color} stroke={stroke} strokeWidth={2}>
            <title>{`${s.label} ${s.value.toFixed(1)}%`}</title>
          </path>
        );
      })}
      {/* Donut hole + center label. */}
      <circle cx={SIZE / 2} cy={SIZE / 2} r={INNER} fill="var(--background)" />
      <text
        x={SIZE / 2}
        y={SIZE / 2 - 4}
        textAnchor="middle"
        fontWeight={700}
        fontSize={12}
        fill="var(--muted)"
      >
        {vm.focusPartyAbbr || "—"}
      </text>
      <text
        x={SIZE / 2}
        y={SIZE / 2 + 14}
        textAnchor="middle"
        fontWeight={800}
        fontSize={20}
        fill={vm.focusPartyColor}
      >
        {vm.focusPartyOrgPct.toFixed(1)}%
      </text>
    </svg>
  );
}

/**
 * SVG path for a pie wedge from angle `t0` → `t1` around (cx, cy) with
 * radius `r`. The wedge is anchored to the (cx, cy) center, allowing the
 * "explode" effect to translate the entire slice without distorting the
 * arc geometry.
 */
function arcPath(cx: number, cy: number, r: number, t0: number, t1: number): string {
  const x0 = cx + r * Math.cos(t0);
  const y0 = cy + r * Math.sin(t0);
  const x1 = cx + r * Math.cos(t1);
  const y1 = cy + r * Math.sin(t1);
  const large = t1 - t0 > Math.PI ? 1 : 0;
  return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
}
