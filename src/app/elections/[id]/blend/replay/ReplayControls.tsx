"use client";

import { BLEND, FONT } from "@/components/blend/tokens";
import type { PresMapCandidate } from "../presMap/presMapModel";
import type { ReplayFrame } from "./replayModel";

export type ReplayView = "ev" | "pv";

const btn = (on: boolean): React.CSSProperties => ({
  padding: "5px 10px",
  cursor: "pointer",
  font: "inherit",
  fontFamily: FONT.mono,
  fontSize: 10.5,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  border: `1px solid ${on ? BLEND.ink : BLEND.hairlineStrong}`,
  color: on ? BLEND.ink : BLEND.muted,
  background: on ? BLEND.hairlineStrong : "transparent",
});

/** Entry point shown on a concluded race before the replay starts. */
export function ReplayStart({ weeks, onStart }: { weeks: number; onStart: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 20px",
        borderBottom: `1px solid ${BLEND.hairline}`,
      }}
    >
      <button type="button" onClick={onStart} style={btn(false)}>
        &#9654; Replay the campaign
      </button>
      <span style={{ fontSize: 12.5, color: BLEND.muted }}>
        {weeks} weeks, state by state and county by county
      </span>
    </div>
  );
}

/**
 * The replay bar: play and pause, a week scrubber, the electoral or popular
 * vote view, and the running totals for the two leading tickets at that week.
 */
export function ReplayControls({
  frame,
  index,
  playing,
  view,
  candidates,
  onIndex,
  onPlaying,
  onView,
  onExit,
}: {
  frame: ReplayFrame;
  index: number;
  playing: boolean;
  view: ReplayView;
  /** The two leading tickets, left to right. */
  candidates: PresMapCandidate[];
  onIndex: (index: number) => void;
  onPlaying: (playing: boolean) => void;
  onView: (view: ReplayView) => void;
  onExit: () => void;
}) {
  const totalVotes = Object.values(frame.totals.votes).reduce((s, v) => s + v, 0);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 14px",
        padding: "8px 20px",
        borderBottom: `1px solid ${BLEND.hairline}`,
        background: BLEND.inset,
      }}
    >
      <button
        type="button"
        aria-label={playing ? "Pause the replay" : "Play the replay"}
        onClick={() => {
          // Playing from the last week starts over.
          if (!playing && index >= frame.weeks - 1) onIndex(0);
          onPlaying(!playing);
        }}
        style={{ ...btn(playing), minWidth: 64 }}
      >
        {playing ? "⏸ Pause" : "▶ Play"}
      </button>
      <label
        style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 220px", minWidth: 180 }}
      >
        <span
          style={{ fontFamily: FONT.mono, fontSize: 11, color: BLEND.muted, whiteSpace: "nowrap" }}
        >
          WEEK {frame.week} / {frame.weeks}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, frame.weeks - 1)}
          value={index}
          onChange={(e) => {
            onPlaying(false);
            onIndex(Number(e.target.value));
          }}
          aria-label="Week of the campaign"
          style={{ flex: 1, accentColor: BLEND.accent }}
        />
      </label>
      <div role="radiogroup" aria-label="Replay view" style={{ display: "inline-flex", gap: 4 }}>
        <button
          type="button"
          role="radio"
          aria-checked={view === "ev"}
          onClick={() => onView("ev")}
          style={btn(view === "ev")}
        >
          Electoral votes
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={view === "pv"}
          onClick={() => onView("pv")}
          style={btn(view === "pv")}
        >
          Popular vote
        </button>
      </div>
      <div style={{ display: "flex", gap: 14, fontFamily: FONT.mono, fontSize: 12 }}>
        {candidates.map((c) => {
          const v = frame.totals.votes[c.id] ?? 0;
          return (
            <span key={c.id} style={{ color: c.color, fontWeight: 600, whiteSpace: "nowrap" }}>
              {c.name.split(" ").slice(-1)[0]}{" "}
              {view === "ev"
                ? `${frame.totals.ev[c.id] ?? 0} EV`
                : `${totalVotes > 0 ? ((v / totalVotes) * 100).toFixed(1) : "0.0"}%`}
            </span>
          );
        })}
      </div>
      <button type="button" onClick={onExit} aria-label="End the replay" style={btn(false)}>
        &times; Final result
      </button>
    </div>
  );
}
