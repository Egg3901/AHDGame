"use client";

import { BLEND, FONT } from "@/components/blend/tokens";
import { FOG_FILL } from "./StateShapes";
import type { PresMapCandidate, PresMapModel, PresMapState } from "./presMapModel";

interface SnakeSegment {
  state: PresMapState;
  /** Positive leans toward the left-hand candidate, negative toward the right. */
  lean: number;
}

/**
 * The left and right candidates of the snake: the two with the most electoral
 * votes on the board, else the model's legend pair.
 */
export function snakeCandidates(model: PresMapModel): [PresMapCandidate, PresMapCandidate] | null {
  const ev = new Map<string, number>();
  for (const s of Object.values(model.states)) {
    if (s.leaderId) ev.set(s.leaderId, (ev.get(s.leaderId) ?? 0) + s.ev);
  }
  const ranked = [...ev.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const ids = ranked.length >= 2 ? ranked.slice(0, 2) : model.legendCandidates.map((c) => c.id);
  const pick = (id: string | undefined): PresMapCandidate | null =>
    id
      ? (model.candidates[id] ??
        model.legendCandidates.find((c) => c.id === id) ??
        (() => {
          const s = Object.values(model.states).find((st) => st.leaderId === id);
          return s ? { id, name: s.leaderName, color: s.leaderColor } : null;
        })())
      : null;
  const a = pick(ids[0]);
  const b = pick(ids[1]);
  return a && b ? [a, b] : null;
}

/**
 * States in snake order: the left candidate's safest state first, through the
 * toss-ups, to the right candidate's safest. A state led by anyone else sits
 * with the toss-ups.
 */
export function snakeOrder(model: PresMapModel, left: string, right: string): SnakeSegment[] {
  const segs = Object.values(model.states)
    .filter((s) => s.ev > 0)
    .map((state) => {
      const lean =
        state.leaderId === left ? state.margin : state.leaderId === right ? -state.margin : 0;
      return { state, lean };
    });
  return segs.sort((a, b) => b.lean - a.lean || a.state.id.localeCompare(b.state.id));
}

/**
 * The road to the electoral majority: every state as a segment sized by its
 * electoral votes and painted as on the map, in order of how safely it leans
 * from one leading ticket to the other, with the majority line marked. The
 * state where the line falls is the one that decides the race.
 */
export function CollegeSnake({
  model,
  threshold,
  onSelect,
}: {
  model: PresMapModel;
  /** Electoral votes needed to win. */
  threshold: number;
  onSelect?: (stateId: string) => void;
}) {
  const pair = snakeCandidates(model);
  if (!pair) return null;
  const [left, right] = pair;
  const segs = snakeOrder(model, left.id, right.id);
  const total = segs.reduce((s, x) => s + x.state.ev, 0);
  if (total <= 0) return null;
  const leftEv = segs.filter((x) => x.lean > 0).reduce((s, x) => s + x.state.ev, 0);
  const rightEv = segs.filter((x) => x.lean < 0).reduce((s, x) => s + x.state.ev, 0);
  const linePct = Math.min(100, (threshold / total) * 100);

  // The state the majority line runs through: the tipping point.
  let acc = 0;
  let tipping: string | null = null;
  for (const x of segs) {
    acc += x.state.ev;
    if (acc >= threshold) {
      tipping = x.state.id;
      break;
    }
  }

  return (
    <div style={{ padding: "8px 20px 10px", borderBottom: `1px solid ${BLEND.hairline}` }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 5,
          fontFamily: FONT.mono,
          fontSize: 11,
        }}
      >
        <span style={{ color: left.color, fontWeight: 600 }}>
          {left.name} {leftEv}
        </span>
        <span style={{ color: BLEND.muted, letterSpacing: ".08em" }}>
          {threshold} TO WIN
          {tipping ? ` / TIPPING POINT ${tipping}` : ""}
        </span>
        <span style={{ color: right.color, fontWeight: 600 }}>
          {rightEv} {right.name}
        </span>
      </div>
      <div
        role="list"
        aria-label={`States in order from ${left.name} to ${right.name}`}
        style={{ position: "relative", display: "flex", height: 22, gap: 1 }}
      >
        {segs.map(({ state, lean }) => {
          const label =
            lean === 0 && !state.leaderId
              ? `${state.name}, ${state.ev} EV, no projection`
              : `${state.name}, ${state.ev} EV, ${state.leaderName} +${state.margin.toFixed(1)}`;
          const showCode = state.ev / total > 0.018;
          return (
            <button
              key={state.id}
              type="button"
              role="listitem"
              title={label}
              aria-label={label}
              onClick={onSelect ? () => onSelect(state.id) : undefined}
              style={{
                flex: `${state.ev} 0 0`,
                minWidth: 0,
                padding: 0,
                border: "none",
                cursor: onSelect ? "pointer" : "default",
                background: state.fill || FOG_FILL,
                color: state.ink,
                fontFamily: FONT.mono,
                fontSize: 9,
                fontWeight: 700,
                overflow: "hidden",
                outline: state.id === tipping ? `2px solid ${BLEND.ink}` : undefined,
                outlineOffset: -2,
              }}
            >
              {showCode ? state.id : ""}
            </button>
          );
        })}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -4,
            bottom: -4,
            left: `${linePct}%`,
            width: 2,
            marginLeft: -1,
            background: BLEND.ink,
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
