import { BLEND, FONT } from "@/components/blend/tokens";
import type { ElectionDetail } from "../components/ElectionDetailTypes";

export function DemocraticHealthBlock({
  data,
}: {
  data: NonNullable<ElectionDetail["democraticHealth"]>;
}) {
  const value = Math.max(0, Math.min(100, data.value));
  const color = value < 40 ? BLEND.negative : value < 60 ? BLEND.caution : BLEND.positive;
  const party = data.rulingPartyName ?? "the ruling party";
  return (
    <>
      <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 9 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 30, fontWeight: 500, color }}>
          {value.toFixed(1)}
        </span>
        <span style={{ fontFamily: FONT.serif, fontSize: 14, color: BLEND.muted }}>
          / 100 · {data.label}
        </span>
      </div>
      <p
        style={{
          margin: "9px 0 0",
          fontFamily: FONT.serif,
          fontSize: 13.5,
          lineHeight: 1.5,
          color: BLEND.muted,
        }}
      >
        Below 60, institutional strain weighs on {party}. The sitting President carries the larger
        personal drag when running.
      </p>
      <div
        style={{
          marginTop: 12,
          height: 4,
          background: BLEND.track,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <i style={{ display: "block", height: "100%", width: `${value}%`, background: color }} />
        <i
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "60%",
            borderLeft: `1px dashed ${BLEND.mutedDim}`,
          }}
        />
      </div>
      <div style={{ marginTop: 10, display: "grid", gap: 7 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontFamily: FONT.serif, fontSize: 13.5 }}>Ruling party drag</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 12, color: BLEND.negative }}>
            -{Math.max(0, data.partyPenaltyPct).toFixed(1)}%
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontFamily: FONT.serif, fontSize: 13.5 }}>Sitting President drag</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 12, color: BLEND.negative }}>
            -{Math.max(0, data.currentRulerPenaltyPct).toFixed(1)}%
          </span>
        </div>
      </div>
      {!data.currentRulerInRace ? (
        <p
          style={{
            margin: "9px 0 0",
            fontFamily: FONT.serif,
            fontSize: 12.5,
            color: BLEND.mutedDim,
          }}
        >
          The sitting President is not in this race, so the larger personal drag is inactive.
        </p>
      ) : null}
      {data.currentRulerReliefPct > 0 ? (
        <p
          style={{
            margin: "9px 0 0",
            fontFamily: FONT.serif,
            fontSize: 12.5,
            color: BLEND.mutedDim,
          }}
        >
          Temporary constitutional relief reduces the extra presidential drag by{" "}
          {data.currentRulerReliefPct.toFixed(0)}%.
        </p>
      ) : null}
      <p
        style={{
          margin: "9px 0 0",
          fontFamily: FONT.mono,
          fontSize: 9.5,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: BLEND.mutedDim,
        }}
      >
        Read on turn {data.recordedTurn}
      </p>
    </>
  );
}
