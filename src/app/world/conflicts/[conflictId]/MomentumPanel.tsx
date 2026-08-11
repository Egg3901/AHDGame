import { MIL_COLOR, MIL_FONT } from "../military/theme";

const mono = MIL_FONT.mono;

/** One thing that happened at the front, placed on the turn track. */
export interface MomentumMark {
  turn: number;
  label: string;
  /** Which side the event went for — colours the mark and its label. */
  side: "A" | "B";
  /** Row to sit on, so neighbouring labels do not collide. */
  row: number;
}

export interface MomentumView {
  /** Side B's share of the host, 0–100 — the bar's fill. */
  control: number;
  /** First and last turn of the window drawn. */
  fromTurn: number;
  toTurn: number;
  marks: MomentumMark[];
  tag: string;
  tagColor: "a" | "b" | "neutral";
  note: string;
  sideBLabel: string;
}

/**
 * Where the line stands, and the offensives that moved it.
 *
 * The bar is side B's CURRENT share; the ticks are when things happened. Nothing
 * here reconstructs a history of `control` over time, because none is stored —
 * every mark is an event that has a turn on it (a battle report or a resolved
 * declaration), which is the honest version of the same picture.
 */
export function MomentumPanel({ view }: { view: MomentumView }) {
  const span = Math.max(1, view.toTurn - view.fromTurn);
  const pos = (t: number) =>
    ((Math.min(view.toTurn, Math.max(view.fromTurn, t)) - view.fromTurn) / span) * 100;
  const tagColor =
    view.tagColor === "a"
      ? MIL_COLOR.blue
      : view.tagColor === "b"
        ? MIL_COLOR.red
        : MIL_COLOR.textMuted;
  const rows = Math.max(1, ...view.marks.map((m) => m.row + 1));

  return (
    <div
      style={{
        border: `1px solid ${MIL_COLOR.border}`,
        borderRadius: 12,
        background: MIL_COLOR.panel,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div
          style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
        >
          MOMENTUM
        </div>
        <div style={{ font: `600 10px ${mono}`, color: tagColor }}>{view.tag}</div>
      </div>

      <div style={{ position: "relative", paddingTop: 16, paddingBottom: 22 }}>
        <div
          style={{
            position: "relative",
            height: 34,
            borderRadius: 6,
            background: MIL_COLOR.inset,
            border: `1px solid ${MIL_COLOR.borderSoft}`,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              width: `${Math.max(0, Math.min(100, view.control))}%`,
              background: "linear-gradient(90deg,rgba(220,38,38,.18),rgba(220,38,38,.42))",
            }}
          />
          {view.marks.map((m) => {
            const color = m.side === "A" ? MIL_COLOR.blue : MIL_COLOR.red;
            return (
              <div
                key={`${m.turn}-${m.label}`}
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${pos(m.turn)}%`,
                  width: 2,
                  background: color,
                  boxShadow: `0 0 8px ${color}`,
                }}
              />
            );
          })}
          {/* Now. The track always ends at the present turn, so the eye reads
              left-to-right into the situation the rest of the page describes. */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              right: 0,
              width: 3,
              background: MIL_COLOR.textStrong,
            }}
          />
        </div>

        <div style={{ position: "relative", height: 13 * rows + 5, marginTop: 6 }}>
          {view.marks.map((m) => (
            <span
              key={`${m.turn}-${m.label}-l`}
              style={{
                position: "absolute",
                top: m.row * 13,
                left: `${pos(m.turn)}%`,
                transform: "translateX(-50%)",
                font: `600 9.5px ${mono}`,
                color: m.side === "A" ? "#9cc0f5" : MIL_COLOR.amber,
                whiteSpace: "nowrap",
              }}
            >
              {m.label}
            </span>
          ))}
          <span
            style={{
              position: "absolute",
              right: 0,
              font: `600 9.5px ${mono}`,
              color: MIL_COLOR.textStrong,
            }}
          >
            NOW · T{view.toTurn}
          </span>
        </div>

        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "space-between",
            font: `500 9.5px ${mono}`,
            color: MIL_COLOR.textFaint,
          }}
        >
          <span>T{view.fromTurn}</span>
          <span>{view.sideBLabel} share of the host</span>
        </div>
      </div>

      <div
        style={{
          font: `500 10px ${mono}`,
          color: MIL_COLOR.textMuted,
          lineHeight: 1.6,
          marginTop: 11,
        }}
      >
        {view.note}
      </div>
    </div>
  );
}
