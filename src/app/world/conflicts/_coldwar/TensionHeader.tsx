"use client";

import type { TensionBand } from "@/lib/coldwar/tension";
import { defconColor } from "./defcon";
import { fmtN } from "./orgForces";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

/** Band palette: the section's green-to-red ladder, gold in the middle. */
const BAND_COLOR: Record<TensionBand, string> = {
  DETENTE: "#86d978",
  CALM: "#d4af37",
  ELEVATED: "#ff7849",
  CRISIS: "#ff5a3c",
  BRINK: "#dc2626",
};

const EVENTS_SHOWN = 6;

export interface TensionEventView {
  turn: number;
  label: string;
  delta: number;
}

export interface NuclearPowerView {
  countryId: string;
  flag: string;
  name: string;
  warheads: number;
  /** Best proven device tier, null for a programme still pre-test. */
  bestDevice: string | null;
}

/**
 * The hub's headline: one global tension reading with its band, the DEFCON it
 * implies, the recent developments that moved it, and who holds the bomb.
 * Display only; everything arrives computed from the server page.
 */
export function TensionHeader({
  tension,
  band,
  defcon,
  events,
  powers,
}: {
  tension: number;
  band: TensionBand;
  defcon: number;
  events: TensionEventView[];
  powers: NuclearPowerView[];
}) {
  const color = BAND_COLOR[band];
  const recent = events.slice(0, EVENTS_SHOWN);

  return (
    <div
      style={{
        margin: "0 auto 18px",
        maxWidth: 1340,
        border: "1px solid #2a2a3d",
        background: "rgba(17,17,26,.55)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "9px 16px",
          borderBottom: "1px solid #2a2a3d",
          font: `600 9px ${mono}`,
          letterSpacing: ".18em",
          color: "#a9863a",
        }}
      >
        ◆ CONFLICTS & COLD WAR · GLOBAL TENSION INDEX
      </div>

      <div style={{ padding: "16px 18px", display: "flex", gap: 22, flexWrap: "wrap" }}>
        {/* the gauge */}
        <div style={{ flex: "1 1 340px", minWidth: 280 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              style={{
                fontFamily: serif,
                fontWeight: 700,
                fontSize: 44,
                lineHeight: 1,
                color,
              }}
            >
              {Math.round(tension)}
            </span>
            <span style={{ font: `600 13px ${mono}`, letterSpacing: ".2em", color }}>{band}</span>
            <span
              style={{
                marginLeft: "auto",
                font: `600 12px ${mono}`,
                letterSpacing: ".14em",
                color: defconColor(defcon),
              }}
            >
              DEFCON {defcon}
            </span>
          </div>
          <div
            style={{
              marginTop: 12,
              height: 8,
              borderRadius: 4,
              background: "#1a1a26",
              border: "1px solid #2a2a3d",
              overflow: "hidden",
            }}
          >
            <div
              data-tension-gauge
              style={{
                width: `${Math.max(0, Math.min(100, tension))}%`,
                height: "100%",
                background: color,
                opacity: 0.85,
              }}
            />
          </div>
          <div
            style={{
              marginTop: 5,
              display: "flex",
              justifyContent: "space-between",
              font: `500 8px ${mono}`,
              letterSpacing: ".14em",
              color: "#6b6b7a",
            }}
          >
            <span>0 · DETENTE</span>
            <span>100 · BRINK</span>
          </div>

          {/* who holds the bomb */}
          {powers.length > 0 && (
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {powers.map((p) => (
                <div
                  key={p.countryId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "6px 10px",
                    borderRadius: 7,
                    border: "1px solid #2a2a3d",
                    background: "rgba(255,120,73,.05)",
                  }}
                >
                  <span style={{ fontSize: 14 }}>{p.flag}</span>
                  <span style={{ fontSize: 12, color: "#e8e8ee" }}>{p.name}</span>
                  <span style={{ font: `600 11px ${mono}`, color: "#ff9d7a" }}>
                    {fmtN(p.warheads)}
                  </span>
                  <span
                    style={{ font: `500 9px ${mono}`, letterSpacing: ".08em", color: "#9595a4" }}
                  >
                    {p.bestDevice ? p.bestDevice.toUpperCase() : "PRE-TEST"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* recent developments */}
        <div style={{ flex: "1 1 300px", minWidth: 260 }}>
          <div
            style={{
              font: `600 9px ${mono}`,
              letterSpacing: ".18em",
              color: "#6f6a52",
              marginBottom: 8,
            }}
          >
            RECENT DEVELOPMENTS
          </div>
          {recent.length === 0 ? (
            <div style={{ fontSize: 12, color: "#77778a" }}>
              No developments on record. The wire is quiet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {recent.map((e, i) => (
                <div
                  key={`${e.turn}-${i}`}
                  style={{ display: "flex", alignItems: "baseline", gap: 10 }}
                >
                  <span
                    style={{
                      font: `600 9px ${mono}`,
                      letterSpacing: ".1em",
                      color: "#6b6b7a",
                      width: 42,
                      flexShrink: 0,
                    }}
                  >
                    T{e.turn}
                  </span>
                  <span style={{ fontSize: 12, color: "#c9c9d4", flex: 1, minWidth: 0 }}>
                    {e.label}
                  </span>
                  <span
                    style={{
                      font: `600 11px ${mono}`,
                      color: e.delta > 0 ? "#ff7849" : e.delta < 0 ? "#86d978" : "#6b6b7a",
                    }}
                  >
                    {e.delta > 0 ? `+${e.delta}` : `${e.delta}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
