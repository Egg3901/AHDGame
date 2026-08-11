"use client";

import { useMemo } from "react";
import { hemicycleLayout, benchLayout, horseshoeLayout } from "@/lib/charts/seatingLayouts";
import type { SeatingStyle } from "@/lib/legislature/process";
import { seatVoteColors, seatingThreshold, SEAT_VOTE_COLORS, type VoteCounts } from "./voteSeating";

export type { SeatingStyle };

export function VoteSeatingChart({
  style,
  votes,
  eligible,
  width = 440,
  requiredPct,
  requiredPctOfCast = false,
}: {
  style: SeatingStyle;
  votes: VoteCounts;
  eligible: number;
  width?: number;
  /**
   * Pass threshold as a percentage of seats. Omit for a simple majority
   * (the default). Set to 60 for an invoked filibuster (3/5 cloture) or 67
   * for a two-thirds supermajority. Drives both the "passing" color and the
   * "{pct}% needed to pass" caption.
   */
  requiredPct?: number;
  /**
   * When true, requiredPct is a share of votes CAST (for + against + abstain)
   * instead of seats — matches the quorum-based cloture rule. Ignored when
   * requiredPct is unset.
   */
  requiredPctOfCast?: boolean;
}) {
  const layout = useMemo(() => {
    if (style === "horseshoe") {
      const l = horseshoeLayout(eligible);
      return { pts: l.pts, seatR: l.seatR, vb: l.vb, chairY: l.chairY as number | undefined };
    }
    if (style === "benches") {
      const l = benchLayout(eligible);
      const pad = 0.6;
      return {
        pts: l.pts,
        seatR: l.seatR,
        vb: [-pad, -pad, l.w + pad * 2, l.h + pad * 2] as [number, number, number, number],
        chairY: undefined as number | undefined,
      };
    }
    const l = hemicycleLayout(eligible);
    return {
      pts: l.pts,
      seatR: l.seatR,
      vb: [-1.1, -1.12, 2.2, 1.24] as [number, number, number, number],
      chairY: undefined as number | undefined,
    };
  }, [style, eligible]);

  const { pts, seatR, vb, chairY } = layout;

  const colors = useMemo(() => {
    const base = seatVoteColors(votes, eligible, SEAT_VOTE_COLORS);
    if (base.length === pts.length) return base;
    if (base.length > pts.length) return base.slice(0, pts.length);
    return [...base, ...Array(pts.length - base.length).fill(SEAT_VOTE_COLORS.pending)];
  }, [votes, eligible, pts.length]);

  const [vx, vy, vw, vh] = vb;
  const votesCast = votes.for + votes.against + votes.abstain;
  const { need, displayPct } =
    requiredPct != null && requiredPctOfCast
      ? { need: Math.max(1, Math.ceil((votesCast * requiredPct) / 100)), displayPct: requiredPct }
      : seatingThreshold(eligible, requiredPct);
  const passing = votes.for >= need;
  const taLabel = style === "horseshoe";

  if (eligible <= 0 || pts.length === 0) return null;

  return (
    <div style={{ width, maxWidth: "100%", margin: "0 auto" }}>
      <svg
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        width="100%"
        style={{ display: "block", overflow: "visible" }}
        role="img"
        aria-label={`${votes.for} for, ${votes.against} against, ${votes.abstain} abstaining of ${eligible} seats`}
      >
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={seatR}
            fill={colors[i]}
            style={{ transition: "fill .5s ease" }}
          />
        ))}
        {chairY != null && (
          <circle cx={0} cy={chairY} r={seatR * 1.05} fill="var(--foreground)" opacity={0.85} />
        )}
      </svg>
      <div style={{ textAlign: "center", marginTop: 10 }}>
        <div
          className="tabular-nums"
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: 28,
            fontWeight: 800,
            lineHeight: 1,
            color: passing ? "var(--success)" : "var(--foreground)",
          }}
        >
          {votes.for}
          <span
            style={{
              color: "var(--muted)",
              fontWeight: 600,
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginLeft: 6,
            }}
          >
            {taLabel ? "Tá" : "Ayes"}
          </span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginTop: 4,
            fontWeight: 700,
          }}
        >
          {displayPct}% {requiredPct != null && requiredPctOfCast ? "of votes cast " : ""}needed to
          pass
        </div>
      </div>
    </div>
  );
}
