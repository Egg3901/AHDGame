"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BLEND, BLEND_CONTAINER, FONT, BLEND_LABEL } from "@/components/blend/tokens";
import { BlendSection } from "@/components/blend/BlendShell";
import { BlendTicker } from "@/components/blend/BlendTicker";
import { BlendScopeInline } from "@/components/blend/BlendScope";
import { CarveUpPanel } from "@/components/elections/primary/CarveUpPanel";
import { PrimaryCampaignControls } from "@/components/elections/primary/PrimaryCampaignControls";
import type { PrimaryPartyDetail } from "@/lib/elections/dto/primaryPartyDetail";
import type { ElectionDetail } from "../components/ElectionDetailTypes";
import { PrimaryTileBoard } from "./PrimaryTileBoard";
import { PresidentialStage, presidentialTitle } from "./PresidentialStage";
import { presidentialResultsLive } from "./liveState";
import { StageField, candidateLinks } from "./StageField";
import { PartyLogo } from "@/components/PartyLogo";
import type { CountryId } from "@/lib/constants/countries";
import { PresidentialMap } from "./presMap/PresidentialMap";
import type { PresMapModel, PresMapState } from "./presMap/presMapModel";
import { STATE_NAMES } from "./presMap/usStates";
import { mixToward } from "./presMap/dataViews";
import type { CountySource } from "./presMap/countyStore";
import { MyCampaignStateBlock, useMyCampaign } from "./useMyCampaign";
import { readableInk } from "@/lib/elections/marginTierShade";
import { useBlendGround } from "@/components/blend/useBlendGround";
import {
  buildPrimaryBlendViewModel,
  type PrimaryBlendVM,
  type PrimaryPartyVM,
} from "./primaryBlendViewModel";

export interface PrimaryBlendViewProps {
  election: ElectionDetail;
  wire: string[];
  /** Desktop stage headline; defaults to "The <year> Presidential Election". */
  stageTitle?: string;
  /** Previous / next cycle links for the top of the stage's left rail. */
  stageNav?: React.ReactNode;
  /** A state to open on arrival (`?state=OH`). */
  initialFocus?: string | null;
}

function PartyButton({
  p,
  onSelect,
  countryId,
}: {
  p: PrimaryPartyVM;
  onSelect: () => void;
  countryId: string;
}) {
  return (
    <button
      type="button"
      aria-current={p.selected ? "true" : undefined}
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        padding: "9px 10px",
        border: 0,
        borderRadius: 6,
        font: "inherit",
        cursor: "pointer",
        color: BLEND.ink,
        background: p.selected ? "rgba(220,38,38,.12)" : "transparent",
      }}
    >
      <PartyLogo
        partyId={p.id}
        partyColor={p.color}
        size="h-6 w-6"
        countryId={countryId as CountryId}
        className="shrink-0"
      />
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{ display: "block", fontFamily: FONT.sans, fontSize: 14, fontWeight: 600 }}>
          {p.name}
        </span>
        <span
          style={{
            display: "block",
            fontFamily: FONT.sans,
            fontSize: 12,
            color: BLEND.mutedDim,
          }}
        >
          {p.leader ? `${p.leader} leads` : "No candidates filed"}
        </span>
      </span>
      <span style={{ fontFamily: FONT.mono, fontSize: 10, color: BLEND.mutedDimmer }}>
        {p.filed}
      </span>
    </button>
  );
}

function DelegateRace({ vm, height }: { vm: PrimaryBlendVM; height: number }) {
  const race = vm.delegateRace;
  if (!race) return null;
  return (
    <>
      <div style={{ display: "flex", height, overflow: "hidden", position: "relative" }}>
        {race.segments.map((s) => (
          <div
            key={s.id}
            title={`${s.name}: ${s.label || "under 6%"}`}
            style={{
              width: `${s.widthPct.toFixed(2)}%`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONT.mono,
              fontSize: 10.5,
              fontWeight: 700,
              color: "#14141c",
              overflow: "hidden",
              background: s.color,
            }}
          >
            {s.label}
          </div>
        ))}
        <div style={{ flex: 1, background: BLEND.track }} />
        {/* The clinch marker sits at the real majority, not at the midpoint. */}
        <div
          style={{
            position: "absolute",
            top: -5,
            bottom: -5,
            left: `${race.clinchMarkerPct.toFixed(2)}%`,
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
        <span>{race.clinchText} CLINCH</span>
        <span>{race.totalText}</span>
      </div>
    </>
  );
}

/**
 * The state board and, beneath it, the carve-up of whichever state is chosen.
 *
 * Rendered without a heading of its own so each layout can supply the one it
 * uses, the way {@link DelegateRace} does.
 */
function StateBoard({
  vm,
  columns,
  onSelect,
}: {
  vm: PrimaryBlendVM;
  columns: number;
  onSelect: (stateId: string) => void;
}) {
  if (vm.board.length === 0) return null;
  return (
    <>
      <PrimaryTileBoard
        tiles={vm.board}
        selectedStateId={vm.selectedStateId}
        onSelect={onSelect}
        columns={columns}
      />
      {vm.carveUp ? (
        <div style={{ marginTop: 18 }}>
          <BlendScopeInline>
            <CarveUpPanel
              stateName={vm.carveUp.stateName}
              stateId={vm.carveUp.stateId}
              slices={vm.carveUp.slices}
              detailHref={vm.carveUp.detailHref}
            />
          </BlendScopeInline>
        </div>
      ) : null}
    </>
  );
}

/** The two personal primary actions, in whichever column has room for them. */
function CampaignBlock({
  vm,
  electionId,
  onChanged,
}: {
  vm: PrimaryBlendVM;
  electionId: string;
  onChanged: () => void;
}) {
  if (!vm.campaign) return null;
  return (
    <BlendScopeInline>
      <PrimaryCampaignControls electionId={electionId} {...vm.campaign} onChanged={onChanged} />
    </BlendScopeInline>
  );
}

/**
 * The wave calendar: when each tier votes, and which states are in it.
 *
 * Rendered without a heading so each layout supplies its own, the way
 * {@link StateBoard} does. It appears in both trees: the desktop rail is
 * `hidden lg:block`, so a rail-only calendar left mobile with no way to see the
 * schedule and no state chips to select from.
 */
function CalendarWaves({
  vm,
  onSelect,
}: {
  vm: PrimaryBlendVM;
  onSelect: (stateId: string) => void;
}) {
  if (vm.calendar.length === 0) return null;
  return (
    <>
      {vm.calendar.map((k) => (
        <div key={k.label} style={{ borderBottom: "1px solid rgba(34,34,47,.7)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 0",
            }}
          >
            <span style={{ fontFamily: FONT.sans, fontSize: 14 }}>{k.label}</span>
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 10.5,
                color: k.color,
                whiteSpace: "nowrap",
              }}
            >
              {k.statusText}
            </span>
          </div>
          <WaveStates states={k.states} onSelect={onSelect} />
        </div>
      ))}
    </>
  );
}

/** Chips for one calendar wave, so a wave row can be selected down to a state. */
function WaveStates({
  states,
  onSelect,
}: {
  states: PrimaryBlendVM["calendar"][number]["states"];
  onSelect: (stateId: string) => void;
}) {
  if (states.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingBottom: 10 }}>
      {states.map((s) => (
        <button
          key={s.id}
          type="button"
          title={s.name}
          // The chip reads "IA"; the state's name is what identifies it aloud.
          aria-label={s.name}
          aria-pressed={s.selected}
          onClick={() => onSelect(s.id)}
          style={{
            padding: "3px 7px",
            border: `1px solid ${s.selected ? BLEND.accent : BLEND.chipBorder}`,
            borderRadius: 3,
            cursor: "pointer",
            fontFamily: FONT.mono,
            fontSize: 9.5,
            letterSpacing: ".04em",
            color: s.selected ? BLEND.accentInk : BLEND.mutedDim,
            background: s.selected ? "rgba(220,38,38,.12)" : "transparent",
          }}
        >
          {s.id}
        </button>
      ))}
    </div>
  );
}

/** The Blend primary-election screen (Proposal D). */
export function PrimaryBlendView({
  election,
  wire,
  stageTitle = presidentialTitle(election.electionYear),
  stageNav,
  initialFocus,
}: PrimaryBlendViewProps) {
  const [partyId, setPartyId] = useState<string | null>(
    // Open on the reader's own party where they have a candidate.
    election.byParty.find((p) => p.candidates.some((c) => c.isYou))?.partyId ??
      election.byParty[0]?.partyId ??
      null
  );

  // The per-party board, carve-up and campaign block. Fetched lazily on party
  // selection rather than carried on the 60s election poll: it is a few hundred
  // numbers per party, and most viewers only ever look at one of them.
  const electionId = election.id;
  const key = partyId ? `${electionId}:${partyId}` : null;

  // Both of these are stamped with the party they belong to and then read back
  // through a match, rather than being cleared when the party changes. A
  // previous party's projection therefore cannot render under a new party's
  // heading even for one frame, and there is no window in which a slow response
  // lands against the wrong selection.
  // Bumped when an action lands, so the board and the campaign block reflect it.
  // router.refresh() only re-runs the server render; this detail is fetched
  // here, so without this the panel would still show the state from before the
  // player camped or surged.
  const [reloadCount, setReloadCount] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; detail: PrimaryPartyDetail } | null>(null);
  const [selection, setSelection] = useState<{ key: string; stateId: string } | null>(() =>
    initialFocus && key ? { key, stateId: initialFocus } : null
  );
  const focusRequest = useMemo(
    () => (initialFocus ? { stateId: initialFocus, nonce: 0 } : null),
    [initialFocus]
  );

  const detail = loaded && loaded.key === key ? loaded.detail : null;
  const selectedStateId = selection && selection.key === key ? selection.stateId : null;
  const selectState = (stateId: string) => {
    if (key) setSelection({ key, stateId });
  };
  const clearState = () => setSelection(null);

  useEffect(() => {
    if (!key || !partyId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/elections/${electionId}/primary/${partyId}`);
        if (!res.ok) return;
        const payload = (await res.json()) as PrimaryPartyDetail;
        if (!cancelled) setLoaded({ key, detail: payload });
      } catch {
        // Non-critical, same posture as the wire ticker: the board, carve-up
        // and campaign block stay hidden and the rest of the screen stands.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [electionId, partyId, key, reloadCount]);

  // Primary night: re-read the party's board every minute while a wave is
  // being counted, so returns climb on screen.
  const counting = Boolean(loaded?.detail.night && Object.keys(loaded.detail.night).length > 0);
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => setReloadCount((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [counting]);

  const vm = useMemo(
    () =>
      buildPrimaryBlendViewModel({
        election,
        selectedPartyId: partyId,
        wire,
        detail,
        selectedStateId,
      }),
    [election, partyId, wire, detail, selectedStateId]
  );

  // The reader's own campaign in this race: presence by state on the map, and
  // building it from the state overview.
  const myCandidate = election.allCandidates.find((c) => c.isYou) ?? null;
  const mine = useMyCampaign({
    enabled: Boolean(myCandidate) && election.countryId === "US",
    campaignId: myCandidate?.campaignId ?? null,
    color: myCandidate?.campaignColor ?? myCandidate?.partyColor ?? "#4F8EF7",
  });
  const ground = useBlendGround();
  // The selected party's primary, by county, for the map's county layer.
  const countySource = useMemo<CountySource | undefined>(
    () =>
      partyId
        ? {
            id: `primary:${partyId}:${reloadCount}`,
            url: (stateId: string) =>
              `/api/elections/${electionId}/primary/${partyId}/state/${stateId}/subdivision-results`,
          }
        : undefined,
    [electionId, partyId, reloadCount]
  );
  const primaryMapModel = useMemo(() => primaryMapModelFromBoard(vm, ground), [vm, ground]);

  const campaignLink = vm.campaignHref ? (
    <Link
      href={vm.campaignHref}
      style={{
        marginTop: 16,
        display: "block",
        background: BLEND.accent,
        padding: 11,
        textAlign: "center",
        fontFamily: FONT.mono,
        fontSize: 10.5,
        letterSpacing: ".08em",
        fontWeight: 700,
        color: "#fff",
      }}
    >
      OPEN CAMPAIGN MANAGER
    </Link>
  ) : null;

  /** Shared by the header and every row, so the columns cannot drift apart. */
  const fieldGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr) 150px 108px 96px",
    gap: 16,
    alignItems: "center",
  };

  const fieldRows = (
    <>
      {/* The delegate column used to be a bare number, which reads as a count
          already won. It is a forecast of the final total for most of a
          primary, so it says so. */}
      <div
        style={{
          ...BLEND_LABEL,
          ...fieldGrid,
          padding: "0 0 8px",
          borderBottom: `1px solid ${BLEND.hairlineStrong}`,
        }}
      >
        <span />
        <span>Candidate</span>
        <span>Outlook</span>
        <span>Vote share</span>
        <span style={{ textAlign: "right" }}>Projected del.</span>
      </div>
      {vm.field.map((c) => (
        <div
          key={c.id}
          style={{
            ...fieldGrid,
            padding: "14px 0",
            borderBottom: "1px solid rgba(42,42,61,.6)",
            ...(c.isYou ? { background: "rgba(220,38,38,.04)" } : {}),
          }}
        >
          <span style={{ fontFamily: FONT.mono, fontSize: 12, color: BLEND.mutedDimmer }}>
            {c.rank}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
            <i
              style={{
                width: 34,
                height: 34,
                borderRadius: 99,
                background: BLEND.track,
                display: "block",
                flexShrink: 0,
                borderLeft: `3px solid ${c.color}`,
              }}
            />
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontFamily: FONT.sans,
                  fontSize: 17,
                  fontWeight: 600,
                  color: c.advancing ? BLEND.ink : BLEND.muted,
                }}
              >
                {c.name}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 1,
                  fontFamily: FONT.sans,
                  fontSize: 13,
                  color: BLEND.mutedDim,
                }}
              >
                {c.blurb}
              </span>
            </span>
          </span>
          <span
            style={{
              fontFamily: FONT.sans,
              fontSize: 13,
              fontWeight: 600,
              color: c.advancing ? BLEND.positive : BLEND.mutedDim,
            }}
          >
            {c.statusText}
          </span>
          <span>
            <span style={{ display: "block", height: 5, background: BLEND.hairline }}>
              <i
                style={{
                  display: "block",
                  height: "100%",
                  width: `${c.barPct}%`,
                  background: c.color,
                  opacity: c.advancing ? 1 : 0.5,
                }}
              />
            </span>
            <span
              style={{
                display: "block",
                marginTop: 5,
                fontFamily: FONT.mono,
                fontSize: 12,
                color: BLEND.muted,
              }}
            >
              {c.pct}%
            </span>
          </span>
          <span style={{ textAlign: "right" }}>
            <span style={{ display: "block", fontFamily: FONT.mono, fontSize: 15 }}>
              {c.delegates ?? "—"}
            </span>
            {c.delegatesAwarded ? (
              <span
                style={{
                  display: "block",
                  marginTop: 2,
                  fontFamily: FONT.mono,
                  fontSize: 10.5,
                  color: BLEND.mutedDim,
                }}
              >
                {c.delegatesAwarded} won
              </span>
            ) : null}
          </span>
        </div>
      ))}
    </>
  );

  return (
    <>
      {/* The map stage, then the field below it. */}
      <div>
        <PresidentialStage
          title={stageTitle}
          kicker={
            <>
              Primary season
              <span style={{ marginLeft: 12, color: BLEND.caution }}>{vm.closesText}</span>
            </>
          }
          deck={vm.headline}
          ticker={
            presidentialResultsLive(election) ? (
              <BlendTicker
                tag="RETURNS"
                tagColor={BLEND.caution}
                tagInk="#14141c"
                items={vm.wire}
              />
            ) : null
          }
          nav={stageNav}
          left={
            <>
              <div style={{ ...BLEND_LABEL, paddingBottom: 9 }}>Parties</div>
              <div style={{ margin: "0 -8px" }}>
                {vm.parties.map((p) => (
                  <PartyButton
                    key={p.id}
                    p={p}
                    onSelect={() => setPartyId(p.id)}
                    countryId={election.countryId}
                  />
                ))}
              </div>
              {vm.delegateRace ? (
                <div
                  style={{
                    marginTop: 18,
                    paddingTop: 16,
                    borderTop: `1px solid ${BLEND.hairline}`,
                  }}
                >
                  <div style={BLEND_LABEL}>Projected delegate race</div>
                  <p
                    style={{
                      margin: "6px 0 12px",
                      fontSize: 12.5,
                      lineHeight: 1.45,
                      color: BLEND.muted,
                    }}
                  >
                    {vm.delegateRace.lede}
                  </p>
                  <DelegateRace vm={vm} height={28} />
                </div>
              ) : null}
              <div style={{ marginTop: 18 }}>
                <StageField
                  title="The field"
                  countryId={election.countryId}
                  rows={vm.field.map((f) => {
                    const c = election.allCandidates.find((x) => x.id === f.id);
                    return {
                      id: f.id,
                      name: f.name,
                      ...candidateLinks(c, election.countryId),
                      partyName: c?.partyName ?? "",
                      color: f.color,
                      figure: `${f.pct}%`,
                      sub: f.delegates ? `${f.delegates} del.` : f.statusText,
                      isYou: f.isYou,
                    };
                  })}
                />
              </div>
              {vm.standfirst ? (
                <p
                  style={{
                    margin: "18px 0 0",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    color: BLEND.muted,
                  }}
                >
                  {vm.standfirst}
                </p>
              ) : null}
            </>
          }
          right={
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <div style={BLEND_LABEL}>Your standing</div>

                {vm.you ? (
                  <>
                    <div
                      style={{
                        marginTop: 10,
                        fontFamily: FONT.mono,
                        fontSize: 38,
                        fontWeight: 500,
                        letterSpacing: "-0.03em",
                        color: vm.partyAccent,
                      }}
                    >
                      {vm.you.share}
                    </div>
                    <div
                      style={{
                        marginTop: 3,
                        fontFamily: FONT.sans,
                        fontSize: 15,
                        fontWeight: 600,
                        color: vm.you.statusColor,
                      }}
                    >
                      {vm.you.statusText}
                    </div>
                    <div
                      style={{
                        marginTop: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 9,
                        fontSize: 13,
                      }}
                    >
                      {[
                        { k: "Rank", v: vm.you.rankText, c: undefined },
                        { k: "Lead over next", v: vm.you.lead, c: BLEND.positive },
                        { k: "Delegates", v: vm.you.delegates ?? "—", c: undefined },
                      ].map((r) => (
                        <div key={r.k} style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontFamily: FONT.sans, color: BLEND.muted }}>{r.k}</span>
                          <span style={{ fontFamily: FONT.mono, color: r.c }}>{r.v}</span>
                        </div>
                      ))}
                      {vm.you.toClinch ? (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            paddingTop: 9,
                            borderTop: `1px solid ${BLEND.hairline}`,
                          }}
                        >
                          <span style={{ fontFamily: FONT.sans, color: BLEND.muted }}>
                            To clinch
                          </span>
                          <span style={{ fontFamily: FONT.mono }}>{vm.you.toClinch}</span>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p
                    style={{
                      margin: "10px 0 0",
                      fontFamily: FONT.sans,
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      color: BLEND.muted,
                    }}
                  >
                    {vm.standingNote}
                  </p>
                )}

                {campaignLink}
              </div>

              {vm.calendar.length > 0 ? (
                <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                  <div style={BLEND_LABEL}>Calendar</div>
                  <CalendarWaves vm={vm} onSelect={selectState} />
                </div>
              ) : null}

              {vm.campaign ? (
                <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                  <div style={{ ...BLEND_LABEL, paddingBottom: 10 }}>Your primary campaign</div>
                  <CampaignBlock
                    vm={vm}
                    electionId={electionId}
                    onChanged={() => setReloadCount((n) => n + 1)}
                  />
                </div>
              ) : null}
            </div>
          }
          squares={<StateBoard vm={vm} columns={11} onSelect={selectState} />}
          map={
            <PresidentialMap
              variant="stage"
              // County results need the party's board, which is sign-in only.
              counties={vm.board.length > 0 && election.countryId === "US"}
              countySource={countySource}
              focusRequest={focusRequest}
              presence={mine ? { levels: mine.levels, color: mine.color } : null}
              panelExtra={
                mine
                  ? (stateId) => <MyCampaignStateBlock mine={mine} stateId={stateId} />
                  : undefined
              }
              model={primaryMapModel}
              electionId={electionId}
              countryId={election.countryId}
              turn={election.gameState?.currentTurn ?? null}
              onSelectState={(id) => (id ? selectState(id) : clearState())}
              renderPanel={(state, onClose) => (
                <div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <h3 style={{ flex: 1, margin: 0, fontSize: 21, fontWeight: 600 }}>
                      {state.name}
                    </h3>
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="Close"
                      style={{
                        width: 30,
                        height: 30,
                        cursor: "pointer",
                        color: BLEND.ink,
                        background: "transparent",
                        border: `1px solid ${BLEND.hairlineStrong}`,
                      }}
                    >
                      &times;
                    </button>
                  </div>
                  {vm.carveUp && vm.carveUp.stateId === state.id ? (
                    <div style={{ marginTop: 12 }}>
                      <BlendScopeInline>
                        <CarveUpPanel
                          stateName={vm.carveUp.stateName}
                          stateId={vm.carveUp.stateId}
                          slices={vm.carveUp.slices}
                          detailHref={vm.carveUp.detailHref}
                        />
                      </BlendScopeInline>
                    </div>
                  ) : (
                    <p style={{ marginTop: 8, fontSize: 13, color: BLEND.muted }}>
                      {state.caption}
                    </p>
                  )}
                </div>
              )}
              legend={
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "6px 18px",
                    fontFamily: FONT.mono,
                    fontSize: 10,
                    color: BLEND.mutedDim,
                  }}
                >
                  <span style={{ letterSpacing: ".1em" }}>
                    {(vm.parties.find((p) => p.selected)?.name ?? "Primary").toUpperCase()}:
                  </span>
                  {vm.board.length > 0 ? (
                    <>
                      <span>Coloured by whoever leads each state</span>
                      <span>{"\u2713"} = voted and settled</span>
                      <span>Dark = not on this party&apos;s calendar</span>
                    </>
                  ) : (
                    <>
                      <span>Shaded by when each state votes</span>
                      <span style={{ color: BLEND.caution }}>Yellow = next wave</span>
                      <span>Sign in to see who leads each state</span>
                    </>
                  )}
                </div>
              }
            />
          }
        />

        <div className={BLEND_CONTAINER} style={{ background: BLEND.page }}>
          <BlendSection title="The field" ruled={false}>
            <div className="hidden lg:block">{fieldRows}</div>
            <div className="lg:hidden">
              {vm.field.map((c) => (
                <div
                  key={c.id}
                  style={{ padding: "12px 0", borderBottom: "1px solid rgba(42,42,61,.6)" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontFamily: FONT.sans, fontSize: 16, fontWeight: 600 }}>
                      {c.name}
                    </span>
                    <span style={{ fontFamily: FONT.mono, fontSize: 14 }}>{c.pct}%</span>
                  </div>
                  <div style={{ marginTop: 7, height: 4, background: BLEND.hairline }}>
                    <i
                      style={{
                        display: "block",
                        height: "100%",
                        width: `${c.barPct}%`,
                        background: c.color,
                        opacity: c.advancing ? 1 : 0.5,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      marginTop: 5,
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      color: BLEND.mutedDim,
                    }}
                  >
                    <span style={{ fontFamily: FONT.sans }}>{c.statusText}</span>
                    <span style={{ fontFamily: FONT.mono }}>
                      {c.delegates
                        ? `${c.delegates} proj.${c.delegatesAwarded ? ` · ${c.delegatesAwarded} won` : ""}`
                        : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </BlendSection>
        </div>
      </div>
    </>
  );
}

/**
 * The selected party's state board as a national map model. Every tile is a
 * state on that party's calendar, coloured by whoever leads it; the rest of
 * the country is left in the fog colour. There are no electoral votes in a
 * primary, so the label figure is a tick once the state has voted.
 */
function primaryMapModelFromBoard(vm: PrimaryBlendVM, ground: string): PresMapModel {
  const states: Record<string, PresMapState> = {};
  // No board (signed out, or the party's projection has not loaded): the map
  // still shows the calendar, shading each state by when its wave votes.
  if (vm.board.length === 0) {
    const nextWave = vm.calendar.findIndex((w) => w.statusText !== "COMPLETE");
    vm.calendar.forEach((w, i) => {
      const done = w.statusText === "COMPLETE";
      const fill = done
        ? mixToward(ground, "#8f8f9d", 0.55)
        : i === nextWave
          ? mixToward(ground, "#eab308", 0.5)
          : mixToward(ground, "#8f8f9d", Math.max(0.1, 0.32 - 0.05 * (i - nextWave)));
      for (const st of w.states) {
        states[st.id] = calendarState(
          st.id,
          st.name,
          fill,
          `${w.label}, ${w.statusText.toLowerCase()}`,
          done
        );
      }
    });
    return { states, candidates: {}, legendCandidates: [] };
  }
  for (const t of vm.board) {
    states[t.stateId] = {
      id: t.stateId,
      name: t.name || STATE_NAMES[t.stateId] || t.stateId,
      ev: 0,
      // On primary night the label is the count; otherwise a tick once voted.
      evLabel:
        t.night && t.night.status !== "polls_open"
          ? `${Math.round(t.night.reportingPct)}%`
          : t.voted
            ? "\u2713"
            : null,
      leaderId: t.leaderId ?? "",
      leaderName: t.leaderName ?? "",
      leaderColor: t.background,
      margin: 0,
      tier: "safe",
      fill: t.background,
      ink: t.ink,
      shares: [],
      totalVotes: 0,
      trend: {
        status: "none",
        candidateId: null,
        name: null,
        color: null,
        shiftPp: 0,
        windowTurns: 0,
        series: [],
      },
      sinceTurn: null,
      turnsAgo: null,
      caption: t.title,
      // Counting, with a leader but no call: hatched in the leader's colour,
      // the general election night's "not yet called" look.
      ...(t.night && !t.night.called && t.leaderColor
        ? { overlay: { kind: "hatch" as const, base: t.background, colors: [t.leaderColor] } }
        : {}),
    };
  }
  return { states, candidates: {}, legendCandidates: [] };
}

/** A state shaded by its calendar wave, for the signed-out primary map. */
function calendarState(
  id: string,
  name: string,
  fill: string,
  caption: string,
  voted: boolean
): PresMapState {
  return {
    id,
    name: name || STATE_NAMES[id] || id,
    ev: 0,
    evLabel: voted ? "\u2713" : null,
    leaderId: "",
    leaderName: "",
    leaderColor: fill,
    margin: 0,
    tier: "safe",
    fill,
    ink: readableInk(fill),
    shares: [],
    totalVotes: 0,
    trend: {
      status: "none",
      candidateId: null,
      name: null,
      color: null,
      shiftPp: 0,
      windowTurns: 0,
      series: [],
    },
    sinceTurn: null,
    turnsAgo: null,
    caption,
  };
}
