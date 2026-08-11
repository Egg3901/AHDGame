import type { IndexFundSnapshot } from "@/lib/db/types";

/** Compute NAV % change from snapshot series (newest-first). */
export function navChangeFromSnapshots(
  snapshots: IndexFundSnapshot[],
  turnsBack: number
): number | null {
  if (snapshots.length === 0) return null;
  const current = snapshots[0]?.quotedNav;
  if (!Number.isFinite(current) || current <= 0) return null;

  const targetTurn = snapshots[0].turn - turnsBack;
  const prior = snapshots.find((s) => s.turn <= targetTurn) ?? snapshots[snapshots.length - 1];
  if (!prior || prior._id.equals(snapshots[0]._id)) return null;
  if (!Number.isFinite(prior.quotedNav) || prior.quotedNav <= 0) return null;

  return ((current - prior.quotedNav) / prior.quotedNav) * 100;
}

export type FundNavMetrics = {
  navChange1: number | null;
  navChange24: number | null;
  navChange48: number | null;
  sparkline: { turn: number; quotedNav: number }[];
};

export function buildFundNavMetrics(snapshots: IndexFundSnapshot[]): FundNavMetrics {
  const chronological = [...snapshots].reverse();
  return {
    navChange1: navChangeFromSnapshots(snapshots, 1),
    navChange24: navChangeFromSnapshots(snapshots, 24),
    navChange48: navChangeFromSnapshots(snapshots, 48),
    sparkline: chronological.map((s) => ({ turn: s.turn, quotedNav: s.quotedNav })),
  };
}
