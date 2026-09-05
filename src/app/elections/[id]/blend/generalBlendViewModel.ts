/**
 * View model for the Blend general-election screen (Proposal D).
 *
 * Pure function over the election payload. The tile board, the margin tiers and
 * the persuasion drivers all reuse the existing general-election model rather
 * than re-deriving them, so this screen and the current one can never disagree
 * about who is winning a state.
 */

import type { ElectionDetail, CandidateDetail } from "../components/ElectionDetailTypes";
import { buildGeneralElectionViewModel, type MarginTier } from "@/lib/elections/generalViewModel";
import { readableInk, shadeColorForTier } from "@/lib/elections/marginTierShade";
import { BLEND } from "@/components/blend/tokens";
import { computePersuasionDriverDisplay } from "@/lib/elections/computePersuasionDriverDisplay";
import type { DriverDisplayInputs } from "@/lib/elections/computePersuasionDriverDisplay";
import type { PersuasionDriverCandidate } from "@/components/elections/general/PersuasionDrivers";
import { buildGeneralHeadline } from "./generalHeadline";

export type GeneralRail = "overview" | "college" | "board" | "tickets";

export interface GeneralBlendInput {
  election: ElectionDetail;
  wire: string[];
  rail: GeneralRail;
}

export interface GeneralTicketVM {
  id: string;
  name: string;
  party: string;
  mate: string | null;
  ev: number;
  pct: string;
  votes: string;
  color: string;
  isYou: boolean;
  endorsed: boolean;
}

export interface EvSegmentVM {
  id: string;
  widthPct: number;
  /**
   * The bar sits directly under the hero pair, which prints the same figure at
   * 50px. Kept for a caller that shows the bar on its own; the general screen
   * does not render it.
   */
  label: string;
  color: string;
}

export interface BoardTileVM {
  stateId: string;
  ev: number;
  background: string;
  /** Ink follows the shaded background's lightness, not the side. */
  ink: string;
  title: string;
}

export interface TierLegendVM {
  label: string;
  band: string;
  swatch: string;
}

export interface DriverRowVM {
  label: string;
  value: string;
  color: string;
  /** 0..100, relative to the largest absolute contribution. */
  barPct: number;
  unit: "pts" | "%";
}

/**
 * Turns from the close within which the screen may call itself "Election
 * Night". The general runs 48 turns; a race with more than this left is a
 * campaign being polled, not a count being read out.
 */
export const FINAL_STRETCH_TURNS = 4;

export interface GeneralBlendVM {
  headline: string;
  standfirst: string;
  turnReadout: string;
  closesIn: number | null;
  liveText: string;
  railItems: { id: GeneralRail; label: string; badge?: string }[];
  showCollege: boolean;
  showBoard: boolean;
  showTickets: boolean;
  /**
   * Whether the standalone tickets table is worth drawing.
   *
   * The hero pair already carries the top two by name, party, running mate,
   * electoral votes, share, popular vote and the endorse button. In the normal
   * two-way presidential race the table repeated every one of those for the
   * same two people, so it earns its place only once a third ticket exists and
   * the hero cannot show them all.
   */
  showTicketsTable: boolean;
  tickets: GeneralTicketVM[];
  topTwo: GeneralTicketVM[];
  evSegments: EvSegmentVM[];
  evRemainderPct: number;
  /** Masthead label: "Election Night" only once the count is closing. */
  kicker: string;
  /** One line saying the figures on this screen are a forecast. */
  projectionNote: string;
  thresholdPct: number;
  threshold: number;
  totalEv: number;
  tiles: BoardTileVM[];
  tierLegend: TierLegendVM[];
  drivers: DriverRowVM[];
  coattailDrivers: DriverRowVM[];
  /**
   * The referendum standing, with the components that produced it.
   *
   * The breakdown travels with the number deliberately. The page used to print
   * this figure twice — here and again in a card lower down — and the two
   * carried different bars underneath: the rail's neighbouring "Why it moved"
   * rows are the persuasion drivers behind a candidate's vote, not the
   * economic components behind this shift, so a reader met one heading, one
   * number, and two unrelated explanations.
   */
  mood: {
    approval: string;
    note: string;
    /** What the economy contributed, in points, largest first. */
    components: { label: string; value: string; positive: boolean }[];
    /** Present only when an enacted bill earned credit against the penalty. */
    credit: string | null;
    /** Present only when consecutive terms weigh on the penalty. */
    fatigue: string | null;
    /** The turn the engine recorded this on. */
    readOn: string;
  } | null;
  yourTicket: { name: string; ev: number; leadText: string } | null;
  campaignHref: string | null;
  wire: string[];
}

const TIER_BANDS: { tier: MarginTier; label: string; band: string }[] = [
  { tier: "safe", label: "Safe", band: "15pp or more" },
  { tier: "likely", label: "Likely", band: "10 to 15pp" },
  { tier: "lean", label: "Lean", band: "5 to 10pp" },
  { tier: "tossup", label: "Toss-up", band: "under 5pp" },
];

function compactVotes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function grouped(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function buildGeneralBlendViewModel(inp: GeneralBlendInput): GeneralBlendVM {
  const { election, wire, rail } = inp;
  const gv = election.generalVotes;
  const currentTurn = election.gameState?.currentTurn ?? null;

  // ── Tickets ───────────────────────────────────────────────────────────────
  const evByCandidate = gv?.electoralVotesByCandidate ?? {};
  const totalVotes = gv?.totalVotes ?? {};
  const ballots = Object.values(totalVotes).reduce((s, v) => s + v, 0);

  const byId = new Map<string, CandidateDetail>(election.allCandidates.map((c) => [c.id, c]));

  const tickets: GeneralTicketVM[] = election.allCandidates
    .map((c) => {
      const votes = totalVotes[c.id] ?? 0;
      return {
        id: c.id,
        name: c.characterName,
        party: c.partyName,
        mate: c.runningMateName ?? null,
        ev: evByCandidate[c.id] ?? 0,
        pct: ballots > 0 ? ((votes / ballots) * 100).toFixed(1) : "0.0",
        votes: compactVotes(votes),
        color: c.campaignColor ?? c.partyColor,
        isYou: c.isYou,
        endorsed: election.myEndorsedCandidateId === c.id,
      };
    })
    .sort((a, b) => b.ev - a.ev || Number(b.pct) - Number(a.pct));

  // ── Electoral college ─────────────────────────────────────────────────────
  // The denominator is the live apportionment total, never a hardcoded 538.
  const totalEv =
    gv?.evByState && Object.keys(gv.evByState).length > 0
      ? Object.values(gv.evByState).reduce((s, v) => s + v, 0)
      : Object.values(evByCandidate).reduce((s, v) => s + v, 0);
  const threshold = totalEv > 0 ? Math.floor(totalEv / 2) + 1 : 0;

  const evSegments: EvSegmentVM[] = tickets
    .filter((t) => t.ev > 0)
    .map((t) => {
      const widthPct = totalEv > 0 ? (t.ev / totalEv) * 100 : 0;
      return {
        id: t.id,
        widthPct,
        label: widthPct > 8 ? String(t.ev) : "",
        color: t.color,
      };
    });
  const allocated = evSegments.reduce((s, seg) => s + seg.widthPct, 0);
  const outstandingEv = Math.max(0, totalEv - tickets.reduce((s, t) => s + t.ev, 0));

  // ── Battleground board ────────────────────────────────────────────────────
  const model = buildGeneralElectionViewModel({
    candidates: election.allCandidates.map((c) => ({
      id: c.id,
      name: c.characterName,
      color: c.campaignColor ?? c.partyColor,
      partyAbbr: c.partyName,
    })),
    stateVoteData: gv?.stateVoteData
      ? Object.fromEntries(
          Object.entries(gv.stateVoteData).map(([k, v]) => [k, v.votesByCandidate])
        )
      : undefined,
  });

  const tiles: BoardTileVM[] = Object.entries(model.marginByState)
    .map(([stateId, info]) => {
      // Shaded against the page the tiles sit on, so a looser tier fades into
      // the board rather than blowing out toward white.
      const background = shadeColorForTier(info.leaderColor, info.tier, BLEND.page);
      const ink = readableInk(background);
      const leader = byId.get(info.leaderId);
      return {
        stateId,
        ev: gv?.evByState?.[stateId] ?? 0,
        background,
        ink,
        title: `${stateId}: ${leader?.characterName ?? info.leaderId} +${info.margin.toFixed(1)}pp`,
      };
    })
    .sort((a, b) => a.stateId.localeCompare(b.stateId));

  const tierLegend: TierLegendVM[] = TIER_BANDS.map((t) => ({
    label: t.label,
    band: t.band,
    // A neutral grey run through the same shading shows the ramp itself.
    swatch: shadeColorForTier("#9CA3AF", t.tier, BLEND.page),
  }));

  // ── Persuasion drivers ────────────────────────────────────────────────────
  const persuasionCandidates: PersuasionDriverCandidate[] = election.allCandidates.map((c) => ({
    id: c.id,
    characterId: c.characterId,
    name: c.characterName,
    party: c.party,
    partyColor: c.partyColor,
    partyEcon: c.partyEcon,
    partySocial: c.partySocial,
    economicPosition: c.economicPosition,
    socialPosition: c.socialPosition,
    favorability: c.favorability,
    politicalInfluence: c.politicalInfluence,
    nationalInfluence: c.nationalInfluence,
    isNPP: c.isNPP,
    sharePct: c.sharePct,
    support: c.support,
  }));
  const driverInputs: DriverDisplayInputs = {
    fundsByParty: election.fundsByParty,
    incumbentSeatShareByParty: election.incumbentSeatShareByParty,
    regByParty: election.persuasionRegByParty,
    medianVoter: election.medianVoter,
    presidentialCoattailPctByParty: election.presidentialCoattailPctByParty,
    gubernatorialCoattailPctByParty: election.gubernatorialCoattailPctByParty,
    midtermOppositionBoostPctByParty: election.midtermOppositionBoostPctByParty,
    incumbentPartyId: election.incumbentPartyId,
    incumbentApproval: election.incumbentApproval,
    legislativeIncumbentPartyId: election.legislativeIncumbentPartyId,
    legislativeIncumbentTenureTerms: election.legislativeIncumbentTenureTerms,
  };
  const rawDrivers = computePersuasionDriverDisplay(persuasionCandidates, driverInputs);
  const maxAbs = rawDrivers.reduce((m, d) => Math.max(m, Math.abs(d.contributionPct)), 0);
  const toRow = (d: (typeof rawDrivers)[number]): DriverRowVM => {
    const positive = d.contributionPct >= 0;
    return {
      label: d.label,
      value: `${positive ? "+" : "-"}${Math.abs(d.contributionPct).toFixed(1)}`,
      color: d.color,
      barPct: maxAbs > 0 ? (Math.abs(d.contributionPct) / maxAbs) * 100 : 0,
      unit: d.unit ?? "pts",
    };
  };
  const allRows = rawDrivers.map(toRow);
  const drivers = allRows.filter((r) => r.unit !== "%");
  const coattailDrivers = allRows.filter((r) => r.unit === "%");

  // ── National mood ─────────────────────────────────────────────────────────
  const econ = election.economicReferendum;
  const forgivenessPct = Math.round((econ?.forgivenessFrac ?? 0) * 100);
  const mood = econ
    ? {
        approval: econ.sharePts.toFixed(1),
        note: `Misery index ${econ.miseryIndex.toFixed(1)}. ${
          election.medianVoter
            ? `Median voter sits at ${election.medianVoter.ep.toFixed(0)} economic, ${election.medianVoter.sp.toFixed(0)} social.`
            : ""
        }`.trim(),
        components: [...econ.components]
          .sort((a, b) => Math.abs(b.contributionPts) - Math.abs(a.contributionPts))
          .map((c) => ({
            label: c.label,
            value: `${c.contributionPts >= 0 ? "+" : "-"}${Math.abs(c.contributionPts).toFixed(1)}`,
            positive: c.contributionPts >= 0,
          })),
        credit:
          forgivenessPct > 0 ? `Response credit forgives ${forgivenessPct}% of the penalty.` : null,
        fatigue:
          econ.fatigueMultiplier > 1
            ? `Time in office weighs the penalty ${econ.fatigueMultiplier.toFixed(1)} times heavier.`
            : null,
        readOn: `Read on turn ${grouped(econ.recordedTurn)}.`,
      }
    : null;

  // ── Your ticket ───────────────────────────────────────────────────────────
  const mine = tickets.find((t) => t.isYou) ?? null;
  const runnerUp = tickets.find((t) => t.id !== mine?.id);
  const yourTicket = mine
    ? {
        name: mine.mate ? `${mine.name} and ${mine.mate}` : mine.name,
        ev: mine.ev,
        leadText:
          runnerUp == null
            ? "Unopposed"
            : mine.ev >= runnerUp.ev
              ? `+${mine.ev - runnerUp.ev} EV lead`
              : `${runnerUp.ev - mine.ev} EV behind`,
      }
    : null;

  const myCandidate = election.allCandidates.find((c) => c.isYou);
  const campaignHref = myCandidate?.campaignId ? `/campaign/${myCandidate.campaignId}` : null;

  // ── Header ────────────────────────────────────────────────────────────────
  const leader = tickets[0] ?? null;
  const second = tickets[1] ?? null;
  const { headline, standfirst } = buildGeneralHeadline({
    leaderName: leader && leader.ev + Number(leader.pct) > 0 ? leader.name : null,
    leaderEv: leader?.ev ?? 0,
    runnerUpEv: second?.ev ?? 0,
    threshold,
    outstandingEv,
    popularMarginPp: leader && second ? Number(leader.pct) - Number(second.pct) : 0,
  });

  const closesIn =
    currentTurn != null && election.endTurn != null
      ? Math.max(0, election.endTurn - currentTurn)
      : null;

  const turnReadout = [
    currentTurn != null ? `TURN ${grouped(currentTurn)}` : null,
    ballots > 0 ? `${grouped(ballots)} BALLOTS` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // A third ticket is what the table exists for; below that the hero is the
  // ticket list, so a "Tickets" pane would open on an empty column.
  const showTicketsTable = tickets.length > 2;

  const railItems: GeneralBlendVM["railItems"] = [
    { id: "overview", label: "Overview" },
    { id: "college", label: "Electoral college", badge: leader ? String(leader.ev) : "" },
    { id: "board", label: "Battleground", badge: String(tiles.length) },
    ...(showTicketsTable
      ? [{ id: "tickets" as const, label: "Tickets", badge: String(tickets.length) }]
      : []),
  ];

  return {
    headline,
    standfirst,
    turnReadout,
    closesIn,
    liveText:
      closesIn == null
        ? "LIVE TALLY"
        : closesIn === 0
          ? "FINAL TURN"
          : `LIVE TALLY · ${closesIn} TURN${closesIn === 1 ? "" : "S"}`,
    /**
     * The masthead. "Election Night" belongs to a race being counted out, not
     * to one with half its turns left: this screen only ever renders a running
     * race, so it says what it is until the count is genuinely closing.
     */
    kicker: closesIn != null && closesIn > FINAL_STRETCH_TURNS ? "The Campaign" : "Election Night",
    /** Every figure here is a forecast from the votes banked so far. */
    projectionNote:
      closesIn === 0
        ? "Final turn. Every figure is still a projection until the race resolves."
        : "Projected from votes banked so far. No state is won until the race resolves.",
    railItems,
    showCollege: rail === "overview" || rail === "college",
    showBoard: rail === "overview" || rail === "board",
    showTickets: rail === "overview" || rail === "tickets",
    showTicketsTable,
    tickets,
    topTwo: tickets.slice(0, 2),
    evSegments,
    evRemainderPct: Math.max(0, 100 - allocated),
    thresholdPct: totalEv > 0 ? (threshold / totalEv) * 100 : 50,
    threshold,
    totalEv,
    tiles,
    tierLegend,
    drivers,
    coattailDrivers,
    mood,
    yourTicket,
    campaignHref,
    wire,
  };
}
