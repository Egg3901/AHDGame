"use client";

import { BLEND, FONT } from "@/components/blend/tokens";
import type { CampaignBlendVM, EndorsementFilter, LedgerTab } from "./campaignBlendViewModel";

export interface BlendLedgerProps {
  ledger: CampaignBlendVM["ledger"];
  onPrev: () => void;
  onNext: () => void;
  onTab: (tab: LedgerTab) => void;
  onFilter: (filter: EndorsementFilter) => void;
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

function tabStyle(active: boolean): React.CSSProperties {
  return {
    border: "none",
    borderBottom: `2px solid ${active ? BLEND.ink : "transparent"}`,
    background: "transparent",
    padding: "6px 2px",
    font: "inherit",
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    fontWeight: 600,
    color: active ? BLEND.ink : BLEND.mutedDim,
    cursor: "pointer",
  };
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? BLEND.hairlineStrong : "rgba(42,42,61,.5)"}`,
    borderRadius: 999,
    background: active ? "rgba(42,42,61,.35)" : "transparent",
    padding: "3px 10px",
    font: "inherit",
    fontFamily: FONT.mono,
    fontSize: 10.5,
    color: active ? BLEND.ink : BLEND.mutedDim,
    cursor: "pointer",
  };
}

const FILTERS: { key: EndorsementFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "player", label: "Players" },
  { key: "npp", label: "Politicians" },
];

/**
 * The Blend ledger: what the campaign bought, and who is backing it.
 *
 * Two tabs over one pager. The view model decides which list is paged and
 * reports that list's range, so this component never has to know which tab the
 * numbers belong to.
 */
export function BlendLedger({
  ledger,
  onPrev,
  onNext,
  onTab,
  onFilter,
  variant = "desktop",
}: BlendLedgerProps) {
  const mobile = variant === "mobile";
  const endorsing = ledger.tab === "endorsements";
  const empty = endorsing ? ledger.endorsementRows.length === 0 : ledger.rows.length === 0;

  return (
    <section style={{ padding: mobile ? "18px 16px" : "24px 26px" }}>
      <h2
        style={{
          margin: mobile ? "0 0 8px" : "0 0 10px",
          fontFamily: FONT.serif,
          fontSize: mobile ? 20 : 23,
          fontWeight: 600,
        }}
      >
        The ledger
      </h2>

      <div
        role="tablist"
        aria-label="Ledger sections"
        style={{
          display: "flex",
          gap: 18,
          borderBottom: "1px solid rgba(42,42,61,.6)",
          marginBottom: endorsing ? 10 : 14,
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={!endorsing}
          onClick={() => onTab("activity")}
          style={tabStyle(!endorsing)}
        >
          Activity
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={endorsing}
          onClick={() => onTab("endorsements")}
          style={tabStyle(endorsing)}
        >
          Endorsements
        </button>
      </div>

      {endorsing ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={ledger.filter === f.key}
              onClick={() => onFilter(f.key)}
              style={chipStyle(ledger.filter === f.key)}
            >
              {f.label} {ledger.filterCounts[f.key]}
            </button>
          ))}
        </div>
      ) : null}

      {empty ? (
        <p
          style={{
            margin: 0,
            fontFamily: FONT.serif,
            fontStyle: "italic",
            fontSize: 14,
            color: BLEND.mutedDim,
          }}
        >
          {ledger.emptyText}
        </p>
      ) : null}

      {endorsing
        ? ledger.endorsementRows.map((r, i) =>
            mobile ? (
              <div
                key={`${r.kind}-${r.name}-${i}`}
                style={{ padding: "11px 0", borderBottom: "1px solid rgba(42,42,61,.6)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontFamily: FONT.serif, fontSize: 14.5 }}>{r.name}</span>
                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 12,
                      color: BLEND.muted,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.sinceText}
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
                  {r.kindLabel}
                </div>
              </div>
            ) : (
              <div
                key={`${r.kind}-${r.name}-${i}`}
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
                  {r.kindLabel}
                </span>
                <span style={{ fontFamily: FONT.serif, fontSize: 15 }}>{r.name}</span>
                <span
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: 12.5,
                    color: BLEND.muted,
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.sinceText}
                </span>
              </div>
            )
          )
        : ledger.rows.map((r, i) =>
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
