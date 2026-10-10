"use client";

import { useBlendGround } from "@/components/blend/useBlendGround";
import { apiErrorText } from "@/lib/errors/catalog";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import type { CountryId } from "@/lib/constants/countries";
import { BLEND, FONT, BLEND_LABEL, BLEND_CONTAINER } from "@/components/blend/tokens";
import { BlendSection } from "@/components/blend/BlendShell";
import { BlendTicker } from "@/components/blend/BlendTicker";
import { useElectionCampaigns } from "../components/useElectionCampaigns";
import { ContingentRiskBanner } from "../components/ContingentRiskBanner";
import {
  PRESIDENTIAL_EV_NEEDED,
  assessContingentEvRisk,
  collegeSizeFromEvByState,
  electoralMajorityFor,
} from "@/lib/elections/presidentialResolutionDisplay";
import { TicketCards, TicketsTable } from "./GeneralTicketsTable";
import { DemocraticHealthBlock } from "./DemocraticHealthBlock";
import { PresidentialMap } from "./presMap/PresidentialMap";
import { StateSquares } from "./presMap/StateSquares";
import { CollegeSnake } from "./presMap/CollegeSnake";
import { MyCampaignStateBlock, useMyCampaign } from "./useMyCampaign";
import { PresidentialStage, presidentialTitle } from "./PresidentialStage";
import { presidentialResultsLive } from "./liveState";
import { ElectionDatesLine } from "./ElectionDatesLine";
import { buildPresMapModel } from "./presMap/presMapModel";
import {
  buildGeneralBlendViewModel,
  type GeneralRail,
  type GeneralTicketVM,
} from "./generalBlendViewModel";
import {
  EvBar,
  YourTicketBlock,
  NationalMoodBlock,
  WhyItMovedBlock,
  type GeneralBlendViewProps,
} from "./GeneralBlendParts";
export type { GeneralBlendViewProps } from "./GeneralBlendParts";

/** The Blend general-election screen (Proposal D). */
export function GeneralBlendView({
  election,
  electionId,
  wire,
  onRefresh,
  stageTitle = presidentialTitle(election.electionYear),
  stageNav,
  stageActions,
  initialFocus,
}: GeneralBlendViewProps) {
  // The stage shows every section at once; the rail selection only survives
  // as the view model's input.
  const rail: GeneralRail = "overview";
  const ground = useBlendGround();
  const [focus, setFocus] = useState<{ stateId: string; nonce: number } | null>(
    initialFocus ? { stateId: initialFocus, nonce: 0 } : null
  );
  const [busy, setBusy] = useState<string | null>(null);
  /** Why the last endorsement was refused, or null. */
  const [endorseError, setEndorseError] = useState<string | null>(null);

  /**
   * Campaign operations for the tickets table. Campaign Manager is US-only, so
   * other countries skip the request. Refetched each turn: the standings move
   * and so do funds and levels.
   */
  const { campaigns, loading: campaignsLoading } = useElectionCampaigns(electionId, {
    enabled: election.countryId === "US",
    refreshKey: election.gameState?.currentTurn ?? undefined,
  });

  const vm = useMemo(
    () => buildGeneralBlendViewModel({ election, wire, rail, ground }),
    [election, wire, rail, ground]
  );

  // The reader's own campaign in this race: presence by state on the map, and
  // building it from the state overview.
  const myCandidate = election.allCandidates.find((c) => c.isYou) ?? null;
  const mine = useMyCampaign({
    enabled: Boolean(myCandidate) && election.countryId === "US",
    campaignId: myCandidate?.campaignId ?? null,
    color: myCandidate?.campaignColor ?? myCandidate?.partyColor ?? "#4F8EF7",
  });
  const live = presidentialResultsLive(election);
  const mapModel = useMemo(() => buildPresMapModel(election, ground), [election, ground]);

  // No projected EV majority: say so beside the college bar, with the House
  // and Senate ballot the engine would run, instead of below the fold.
  const contingentBanner = useMemo(() => {
    const gv = election.generalVotes;
    const college = collegeSizeFromEvByState(gv?.evByState);
    const risk = assessContingentEvRisk(
      gv?.electoralVotesByCandidate,
      college > 0 ? electoralMajorityFor(college) : PRESIDENTIAL_EV_NEEDED
    );
    if (!risk?.atRisk || election.countryId !== "US") return null;
    return (
      <ContingentRiskBanner
        risk={risk}
        candidateNames={gv?.candidateNames ?? {}}
        projection={gv?.contingentProjection}
      />
    );
  }, [election]);

  /**
   * The hero shows two tickets at a time. A third ticket (or more) pages
   * through instead of squeezing in: page two shows 3rd (and 4th), and so on.
   */
  const heroPages = Math.max(1, Math.ceil(vm.tickets.length / 2));
  const [heroPage, setHeroPage] = useState(0);
  const safeHeroPage = Math.min(Math.max(0, heroPage), heroPages - 1);
  const heroPairTickets = vm.tickets.slice(safeHeroPage * 2, safeHeroPage * 2 + 2);

  /** Turns left plus the local close time, under the masthead on both trees. */
  const closeLine = vm.closeSummary ? (
    <div
      style={{
        fontFamily: FONT.mono,
        fontSize: 10.5,
        letterSpacing: ".08em",
        color: BLEND.muted,
      }}
    >
      {vm.closeSummary.toUpperCase()}
    </div>
  ) : null;

  /** Pager for the hero pair, drawn only once a third ticket exists. */
  const heroPager =
    heroPages > 1 ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 10,
            letterSpacing: ".1em",
            color: BLEND.mutedDim,
          }}
        >
          {safeHeroPage * 2 + 1}-{Math.min(vm.tickets.length, safeHeroPage * 2 + 2)} OF{" "}
          {vm.tickets.length}
        </span>
        <span style={{ display: "inline-flex", gap: 8 }}>
          <button
            type="button"
            aria-label="Show previous tickets"
            disabled={safeHeroPage === 0}
            onClick={() => setHeroPage(safeHeroPage - 1)}
            style={{
              padding: "4px 12px",
              font: "inherit",
              fontFamily: FONT.mono,
              fontSize: 12,
              cursor: safeHeroPage === 0 ? "not-allowed" : "pointer",
              border: `1px solid ${BLEND.hairlineStrong}`,
              background: "transparent",
              color: safeHeroPage === 0 ? BLEND.mutedDimmer : BLEND.muted,
            }}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Show next tickets"
            disabled={safeHeroPage >= heroPages - 1}
            onClick={() => setHeroPage(safeHeroPage + 1)}
            style={{
              padding: "4px 12px",
              font: "inherit",
              fontFamily: FONT.mono,
              fontSize: 12,
              cursor: safeHeroPage >= heroPages - 1 ? "not-allowed" : "pointer",
              border: `1px solid ${BLEND.hairlineStrong}`,
              background: "transparent",
              color: safeHeroPage >= heroPages - 1 ? BLEND.mutedDimmer : BLEND.muted,
            }}
          >
            ›
          </button>
        </span>
      </div>
    ) : null;

  /**
   * Endorse or un-endorse a ticket.
   *
   * A refusal used to be swallowed whole: the handler acted only on `res.ok`,
   * so a rejected endorsement left the button looking like it did nothing and
   * said nothing about why. The route has real reasons to say no — the race has
   * ended, the endorsement is already spent elsewhere — and the reader is
   * entitled to hear them.
   */
  async function toggleEndorse(candidateId: string, currentlyEndorsed: boolean) {
    setBusy(candidateId);
    setEndorseError(null);
    try {
      const res = await fetch(`/api/elections/${electionId}/endorse`, {
        method: currentlyEndorsed ? "DELETE" : "POST",
        ...(currentlyEndorsed
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ candidateId }),
            }),
      });
      if (res.ok) {
        onRefresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setEndorseError(apiErrorText(body, "That endorsement did not go through."));
    } catch {
      setEndorseError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const campaignLink = vm.campaignHref ? (
    <Link
      href={vm.campaignHref}
      style={{
        marginTop: 14,
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

  /**
   * The endorse control, shared by the hero and the tickets table.
   *
   * It used to exist only inside the table, which the mobile tree never
   * rendered, so a player on a phone could not endorse anybody. Defining it
   * once means the affordance cannot go missing from one layout again — and
   * that the self-endorsement guard cannot be applied to one and not the other.
   *
   * Nothing is rendered for the reader's own ticket. The route refuses it
   * ("You cannot endorse yourself", 400), so the button could never do anything
   * but fail; offering it was an affordance that had no action behind it.
   */
  const endorseButton = (c: GeneralTicketVM) => {
    if (c.isYou) return null;
    return (
      <button
        type="button"
        disabled={busy === c.id}
        onClick={() => toggleEndorse(c.id, c.endorsed)}
        style={{
          ...BLEND_LABEL,
          padding: "4px 10px",
          font: "inherit",
          fontWeight: 700,
          whiteSpace: "nowrap",
          cursor: busy === c.id ? "not-allowed" : "pointer",
          ...(c.endorsed
            ? {
                border: "1px solid rgba(34,197,94,.4)",
                background: "rgba(34,197,94,.12)",
                color: BLEND.positive,
              }
            : {
                border: `1px solid ${BLEND.hairlineStrong}`,
                background: "transparent",
                color: BLEND.muted,
              }),
        }}
      >
        {busy === c.id ? "…" : c.endorsed ? "Endorsed" : "Endorse"}
      </button>
    );
  };

  /** The small caps label that says which of the two figures follows. */
  const labelStyle = (fontSize: number): React.CSSProperties => ({
    fontFamily: FONT.mono,
    fontSize,
    letterSpacing: ".14em",
    textTransform: "uppercase",
    color: BLEND.mutedDim,
  });

  const heroCell = (
    c: GeneralTicketVM,
    i: number,
    row: string,
    style: React.CSSProperties,
    content: React.ReactNode
  ) => (
    <div
      key={`${c.id}-${row}`}
      style={{
        display: "flex",
        justifyContent: i === 0 ? "flex-start" : "flex-end",
        textAlign: i === 0 ? "left" : "right",
        // A grid item's default `min-width: auto` floors the track at its
        // widest word. On a phone each track is roughly 160px, and `body` is
        // `overflow-x: clip`, so a long name would push the other ticket off
        // a screen that cannot scroll sideways to reach it.
        minWidth: 0,
        ...style,
      }}
    >
      {content}
    </div>
  );

  /**
   * The two leading tickets, side by side, at a given type scale.
   *
   * Counted first, forecast second. The hero figure is the ballots the engine
   * has actually banked; the electoral votes under it are read off those same
   * ballots by winner-take-all and are a projection, because no state is
   * awarded until the race resolves — mid-race there is no such thing as an
   * electoral vote a ticket already holds. Leading with the electoral figure
   * unlabelled invited it to be read as won. Each half is named and the two
   * are ruled apart.
   *
   * One function for both trees. The phone used to draw its own inline copy of
   * this block, so a fix applied to one layout left the other as it was — and
   * both copies had the same latent fault, since each side was an independent
   * flex column. Any asymmetry between them (one ticket with a running mate,
   * the reader's own ticket with no endorse button) pushed one column down and
   * the figures stopped lining up. Shared grid rows align by construction,
   * whatever each side happens to carry.
   */
  const heroPair = (
    scale: {
      name: number;
      party: number;
      mate: number;
      label: number;
      votes: number;
      share: number;
      projection: number;
      columnGap: number;
      marginBottom: number;
      avatarSize: string;
    },
    pair: GeneralTicketVM[]
  ) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        columnGap: scale.columnGap,
        alignItems: "end",
        marginBottom: scale.marginBottom,
      }}
    >
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "name",
          { fontFamily: FONT.sans, fontSize: scale.name, fontWeight: 600 },
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              justifyContent: i === 0 ? "flex-start" : "flex-end",
            }}
          >
            <Avatar url={c.avatarUrl} name={c.name} size={scale.avatarSize} />
            <Link
              href={c.href}
              style={{
                color: "inherit",
                textDecoration: "underline",
                textDecorationColor: "rgba(255,255,255,.25)",
                textUnderlineOffset: 3,
              }}
            >
              {c.name}
            </Link>
          </span>
        )
      )}
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "party",
          {
            marginTop: 2,
            fontFamily: FONT.mono,
            fontSize: scale.party,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            color: BLEND.mutedDim,
          },
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <PartyLogo
              partyId={c.partyId}
              partyColor={c.color}
              size="h-4 w-4"
              countryId={election.countryId as CountryId}
            />
            <Link
              href={c.partyHref}
              style={{
                color: "inherit",
                textDecoration: "underline",
                textDecorationColor: "rgba(128,128,128,.4)",
                textUnderlineOffset: 3,
              }}
            >
              {c.party}
            </Link>
            {c.campaignHref ? (
              <Link
                href={c.campaignHref}
                style={{ color: BLEND.accentInk, textDecoration: "none", flexShrink: 0 }}
              >
                Campaign
              </Link>
            ) : null}
          </span>
        )
      )}
      {/* Rendered for both sides even when only one has a mate, so the row
          exists and the figures below it stay level. */}
      {pair.some((c) => c.mate)
        ? pair.map((c, i) =>
            heroCell(
              c,
              i,
              "mate",
              {
                marginTop: 2,
                fontFamily: FONT.sans,
                fontSize: scale.mate,
                color: BLEND.mutedDim,
                minHeight: 18,
              },
              c.mate ? `with ${c.mate}` : ""
            )
          )
        : null}
      {/* The counted half. These are ballots the engine has actually banked, so
          they carry the hero figure; the electoral votes below them are read
          off the same ballots and are a forecast until the race resolves. */}
      {pair.map((c, i) =>
        heroCell(c, i, "votes-label", { marginTop: 9, ...labelStyle(scale.label) }, "Votes banked")
      )}
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "votes",
          {
            marginTop: 3,
            fontFamily: FONT.mono,
            fontSize: scale.votes,
            lineHeight: 1,
            fontWeight: 500,
            letterSpacing: "-0.04em",
            color: c.color,
          },
          c.votes
        )
      )}
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "share",
          { marginTop: 4, fontFamily: FONT.mono, fontSize: scale.share, color: BLEND.muted },
          `${c.pct}%`
        )
      )}
      {/* The forecast half, ruled off so the two cannot be read as one figure. */}
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "projection-label",
          {
            marginTop: 11,
            paddingTop: 8,
            borderTop: `1px solid ${BLEND.hairline}`,
            ...labelStyle(scale.label),
          },
          "Current projection"
        )
      )}
      {pair.map((c, i) =>
        heroCell(
          c,
          i,
          "projection",
          {
            marginTop: 3,
            fontFamily: FONT.mono,
            fontSize: scale.projection,
            lineHeight: 1,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            color: c.color,
          },
          `${c.ev} EV`
        )
      )}
      {pair.some((c) => !c.isYou)
        ? pair.map((c, i) => heroCell(c, i, "endorse", { marginTop: 10 }, endorseButton(c)))
        : null}
    </div>
  );

  /** Error from the last endorse attempt, for a view where the hero (and its copy) is hidden. */
  const ticketsError =
    !vm.showCollege && endorseError ? (
      <p role="alert" style={{ margin: "0 0 10px", fontSize: 13, color: BLEND.negative }}>
        {endorseError}
      </p>
    ) : null;

  return (
    <>
      {/* The map stage, then the tickets table below it. */}
      <div>
        <PresidentialStage
          title={stageTitle}
          kicker={
            <>
              <span>{vm.kicker}</span>
              {live ? (
                <span style={{ marginLeft: 12, color: BLEND.positive }}>{vm.liveText}</span>
              ) : vm.closesIn != null ? (
                <span style={{ marginLeft: 12 }}>
                  {vm.closesIn} TURN{vm.closesIn === 1 ? "" : "S"} LEFT
                </span>
              ) : null}
            </>
          }
          deck={vm.headline}
          ticker={live ? <BlendTicker tag="CALLS" items={vm.wire} /> : null}
          strip={
            <CollegeSnake
              model={mapModel}
              threshold={vm.threshold}
              onSelect={(stateId) => setFocus({ stateId, nonce: Date.now() })}
            />
          }
          nav={stageNav}
          actions={stageActions}
          left={
            <>
              {closeLine ? <div style={{ marginBottom: 16 }}>{closeLine}</div> : null}
              <div style={{ marginBottom: 16 }}>
                <ElectionDatesLine election={election} />
              </div>
              {heroPairTickets.length > 0 ? (
                <>
                  {heroPager}
                  {heroPair(
                    {
                      name: 15,
                      party: 9,
                      mate: 12,
                      label: 8,
                      votes: 32,
                      share: 11,
                      projection: 19,
                      columnGap: 14,
                      marginBottom: 14,
                      avatarSize: "h-8 w-8",
                    },
                    heroPairTickets
                  )}
                  <EvBar vm={vm} height={28} error={endorseError} />
                  {contingentBanner ? (
                    <div style={{ marginTop: 14 }}>{contingentBanner}</div>
                  ) : null}
                </>
              ) : null}
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
              {vm.yourTicket ? (
                <div
                  style={{
                    marginTop: 20,
                    paddingTop: 18,
                    borderTop: `1px solid ${BLEND.hairline}`,
                  }}
                >
                  <div style={BLEND_LABEL}>Your ticket</div>
                  <YourTicketBlock vm={vm} campaignLink={campaignLink} />
                </div>
              ) : null}
            </>
          }
          right={
            vm.mood ||
            election.democraticHealth ||
            vm.drivers.length + vm.coattailDrivers.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                {vm.mood ? (
                  <div>
                    <div style={BLEND_LABEL}>National mood</div>
                    <NationalMoodBlock vm={vm} />
                  </div>
                ) : null}
                {election.democraticHealth ? (
                  <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                    <div style={BLEND_LABEL}>Democratic health</div>
                    <DemocraticHealthBlock data={election.democraticHealth} />
                  </div>
                ) : null}
                {vm.drivers.length + vm.coattailDrivers.length > 0 ? (
                  <div style={{ paddingTop: 20, borderTop: `1px solid ${BLEND.hairline}` }}>
                    <div style={BLEND_LABEL}>Why it moved</div>
                    <WhyItMovedBlock vm={vm} />
                  </div>
                ) : null}
              </div>
            ) : undefined
          }
          map={
            <PresidentialMap
              variant="stage"
              model={mapModel}
              electionId={electionId}
              countryId={election.countryId}
              turn={election.gameState?.currentTurn ?? null}
              focusRequest={focus}
              presence={mine ? { levels: mine.levels, color: mine.color } : null}
              panelExtra={
                mine
                  ? (stateId) => <MyCampaignStateBlock mine={mine} stateId={stateId} />
                  : undefined
              }
            />
          }
          squares={
            <StateSquares model={mapModel} electionId={electionId} countryId={election.countryId} />
          }
        />

        {vm.showTicketsTable ? (
          <div className={BLEND_CONTAINER} style={{ background: BLEND.page }}>
            <BlendSection
              title="The tickets"
              lede="Projected electoral votes, vote share, and each campaign's operations."
              ruled={false}
            >
              {ticketsError}
              <div className="hidden lg:block">
                <TicketsTable
                  tickets={vm.tickets}
                  campaigns={campaigns}
                  campaignsLoading={campaignsLoading}
                  endorseButton={endorseButton}
                />
              </div>
              <div className="lg:hidden">
                <TicketCards
                  tickets={vm.tickets}
                  campaigns={campaigns}
                  campaignsLoading={campaignsLoading}
                  endorseButton={endorseButton}
                />
              </div>
            </BlendSection>
          </div>
        ) : null}
      </div>
    </>
  );
}
