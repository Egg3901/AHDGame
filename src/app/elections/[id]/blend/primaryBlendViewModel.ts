/**
 * View model for the Blend primary-election screen (Proposal D).
 *
 * Pure function over the election payload plus the selected party. Every figure
 * the D markup binds resolves here so the JSX stays declarative and the
 * derivations are unit-testable.
 */

import type {
  CandidateDetail,
  ElectionDetail,
  PartyGroup,
} from "../components/ElectionDetailTypes";
import { BLEND } from "@/components/blend/tokens";

export interface PrimaryBlendInput {
  election: ElectionDetail;
  /** Party whose field is on screen. Falls back to the first party. */
  selectedPartyId: string | null;
  /** Headlines from the per-race wire feed. */
  wire: string[];
}

export interface PrimaryPartyVM {
  id: string;
  name: string;
  shortName: string;
  color: string;
  leader: string | null;
  filed: number;
  selected: boolean;
  hasYou: boolean;
}

export interface PrimaryFieldRowVM {
  id: string;
  rank: number;
  name: string;
  blurb: string;
  pct: string;
  delegates: string | null;
  advancing: boolean;
  isYou: boolean;
  isNPP: boolean;
  statusText: string;
  color: string;
  barPct: number;
}

export interface DelegateSegmentVM {
  id: string;
  name: string;
  color: string;
  widthPct: number;
  /** Rendered inside the segment only when it is wide enough to read. */
  label: string;
}

export interface DelegateRaceVM {
  lede: string;
  segments: DelegateSegmentVM[];
  remainderPct: number;
  clinchMarkerPct: number;
  clinchText: string;
  totalText: string;
}

export interface PrimaryStandingVM {
  share: string;
  rankText: string;
  rankNum: number;
  lead: string;
  delegates: string | null;
  toClinch: string | null;
  advancing: boolean;
  statusText: string;
  statusColor: string;
}

export interface PrimaryCalendarRowVM {
  label: string;
  statusText: string;
  color: string;
}

export interface PrimaryBlendVM {
  headline: string;
  standfirst: string;
  turnReadout: string;
  closesIn: number | null;
  closesText: string;
  advanceText: string;
  selectedName: string;
  partyAccent: string;
  parties: PrimaryPartyVM[];
  field: PrimaryFieldRowVM[];
  delegateRace: DelegateRaceVM | null;
  you: PrimaryStandingVM | null;
  standingNote: string | null;
  calendar: PrimaryCalendarRowVM[];
  campaignHref: string | null;
  wire: string[];
  vitals: { label: string; value: string; sub?: string; color?: string }[];
}

function grouped(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** The office and region a candidate holds, for the field row's italic blurb. */
function blurbFor(c: CandidateDetail): string {
  if (c.isNPP) return "Non-player politician";
  return c.partyName;
}

function selectParty(election: ElectionDetail, selectedPartyId: string | null): PartyGroup | null {
  if (election.byParty.length === 0) return null;
  return election.byParty.find((p) => p.partyId === selectedPartyId) ?? election.byParty[0];
}

export function buildPrimaryBlendViewModel(inp: PrimaryBlendInput): PrimaryBlendVM {
  const { election, selectedPartyId, wire } = inp;

  const party = selectParty(election, selectedPartyId);
  const candidates = party?.candidates ?? [];
  const advanceCount = election.primaryAdvanceCount ?? 1;
  const currentTurn = election.gameState?.currentTurn ?? null;

  // ── Countdown ─────────────────────────────────────────────────────────────
  const closesIn =
    currentTurn != null && election.primaryEndTurn != null
      ? Math.max(0, election.primaryEndTurn - currentTurn)
      : null;
  const closesText =
    closesIn == null
      ? "PRIMARY PHASE"
      : closesIn === 0
        ? "PRIMARY CLOSING"
        : `CLOSES IN ${closesIn} TURN${closesIn === 1 ? "" : "S"}`;

  // ── Party rail ────────────────────────────────────────────────────────────
  const activeId = party?.partyId ?? null;
  const parties: PrimaryPartyVM[] = election.byParty.map((p) => ({
    id: p.partyId,
    name: p.partyName,
    shortName: p.partyName.replace(/\s+Party$/i, ""),
    color: p.partyColor,
    // Candidates arrive already sorted by delegates then standing.
    leader: p.candidates[0]?.characterName ?? null,
    filed: p.candidates.length,
    selected: p.partyId === activeId,
    hasYou: p.candidates.some((c) => c.isYou),
  }));

  const selectedName = party ? party.partyName.replace(/\s+Party$/i, "") : "";

  // ── The field ─────────────────────────────────────────────────────────────
  const topPct = candidates.reduce((m, c) => Math.max(m, c.sharePct ?? 0), 0);
  const field: PrimaryFieldRowVM[] = candidates.map((c, i) => {
    const advancing = i < advanceCount;
    return {
      id: c.id,
      rank: i + 1,
      name: c.characterName,
      blurb: blurbFor(c),
      pct: (c.sharePct ?? 0).toFixed(1),
      delegates:
        party?.projectedDelegates && party.projectedDelegates[c.id] != null
          ? grouped(party.projectedDelegates[c.id])
          : null,
      advancing,
      isYou: c.isYou,
      isNPP: c.isNPP,
      statusText: advancing ? "Advancing" : "Eliminated at close",
      color: c.campaignColor ?? party?.partyColor ?? BLEND.muted,
      // Bars are scaled against the leader so a tight field still reads.
      barPct: topPct > 0 ? Math.max(0, Math.min(100, ((c.sharePct ?? 0) / topPct) * 100)) : 0,
    };
  });

  const advanceText =
    advanceCount === 1
      ? "One advances to the general election."
      : `${advanceCount} advance to the general election.`;

  // ── Delegate race ─────────────────────────────────────────────────────────
  let delegateRace: DelegateRaceVM | null = null;
  const total = party?.totalDelegates ?? 0;
  if (party?.projectedDelegates && total > 0) {
    const majority = party.delegateMajority ?? Math.floor(total / 2) + 1;
    const segments: DelegateSegmentVM[] = candidates
      .map((c) => {
        const d = party.projectedDelegates?.[c.id] ?? 0;
        const widthPct = (d / total) * 100;
        return {
          id: c.id,
          name: c.characterName,
          color: c.campaignColor ?? party.partyColor,
          widthPct,
          // A sliver cannot hold a number legibly.
          label: widthPct > 6 ? grouped(d) : "",
        };
      })
      .filter((s) => s.widthPct > 0);

    const awarded = segments.reduce((sum, s) => sum + s.widthPct, 0);
    delegateRace = {
      lede: `Awarded delegates locked, remaining states projected. ${grouped(majority)} to clinch.`,
      segments,
      remainderPct: Math.max(0, 100 - awarded),
      clinchMarkerPct: (majority / total) * 100,
      clinchText: grouped(majority),
      totalText: grouped(total),
    };
  }

  // ── Your standing ─────────────────────────────────────────────────────────
  const meIndex = candidates.findIndex((c) => c.isYou);
  const me = meIndex >= 0 ? candidates[meIndex] : null;
  let you: PrimaryStandingVM | null = null;
  if (me) {
    const advancing = meIndex < advanceCount;
    // Lead over the next candidate, or the gap to the leader when trailing.
    const comparator = meIndex === 0 ? candidates[1] : candidates[0];
    const diff = comparator ? (me.sharePct ?? 0) - (comparator.sharePct ?? 0) : null;
    const myDelegates = party?.projectedDelegates?.[me.id];
    const majority = party?.delegateMajority;

    you = {
      share: `${(me.sharePct ?? 0).toFixed(1)}%`,
      rankText: `${meIndex + 1} of ${candidates.length}`,
      rankNum: meIndex + 1,
      lead: diff == null ? "—" : `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pts`,
      delegates: myDelegates != null ? grouped(myDelegates) : null,
      toClinch:
        myDelegates != null && majority != null
          ? grouped(Math.max(0, majority - myDelegates))
          : null,
      advancing,
      statusText: advancing ? "Projected to advance" : "Trailing",
      statusColor: advancing ? BLEND.positive : BLEND.caution,
    };
  }

  const standingNote = me
    ? null
    : `You are not filed in the ${party?.partyName ?? "selected"} primary. Switch to your own party to see your standing.`;

  // ── Calendar ──────────────────────────────────────────────────────────────
  const calendar: PrimaryCalendarRowVM[] = (election.primaryCalendar ?? []).map((w) => {
    if (w.status === "complete") {
      return { label: w.label, statusText: "COMPLETE", color: BLEND.positive };
    }
    // A wave fires with `turnsRemaining` left on the clock, so the wait is the
    // difference between now and that point.
    const turnsAway = closesIn == null ? null : Math.max(0, closesIn - w.turnsRemaining);
    return {
      label: w.label,
      statusText:
        turnsAway == null
          ? "UPCOMING"
          : turnsAway === 0
            ? "THIS TURN"
            : `IN ${turnsAway} TURN${turnsAway === 1 ? "" : "S"}`,
      color: BLEND.caution,
    };
  });

  // ── Header and vitals ─────────────────────────────────────────────────────
  const headline = `The ${selectedName} primary`;
  const standfirst = `${candidates.length} filed. ${advanceText}`;
  const turnReadout = [
    currentTurn != null ? `TURN ${grouped(currentTurn)}` : null,
    delegateRace ? `${delegateRace.clinchText} TO CLINCH` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const vitals: PrimaryBlendVM["vitals"] = [
    {
      label: "Your share",
      value: you?.share ?? "—",
      sub: you ? `rank ${you.rankText}` : "not filed",
      color: party?.partyColor,
    },
    {
      label: "Delegates",
      value: you?.delegates ?? "—",
      sub: you?.toClinch ? `${you.toClinch} to clinch` : delegateRace?.clinchText,
    },
    {
      label: "Field",
      value: String(candidates.length),
      sub: advanceCount === 1 ? "1 advances" : `${advanceCount} advance`,
    },
    {
      label: "Primary closes",
      value: closesIn == null ? "—" : String(closesIn),
      sub: "turns remaining",
      color: BLEND.caution,
    },
  ];

  const campaignHref = me?.campaignId ? `/campaign/${me.campaignId}` : null;

  return {
    headline,
    standfirst,
    turnReadout,
    closesIn,
    closesText,
    advanceText,
    selectedName,
    partyAccent: party?.partyColor ?? BLEND.accent,
    parties,
    field,
    delegateRace,
    you,
    standingNote,
    calendar,
    campaignHref,
    wire,
    vitals,
  };
}
