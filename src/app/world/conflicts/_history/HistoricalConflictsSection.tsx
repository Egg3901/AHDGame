import Link from "next/link";
import { MIL_COLOR, MIL_FONT } from "../military/theme";
import type { HistoricalConflictRow } from "./historyView";

const mono = MIL_FONT.mono;

/**
 * The wars that have ended, newest first, each linking to its record.
 *
 * The live board drops a war the moment it resolves, and until this section
 * existed nothing else linked to the record it left behind. Server-rendered and
 * era-agnostic: it sits below the Cold War board but carries none of its framing,
 * because a war fought in any preset ends up here.
 *
 * Every figure on a card is public-tier. What the fog still withholds is on the
 * record page, which says when it lifts; the card only repeats the date.
 */
export function HistoricalConflictsSection({ rows }: { rows: HistoricalConflictRow[] }) {
  return (
    <div style={{ padding: "0 26px 26px", fontFamily: MIL_FONT.sans, color: MIL_COLOR.text }}>
      <div
        style={{
          maxWidth: 1340,
          margin: "0 auto",
          background: MIL_COLOR.panel,
          border: `1px solid ${MIL_COLOR.border}`,
          borderRadius: 10,
          boxShadow: "0 18px 50px -14px rgba(0,0,0,.7)",
          padding: "20px 24px 24px",
        }}
      >
        <div
          style={{
            font: `600 10px ${mono}`,
            letterSpacing: ".14em",
            color: MIL_COLOR.textFaint,
            margin: "0 2px 12px",
          }}
        >
          HISTORICAL CONFLICTS · THE RECORD
        </div>
        {rows.length === 0 ? (
          <div
            style={{
              border: `1px dashed ${MIL_COLOR.border}`,
              borderRadius: 12,
              padding: "24px 20px",
              textAlign: "center",
              color: MIL_COLOR.textFaint,
              font: `500 12px ${mono}`,
              lineHeight: 1.6,
            }}
          >
            No war has yet concluded.
          </div>
        ) : (
          <div className="cw-conflict-grid">
            {rows.map((r) => (
              <HistoricalConflictCard key={r.id} row={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoricalConflictCard({ row: r }: { row: HistoricalConflictRow }) {
  // The winner's colour follows the board's side treatment: A reads blue, B red,
  // and a stalemate or an undated legacy outcome takes the neutral grey.
  const outcomeColor =
    r.outcome.side === "A" ? "#9cc0f5" : r.outcome.side === "B" ? "#f0a0a0" : "#cfcfda";
  return (
    <div
      style={{
        border: `1px solid ${MIL_COLOR.border}`,
        background: "#1a1a25",
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ font: "600 14px system-ui", color: MIL_COLOR.textStrong }}>
              {r.name}
            </span>
            <span
              style={{
                font: `500 8.5px ${mono}`,
                letterSpacing: ".06em",
                padding: "2px 7px",
                borderRadius: 5,
                border: `1px solid ${MIL_COLOR.border}`,
                color: "#8a8a9a",
              }}
            >
              {r.type}
            </span>
          </div>
          <div style={{ font: `500 9.5px ${mono}`, color: "#7a7a8c", marginTop: 5 }}>
            {r.region} · {r.years}
          </div>
        </div>
        <span
          style={{
            font: `600 8.5px ${mono}`,
            letterSpacing: ".08em",
            padding: "3px 9px",
            borderRadius: 6,
            border: `1px solid ${outcomeColor}55`,
            background: `${outcomeColor}1a`,
            color: outcomeColor,
            // A long side label ("Provisional Government victory") wraps inside the
            // badge on a narrow card rather than pushing the row past the edge.
            textAlign: "right",
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {r.outcome.label}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <span style={{ flex: 1, textAlign: "right", font: "500 10px system-ui", color: "#9cc0f5" }}>
          {r.sideA}
        </span>
        <span style={{ font: `700 9px ${mono}`, color: MIL_COLOR.textFaint, flexShrink: 0 }}>
          ⚔
        </span>
        <span style={{ flex: 1, font: "500 10px system-ui", color: "#f0a0a0" }}>{r.sideB}</span>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          font: `500 9px ${mono}`,
          color: "#7a7a8c",
          marginTop: 9,
        }}
      >
        <span style={{ color: r.archive.open ? MIL_COLOR.green : MIL_COLOR.amber }}>
          {r.archive.open
            ? "FULL RECORD OPEN"
            : `FOG LIFTS T${r.archive.opensTurn} · ${r.archive.opensYear}`}
        </span>
        <span style={{ color: "#8a8a9a" }}>{r.deaths}</span>
      </div>

      <Link
        href={`/world/conflicts/${r.conflictId}`}
        style={{
          marginTop: 9,
          paddingTop: 9,
          borderTop: `1px solid ${MIL_COLOR.borderSoft}`,
          font: `600 8.5px ${mono}`,
          letterSpacing: ".06em",
          color: "#8a8a9a",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 5,
          textDecoration: "none",
        }}
      >
        OPEN RECORD <span style={{ color: "#cfcfda" }}>▸</span>
      </Link>
    </div>
  );
}
