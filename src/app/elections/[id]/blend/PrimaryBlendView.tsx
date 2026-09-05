"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BLEND, FONT } from "@/components/blend/tokens";
import { BlendShell, BlendHeader, BlendSection } from "@/components/blend/BlendShell";
import { BlendRail, BlendChipRail } from "@/components/blend/BlendRail";
import { BlendTicker } from "@/components/blend/BlendTicker";
import { BlendVitals } from "@/components/blend/BlendVitals";
import { BlendScopeInline } from "@/components/blend/BlendScope";
import { CarveUpPanel } from "@/components/elections/primary/CarveUpPanel";
import { PrimaryCampaignControls } from "@/components/elections/primary/PrimaryCampaignControls";
import type { PrimaryPartyDetail } from "@/lib/elections/dto/primaryPartyDetail";
import type { ElectionDetail } from "../components/ElectionDetailTypes";
import { PrimaryTileBoard } from "./PrimaryTileBoard";
import {
  buildPrimaryBlendViewModel,
  type PrimaryBlendVM,
  type PrimaryPartyVM,
} from "./primaryBlendViewModel";

export interface PrimaryBlendViewProps {
  election: ElectionDetail;
  wire: string[];
}

function PartyButton({ p, onSelect }: { p: PrimaryPartyVM; onSelect: () => void }) {
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
      <i
        style={{
          width: 10,
          height: 10,
          borderRadius: 99,
          background: p.color,
          display: "block",
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
        <span style={{ display: "block", fontFamily: FONT.serif, fontSize: 14, fontWeight: 600 }}>
          {p.name}
        </span>
        <span
          style={{
            display: "block",
            fontFamily: FONT.serif,
            fontStyle: "italic",
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
            <span style={{ fontFamily: FONT.serif, fontSize: 14 }}>{k.label}</span>
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
export function PrimaryBlendView({ election, wire }: PrimaryBlendViewProps) {
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
  const [selection, setSelection] = useState<{ key: string; stateId: string } | null>(null);

  const detail = loaded && loaded.key === key ? loaded.detail : null;
  const selectedStateId = selection && selection.key === key ? selection.stateId : null;
  const selectState = (stateId: string) => {
    if (key) setSelection({ key, stateId });
  };

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
          ...fieldGrid,
          padding: "0 0 8px",
          borderBottom: `1px solid ${BLEND.hairlineStrong}`,
          fontFamily: FONT.mono,
          fontSize: 9.5,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: BLEND.mutedDimmer,
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
                  fontFamily: FONT.serif,
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
                  fontFamily: FONT.serif,
                  fontStyle: "italic",
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
              fontFamily: FONT.serif,
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
            <span>Primary Season</span>
            <span style={{ fontFamily: FONT.mono, letterSpacing: ".06em" }}>
              {vm.closesIn != null ? `${vm.closesIn} TURNS` : ""}
            </span>
          </div>
          <div
            style={{
              marginTop: 11,
              fontFamily: FONT.serif,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {vm.headline}
          </div>
          <BlendChipRail
            items={vm.parties.map((p) => ({ id: p.id, label: p.shortName }))}
            selectedId={partyId ?? undefined}
            onSelect={setPartyId}
            fontSize={11}
          />
        </div>

        <BlendTicker tag="RETURNS" tagColor={BLEND.caution} tagInk="#14141c" items={vm.wire} />
        <BlendVitals cells={vm.vitals} variant="mobile" />

        <div style={{ padding: "18px 16px" }}>
          {/* Without this, a reader on another party's primary sees a dash in
              the vitals and no reason for it; the rail that carries the
              explanation on desktop is hidden here. */}
          {vm.standingNote ? (
            <p
              style={{
                margin: "0 0 18px",
                fontFamily: FONT.serif,
                fontSize: 13.5,
                lineHeight: 1.55,
                color: BLEND.muted,
              }}
            >
              {vm.standingNote}
            </p>
          ) : null}

          {vm.delegateRace ? (
            <>
              <h2
                style={{
                  margin: "0 0 12px",
                  fontFamily: FONT.serif,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                Projected delegate race
              </h2>
              <DelegateRace vm={vm} height={30} />
            </>
          ) : null}

          {vm.board.length > 0 ? (
            <>
              <h2
                style={{
                  margin: "24px 0 4px",
                  fontFamily: FONT.serif,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                The state board
              </h2>
              <p
                style={{
                  margin: "0 0 12px",
                  fontFamily: FONT.serif,
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: BLEND.muted,
                }}
              >
                Coloured by whoever leads. States that have voted are settled; the rest are
                projected.
              </p>
              <StateBoard vm={vm} columns={6} onSelect={selectState} />
            </>
          ) : null}

          {/* The calendar sits with the board because the two drive the same
              selection. Without it here, mobile had no schedule at all and the
              board was the only way to reach a state. */}
          {vm.calendar.length > 0 ? (
            <>
              <h2
                style={{
                  margin: "24px 0 8px",
                  fontFamily: FONT.serif,
                  fontSize: 20,
                  fontWeight: 600,
                }}
              >
                The calendar
              </h2>
              <CalendarWaves vm={vm} onSelect={selectState} />
            </>
          ) : null}

          {vm.campaign ? (
            <div style={{ marginTop: 24 }}>
              <CampaignBlock
                vm={vm}
                electionId={electionId}
                onChanged={() => setReloadCount((n) => n + 1)}
              />
            </div>
          ) : null}

          <h2
            style={{ margin: "24px 0 8px", fontFamily: FONT.serif, fontSize: 20, fontWeight: 600 }}
          >
            The field
          </h2>
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
                <span style={{ fontFamily: FONT.serif, fontSize: 16, fontWeight: 600 }}>
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
                <span style={{ fontFamily: FONT.serif }}>{c.statusText}</span>
                <span style={{ fontFamily: FONT.mono }}>
                  {c.delegates
                    ? `${c.delegates} proj.${c.delegatesAwarded ? ` · ${c.delegatesAwarded} won` : ""}`
                    : ""}
                </span>
              </div>
            </div>
          ))}
          {campaignLink}
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden lg:block">
        <BlendShell
          left={
            <BlendRail
              eyebrow="Primary phase"
              // Country comes from the payload; presidential races exist
              // outside the US and the rail must not assert otherwise.
              title={`${election.countryId} President${election.electionYear ? ` ${election.electionYear}` : ""}`}
              titleSize={18}
              status={{ text: vm.closesText, color: BLEND.caution }}
            >
              <div style={{ padding: "14px 10px" }}>
                <div
                  style={{
                    padding: "0 8px 9px",
                    fontFamily: FONT.mono,
                    fontSize: 9.5,
                    letterSpacing: ".16em",
                    textTransform: "uppercase",
                    color: BLEND.mutedDimmer,
                  }}
                >
                  Parties
                </div>
                {vm.parties.map((p) => (
                  <PartyButton key={p.id} p={p} onSelect={() => setPartyId(p.id)} />
                ))}
              </div>
            </BlendRail>
          }
          rightWidth={296}
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
                  Your standing
                </div>

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
                        fontFamily: FONT.serif,
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
                          <span style={{ fontFamily: FONT.serif, color: BLEND.muted }}>{r.k}</span>
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
                          <span style={{ fontFamily: FONT.serif, color: BLEND.muted }}>
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
                      fontFamily: FONT.serif,
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
                  <div
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 9.5,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: BLEND.mutedDimmer,
                    }}
                  >
                    Calendar
                  </div>
                  <CalendarWaves vm={vm} onSelect={selectState} />
                </div>
              ) : null}

              {vm.campaign ? (
                <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                  <div
                    style={{
                      paddingBottom: 10,
                      fontFamily: FONT.mono,
                      fontSize: 9.5,
                      letterSpacing: ".16em",
                      textTransform: "uppercase",
                      color: BLEND.mutedDimmer,
                    }}
                  >
                    Your primary campaign
                  </div>
                  <CampaignBlock
                    vm={vm}
                    electionId={electionId}
                    onChanged={() => setReloadCount((n) => n + 1)}
                  />
                </div>
              ) : null}
            </aside>
          }
        >
          <BlendHeader
            kicker="Primary Season"
            readout={vm.turnReadout}
            headline={vm.headline}
            standfirst={vm.standfirst}
            headlineSize={32}
          />
          <BlendTicker tag="RETURNS" tagColor={BLEND.caution} tagInk="#14141c" items={vm.wire} />
          <BlendVitals cells={vm.vitals} />

          {vm.delegateRace ? (
            <BlendSection title="Projected delegate race" lede={vm.delegateRace.lede}>
              <DelegateRace vm={vm} height={36} />
            </BlendSection>
          ) : null}

          {vm.board.length > 0 ? (
            <BlendSection
              title="The state board"
              lede="Coloured by whoever leads. States that have voted are settled; the rest are projected."
            >
              <StateBoard vm={vm} columns={11} onSelect={selectState} />
            </BlendSection>
          ) : null}

          <BlendSection title="The field" ruled={false}>
            {fieldRows}
          </BlendSection>
        </BlendShell>
      </div>
    </>
  );
}
