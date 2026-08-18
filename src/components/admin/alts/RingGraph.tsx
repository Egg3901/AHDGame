"use client";

// RingGraph: node-link diagram of the cluster. Edges stay SVG; nodes are
// in-game PFPs with names that open the suspect peek (username / email / IP /
// cookie / ban / profile). Clicking a portrait still selects its strongest
// incident edge for the evidence panel.

import { useMemo } from "react";
import { SuspectMugshot } from "./SuspectPortrait";
import { SuspectNameButton } from "./SuspectPeek";
import {
  confidenceHex,
  formatPct,
  memberInGameName,
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
const HEIGHT = 360;

export function RingGraph({
  members,
  links,
  operatorId,
  selectedPair,
  onSelectPair,
}: RingGraphProps) {
  const hasOperator = Boolean(operatorId && members.some((m) => m.userId === operatorId));
  const orbitR = Math.min(WIDTH, HEIGHT) / 2 - 58;

  const nodes = useMemo<Node[]>(() => {
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;

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
        <div
          className="relative mx-auto w-full max-w-[440px]"
          style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
        >
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={`Ring graph of ${members.length} linked accounts`}
          >
            <defs>
              <radialGradient id="ring-graph-vignette" cx="50%" cy="46%" r="62%">
                <stop offset="0%" stopColor="var(--card-elevated)" stopOpacity="0.55" />
                <stop offset="100%" stopColor="var(--card-elevated)" stopOpacity="0" />
              </radialGradient>
            </defs>

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
                  <title>{`${memberInGameName(a.member)} ↔ ${memberInGameName(b.member)} — ${formatPct(link.confidence)} link confidence`}</title>
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
          </svg>

          {nodes.map((node) => {
            const { member } = node;
            const isHub = hasOperator && member.userId === operatorId;
            const inSelection = Boolean(
              selectedPair && selectedPair.split("_").includes(member.userId)
            );
            const dimmed = Boolean(selectedPair) && !inSelection;
            return (
              <div
                key={`node-${node.id}`}
                className="absolute flex flex-col items-center"
                style={{
                  left: `${(node.x / WIDTH) * 100}%`,
                  top: `${(node.y / HEIGHT) * 100}%`,
                  transform: "translate(-50%, -50%)",
                  opacity: dimmed ? 0.45 : 1,
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelectPair?.(strongestPairFor(node.id, links))}
                  className="rounded-full"
                  style={
                    inSelection ? { boxShadow: `0 0 0 2px ${ROLE_HEX[member.role]}` } : undefined
                  }
                  title={`${memberInGameName(member)} — ${ROLE_LABEL[member.role]}${member.banned ? " · BANNED" : ""}`}
                >
                  <SuspectMugshot
                    member={member}
                    size={isHub ? "h-12 w-12" : "h-10 w-10"}
                    rounded="rounded-full"
                  />
                </button>
                <div className="absolute left-1/2 top-full mt-1 w-24 -translate-x-1/2 text-center">
                  <SuspectNameButton
                    member={member}
                    className="text-[11px] font-semibold text-primary hover:underline"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

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

function strongestPairFor(userId: string, links: ClusterLink[]): string | null {
  let best: ClusterLink | null = null;
  for (const link of links) {
    if (link.userA !== userId && link.userB !== userId) continue;
    if (!best || link.confidence > best.confidence) best = link;
  }
  return best ? pairKey(best.userA, best.userB) : null;
}
