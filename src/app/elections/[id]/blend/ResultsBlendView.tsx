"use client";

import { useMemo, useState } from "react";
import { BLEND, BLEND_CONTAINER, FONT, BLEND_LABEL } from "@/components/blend/tokens";
import { BlendSection } from "@/components/blend/BlendShell";
import { BlendChipRail } from "@/components/blend/BlendRail";
import type { ElectionDetail } from "../components/ElectionDetailTypes";
import { PresidentialStage, presidentialTitle } from "./PresidentialStage";
import { PresidentialMap } from "./presMap/PresidentialMap";
import { buildPresMapModel, presMapModelFromTiles } from "./presMap/presMapModel";
import { BlendVitals } from "@/components/blend/BlendVitals";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import {
  buildResultsBlendViewModel,
  type ResultsBlendVM,
  type ResultsRail,
  type ResultsRoute,
  type StateSortKey,
} from "./resultsBlendViewModel";
import { ContingentHouseVotePanel } from "../components/ContingentHouseVotePanel";

export interface ResultsBlendViewProps {
  data: ElectionResultsResponse;
  route: ResultsRoute;
  /** The race payload, for the national map. Without it the stage shows the tile board. */
  election?: ElectionDetail;
  /** Desktop stage headline; defaults to "The <year> Presidential Election". */
  stageTitle?: string;
  /** Previous / next cycle links for the top of the stage's left rail. */
  stageNav?: React.ReactNode;
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

/**
 * The final standing of every ticket: electoral votes, share and raw votes.
 *
 * Rendered without a heading so each layout supplies its own. It appears in
 * both trees because the desktop rail is `hidden lg:block`, and a rail-only
 * version meant the actual result of the election was unreadable on a phone.
 */
function TicketRows({ vm }: { vm: ResultsBlendVM }) {
  return (
    <>
      {vm.tickets.map((c) => (
        <div key={c.id} style={{ padding: "12px 0", borderBottom: "1px solid rgba(34,34,47,.7)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i style={{ width: 12, height: 12, display: "block", background: c.color }} />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: FONT.sans,
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
    </>
  );
}

/** The states that decided it, tightest first. */
function ClosestRows({ vm }: { vm: ResultsBlendVM }) {
  if (vm.closest.length === 0) return null;
  return (
    <>
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
          <span style={{ fontFamily: FONT.sans, fontSize: 14 }}>{s.name}</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 11, color: s.color }}>{s.margin}</span>
        </div>
      ))}
    </>
  );
}

/** The Blend results screen: serves the concluded page and the live dashboard. */
export function ResultsBlendView({
  data,
  route,
  election,
  stageTitle = presidentialTitle(data.election.electionYear),
  stageNav,
}: ResultsBlendViewProps) {
  const [rail, setRail] = useState<ResultsRail>("overview");
  const [sortBy, setSortBy] = useState<StateSortKey>("ev");
  const [sortDesc, setSortDesc] = useState(true);

  const vm = useMemo(
    () => buildResultsBlendViewModel({ data, route, rail, sortBy, sortDesc }),
    [data, route, rail, sortBy, sortDesc]
  );

  // The full model (shares, trend, county drill-down) where the race payload
  // has a per-state tally; the results tiles fill any state it skips, such as
  // every state of a single-ticket race.
  const mapModel = useMemo(() => {
    const base = presMapModelFromTiles(vm.tiles);
    if (!election) return base;
    const full = buildPresMapModel(election);
    return { ...full, states: { ...base.states, ...full.states } };
  }, [election, vm.tiles]);

  // Repeat click on the active column flips direction, matching ResultsTable.
  const sort = (col: StateSortKey) => {
    if (sortBy === col) setSortDesc((d) => !d);
    else {
      setSortBy(col);
      setSortDesc(true);
    }
  };

  const headStyle = (active: boolean, right = false): React.CSSProperties => ({
    ...BLEND_LABEL,
    cursor: "pointer",
    textAlign: right ? "right" : "left",
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
          <span style={{ fontFamily: FONT.sans, fontSize: 16, fontWeight: 600 }}>{s.name}</span>
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
              fontFamily: FONT.sans,
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

  return (
    <>
      {/* One instance above both layouts; the panel renders only for a deadlocked House. */}
      {data.summary.contingentHouseVote ? (
        <div style={{ background: BLEND.page }}>
          <div className={BLEND_CONTAINER}>
            <ContingentHouseVotePanel
              electionId={data.election.id}
              colorMap={new Map(data.candidates.map((c) => [c.id, c.partyColor]))}
            />
          </div>
        </div>
      ) : null}
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
              fontFamily: FONT.sans,
              fontSize: 10,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: BLEND.muted,
            }}
          >
            <span>{route === "concluded" ? "Final edition" : "Live results"}</span>
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
              fontFamily: FONT.sans,
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
              fontFamily: FONT.sans,
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
                  fontFamily: FONT.sans,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                {route === "concluded" ? "The final map" : "The board"}
              </h2>
              <TileBoard vm={vm} columns={6} />
            </div>
          ) : null}

          {/* The tickets and the closest states lived only in the desktop rail,
              which is `hidden lg:block`. On a phone that left the board and a
              winner line with no per-ticket result at all. */}
          <div style={{ marginBottom: 22 }}>
            <h2 style={{ margin: "0 0 8px", fontFamily: FONT.sans, fontSize: 20, fontWeight: 600 }}>
              {route === "concluded" ? "The final tickets" : "The tickets"}
            </h2>
            <TicketRows vm={vm} />
          </div>

          {vm.closest.length > 0 ? (
            <div style={{ marginBottom: 22 }}>
              <h2
                style={{ margin: "0 0 8px", fontFamily: FONT.sans, fontSize: 20, fontWeight: 600 }}
              >
                Closest states
              </h2>
              <ClosestRows vm={vm} />
            </div>
          ) : null}

          {vm.showStates ? (
            <div>
              <h2
                style={{ margin: "0 0 8px", fontFamily: FONT.sans, fontSize: 20, fontWeight: 600 }}
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
                    <span style={{ fontFamily: FONT.sans, fontSize: 15, fontWeight: 600 }}>
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

      {/* Desktop: the full-screen map stage, then the state-by-state table. */}
      <div className="hidden lg:block">
        <PresidentialStage
          title={stageTitle}
          kicker={
            <>
              {vm.routeChip}
              <span style={{ marginLeft: 12, color: BLEND.positive }}>{vm.certifiedText}</span>
            </>
          }
          deck={vm.winnerName ? vm.winnerLine : undefined}
          nav={stageNav}
          left={
            <>
              <div style={{ ...BLEND_LABEL, color: BLEND.gold }}>{vm.eyebrow}</div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 30,
                  lineHeight: 1.05,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                }}
              >
                {vm.winnerName ?? "Counting"}
              </div>
              <div style={{ marginTop: 18 }}>
                <EvBar vm={vm} height={28} />
              </div>
              <div style={{ marginTop: 22 }}>
                <div style={BLEND_LABEL}>{route === "concluded" ? "Final tickets" : "Tickets"}</div>
                <TicketRows vm={vm} />
              </div>
              {vm.closest.length > 0 ? (
                <div
                  style={{
                    marginTop: 20,
                    paddingTop: 18,
                    borderTop: `1px solid ${BLEND.hairline}`,
                  }}
                >
                  <div style={BLEND_LABEL}>Closest states</div>
                  <ClosestRows vm={vm} />
                </div>
              ) : null}
            </>
          }
          map={
            <PresidentialMap
              variant="stage"
              model={mapModel}
              electionId={data.election.id}
              countryId={data.election.countryId}
              turn={null}
            />
          }
          squares={<TileBoard vm={vm} columns={11} />}
        />

        <div className={BLEND_CONTAINER} style={{ background: BLEND.page }}>
          <BlendSection title={route === "concluded" ? "State by state" : "Returns"} ruled={false}>
            {stateRows}
          </BlendSection>
        </div>
      </div>
    </>
  );
}
