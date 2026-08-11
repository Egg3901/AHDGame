"use client";

import { useState } from "react";
import { formatFundsCompact } from "@/lib/utils/formatters";

/**
 * Fiscal-flow sankey (ported from the design prototype `bcomponents.jsx`):
 * revenue lines converge into a Treasury trunk and diverge into spending lines.
 * A red "Net borrowing" inflow appears when in deficit; a green "Surplus"
 * outflow when in surplus. The trunk uses the country accent; ribbon colors are
 * the allowed data-viz exception (raw hex), isolated to this file.
 */

export interface FlowItem {
  label: string;
  value: number;
}

// Data-viz ramps — high neighbor contrast (chart exception to design tokens).
const REV_COLORS = [
  "#3b82f6",
  "#f59e0b",
  "#14b8a6",
  "#22d3ee",
  "#a855f7",
  "#fb923c",
  "#38bdf8",
  "#f472b6",
  "#a3e635",
  "#d8b25e",
  "#94a3b8",
];
const SPEND_COLORS = [
  "#3b82f6",
  "#eab308",
  "#14b8a6",
  "#f97316",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#94a3b8",
];

/**
 * Compact a line label for the narrow sankey label columns: drop the
 * original-language "(…)" parenthetical and cap length so long names (e.g.
 * "Individual Income Tax (个人所得税)") don't run off the SVG edge. The breakdown
 * panel still shows the full label.
 */
function shortLabel(s: string): string {
  const stripped = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return stripped.length > 26 ? `${stripped.slice(0, 25)}…` : stripped;
}

interface PreppedNode extends FlowItem {
  /** Stable unique id (index-derived) — labels can repeat across data, keys can't. */
  nid: string;
  color: string;
  borrow?: boolean;
  surplus?: boolean;
  y: number;
  h: number;
  mid: number;
}

interface FiscalFlowProps {
  revenue: FlowItem[];
  spending: FlowItem[];
  revenueTotal: number;
  spendingTotal: number;
  sym: string;
  fiscalYear: number;
  /** Country accent (Treasury trunk + brand line). */
  accent: string;
}

export function FiscalFlow({
  revenue,
  spending,
  revenueTotal,
  spendingTotal,
  sym,
  fiscalYear,
  accent,
}: FiscalFlowProps) {
  const [hover, setHover] = useState<{ nid: string; label: string; value: number } | null>(null);
  const money = (n: number) => formatFundsCompact(n, sym);

  const W = 760;
  const H = 360;
  const PAD = 8;
  const colL = 150;
  const colR = W - 150;
  const trunkX1 = W / 2 - 26;
  const trunkX2 = W / 2 + 26;

  // Aggregate revenue: top 5 lines + "Other revenue". Labels are kept full (no
  // " — " trim) so e.g. Corporate Tax — Domestic/Foreign stay distinct lines.
  const revGroups = revenue
    .map((l, i) => ({
      label: shortLabel(l.label),
      value: l.value,
      color: REV_COLORS[i % REV_COLORS.length],
    }))
    .sort((a, b) => b.value - a.value);
  const revTop = revGroups.slice(0, 5);
  const revOther = revGroups.slice(5).reduce((s, g) => s + g.value, 0);
  if (revOther > 0) revTop.push({ label: "Other revenue", value: revOther, color: "#94a3b8" });

  // Aggregate spending: top 6 lines + "Other outlays" (named so it can't collide
  // with a real category literally labelled "Other", e.g. US spending).
  const spGroups = spending
    .map((l, i) => ({
      label: shortLabel(l.label),
      value: l.value,
      color: SPEND_COLORS[i % SPEND_COLORS.length],
    }))
    .sort((a, b) => b.value - a.value);
  const spTop = spGroups.slice(0, 6);
  const spOther = spGroups.slice(6).reduce((s, g) => s + g.value, 0);
  if (spOther > 0) spTop.push({ label: "Other outlays", value: spOther, color: "#94a3b8" });

  const deficit = spendingTotal - revenueTotal;

  const leftItems: Array<FlowItem & { color: string; borrow?: boolean }> = [...revTop];
  if (deficit > 0)
    leftItems.push({ label: "Net borrowing", value: deficit, color: "#ef4444", borrow: true });
  const leftTotal = leftItems.reduce((s, g) => s + g.value, 0);

  const rightItems: Array<FlowItem & { color: string; surplus?: boolean }> = [...spTop];
  if (deficit < 0)
    rightItems.push({ label: "Surplus", value: -deficit, color: "#22c55e", surplus: true });
  const rightTotal = rightItems.reduce((s, g) => s + g.value, 0);

  const trunkTotal = Math.max(leftTotal, rightTotal, 1);
  const usableH = H - PAD * 2;
  const scale = usableH / trunkTotal;
  const gap = 6;

  let ly = PAD;
  const leftNodes: PreppedNode[] = leftItems.map((g, i) => {
    const h = Math.max(2, g.value * scale - gap);
    const node = { ...g, nid: `l${i}`, y: ly, h, mid: ly + h / 2 };
    ly += h + gap;
    return node;
  });
  let ry = PAD;
  const rightNodes: PreppedNode[] = rightItems.map((g, i) => {
    const h = Math.max(2, g.value * scale - gap);
    const node = { ...g, nid: `r${i}`, y: ry, h, mid: ry + h / 2 };
    ry += h + gap;
    return node;
  });

  const trunkH = trunkTotal * scale;
  const trunkY = PAD;
  let trunkLeftOff = trunkY;
  let trunkRightOff = trunkY;

  const ribbon = (x1: number, y1a: number, y1b: number, x2: number, y2a: number, y2b: number) => {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1a} C ${mx} ${y1a}, ${mx} ${y2a}, ${x2} ${y2a} L ${x2} ${y2b} C ${mx} ${y2b}, ${mx} ${y1b}, ${x1} ${y1b} Z`;
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">
          Fiscal flow · where the money comes from &amp; goes
        </div>
        <div className="text-body-xs text-muted">
          {hover ? (
            <span className="text-gold">
              {hover.label}: {money(hover.value)}
            </span>
          ) : (
            `FY${fiscalYear}`
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minHeight: 240 }}>
        {/* ribbons left → trunk */}
        {leftNodes.map((n) => {
          const ta = trunkLeftOff;
          const tb = trunkLeftOff + n.h;
          trunkLeftOff = tb;
          const active = hover?.nid === n.nid;
          return (
            <path
              key={`lr-${n.nid}`}
              d={ribbon(colL, n.y, n.y + n.h, trunkX1, ta, tb)}
              fill={n.color}
              opacity={active ? 0.55 : 0.22}
            />
          );
        })}
        {/* ribbons trunk → right */}
        {rightNodes.map((n) => {
          const ta = trunkRightOff;
          const tb = trunkRightOff + n.h;
          trunkRightOff = tb;
          const active = hover?.nid === n.nid;
          return (
            <path
              key={`rr-${n.nid}`}
              d={ribbon(trunkX2, ta, tb, colR, n.y, n.y + n.h)}
              fill={n.color}
              opacity={active ? 0.55 : 0.22}
            />
          );
        })}

        {/* trunk */}
        <rect
          x={trunkX1}
          y={trunkY}
          width={trunkX2 - trunkX1}
          height={trunkH}
          rx="4"
          fill={accent}
          opacity="0.9"
        />
        <text
          x={W / 2}
          y={trunkY + trunkH / 2 - 4}
          textAnchor="middle"
          fontSize="10"
          fontWeight="700"
          fill="#1a120a"
        >
          TREASURY
        </text>
        <text x={W / 2} y={trunkY + trunkH / 2 + 9} textAnchor="middle" fontSize="9" fill="#1a120a">
          {money(trunkTotal)}
        </text>
        <text
          x={W / 2}
          y={trunkY + trunkH / 2 + 20}
          textAnchor="middle"
          fontSize="7"
          fill="#1a120a"
          fillOpacity={0.7}
        >
          annual flow
        </text>

        {/* left nodes + labels */}
        {leftNodes.map((n) => (
          <g
            key={`ln-${n.nid}`}
            onMouseEnter={() => setHover({ nid: n.nid, label: n.label, value: n.value })}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "default" }}
          >
            <rect x={colL} y={n.y} width="7" height={n.h} rx="2" fill={n.color} />
            <text
              x={colL - 8}
              y={n.mid + 3}
              textAnchor="end"
              fontSize="9.5"
              fontWeight={n.borrow ? 700 : 500}
              fill="currentColor"
              className={n.borrow ? "text-error" : "text-foreground"}
              fillOpacity={n.borrow ? 1 : 0.8}
            >
              {n.label}
            </text>
          </g>
        ))}
        {/* right nodes + labels */}
        {rightNodes.map((n) => (
          <g
            key={`rn-${n.nid}`}
            onMouseEnter={() => setHover({ nid: n.nid, label: n.label, value: n.value })}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "default" }}
          >
            <rect x={colR - 7} y={n.y} width="7" height={n.h} rx="2" fill={n.color} />
            <text
              x={colR + 8}
              y={n.mid + 3}
              textAnchor="start"
              fontSize="9.5"
              fontWeight={n.surplus ? 700 : 500}
              fill="currentColor"
              className={n.surplus ? "text-success" : "text-foreground"}
              fillOpacity={n.surplus ? 1 : 0.8}
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between text-body-xs text-muted">
        <span>
          <span
            className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
            style={{ background: "#ef4444" }}
          />
          inflow side includes net borrowing when in deficit
        </span>
        <span>
          {deficit > 0 ? (
            <span className="font-semibold text-error">Deficit {money(deficit)}</span>
          ) : (
            <span className="font-semibold text-success">Surplus {money(-deficit)}</span>
          )}
        </span>
      </div>
    </div>
  );
}
