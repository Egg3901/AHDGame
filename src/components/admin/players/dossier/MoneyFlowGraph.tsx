"use client";

// MoneyFlowGraph — the dossier's cash-flow node-link diagram, hand-rolled in
// SVG exactly like `../alts/RingGraph` (no chart library — the admin CSP
// forbids remote scripts). Consumes GET /api/admin/players/money-graph.
//
// Reading: THIS account's character(s) sit at the hub; direct counterparties
// ring the inner orbit, second-hop accounts the outer orbit. Edges are
// directed (arrowhead = direction money moved), thickness ∝ total amount,
// and opposite directions between the same pair curve apart so an A→B→A
// round-trip reads as two distinct arcs. Red is reserved for danger: banned
// accounts (and edges touching them) are the only red ink. Hovering an edge
// or node shows the exact amount / tx count; clicking an edge pins it to the
// caption row underneath.

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAmount } from "@/components/admin/forensics/types";
import {
  accountLabel,
  capGraphForDisplay,
  computeHops,
  formatCompactAmount,
  isSyntheticNodeId,
  moneyEdgeKey,
  nodeFlowTotals,
  type MoneyGraphEdge,
  type MoneyGraphNode,
  type MoneyGraphResponse,
} from "./dossierTypes";

interface MoneyFlowGraphProps {
  userId: string;
  /** Character ids belonging to this account (from the dossier's financial
   * rows) — pins the hub. Without a hint the highest-flow node anchors. */
  centerIds?: string[];
}

const WIDTH = 560;
const HEIGHT = 400;
const INNER_ORBIT = 108;
const OUTER_ORBIT = 172;
const CENTER_R = 14;
const NODE_R = 10;
const SYNTH_HALF = 8; // half-size of the synthetic (gov/system) square
const MAX_RENDER_NODES = 36;
const MAX_LABELS = 8;

const EDGE_HEX = "#38bdf8"; // sky-400 — neutral flow ink
const DANGER_HEX = "#f87171"; // red-400 — banned endpoints only
const CENTER_HEX = "#a78bfa"; // violet — the hub, matches RingGraph's operator
const ACCOUNT_HEX = "#94a3b8"; // slate — ordinary counterparties
const SYNTH_HEX = "#64748b"; // slate-600 — government / system leaves

interface PlacedNode {
  node: MoneyGraphNode;
  x: number;
  y: number;
  isCenter: boolean;
  synthetic: boolean;
}

export function MoneyFlowGraph({ userId, centerIds }: MoneyFlowGraphProps) {
  const [depth, setDepth] = useState<1 | 2>(1);
  const [data, setData] = useState<MoneyGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/players/money-graph?userId=${userId}&depth=${depth}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }
        const body: MoneyGraphResponse = await res.json();
        if (!cancelled) {
          setData(body);
          setSelectedEdge(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load money graph");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, depth, reloadNonce]);

  // ─── Layout ──────────────────────────────────────────────────────────────
  const layout = useMemo(() => {
    if (!data) return null;

    // Hub = provided character ids present in the graph; fall back to the
    // single highest-flow account node so the diagram always has an anchor.
    const present = new Set(data.nodes.map((n) => n.id));
    let centers = new Set((centerIds ?? []).filter((id) => present.has(id)));
    if (centers.size === 0 && data.nodes.length > 0) {
      const flow = nodeFlowTotals(data.edges);
      const best = [...data.nodes]
        .filter((n) => !isSyntheticNodeId(n.id))
        .sort((a, b) => (flow.get(b.id) ?? 0) - (flow.get(a.id) ?? 0))[0];
      centers = new Set(best ? [best.id] : []);
    }

    const capped = capGraphForDisplay(data.nodes, data.edges, centers, MAX_RENDER_NODES);
    const nodes = data.nodes.filter((n) => capped.keep.has(n.id));
    const hops = computeHops(capped.edges, centers);
    const flow = nodeFlowTotals(capped.edges);

    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    const placed = new Map<string, PlacedNode>();

    // Hub: one center dead-middle; several (multi-character accounts) on a
    // tight inner wheel so they still read as "one account".
    const centerNodes = nodes.filter((n) => centers.has(n.id));
    centerNodes.forEach((node, i) => {
      const angle = (i / Math.max(1, centerNodes.length)) * 2 * Math.PI - Math.PI / 2;
      const r = centerNodes.length > 1 ? 26 : 0;
      placed.set(node.id, {
        node,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        isCenter: true,
        synthetic: false,
      });
    });

    // Orbits: hop-1 inner, everything further (or unreachable) outer. Each
    // orbit is sorted by flow so the heaviest counterparties cluster at the
    // top and the eye lands on them first.
    const ring = (ids: MoneyGraphNode[], radius: number) => {
      const sorted = [...ids].sort((a, b) => (flow.get(b.id) ?? 0) - (flow.get(a.id) ?? 0));
      sorted.forEach((node, i) => {
        const angle = (i / Math.max(1, sorted.length)) * 2 * Math.PI - Math.PI / 2;
        placed.set(node.id, {
          node,
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
          isCenter: false,
          synthetic: isSyntheticNodeId(node.id),
        });
      });
    };
    const rest = nodes.filter((n) => !centers.has(n.id));
    const hopOne = rest.filter((n) => (hops.get(n.id) ?? Infinity) <= 1);
    const beyond = rest.filter((n) => (hops.get(n.id) ?? Infinity) > 1);
    // With no second hop, let the direct counterparties use the roomier orbit.
    ring(hopOne, beyond.length > 0 ? INNER_ORBIT : (INNER_ORBIT + OUTER_ORBIT) / 2);
    ring(beyond, OUTER_ORBIT);

    const maxAmount = capped.edges.reduce((m, e) => Math.max(m, e.totalAmount), 0) || 1;
    const labeled = new Set(
      [...nodes]
        .sort((a, b) => (flow.get(b.id) ?? 0) - (flow.get(a.id) ?? 0))
        .slice(0, MAX_LABELS)
        .map((n) => n.id)
    );
    for (const id of centers) labeled.add(id);

    return { placed, edges: capped.edges, hiddenCount: capped.hiddenCount, maxAmount, labeled };
  }, [data, centerIds]);

  const selected = useMemo(() => {
    if (!layout || !selectedEdge) return null;
    return layout.edges.find((e) => moneyEdgeKey(e) === selectedEdge) ?? null;
  }, [layout, selectedEdge]);

  const selectEdge = useCallback((key: string) => {
    setSelectedEdge((prev) => (prev === key ? null : key));
  }, []);

  // ─── States ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Controls: depth + truncation badges */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex overflow-hidden rounded-lg border border-card-border"
          role="group"
          aria-label="Graph depth"
        >
          {([1, 2] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDepth(d)}
              aria-pressed={depth === d}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none ${
                depth === d
                  ? "bg-card-elevated text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {d} hop{d > 1 ? "s" : ""}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-[11px] tabular-nums text-muted">
            {data.nodes.length} accounts · {data.edges.length} flows · turns ≥ {data.turnMin}
          </span>
        )}
        {data?.truncated && (
          <span
            className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400"
            title="The server hit its node/edge/row cap — some flows are not shown."
          >
            Truncated
          </span>
        )}
        {layout && layout.hiddenCount > 0 && (
          <span className="text-[11px] text-muted">
            +{layout.hiddenCount} low-flow account{layout.hiddenCount === 1 ? "" : "s"} hidden
          </span>
        )}
      </div>

      {loading ? (
        <div
          className="h-72 animate-pulse rounded-lg border border-card-border/70 bg-card-muted/60 motion-reduce:animate-none"
          aria-hidden
        />
      ) : error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-8 text-center text-sm text-red-400">
          {error}
          <div>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="mt-3 inline-flex h-8 items-center rounded-lg border border-card-border px-3 text-xs text-foreground transition-colors hover:bg-card-elevated motion-reduce:transition-none"
            >
              Retry
            </button>
          </div>
        </div>
      ) : !layout || layout.edges.length === 0 ? (
        <div className="rounded-lg border border-card-border/70 bg-card-muted/40 px-4 py-10 text-center text-sm text-muted">
          No money flow recorded in the retention window.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-card-border/70 bg-card-muted/60">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="mx-auto block h-auto w-full max-w-[640px]"
              role="img"
              aria-label={`Money-flow graph: ${layout.placed.size} accounts, ${layout.edges.length} aggregated flows`}
            >
              <defs>
                <radialGradient id="money-graph-vignette" cx="50%" cy="46%" r="62%">
                  <stop offset="0%" stopColor="var(--card-elevated)" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="var(--card-elevated)" stopOpacity="0" />
                </radialGradient>
                <marker
                  id="money-arrow-flow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0.6 L7.4,4 L0,7.4 Z" fill={EDGE_HEX} />
                </marker>
                <marker
                  id="money-arrow-danger"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0.6 L7.4,4 L0,7.4 Z" fill={DANGER_HEX} />
                </marker>
              </defs>

              <rect width={WIDTH} height={HEIGHT} fill="url(#money-graph-vignette)" />
              {/* The two orbits, whispered in — the same dashed idiom as RingGraph. */}
              {[INNER_ORBIT, OUTER_ORBIT].map((r) => (
                <circle
                  key={r}
                  cx={WIDTH / 2}
                  cy={HEIGHT / 2}
                  r={r}
                  fill="none"
                  stroke="var(--card-border)"
                  strokeWidth={1}
                  strokeDasharray="2 6"
                  strokeLinecap="round"
                  opacity={0.55}
                />
              ))}

              {/* Edges under nodes. */}
              {layout.edges.map((edge) => (
                <EdgeArc
                  key={moneyEdgeKey(edge)}
                  edge={edge}
                  layout={layout}
                  selectedEdge={selectedEdge}
                  onSelect={selectEdge}
                />
              ))}

              {/* Nodes. */}
              {[...layout.placed.values()].map((p) => (
                <NodeGlyph
                  key={p.node.id}
                  placed={p}
                  labeled={layout.labeled.has(p.node.id)}
                  selectedEdge={selectedEdge}
                  edges={layout.edges}
                  onSelect={selectEdge}
                />
              ))}
            </svg>
          </div>

          {/* Pinned edge caption — exact figures for the selected flow. */}
          {selected && (
            <SelectedEdgeCaption
              edge={selected}
              placed={layout.placed}
              onClear={() => setSelectedEdge(null)}
            />
          )}

          {/* Legend — identity is never color-alone. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
            <LegendDot color={CENTER_HEX} label="This account" />
            <LegendDot color={ACCOUNT_HEX} label="Counterparty" />
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full border border-dashed"
                style={{ borderColor: "var(--error)" }}
              />
              Banned
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-[3px]"
                style={{ backgroundColor: SYNTH_HEX }}
              />
              Gov / system
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="font-semibold" style={{ color: EDGE_HEX }}>
                →
              </span>
              Arrow = direction · width = total amount
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Edge ───────────────────────────────────────────────────────────────────

interface EdgeArcProps {
  edge: MoneyGraphEdge;
  layout: {
    placed: Map<string, PlacedNode>;
    maxAmount: number;
  };
  selectedEdge: string | null;
  onSelect: (key: string) => void;
}

function EdgeArc({ edge, layout, selectedEdge, onSelect }: EdgeArcProps) {
  const a = layout.placed.get(edge.from);
  const b = layout.placed.get(edge.to);
  if (!a || !b) return null;

  const key = moneyEdgeKey(edge);
  const isSelected = selectedEdge === key;
  const dimmed = Boolean(selectedEdge) && !isSelected;

  // sqrt scaling keeps mid-sized flows visible next to one whale transfer.
  const width = 1.25 + Math.sqrt(edge.totalAmount / layout.maxAmount) * 4.75;
  const danger = a.node.banned || b.node.banned;
  const color = danger ? DANGER_HEX : EDGE_HEX;

  // Trim the line back so the arrowhead lands on the node's rim, not center.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const rA = a.isCenter ? CENTER_R : a.synthetic ? SYNTH_HALF : NODE_R;
  const rB = (b.isCenter ? CENTER_R : b.synthetic ? SYNTH_HALF : NODE_R) + 4;
  const sx = a.x + (dx / dist) * rA;
  const sy = a.y + (dy / dist) * rA;
  const ex = b.x - (dx / dist) * rB;
  const ey = b.y - (dy / dist) * rB;

  // Perpendicular bow, signed by direction, so A→B and B→A curve apart and a
  // round-trip reads as two distinct arcs instead of one overdrawn line.
  const bow = Math.min(26, 10 + dist * 0.06) * (edge.from < edge.to ? 1 : -1);
  const mx = (sx + ex) / 2 + (-dy / dist) * bow;
  const my = (sy + ey) / 2 + (dx / dist) * bow;
  const d = `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;

  // Quadratic midpoint (t = 0.5) for the inline label.
  const labelX = 0.25 * sx + 0.5 * mx + 0.25 * ex;
  const labelY = 0.25 * sy + 0.5 * my + 0.25 * ey;

  const fromName = accountLabel(a.node.name, a.node.id);
  const toName = accountLabel(b.node.name, b.node.id);

  return (
    <g
      className="cursor-pointer opacity-90 transition-opacity hover:opacity-100 motion-reduce:transition-none"
      onClick={() => onSelect(key)}
    >
      {/* Invisible fat hit-target. */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={isSelected ? width + 1.25 : width}
        strokeOpacity={isSelected ? 0.95 : dimmed ? 0.15 : 0.55}
        strokeLinecap="round"
        markerEnd={`url(#${danger ? "money-arrow-danger" : "money-arrow-flow"})`}
        style={isSelected ? { filter: `drop-shadow(0 0 4px ${color}66)` } : undefined}
      />
      <title>
        {`${fromName} → ${toName} — ${formatAmount(edge.totalAmount, edge.currencyCode, false)} across ${edge.txCount} tx${edge.txCount === 1 ? "" : "s"}`}
      </title>
      {isSelected && (
        <text
          x={labelX}
          y={labelY - 7}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          fill={color}
          stroke="var(--card)"
          strokeWidth={3}
          paintOrder="stroke"
          className="pointer-events-none tabular-nums"
        >
          {formatCompactAmount(edge.totalAmount, edge.currencyCode)} · {edge.txCount}tx
        </text>
      )}
    </g>
  );
}

// ─── Node ───────────────────────────────────────────────────────────────────

interface NodeGlyphProps {
  placed: PlacedNode;
  labeled: boolean;
  selectedEdge: string | null;
  edges: MoneyGraphEdge[];
  onSelect: (key: string) => void;
}

function NodeGlyph({ placed, labeled, selectedEdge, edges, onSelect }: NodeGlyphProps) {
  const { node, x, y, isCenter, synthetic } = placed;
  const r = isCenter ? CENTER_R : NODE_R;
  const fill = isCenter
    ? CENTER_HEX
    : node.banned
      ? DANGER_HEX
      : synthetic
        ? SYNTH_HEX
        : ACCOUNT_HEX;
  const inSelection = Boolean(
    selectedEdge &&
    selectedEdge.slice(0, selectedEdge.lastIndexOf("·")).split("→").includes(node.id)
  );
  const dimmed = Boolean(selectedEdge) && !inSelection;
  const name = accountLabel(node.name, node.id);

  return (
    <g
      className="cursor-pointer transition-opacity motion-reduce:transition-none"
      opacity={dimmed ? 0.4 : 1}
      onClick={() => {
        // Clicking a node pins its heaviest incident flow.
        const best = heaviestEdgeFor(node.id, edges);
        if (best) onSelect(moneyEdgeKey(best));
      }}
    >
      <title>
        {`${name}${isCenter ? " — this account" : ""}${node.banned ? " · BANNED" : ""}${synthetic ? " · not a player account" : ""}`}
      </title>
      {node.banned && (
        <circle
          cx={x}
          cy={y}
          r={r + 4.5}
          fill="none"
          stroke="var(--error)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      )}
      {synthetic ? (
        <rect
          x={x - SYNTH_HALF}
          y={y - SYNTH_HALF}
          width={SYNTH_HALF * 2}
          height={SYNTH_HALF * 2}
          rx={4}
          fill={fill}
          fillOpacity={0.85}
          stroke="var(--background)"
          strokeWidth={2}
        />
      ) : (
        <circle
          cx={x}
          cy={y}
          r={r}
          fill={fill}
          fillOpacity={0.92}
          stroke="var(--background)"
          strokeWidth={2}
        />
      )}
      {/* Hub keel, same idiom as RingGraph's operator. */}
      {isCenter && (
        <circle
          cx={x}
          cy={y}
          r={r - 5}
          fill="none"
          stroke="var(--background)"
          strokeOpacity={0.55}
          strokeWidth={1.5}
        />
      )}
      {labeled && (
        <text
          x={x}
          y={y + (synthetic ? SYNTH_HALF : r) + 13}
          textAnchor="middle"
          fontSize={10}
          fontWeight={isCenter ? 600 : 500}
          fill="var(--foreground)"
          stroke="var(--card)"
          strokeWidth={3}
          paintOrder="stroke"
          opacity={node.banned ? 0.75 : 0.92}
        >
          {truncate(name, 14)}
        </text>
      )}
    </g>
  );
}

// ─── Caption + legend bits ─────────────────────────────────────────────────

function SelectedEdgeCaption({
  edge,
  placed,
  onClear,
}: {
  edge: MoneyGraphEdge;
  placed: Map<string, PlacedNode>;
  onClear: () => void;
}) {
  const from = placed.get(edge.from);
  const to = placed.get(edge.to);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-card-border/70 bg-card-elevated/50 px-3 py-2 text-xs">
      <span className="min-w-0 truncate font-medium">
        {accountLabel(from?.node.name ?? null, edge.from)}
        <span aria-hidden className="mx-1.5 text-sky-400">
          →
        </span>
        {accountLabel(to?.node.name ?? null, edge.to)}
      </span>
      <span className="font-semibold tabular-nums text-sky-400">
        {formatAmount(edge.totalAmount, edge.currencyCode, false)}
      </span>
      <span className="tabular-nums text-muted">
        {edge.txCount} transaction{edge.txCount === 1 ? "" : "s"} · {edge.currencyCode}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded-md px-1.5 py-0.5 text-muted transition-colors hover:text-foreground motion-reduce:transition-none"
        aria-label="Clear selected flow"
      >
        ✕
      </button>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-full ring-2 ring-background"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function heaviestEdgeFor(nodeId: string, edges: MoneyGraphEdge[]): MoneyGraphEdge | null {
  let best: MoneyGraphEdge | null = null;
  for (const edge of edges) {
    if (edge.from !== nodeId && edge.to !== nodeId) continue;
    if (!best || edge.totalAmount > best.totalAmount) best = edge;
  }
  return best;
}
