"use client";

import {
  getEconomicPositionName,
  getPolicyColor,
  getSocialPolicyColor,
  getSocialPositionName,
  POLICY_INTEGER_AXIS_RANGE,
} from "@/lib/utils/politics";
import { formatLeanValue } from "@/lib/utils/demographics";

export interface CompassMarker {
  economic: number;
  social: number;
  label: string;
  /** Hex color for the marker dot and line. Falls back to a muted gray. */
  color?: string;
}

interface CompassGroup {
  mx: number;
  my: number;
  label: string; // "P", "R", or "P·R"
  color: string;
}

/**
 * Groups compass markers that are within MERGE_DIST of each other on the 2D plane.
 * Also nudges groups that overlap the player dot so both are visible.
 */
function groupCompassMarkers(
  markers: CompassMarker[],
  range: number,
  playerX: number,
  playerY: number
): CompassGroup[] {
  const MERGE_DIST = 5; // viewBox units — merge if closer than this
  const PLAYER_MIN_DIST = 7; // nudge away from player dot if closer than this

  const items = markers.map((m) => ({
    mx: Math.max(2, Math.min(98, ((m.economic + range) / (range * 2)) * 100)),
    my: Math.max(2, Math.min(98, ((range - m.social) / (range * 2)) * 100)),
    label: m.label === "Party" ? "P" : m.label === "State" ? "R" : m.label.charAt(0),
    color: m.color ?? "rgba(160,160,160,0.9)",
  }));

  const used = new Set<number>();
  const groups: CompassGroup[] = [];

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    let { mx, my, label } = items[i];
    const { color } = items[i];
    used.add(i);

    for (let j = i + 1; j < items.length; j++) {
      if (!used.has(j)) {
        const dx = items[i].mx - items[j].mx;
        const dy = items[i].my - items[j].my;
        if (Math.sqrt(dx * dx + dy * dy) <= MERGE_DIST) {
          mx = (mx + items[j].mx) / 2;
          my = (my + items[j].my) / 2;
          label = label + "·" + items[j].label;
          used.add(j);
        }
      }
    }

    // Nudge away from player dot if overlapping
    const dpx = mx - playerX;
    const dpy = my - playerY;
    const playerDist = Math.sqrt(dpx * dpx + dpy * dpy);
    if (playerDist < PLAYER_MIN_DIST) {
      if (playerDist > 0.2) {
        // Push outward along the existing direction
        const scale = PLAYER_MIN_DIST / playerDist;
        mx = Math.max(2, Math.min(98, playerX + dpx * scale));
        my = Math.max(2, Math.min(98, playerY + dpy * scale));
      } else {
        // Exact same spot — nudge diagonally up-right
        mx = Math.min(98, mx + PLAYER_MIN_DIST * 0.7);
        my = Math.max(2, my - PLAYER_MIN_DIST * 0.7);
      }
    }

    groups.push({ mx, my, label, color });
  }

  return groups;
}

interface PoliticalCompassProps {
  economic: number;
  social: number;
  embedded?: boolean;
  /** Optional party hex color for the position dot. Falls back to var(--primary). */
  dotColor?: string;
  /** Secondary reference markers (e.g. party or state position). */
  markers?: CompassMarker[];
}

export function PoliticalCompass({
  economic,
  social,
  embedded = false,
  dotColor,
  markers,
}: PoliticalCompassProps) {
  const range = POLICY_INTEGER_AXIS_RANGE;

  const xPercent = ((economic + range) / (range * 2)) * 100;
  const yPercent = ((range - social) / (range * 2)) * 100;

  const groups = markers ? groupCompassMarkers(markers, range, xPercent, yPercent) : [];

  const partyMarker = markers?.find((m) => m.label === "Party");
  const stateMarker = markers?.find((m) => m.label === "State");
  const hasMarkers = markers && markers.length > 0;

  const plot = (
    <div className="flex w-full flex-col items-center">
      <div className="relative flex w-full max-w-[min(100%,320px)] items-stretch gap-2 sm:gap-3">
        <div className="relative aspect-square min-w-0 flex-1">
          <div className="absolute inset-0 overflow-hidden rounded-2xl border border-card-border/80 bg-zinc-950/40 shadow-inner ring-1 ring-white/[0.04]">
            {/* Quadrants - Custom color scheme */}
            {/* Top-Left: Red */}
            <div className="absolute top-0 left-0 h-1/2 w-1/2 bg-gradient-to-br from-red-500/[0.18] to-red-600/[0.10]" />
            {/* Top-Right: Blue */}
            <div className="absolute top-0 right-0 h-1/2 w-1/2 bg-gradient-to-bl from-blue-500/[0.18] to-blue-600/[0.10]" />
            {/* Bottom-Left: Green */}
            <div className="absolute bottom-0 left-0 h-1/2 w-1/2 bg-gradient-to-tr from-green-500/[0.18] to-green-600/[0.10]" />
            {/* Bottom-Right: Purple */}
            <div className="absolute right-0 bottom-0 h-1/2 w-1/2 bg-gradient-to-tl from-purple-500/[0.18] to-violet-600/[0.10]" />

            <div
              className="absolute inset-0 opacity-[0.35]"
              style={{
                backgroundImage: `
                  linear-gradient(to right, transparent 0%, transparent calc(50% - 0.5px), rgba(255,255,255,0.08) calc(50% - 0.5px), rgba(255,255,255,0.08) calc(50% + 0.5px), transparent calc(50% + 0.5px)),
                  linear-gradient(to bottom, transparent 0%, transparent calc(50% - 0.5px), rgba(255,255,255,0.08) calc(50% - 0.5px), rgba(255,255,255,0.08) calc(50% + 0.5px), transparent calc(50% + 0.5px))
                `,
              }}
            />

            <div className="pointer-events-none absolute inset-2 flex flex-col justify-between text-[9px] font-semibold tracking-wide text-foreground/45">
              <div className="flex justify-between gap-1">
                <span className="drop-shadow-sm">Left · Trad.</span>
                <span className="drop-shadow-sm">Right · Trad.</span>
              </div>
              <div className="flex justify-between gap-1">
                <span className="drop-shadow-sm">Left · Lib.</span>
                <span className="drop-shadow-sm">Right · Lib.</span>
              </div>
            </div>
          </div>

          {/* Secondary markers with connector lines */}
          {groups.length > 0 && (
            <svg
              className="pointer-events-none absolute inset-0 z-[5] h-full w-full overflow-visible"
              viewBox="0 0 100 100"
            >
              {groups.map((g, i) => {
                const sameAsPlayer =
                  Math.abs(g.mx - xPercent) < 0.5 && Math.abs(g.my - yPercent) < 0.5;
                const isCombined = g.label.includes("·");
                // Pill width for combined labels
                const pillW = isCombined ? 14 : 10;
                const pillH = 10;
                return (
                  <g key={i}>
                    {!sameAsPlayer && (
                      <line
                        x1={xPercent}
                        y1={yPercent}
                        x2={g.mx}
                        y2={g.my}
                        stroke={g.color}
                        strokeWidth="0.7"
                        strokeDasharray="2.5 1.5"
                        strokeOpacity="0.75"
                      />
                    )}
                    {isCombined ? (
                      <rect
                        x={g.mx - pillW / 2}
                        y={g.my - pillH / 2}
                        width={pillW}
                        height={pillH}
                        rx="5"
                        fill={g.color}
                        stroke="rgba(0,0,0,0.6)"
                        strokeWidth="0.8"
                      />
                    ) : (
                      <circle
                        cx={g.mx}
                        cy={g.my}
                        r="5"
                        fill={g.color}
                        stroke="rgba(0,0,0,0.6)"
                        strokeWidth="0.8"
                      />
                    )}
                    <text
                      x={g.mx}
                      y={g.my + 2}
                      textAnchor="middle"
                      fontSize={isCombined ? "5.5" : "7"}
                      fontWeight="700"
                      fill="#fff"
                      fontFamily="ui-sans-serif, system-ui, sans-serif"
                    >
                      {g.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}

          {/* Player dot */}
          <div
            className="group absolute z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 transition-all duration-500 ease-out will-change-transform"
            style={{
              left: `${Math.max(0, Math.min(100, xPercent))}%`,
              top: `${Math.max(0, Math.min(100, yPercent))}%`,
            }}
          >
            <div
              className="absolute inset-0 animate-ping rounded-full motion-reduce:animate-none"
              style={{
                backgroundColor: dotColor
                  ? `${dotColor}40`
                  : "var(--color-primary, oklch(65% 0.3 290))",
                opacity: dotColor ? 1 : undefined,
              }}
            />
            <div
              className="relative h-full w-full rounded-full border-2 border-background shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
              style={{
                backgroundColor: dotColor ?? "var(--color-primary)",
                boxShadow: `0 0 0 1px rgba(0,0,0,0.25), 0 0 0 3px ${dotColor ? `${dotColor}50` : "color-mix(in srgb, var(--color-primary) 30%, transparent)"}`,
              }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 max-w-[min(90vw,240px)] -translate-x-1/2 rounded-lg border border-card-border bg-popover px-2.5 py-1.5 text-center text-xs font-medium text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              <div className={getPolicyColor(economic)}>
                {getEconomicPositionName(economic)} ({formatLeanValue(economic)})
              </div>
              <div className={`mt-0.5 ${getSocialPolicyColor(social)}`}>
                {getSocialPositionName(social)} ({formatLeanValue(social)})
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      {hasMarkers && (partyMarker || stateMarker) && (
        <div className="mt-3 flex gap-4 justify-center">
          <span className="flex items-center gap-1.5 text-[10px] text-muted">
            <span
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ring-1 ring-black/20"
              style={{ backgroundColor: dotColor ?? "var(--color-primary)" }}
            />
            You
          </span>
          {partyMarker && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted">
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ring-1 ring-black/20"
                style={{ backgroundColor: partyMarker.color ?? "#a1a1aa" }}
              >
                P
              </span>
              Party
            </span>
          )}
          {stateMarker && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted">
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ring-1 ring-black/20"
                style={{ backgroundColor: stateMarker.color ?? "#38bdf8" }}
              >
                R
              </span>
              State lean
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (embedded) {
    return plot;
  }

  return (
    <div className="flex flex-col items-center rounded-2xl border border-card-border bg-card p-6 shadow-sm">
      <h3 className="mb-6 text-xs font-bold uppercase tracking-widest text-muted">
        Political alignment
      </h3>
      {plot}
    </div>
  );
}
