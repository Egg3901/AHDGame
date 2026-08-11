"use client";

// RingGraph (plan §4.8): a node-link diagram of the cluster, hand-rolled in
// SVG (no external library — CSP on the admin app forbids remote/CDN scripts).
// Nodes are members on a fixed orbit (operator at the hub), colored by role
// with a surface ring for separation; a banned member gets a dashed danger
// halo (red is reserved for danger, never a role). Edges are pairwise links,
// thickness ∝ link confidence and colored on the same severity scale as the
// meter. Clicking an edge (or a node) selects the pair so the EvidencePanel
// can focus its evidence; the selected edge shows its % inline.

import { useMemo } from "react";
import {
  confidenceHex,
  formatPct,
  memberDisplayName,
  pairKey,
  ROLE_HEX,
  ROLE_LABEL,
  type ClusterLink,
  type ClusterMember,
} from "./altTypes";

interface RingGraphProps {
  members: ClusterMember[];
  links: ClusterLink[];
  operatorId?: string;
  selectedPair?: string | null;
  onSelectPair?: (pair: string | null) => void;
}

interface Node {
  id: string;
  x: number;
  y: number;
  member: ClusterMember;
}

const WIDTH = 360;
const HEIGHT = 320;
const NODE_R = 15;
const HUB_R = 18;

export function RingGraph({
  members,
  links,
  operatorId,
  selectedPair,
  onSelectPair,
}: RingGraphProps) {
  const hasOperator = Boolean(operatorId && members.some((m) => m.userId === operatorId));
  const orbitR = Math.min(WIDTH, HEIGHT) / 2 - NODE_R - 30;

  const nodes = useMemo<Node[]>(() => {
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;

    // Operator (if any) sits at the hub; everyone else rings around it. With no
    // operator, all members sit evenly on the circle.
    const ring = members.filter((m) => !(hasOperator && m.userId === operatorId));
    const placed: Node[] = ring.map((member, i) => {
      const angle = (i / Math.max(1, ring.length)) * 2 * Math.PI - Math.PI / 2;
      return {
        id: member.userId,
        x: cx + orbitR * Math.cos(angle),
        y: cy + orbitR * Math.sin(angle),
        member,
      };
    });
    if (hasOperator) {
      const op = members.find((m) => m.userId === operatorId)!;
      placed.push({ id: op.userId, x: cx, y: cy, member: op });
    }
    return placed;
  }, [members, hasOperator, operatorId, orbitR]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const maxConfidence = useMemo(
    () => links.reduce((max, l) => Math.max(max, l.confidence), 0) || 1,
    [links]
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-card-border/70 bg-card-muted/60">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="mx-auto block h-auto w-full max-w-[440px]"
          role="img"
          aria-label={`Ring graph of ${members.length} linked accounts`}
        >
          <defs>
            <radialGradient id="ring-graph-vignette" cx="50%" cy="46%" r="62%">
              <stop offset="0%" stopColor="var(--card-elevated)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--card-elevated)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Ambient center glow + the orbit the members sit on. */}
          <rect width={WIDTH} height={HEIGHT} fill="url(#ring-graph-vignette)" />
          <circle
            cx={WIDTH / 2}
            cy={HEIGHT / 2}
            r={orbitR}
            fill="none"
            stroke="var(--card-border)"
            strokeWidth={1}
            strokeDasharray="2 6"
            strokeLinecap="round"
            opacity={0.7}
          />

          {/* Edges first, so nodes sit on top */}
          {links.map((link, i) => {
            const a = nodeById.get(link.userA);
            const b = nodeById.get(link.userB);
            if (!a || !b) return null;
            const key = pairKey(link.userA, link.userB);
            const isSelected = selectedPair === key;
            const dimmed = Boolean(selectedPair) && !isSelected;
            const width = 1.5 + (link.confidence / maxConfidence) * 4.5;
            const color = confidenceHex(link.confidence);
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <g
                key={`edge-${i}`}
                className="cursor-pointer opacity-90 transition-opacity hover:opacity-100 motion-reduce:transition-none"
                onClick={() => onSelectPair?.(key)}
              >
                {/* Invisible fat hit-target for easy clicking */}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={color}
                  strokeWidth={isSelected ? width + 1.5 : width}
                  strokeOpacity={isSelected ? 0.95 : dimmed ? 0.18 : 0.5}
                  strokeLinecap="round"
                  style={isSelected ? { filter: `drop-shadow(0 0 4px ${color}66)` } : undefined}
                />
                <title>{`${memberDisplayName(a.member.name, a.id)} ↔ ${memberDisplayName(b.member.name, b.id)} — ${formatPct(link.confidence)} link confidence`}</title>
                {/* Inline % on the selected edge — the evidence panel's anchor. */}
                {isSelected && (
                  <text
                    x={mx}
                    y={my - 7}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={color}
                    stroke="var(--card)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    className="pointer-events-none tabular-nums"
                  >
                    {formatPct(link.confidence)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const { member } = node;
            const isHub = hasOperator && member.userId === operatorId;
            const r = isHub ? HUB_R : NODE_R;
            const fill = ROLE_HEX[member.role];
            const inSelection = Boolean(
              selectedPair && selectedPair.split("_").includes(member.userId)
            );
            const dimmed = Boolean(selectedPair) && !inSelection;
            return (
              <g
                key={`node-${node.id}`}
                className="cursor-pointer transition-opacity motion-reduce:transition-none"
                opacity={dimmed ? 0.45 : 1}
                onClick={() =>
                  onSelectPair?.(
                    // Clicking a node selects its strongest incident edge.
                    strongestPairFor(node.id, links)
                  )
                }
              >
                <title>
                  {`${memberDisplayName(member.name, member.userId)} — ${ROLE_LABEL[member.role]}${member.banned ? " · BANNED" : ""}`}
                </title>
                {/* Banned: dashed danger halo, distinct from any role color. */}
                {member.banned && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r + 4.5}
                    fill="none"
                    stroke="var(--error)"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                )}
                {/* Selection halo */}
                {inSelection && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r + 3}
                    fill="none"
                    stroke={fill}
                    strokeOpacity={0.45}
                    strokeWidth={2}
                  />
                )}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  fill={fill}
                  fillOpacity={inSelection ? 1 : 0.9}
                  stroke="var(--background)"
                  strokeWidth={2}
                />
                {/* Hub keel: marks the operator without extra chrome. */}
                {isHub && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r - 5}
                    fill="none"
                    stroke="var(--background)"
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                  />
                )}
                <text
                  x={node.x}
                  y={node.y + r + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={isHub ? 600 : 500}
                  fill="var(--foreground)"
                  stroke="var(--card)"
                  strokeWidth={3}
                  paintOrder="stroke"
                  opacity={member.banned ? 0.75 : 0.92}
                >
                  {truncate(memberDisplayName(member.name, member.userId), 13)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend — identity is never color-alone. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
        <LegendSwatch color={ROLE_HEX.operator} label="Operator" />
        <LegendSwatch color={ROLE_HEX.burner} label="Burner" />
        <LegendSwatch color={ROLE_HEX.associate} label="Associate" />
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full border border-dashed"
            style={{ borderColor: "var(--error)" }}
          />
          Banned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex items-center gap-px" aria-hidden>
            <span className="inline-block h-[2px] w-3 rounded-full bg-current opacity-50" />
            <span className="inline-block h-[5px] w-3 rounded-full bg-current opacity-80" />
          </span>
          Edge width = link confidence
        </span>
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
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

function strongestPairFor(userId: string, links: ClusterLink[]): string | null {
  let best: ClusterLink | null = null;
  for (const link of links) {
    if (link.userA !== userId && link.userB !== userId) continue;
    if (!best || link.confidence > best.confidence) best = link;
  }
  return best ? pairKey(best.userA, best.userB) : null;
}
