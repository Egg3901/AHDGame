"use client";

import { formatRealTimeCountdown } from "@/lib/utils/formatters";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { useCountdownTimer } from "@/hooks/useCountdownTimer";
import { MIL_COLOR, MIL_FONT } from "../military/theme";

const mono = MIL_FONT.mono;

/** One thing that resolves on the next tick. */
export interface PendingChip {
  text: string;
  /** When it lands, e.g. "resolves T496". */
  when: string;
  /** Whose it is — colours the chip and its dot. */
  tone: "own" | "enemy" | "plain" | "quiet";
}

const TONE = {
  own: { border: "rgba(220,38,38,.4)", background: "rgba(220,38,38,.07)", dot: MIL_COLOR.red },
  enemy: { border: "rgba(59,130,246,.4)", background: "rgba(59,130,246,.07)", dot: MIL_COLOR.blue },
  plain: { border: MIL_COLOR.border, background: MIL_COLOR.panel, dot: MIL_COLOR.green },
  quiet: { border: MIL_COLOR.border, background: MIL_COLOR.panel, dot: MIL_COLOR.textFaint },
} as const;

/**
 * What resolves at the next tick.
 *
 * A turn-based war's most useful fact is what is already committed and cannot be
 * taken back, and the record page previously said nothing about it — a pending
 * offensive appeared only inside the COMMAND panel, invisible to every seat that
 * could not declare.
 *
 * The countdown targets the cron schedule the status bar uses, so this strip and
 * the clock at the bottom of the screen can never disagree.
 */
export function NextTickStrip({ nextTurn, chips }: { nextTurn: number; chips: PendingChip[] }) {
  const gameState = useGameTurnStatus(true);
  // Re-renders on a timer; the countdown is derived, never stored, so there is no
  // stale value to reconcile.
  useCountdownTimer(30_000);

  const eta = gameState?.isProcessing
    ? "processing"
    : gameState?.nextScheduledTurn && gameState.isActive
      ? formatRealTimeCountdown(gameState.nextScheduledTurn, gameState.pausedAt ?? null)
      : "paused";

  return (
    <div
      className="cw-front-tick"
      style={{
        display: "flex",
        alignItems: "stretch",
        border: `1px solid ${MIL_COLOR.border}`,
        borderRadius: 12,
        background: MIL_COLOR.inset,
        overflow: "hidden",
        flexWrap: "wrap",
      }}
    >
      <div
        className="cw-front-tick-head"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          background: "rgba(212,175,55,.07)",
          borderRight: `1px solid ${MIL_COLOR.border}`,
          flexShrink: 0,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={MIL_COLOR.gold}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <div
            style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
          >
            RESOLVES NEXT TICK
          </div>
          <div style={{ font: `600 11px ${mono}`, color: MIL_COLOR.gold, marginTop: 2 }}>
            T{nextTurn} · {eta === "Ended" ? "processing" : eta}
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          flexWrap: "wrap",
        }}
      >
        {chips.map((p) => {
          const t = TONE[p.tone];
          return (
            <div
              key={`${p.text}-${p.when}`}
              className="cw-front-chip"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: `1px solid ${t.border}`,
                background: t.background,
                borderRadius: 8,
                padding: "7px 11px",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 9999,
                  background: t.dot,
                  flexShrink: 0,
                }}
              />
              <span style={{ font: `500 10.5px ${mono}`, color: "#c8c8d4" }}>{p.text}</span>
              {/* A chip with nothing pending states no timing. An empty `when`
                  is that case, not a missing value. */}
              {p.when && (
                <span style={{ font: `600 10.5px ${mono}`, color: MIL_COLOR.textFaint }}>
                  {p.when}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
