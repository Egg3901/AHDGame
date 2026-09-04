"use client";

import { BLEND, FONT } from "@/components/blend/tokens";
import type { CampaignBlendVM } from "./campaignBlendViewModel";

export interface BlendLedgerProps {
  ledger: CampaignBlendVM["ledger"];
  onPrev: () => void;
  onNext: () => void;
  variant?: "desktop" | "mobile";
}

function pagerButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    border: `1px solid ${enabled ? BLEND.hairlineStrong : "rgba(42,42,61,.5)"}`,
    borderRadius: 6,
    background: "transparent",
    padding: "5px 11px",
    font: "inherit",
    fontSize: 11.5,
    fontWeight: 600,
    color: enabled ? BLEND.ink : BLEND.mutedDimmer,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}

/** The Blend activity ledger: what was bought, when, and at what cost. */
export function BlendLedger({ ledger, onPrev, onNext, variant = "desktop" }: BlendLedgerProps) {
  const mobile = variant === "mobile";

  return (
    <section style={{ padding: mobile ? "18px 16px" : "24px 26px" }}>
      <h2
        style={{
          margin: mobile ? "0 0 10px" : "0 0 14px",
          fontFamily: FONT.serif,
          fontSize: mobile ? 20 : 23,
          fontWeight: 600,
        }}
      >
        The ledger
      </h2>

      {ledger.rows.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontFamily: FONT.serif,
            fontStyle: "italic",
            fontSize: 14,
            color: BLEND.mutedDim,
          }}
        >
          Nothing has been bought yet.
        </p>
      ) : null}

      {ledger.rows.map((r, i) =>
        mobile ? (
          <div
            key={`${r.turnTag}-${i}`}
            style={{ padding: "11px 0", borderBottom: "1px solid rgba(42,42,61,.6)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontFamily: FONT.serif, fontSize: 14.5 }}>{r.label}</span>
              <span
                style={{
                  fontFamily: FONT.mono,
                  fontSize: 12,
                  color: r.demoted ? BLEND.caution : BLEND.muted,
                  whiteSpace: "nowrap",
                }}
              >
                {r.cost}
              </span>
            </div>
            <div
              style={{
                marginTop: 3,
                fontFamily: FONT.mono,
                fontSize: 10,
                color: BLEND.mutedDimmer,
              }}
            >
              {r.turnTag}
            </div>
            {r.reason ? (
              <div
                style={{
                  marginTop: 3,
                  fontFamily: FONT.serif,
                  fontStyle: "italic",
                  fontSize: 12,
                  color: BLEND.caution,
                }}
              >
                {r.reason}
              </div>
            ) : null}
          </div>
        ) : (
          <div
            key={`${r.turnTag}-${i}`}
            style={{
              display: "grid",
              gridTemplateColumns: "86px minmax(0, 1fr) auto",
              gap: 16,
              alignItems: "baseline",
              padding: "11px 0",
              borderBottom: "1px solid rgba(42,42,61,.6)",
            }}
          >
            <span style={{ fontFamily: FONT.mono, fontSize: 10.5, color: BLEND.mutedDimmer }}>
              {r.turnTag}
            </span>
            <span style={{ fontFamily: FONT.serif, fontSize: 15 }}>
              {r.label}
              {r.reason ? (
                <span
                  style={{
                    display: "block",
                    marginTop: 2,
                    fontStyle: "italic",
                    fontSize: 13,
                    color: BLEND.caution,
                  }}
                >
                  {r.reason}
                </span>
              ) : null}
            </span>
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 12.5,
                color: r.demoted ? BLEND.caution : BLEND.muted,
                whiteSpace: "nowrap",
              }}
            >
              {r.cost}
            </span>
          </div>
        )
      )}

      {ledger.hasPager ? (
        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ fontFamily: FONT.mono, fontSize: 10.5, color: BLEND.mutedDim }}>
            {ledger.rangeText}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 10.5, color: BLEND.mutedDim }}>
              {ledger.pageText}
            </span>
            <button
              type="button"
              disabled={!ledger.canPrev}
              onClick={onPrev}
              style={pagerButtonStyle(ledger.canPrev)}
            >
              PREV
            </button>
            <button
              type="button"
              disabled={!ledger.canNext}
              onClick={onNext}
              style={pagerButtonStyle(ledger.canNext)}
            >
              NEXT
            </button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
