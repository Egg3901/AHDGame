"use client";

import type { OverviewViewModel } from "@/lib/states/overview/types";

/**
 * Donut chart of the state's Registration pool. Slices: per-party Reg%,
 * Independent, Unregistered. Hover any slice to see its label + %. The
 * donut hole shows the focus party's Reg%.
 *
 * Renders an honest empty state when the pool isn't seeded yet
 * (`registrationPool.seeded === false`).
 *
 * Pure SVG to match `AllPartyOrgPie`.
 */

const SIZE = 240;
const RADIUS = 96;
const INNER = 56;
const EXPLODE_OFFSET = 6;
const INDEPENDENT_COLOR = "#9CA3AF";
const UNREGISTERED_COLOR = "var(--card-border)";

export function AllPartyRegPie({ vm }: { vm: OverviewViewModel }) {
  const { registrationPool } = vm;

  if (!registrationPool.seeded) {
    return (
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full max-w-[240px]"
        role="img"
        aria-label={`Registration pool for ${vm.stateId} (not yet seeded)`}
      >
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill={UNREGISTERED_COLOR} />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={INNER} fill="var(--background)" />
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 4}
          textAnchor="middle"
          fontWeight={700}
          fontSize={11}
          fill="var(--muted)"
        >
          REG%
        </text>
        <text
          x={SIZE / 2}
          y={SIZE / 2 + 14}
          textAnchor="middle"
          fontWeight={600}
          fontSize={11}
          fill="var(--muted)"
        >
          not yet seeded
        </text>
      </svg>
    );
  }

  const slices: Array<{ id: string; value: number; color: string; label: string }> =
    registrationPool.parties
      .filter((p) => p.regPct > 0)
      .map((p) => ({ id: p.id, value: p.regPct, color: p.color, label: p.abbr }));
  if (registrationPool.independent > 0) {
    slices.push({
      id: "independent",
      value: registrationPool.independent,
      color: INDEPENDENT_COLOR,
      label: "Independent",
    });
  }
  if (registrationPool.unregistered > 0) {
    slices.push({
      id: "unregistered",
      value: registrationPool.unregistered,
      color: UNREGISTERED_COLOR,
      label: "Unregistered",
    });
  }

  const total = slices.reduce((s, x) => s + x.value, 0);

  if (total <= 0) {
    return (
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full max-w-[240px]"
        aria-hidden="true"
      >
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill={UNREGISTERED_COLOR} />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={INNER} fill="var(--background)" />
      </svg>
    );
  }

  // Resolve the focus party's Reg% for the donut-hole label. Falls back
  // to the leading party in the registration pool when the viewer has no
  // row in this state.
  const focusReg = registrationPool.parties.find((p) => p.id === vm.pieFocusPartyId);
  const fallbackTop = [...registrationPool.parties].sort((a, b) => b.regPct - a.regPct)[0];
  const centerParty = focusReg ?? fallbackTop ?? null;
  const centerLabel = centerParty?.abbr ?? "—";
  const centerColor = centerParty?.color ?? "var(--muted)";
  const centerPct = centerParty?.regPct.toFixed(1) ?? "—";

  // Single-slice edge case (matches AllPartyOrgPie).
  if (slices.length === 1) {
    const only = slices[0];
    const isFocus = only.id === vm.pieFocusPartyId;
    return (
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-auto w-full max-w-[240px]"
        role="img"
        aria-label={`Registration pool breakdown for ${vm.stateId}`}
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
          {centerLabel}
        </text>
        <text
          x={SIZE / 2}
          y={SIZE / 2 + 14}
          textAnchor="middle"
          fontWeight={800}
          fontSize={20}
          fill={centerColor}
        >
          {centerPct}%
        </text>
      </svg>
    );
  }

  // Precompute slice angles outside the JSX so the render path doesn't
  // mutate state. Each slice gets its own `[t0, t1]` window cumulatively
  // built from the running offset.
  const sliceAngles: Array<{
    id: string;
    value: number;
    color: string;
    label: string;
    t0: number;
    t1: number;
  }> = [];
  {
    let offset = -Math.PI / 2;
    for (const s of slices) {
      const arc = (s.value / total) * 2 * Math.PI;
      sliceAngles.push({ ...s, t0: offset, t1: offset + arc });
      offset += arc;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-auto w-full max-w-[240px]"
      role="img"
      aria-label={`Registration pool breakdown for ${vm.stateId}`}
    >
      {sliceAngles.map((s) => {
        const arc = s.t1 - s.t0;
        const isFocus = s.id === vm.pieFocusPartyId;
        const explode = isFocus ? EXPLODE_OFFSET : 0;
        const cx = SIZE / 2 + Math.cos(s.t0 + arc / 2) * explode;
        const cy = SIZE / 2 + Math.sin(s.t0 + arc / 2) * explode;
        const path = arcPath(cx, cy, RADIUS, s.t0, s.t1);
        const stroke = isFocus ? s.color : "transparent";
        return (
          <path key={s.id} d={path} fill={s.color} stroke={stroke} strokeWidth={2}>
            <title>{`${s.label} ${s.value.toFixed(1)}%`}</title>
          </path>
        );
      })}
      <circle cx={SIZE / 2} cy={SIZE / 2} r={INNER} fill="var(--background)" />
      <text
        x={SIZE / 2}
        y={SIZE / 2 - 4}
        textAnchor="middle"
        fontWeight={700}
        fontSize={12}
        fill="var(--muted)"
      >
        {centerLabel}
      </text>
      <text
        x={SIZE / 2}
        y={SIZE / 2 + 14}
        textAnchor="middle"
        fontWeight={800}
        fontSize={20}
        fill={centerColor}
      >
        {centerPct}%
      </text>
    </svg>
  );
}

function arcPath(cx: number, cy: number, r: number, t0: number, t1: number): string {
  const x0 = cx + r * Math.cos(t0);
  const y0 = cy + r * Math.sin(t0);
  const x1 = cx + r * Math.cos(t1);
  const y1 = cy + r * Math.sin(t1);
  const large = t1 - t0 > Math.PI ? 1 : 0;
  return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
}
