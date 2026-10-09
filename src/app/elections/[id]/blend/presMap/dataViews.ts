/**
 * Alternative colourings of the presidential map. The model's own fills are
 * the margin view; every other view repaints states (and counties) from data
 * the model already carries, so switching views costs no request.
 *
 * Pure, and painted toward the theme's page ground so a light theme fades
 * toward light and a dark theme toward dark.
 */

import { readableInk } from "@/lib/elections/marginTierShade";
import type { CountyRow } from "./countyModel";
import { describeTrend, type PresMapCandidate, type PresMapModel } from "./presMapModel";

export type MapDataView = "margin" | "winner" | "share" | "momentum";

export const DATA_VIEWS: { id: MapDataView; label: string }[] = [
  { id: "margin", label: "Margin" },
  { id: "winner", label: "Winner" },
  { id: "share", label: "Vote share" },
  { id: "momentum", label: "Momentum" },
];

/** Share at which the vote-share ramp starts and saturates. */
export const SHARE_RAMP = { lo: 20, hi: 70 } as const;
/** Swing in points at which the momentum ramp saturates. */
export const MOMENTUM_FULL_PP = 2.5;

function parseHex(color: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null;
}

/** `color` faded toward `ground`: t = 1 is the full colour, t = 0 the ground. */
export function mixToward(ground: string, color: string, t: number): string {
  const g = parseHex(ground);
  const c = parseHex(color);
  if (!g || !c) return color;
  const k = Math.max(0, Math.min(1, t));
  const ch = (i: number) => Math.round(g[i] + (c[i] - g[i]) * k);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

/** Ramp position for a vote share; never fully faded so a state stays visible. */
export function shareStrength(pct: number): number {
  const t = (pct - SHARE_RAMP.lo) / (SHARE_RAMP.hi - SHARE_RAMP.lo);
  return 0.12 + 0.88 * Math.max(0, Math.min(1, t));
}

/** Whether the model has per-ticket shares to drive the share and momentum views. */
export function hasShareData(model: PresMapModel): boolean {
  return Object.values(model.states).some((s) => s.shares.length >= 2);
}

/**
 * Tickets that can be picked in the vote-share view, most votes first. Read
 * off the per-state shares themselves (name and colour included), since the
 * tally can key a ticket differently from the race's candidate list.
 */
export function shareCandidates(model: PresMapModel): PresMapCandidate[] {
  const byId = new Map<string, PresMapCandidate & { votes: number }>();
  for (const s of Object.values(model.states)) {
    for (const sh of s.shares) {
      const cur = byId.get(sh.id);
      if (cur) cur.votes += sh.votes;
      else byId.set(sh.id, { id: sh.id, name: sh.name, color: sh.color, votes: sh.votes });
    }
  }
  return [...byId.values()]
    .filter((c) => c.votes > 0)
    .sort((a, b) => b.votes - a.votes)
    .map(({ id, name, color }) => ({ id, name, color }));
}

/** The model repainted for `view`. Margin returns the model untouched. */
export function applyDataView(
  model: PresMapModel,
  view: MapDataView,
  ground: string,
  shareCandidate: PresMapCandidate | null
): PresMapModel {
  if (view === "margin") return model;
  const states: PresMapModel["states"] = {};
  for (const [id, s] of Object.entries(model.states)) {
    let fill = s.fill;
    let caption = s.caption;
    if (view === "winner") {
      fill = s.leaderColor;
    } else if (view === "share") {
      const sh = shareCandidate ? s.shares.find((x) => x.id === shareCandidate.id) : undefined;
      const cand = shareCandidate;
      if (cand) {
        const pct = sh?.pct ?? 0;
        fill = mixToward(ground, cand.color, shareStrength(pct));
        caption = `${cand.name}: ${pct.toFixed(1)}%`;
      }
    } else if (view === "momentum") {
      const tr = s.trend;
      if (tr.status === "toward" && tr.color) {
        fill = mixToward(
          ground,
          tr.color,
          0.15 + 0.85 * Math.min(1, tr.shiftPp / MOMENTUM_FULL_PP)
        );
      } else {
        fill = mixToward(ground, "#8f8f9d", tr.status === "steady" ? 0.22 : 0.08);
      }
      caption = describeTrend(tr);
    }
    // Patterns belong to the margin view's broadcast states; the other views are flat.
    states[id] = { ...s, fill, ink: readableInk(fill), caption, overlay: undefined };
  }
  return { ...model, states };
}

/** County rows repainted for `view`; momentum has no county series and returns null. */
export function applyCountyView(
  rows: CountyRow[],
  view: MapDataView,
  ground: string,
  shareCandidate: PresMapCandidate | null
): CountyRow[] | null {
  if (view === "margin") return rows;
  if (view === "momentum") return null;
  return rows.map((r) => {
    if (view === "winner") return { ...r, fill: r.winnerName ? r.winnerColor : r.fill };
    if (!shareCandidate) return r;
    const pct = r.shareByName[shareCandidate.name] ?? 0;
    return { ...r, fill: mixToward(ground, shareCandidate.color, shareStrength(pct)) };
  });
}
