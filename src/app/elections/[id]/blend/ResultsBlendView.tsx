"use client";

import { useMemo, useState } from "react";
import { BLEND, FONT } from "@/components/blend/tokens";
import { BlendShell, BlendSection } from "@/components/blend/BlendShell";
import { BlendRail, BlendChipRail } from "@/components/blend/BlendRail";
import { BlendVitals } from "@/components/blend/BlendVitals";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import {
  buildResultsBlendViewModel,
  type ResultsBlendVM,
  type ResultsRail,
  type ResultsRoute,
  type StateSortKey,
} from "./resultsBlendViewModel";

export interface ResultsBlendViewProps {
  data: ElectionResultsResponse;
  route: ResultsRoute;
}

function EvBar({ vm, height }: { vm: ResultsBlendVM; height: number }) {
  return (
    <>
      <div style={{ position: "relative", height, display: "flex", background: BLEND.track }}>
        {vm.evSegments.map((s) => (
          <div
            key={s.id}
            style={{
              width: `${s.widthPct.toFixed(2)}%`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              background: s.color,
              color: "#fff",
              fontFamily: FONT.mono,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {s.label}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div
          style={{
            position: "absolute",
            top: -5,
            bottom: -5,
            left: `${vm.thresholdPct.toFixed(2)}%`,
            width: 1,
            background: BLEND.ink,
          }}
        />
      </div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: FONT.mono,
          fontSize: 10,
          letterSpacing: ".1em",
          color: BLEND.mutedDimmer,
        }}
      >
        <span>0</span>
        <span>{vm.threshold} TO WIN</span>
        <span>{vm.totalEv}</span>
      </div>
    </>
  );
}

function TileBoard({ vm, columns }: { vm: ResultsBlendVM; columns: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 4 }}>
      {vm.tiles.map((t) => (
        <div
          key={t.stateId}
          title={t.title}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            aspectRatio: "1",
            color: t.ink,
            background: t.background,
          }}
        >
          <span style={{ fontFamily: FONT.mono, fontSize: 10.5, fontWeight: 700 }}>
            {t.stateId}
          </span>
          <span style={{ fontFamily: FONT.mono, fontSize: 9, opacity: 0.75 }}>{t.ev}</span>
        </div>
      ))}
    </div>
  );
}

/** The Blend results screen: serves the concluded page and the live dashboard. */
export function ResultsBlendView({ data, route }: ResultsBlendViewProps) {
  const [rail, setRail] = useState<ResultsRail>("overview");
  const [sortBy, setSortBy] = useState<StateSortKey>("ev");
  const [sortDesc, setSortDesc] = useState(true);

  const vm = useMemo(
    () => buildResultsBlendViewModel({ data, route, rail, sortBy, sortDesc }),
    [data, route, rail, sortBy, sortDesc]
  );

  // Repeat click on the active column flips direction, matching ResultsTable.
  const sort = (col: StateSortKey) => {
    if (sortBy === col) setSortDesc((d) => !d);
    else {
      setSortBy(col);
      setSortDesc(true);
    }
  };

  const headStyle = (active: boolean, right = false): React.CSSProperties => ({
    cursor: "pointer",
    textAlign: right ? "right" : "left",
    fontFamily: FONT.mono,
    fontSize: 9.5,
    letterSpacing: ".12em",
    textTransform: "uppercase",
    color: active ? BLEND.ink : BLEND.mutedDimmer,
    background: "none",
    border: 0,
    padding: 0,
  });

  const stateRows = (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 62px 140px 82px 90px",
          gap: 14,
          paddingBottom: 9,
          borderBottom: `1px solid ${BLEND.hairlineStrong}`,
        }}
      >
        <button type="button" onClick={() => sort("state")} style={headStyle(sortBy === "state")}>
          {vm.sortLabels.state}
        </button>
        <button type="button" onClick={() => sort("ev")} style={headStyle(sortBy === "ev", true)}>
          {vm.sortLabels.ev}
        </button>
        <span style={{ ...headStyle(false), cursor: "default" }}>Winner</span>
        <button
          type="button"
          onClick={() => sort("margin")}
          style={headStyle(sortBy === "margin", true)}
        >
          {vm.sortLabels.margin}
        </button>
        <span style={{ ...headStyle(false, true), cursor: "default" }}>Votes</span>
      </div>
      {vm.states.map((s) => (
        <div
          key={s.id}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 62px 140px 82px 90px",
            gap: 14,
            alignItems: "baseline",
            padding: "12px 0",
            borderBottom: "1px solid rgba(42,42,61,.6)",
          }}
        >
          <span style={{ fontFamily: FONT.serif, fontSize: 16, fontWeight: 600 }}>{s.name}</span>
          <span
            style={{ textAlign: "right", fontFamily: FONT.mono, fontSize: 13, color: BLEND.muted }}
          >
            {s.ev} EV
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: FONT.serif,
              fontSize: 13.5,
              color: BLEND.muted,
            }}
          >
            <i style={{ width: 8, height: 8, display: "block", background: s.dot }} />
            {s.winner}
          </span>
          <span
            style={{
              textAlign: "right",
              fontFamily: FONT.mono,
              fontSize: 13,
              color: s.marginColor,
            }}
          >
            {s.winner === "Not reporting" ? "—" : `+${s.marginPct}%`}
          </span>
          <span
            style={{
              textAlign: "right",
              fontFamily: FONT.mono,
              fontSize: 12,
              color: BLEND.mutedDim,
            }}
          >
            {s.votes}
          </span>
        </div>
      ))}
    </>
  );

  const masthead = (
    <header
      style={{
        padding: "24px 26px 20px",
        borderBottom: `1px solid ${BLEND.hairlineStrong}`,
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 20,
          paddingBottom: 12,
          borderBottom: `1px solid ${BLEND.hairline}`,
          textAlign: "left",
        }}
      >
        <div
          style={{
            fontFamily: FONT.serif,
            fontSize: 12,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: BLEND.muted,
          }}
        >
          {route === "concluded" ? "Final Edition" : "Live Results"}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 10.5, color: BLEND.mutedDim }}>
          {vm.headerReadout}
        </div>
      </div>
      <div
        style={{
          marginTop: 20,
          fontFamily: FONT.mono,
          fontSize: 10,
          letterSpacing: ".18em",
          textTransform: "uppercase",
          color: BLEND.gold,
        }}
      >
        {vm.eyebrow}
      </div>
      <h1
        style={{
          margin: "10px 0 0",
          fontFamily: FONT.serif,
          fontSize: 52,
          lineHeight: 1,
          fontWeight: 600,
          letterSpacing: "-0.03em",
        }}
      >
        {vm.winnerName ?? "Counting"}
      </h1>
      <div
        style={{
          marginTop: 11,
          fontFamily: FONT.serif,
          fontStyle: "italic",
          fontSize: 16,
          color: BLEND.muted,
        }}
      >
        {vm.winnerLine}
      </div>
    </header>
  );

  return (
    <>
      {/* Mobile */}
      <div className="lg:hidden" style={{ background: BLEND.page, color: BLEND.ink }}>
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            background: BLEND.rail,
            borderBottom: `1px solid ${BLEND.hairline}`,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              paddingBottom: 9,
              borderBottom: `1px solid ${BLEND.hairline}`,
              fontFamily: FONT.serif,
              fontSize: 10,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: BLEND.muted,
            }}
          >
            <span>{route === "concluded" ? "Final Edition" : "Live Results"}</span>
            <span style={{ fontFamily: FONT.mono, letterSpacing: ".06em" }}>
              {vm.certifiedText}
            </span>
          </div>
          <div
            style={{
              marginTop: 12,
              fontFamily: FONT.mono,
              fontSize: 9.5,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: BLEND.gold,
            }}
          >
            {vm.eyebrow}
          </div>
          <div
            style={{
              marginTop: 7,
              fontFamily: FONT.serif,
              fontSize: 30,
              lineHeight: 1,
              fontWeight: 600,
              letterSpacing: "-0.03em",
            }}
          >
            {vm.winnerName ?? "Counting"}
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: FONT.serif,
              fontStyle: "italic",
              fontSize: 13.5,
              color: BLEND.muted,
            }}
          >
            {vm.winnerLine}
          </div>
          <BlendChipRail
            items={vm.railItems}
            selectedId={rail}
            onSelect={(id) => setRail(id as ResultsRail)}
            fontSize={11}
          />
        </div>

        <BlendVitals cells={vm.vitals} variant="mobile" />

        <div style={{ padding: 16 }}>
          {vm.showCollege ? (
            <div style={{ marginBottom: 22 }}>
              <EvBar vm={vm} height={28} />
              <h2
                style={{
                  margin: "22px 0 12px",
                  fontFamily: FONT.serif,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                {route === "concluded" ? "The final map" : "The board"}
              </h2>
              <TileBoard vm={vm} columns={6} />
            </div>
          ) : null}

          {vm.showStates ? (
            <div>
              <h2
                style={{ margin: "0 0 8px", fontFamily: FONT.serif, fontSize: 20, fontWeight: 600 }}
              >
                {route === "concluded" ? "State by state" : "Returns"}
              </h2>
              {vm.states.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "11px 0",
                    borderBottom: "1px solid rgba(42,42,61,.6)",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <i style={{ width: 8, height: 8, display: "block", background: s.dot }} />
                    <span style={{ fontFamily: FONT.serif, fontSize: 15, fontWeight: 600 }}>
                      {s.name}
                    </span>
                  </span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: s.marginColor }}>
                    {s.winner === "Not reporting" ? "—" : `+${s.marginPct}%`} · {s.ev} EV
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden lg:block">
        <BlendShell
          rightWidth={300}
          left={
            <BlendRail
              eyebrow={vm.routeChip}
              title={`${data.election.countryId} President${data.election.electionYear ? ` ${data.election.electionYear}` : ""}`}
              titleSize={18}
              status={{ text: vm.certifiedText, color: BLEND.positive }}
              items={vm.railItems}
              selectedId={rail}
              onSelect={(id) => setRail(id as ResultsRail)}
            />
          }
          right={
            <aside
              style={{
                borderLeft: `1px solid ${BLEND.hairline}`,
                background: BLEND.rail,
                padding: "20px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 22,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: 9.5,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: BLEND.mutedDimmer,
                  }}
                >
                  {route === "concluded" ? "Final tickets" : "Tickets"}
                </div>
                {vm.tickets.map((c) => (
                  <div
                    key={c.id}
                    style={{ padding: "12px 0", borderBottom: "1px solid rgba(34,34,47,.7)" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <i style={{ width: 12, height: 12, display: "block", background: c.color }} />
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontFamily: FONT.serif,
                          fontSize: 15,
                          fontWeight: 600,
                        }}
                      >
                        {c.name}
                      </span>
                      <span style={{ fontFamily: FONT.mono, fontSize: 15 }}>{c.ev}</span>
                      {c.isWinner ? <span style={{ color: BLEND.gold }}>★</span> : null}
                    </div>
                    <div style={{ marginTop: 7, height: 4, background: BLEND.trackAlt }}>
                      <i
                        style={{
                          display: "block",
                          height: "100%",
                          width: `${c.sharePct}%`,
                          background: c.color,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        marginTop: 5,
                        display: "flex",
                        justifyContent: "space-between",
                        fontFamily: FONT.mono,
                        fontSize: 10.5,
                        color: BLEND.mutedDim,
                      }}
                    >
                      <span>{c.pct}%</span>
                      <span>{c.votes}</span>
                    </div>
                  </div>
                ))}
              </div>

              {vm.closest.length > 0 ? (
                <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                  <div
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 9.5,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: BLEND.mutedDimmer,
                    }}
                  >
                    Closest states
                  </div>
                  {vm.closest.map((s) => (
                    <div
                      key={s.name}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "10px 0",
                        borderBottom: "1px solid rgba(34,34,47,.7)",
                      }}
                    >
                      <span style={{ fontFamily: FONT.serif, fontSize: 14 }}>{s.name}</span>
                      <span style={{ fontFamily: FONT.mono, fontSize: 11, color: s.color }}>
                        {s.margin}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </aside>
          }
        >
          {masthead}
          <BlendVitals cells={vm.vitals} />

          {vm.showCollege ? (
            <BlendSection
              title={route === "concluded" ? "Electoral college, final" : "Electoral college"}
            >
              <EvBar vm={vm} height={34} />
              <div style={{ marginTop: 20 }}>
                <TileBoard vm={vm} columns={11} />
              </div>
            </BlendSection>
          ) : null}

          {vm.showStates ? (
            <BlendSection
              title={route === "concluded" ? "State by state" : "Returns"}
              ruled={false}
            >
              {stateRows}
            </BlendSection>
          ) : null}
        </BlendShell>
      </div>
    </>
  );
}
