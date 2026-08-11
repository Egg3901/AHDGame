/**
 * Momentum from a referendum's `pollHistory`: a short-window "recent swing"
 * (drives the arrow) plus the since-open total. Pure; returns null when there
 * is not yet enough history, so consumers keep their neutral "—" fallback.
 */
import { MOMENTUM_LOOKBACK_TURNS, MOMENTUM_FLAT_THRESHOLD } from "@/lib/constants/referendum";
import type { PollPoint } from "./pollSnapshot";

export interface ReferendumMomentum {
  direction: "up" | "down" | "flat";
  /** Latest minus the reading ~lookback turns earlier (percentage points). */
  recentDelta: number;
  /** Latest minus the opening reading (percentage points). */
  totalDelta: number;
  latest: number;
}

export function computeReferendumMomentum(
  history: PollPoint[] | undefined,
  opts?: { lookback?: number; flatThreshold?: number }
): ReferendumMomentum | null {
  if (!history || history.length < 2) return null;
  const lookback = opts?.lookback ?? MOMENTUM_LOOKBACK_TURNS;
  const flat = opts?.flatThreshold ?? MOMENTUM_FLAT_THRESHOLD;

  const sorted = [...history].sort((a, b) => a.turn - b.turn);
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];

  // Reference point for the recent swing: the latest reading at or before
  // (latest.turn − lookback); fall back to the opening reading.
  const targetTurn = latest.turn - lookback;
  let ref = first;
  for (const p of sorted) {
    if (p.turn <= targetTurn) ref = p;
    else break;
  }

  const recentDelta = latest.yesShare - ref.yesShare;
  const totalDelta = latest.yesShare - first.yesShare;
  const direction = recentDelta > flat ? "up" : recentDelta < -flat ? "down" : "flat";
  return { direction, recentDelta, totalDelta, latest: latest.yesShare };
}
