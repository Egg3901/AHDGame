"use client";

import { MIL_COLOR, MIL_FONT } from "../../military/theme";

const mono = MIL_FONT.mono;

/**
 * Both directions of the engagement at this front, in the same visual language as the
 * territory meter above it.
 *
 * The two rows are SEPARATE engagements, not a partition of one quantity: the defender
 * holds terrain whichever way the attack runs, so with comparable forces both sides
 * can project themselves under 50%. Each row is therefore labelled by who is
 * attacking, and neither is ever derived from the other.
 */
export function BattleOddsBar({
  oddsPct,
  enemyOddsPct,
  target,
  unopposed,
  ownSpectrum = "west",
}: {
  oddsPct: number;
  enemyOddsPct: number;
  target: string;
  unopposed: boolean;
  ownSpectrum?: "west" | "east" | "neutral";
}) {
  const ownColor =
    ownSpectrum === "east" ? "#dc2626" : ownSpectrum === "neutral" ? "#d4af37" : MIL_COLOR.blue;
  const opposingColor =
    ownSpectrum === "east"
      ? MIL_COLOR.blue
      : ownSpectrum === "neutral"
        ? MIL_COLOR.textMuted
        : "#dc2626";
  const rows: { label: string; pct: number; color: string }[] = [
    { label: "You attack", pct: oddsPct, color: ownColor },
  ];
  // An enemy with no force at this front has nothing to attack with.
  if (!unopposed) {
    rows.push({ label: "They attack", pct: enemyOddsPct, color: opposingColor });
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          font: `600 9px ${mono}`,
          letterSpacing: ".14em",
          color: MIL_COLOR.textFaint,
          marginBottom: 6,
        }}
      >
        BATTLE · VS {target.toUpperCase()}
      </div>

      {rows.map((r) => (
        <div
          key={r.label}
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}
        >
          <span style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textMuted, width: 78 }}>
            {r.label}
          </span>
          <span
            style={{
              font: `600 11px ${mono}`,
              color: r.color,
              width: 40,
              textAlign: "right",
            }}
          >
            {/* The value crosses an untyped JSON boundary, so a missing field must
                read as unavailable rather than rendering "undefined%". */}
            {Number.isFinite(r.pct) ? `${r.pct}%` : "—"}
          </span>
          <div
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              overflow: "hidden",
              background: MIL_COLOR.panelAlt,
              border: `1px solid ${MIL_COLOR.borderSoft}`,
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(100, r.pct))}%`,
                height: "100%",
                background: r.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
