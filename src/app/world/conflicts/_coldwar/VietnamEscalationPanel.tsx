"use client";

import { useEffect } from "react";
import Link from "next/link";
import { VIETNAM_RUNGS, type VietnamEscalationSummary } from "@/lib/crises/vietnamEscalation";
import { syncVietnamDials } from "./vietnamDials";
import { defconColor } from "./defcon";

const mono = "'IBM Plex Mono',monospace";
const serif = "Lora,Georgia,serif";

/**
 * The Vietnam escalation ladder, on the conflicts hub.
 *
 * Two jobs. It shows players where the war sits, what each superpower has
 * committed and what the war is doing to readiness, bloc cohesion, war weariness
 * and defence procurement demand. And on mount it pushes the derived dials into
 * the Cold War console's shared state, so the crisis, detente, proxy-war and
 * home front boards all read the same war rather than their own defaults.
 */
export function VietnamEscalationPanel({ summary }: { summary: VietnamEscalationSummary }) {
  const { dials } = summary;

  useEffect(() => {
    if (summary.level > 0) syncVietnamDials(dials);
  }, [summary.level, dials]);

  if (summary.level <= 0) return null;

  return (
    <div
      style={{
        margin: "0 auto 18px",
        maxWidth: 1340,
        border: "1px solid rgba(220,38,38,.35)",
        background: "rgba(220,38,38,.06)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "9px 16px",
          borderBottom: "1px solid rgba(220,38,38,.28)",
          font: `600 9px ${mono}`,
          letterSpacing: ".18em",
          color: "#d98a8a",
        }}
      >
        ◆ VIETNAM · ESCALATION LADDER · RUNG {summary.level} OF {VIETNAM_RUNGS.length}
      </div>

      <div style={{ padding: "16px 18px", display: "grid", gap: 14 }}>
        <div>
          <h2
            style={{
              margin: 0,
              fontFamily: serif,
              fontWeight: 700,
              fontSize: 22,
              color: "#f3f1ea",
            }}
          >
            {summary.rungLabel}
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5, color: "#9595a4" }}>
            {summary.rungSummary}
          </p>
        </div>

        {/* ladder */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {VIETNAM_RUNGS.map((rung) => {
            const reached = summary.level >= rung.level;
            const current = summary.level === rung.level;
            return (
              <div
                key={rung.key}
                style={{
                  flex: "1 1 130px",
                  minWidth: 120,
                  padding: "8px 10px",
                  borderRadius: 7,
                  border: `1px solid ${current ? "rgba(255,90,60,.55)" : reached ? "rgba(255,120,73,.3)" : "#2a2a3d"}`,
                  background: current
                    ? "rgba(255,90,60,.14)"
                    : reached
                      ? "rgba(255,120,73,.06)"
                      : "transparent",
                }}
              >
                <div
                  style={{
                    font: `600 8px ${mono}`,
                    letterSpacing: ".14em",
                    color: reached ? "#ff9d6b" : "#6b6b7a",
                  }}
                >
                  RUNG {rung.level}
                </div>
                <div style={{ marginTop: 3, fontSize: 12, color: reached ? "#f3f1ea" : "#77778a" }}>
                  {rung.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* dials the war is actually moving */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Dial
            label="READINESS"
            value={`DEFCON ${dials.defcon}`}
            color={defconColor(dials.defcon)}
          />
          <Dial label="WEST COHESION" value={`${dials.cohesionWest}`} color="#3b82f6" />
          <Dial label="EAST COHESION" value={`${dials.cohesionEast}`} color="#dc2626" />
          <Dial label="WAR WEARINESS" value={`${dials.warWeariness}`} color="#eab308" />
          <Dial
            label="PROCUREMENT DEMAND"
            value={`x${dials.procurementMultiplier.toFixed(2)}`}
            color="#d4af37"
          />
          <Dial
            label="DETENTE PENALTY"
            value={`-${dials.detenteGoodwillPenalty}`}
            color="#9595a4"
          />
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "#9595a4" }}>
          <span>
            US committed support:{" "}
            <strong style={{ color: "#3b82f6" }}>{summary.westSupport}</strong>
          </span>
          <span>
            Soviet committed support:{" "}
            <strong style={{ color: "#dc2626" }}>{summary.eastSupport}</strong>
          </span>
          <span>
            Turns at war: <strong style={{ color: "#f3f1ea" }}>{summary.warTurns}</strong>
          </span>
          <Link href="/world/crises" style={{ color: "#d4af37", textDecoration: "none" }}>
            Open the active decision
          </Link>
        </div>
      </div>
    </div>
  );
}

function Dial({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        flex: "1 1 140px",
        minWidth: 130,
        border: "1px solid #2a2a3d",
        borderRadius: 8,
        padding: "9px 12px",
        background: "#14141c",
      }}
    >
      <div style={{ font: `600 8px ${mono}`, letterSpacing: ".14em", color: "#6b6b7a" }}>
        {label}
      </div>
      <div style={{ marginTop: 4, font: `600 16px ${mono}`, color }}>{value}</div>
    </div>
  );
}
