"use client";

import { BLEND, FONT } from "@/components/blend/tokens";
import type { ElectionDetail } from "../components/ElectionDetailTypes";

function turnsLeft(target: number | null | undefined, current: number | null): string | null {
  if (target == null || current == null) return null;
  const n = Math.max(0, target - current);
  return n === 0 ? "This turn" : `${n} turn${n === 1 ? "" : "s"}`;
}

/**
 * The race's key dates in two lines: when the primary ends and when the general
 * election is held. Counts from the turn the race payload already carries (the
 * same count `ElectionTimeline` uses), so it adds no request of its own and
 * never disagrees with the full schedule. Phases already past are left out.
 */
export function ElectionDatesLine({ election }: { election: ElectionDetail }) {
  if (election.isEnded || election.isUpcoming) return null;
  const currentTurn = election.gameState?.currentTurn ?? null;

  const rows: { label: string; left: string }[] = [];
  const primaryLeft = turnsLeft(election.primaryEndTurn, currentTurn);
  if (election.inPrimary && primaryLeft) rows.push({ label: "Primary ends", left: primaryLeft });
  const generalLeft = turnsLeft(election.endTurn, currentTurn);
  if (generalLeft) {
    rows.push({
      label: election.electionYear
        ? `General election · ${election.electionYear}`
        : "General election",
      left: generalLeft,
    });
  }
  if (rows.length === 0) return null;

  return (
    <dl
      aria-label="Key dates"
      style={{
        margin: 0,
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "4px 14px",
        fontSize: 12.5,
      }}
    >
      {rows.map((r) => (
        <div key={r.label} style={{ display: "contents" }}>
          <dt style={{ fontFamily: FONT.sans, color: BLEND.muted }}>{r.label}</dt>
          <dd style={{ margin: 0, textAlign: "right", fontFamily: FONT.mono }}>{r.left}</dd>
        </div>
      ))}
    </dl>
  );
}
