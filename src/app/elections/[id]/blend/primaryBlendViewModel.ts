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
import { buildCandidateColorMap } from "@/lib/campaigns/candidateColor";
import { buildPerStateSlices } from "@/lib/elections/primaryViewModel";
import type { CarveUpSlice } from "@/components/elections/primary/CarveUpPanel";
import type {
  PrimaryPartyDetail,
  PrimaryViewerCampaign,
} from "@/lib/elections/dto/primaryPartyDetail";
import { contrastTextColor } from "@/lib/utils/colorContrast";

export interface PrimaryBlendInput {
  election: ElectionDetail;
  /** Party whose field is on screen. Falls back to the first party. */
  selectedPartyId: string | null;
  /** Headlines from the per-race wire feed. */
  wire: string[];
  /**
   * Per-party board, carve-up and campaign data, fetched lazily once a party is
   * selected. Null until it lands, or when the fetch failed: the board, the
   * carve-up and the campaign block then simply do not render.
   */
  detail?: PrimaryPartyDetail | null;
  /** State the board and carve-up are focused on. Null defaults to the next wave. */
  selectedStateId?: string | null;
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
  /** Projected FINAL delegate count, not a running total. */
  delegates: string | null;
  /** Delegates already awarded, or null when the primary has awarded none yet. */
  delegatesAwarded: string | null;
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

export interface PrimaryCalendarStateVM {
  id: string;
  name: string;
  selected: boolean;
}

export interface PrimaryCalendarRowVM {
  label: string;
  statusText: string;
  color: string;
  /** The wave's states, so a row can expand into selectable chips. */
  states: PrimaryCalendarStateVM[];
}

export interface PrimaryTileVM {
  stateId: string;
  name: string;
  leaderId: string | null;
  leaderName: string | null;
  background: string;
  /** Chosen from the fill's own lightness, so a label never fades into it. */
  ink: string;
  /** True once the state's wave has fired, so the result is settled. */
  voted: boolean;
  title: string;
}

export interface PrimaryCarveUpVM {
  stateId: string;
  stateName: string;
  slices: CarveUpSlice[];
  /** The per-state drill-down, which the board deliberately does not replace. */
  detailHref: string;
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
  /** One tile per state on this party's calendar. Empty until the detail loads. */
  board: PrimaryTileVM[];
  carveUp: PrimaryCarveUpVM | null;
  /** The state the board and carve-up agree on. Null when there is no calendar. */
  selectedStateId: string | null;
  campaign: PrimaryViewerCampaign | null;
}

/**
 * Mix a hex colour toward the Blend track.
 *
 * A state that has only been projected reads as the same candidate at lower
 * conviction rather than as a different one, which keeps the board's colour
 * legend honest: hue is who leads, strength is how settled it is.
 */
function towardTrack(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
  const channels = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  const track = [0x1a, 0x1a, 0x25]; // BLEND.track
  const mixed = channels.map((c, i) =>
    Math.round(c + (track[i] - c) * amount)
      .toString(16)
      .padStart(2, "0")
  );
  return `#${mixed.join("")}`;
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
  const detail = inp.detail ?? null;

  const party = selectParty(election, selectedPartyId);
  const candidates = party?.candidates ?? [];

  // One colour per candidate for the whole screen.
  //
  // The delegate bar and the field rows used to fall back to the party's colour
  // whenever a candidate had set no campaign colour, which is the normal case:
  // a four-way primary drew as four identical blue segments. The board, built
  // server-side, already used this palette, so the same candidate could be one
  // colour in the bar and another on the tiles. Same function, same candidate
  // ids and same campaign colours as the builder, so the two agree.
  const colorById = buildCandidateColorMap(
    candidates.map((c) => ({ candidateId: c.id, campaignColor: c.campaignColor ?? null })),
    party?.partyId ?? "",
    party?.partyColor
  );
  const colorFor = (candidateId: string): string =>
    colorById[candidateId] ?? party?.partyColor ?? BLEND.muted;
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
  // Delegates actually locked in so far. Zero for everyone until the first wave
  // fires, which is most of a primary: the headline figure beside a name is a
  // forecast of the FINAL total, and unlabelled it reads as a running score.
  const awarded = party?.awardedDelegates;
  const anyAwarded = awarded ? Object.values(awarded).some((d) => d > 0) : false;

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
      /** Locked in so far. Null while nothing in this primary has been awarded. */
      delegatesAwarded:
        anyAwarded && awarded && awarded[c.id] != null ? grouped(awarded[c.id]) : null,
      advancing,
      isYou: c.isYou,
      isNPP: c.isNPP,
      statusText: advancing ? "Advancing" : "Eliminated at close",
      color: colorFor(c.id),
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
          color: colorFor(c.id),
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

  // ── Calendar, board and carve-up ──────────────────────────────────────────
  // All three read one selection, so a tile and a calendar chip can never
  // disagree about which state is on screen.
  const waves = election.primaryCalendar ?? [];
  const calendarStateIds = waves.flatMap((w) => w.states);
  const nameFor = (stateId: string) => detail?.stateNameById[stateId] ?? stateId;
  const voted = new Set(detail?.votedStateIds ?? []);

  /**
   * Whether a wave has run.
   *
   * The payload's own flag counts waves (`primaryStaggerWavesRun`) while the
   * detail lists the states that actually voted (`primaryWaveHistory`). They
   * are two records of one fact, and this screen is the first to show them side
   * by side: a wave whose states have all voted must not read as upcoming next
   * to a board that has already settled them. Either record alone is enough,
   * which is how the deep dive reconciles an ad-hoc admin force-resolve too.
   */
  const isWaveComplete = (w: (typeof waves)[number]) =>
    w.status === "complete" || (w.states.length > 0 && w.states.every((s) => voted.has(s)));

  const requested = inp.selectedStateId ?? null;
  const selectedStateId =
    requested && calendarStateIds.includes(requested)
      ? requested
      : // The next contest still to vote is what a player is deciding about;
        // fall back to the first on the calendar once they have all run.
        (waves.find((w) => !isWaveComplete(w) && w.states.length > 0)?.states[0] ??
        calendarStateIds[0] ??
        null);

  const calendar: PrimaryCalendarRowVM[] = waves.map((w) => {
    const states: PrimaryCalendarStateVM[] = w.states.map((id) => ({
      id,
      name: nameFor(id),
      selected: id === selectedStateId,
    }));
    if (isWaveComplete(w)) {
      return { label: w.label, statusText: "COMPLETE", color: BLEND.positive, states };
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
      states,
    };
  });

  const candidateById = new Map((detail?.candidates ?? []).map((c) => [c.id, c]));

  // The board lays out the calendar, not the country: a state that never votes
  // in this party's primary has no tile rather than an inert grey one.
  const board: PrimaryTileVM[] = detail
    ? calendarStateIds.map((stateId) => {
        const votes = Object.entries(detail.byState[stateId] ?? {}).filter(([, v]) => v > 0);
        // Sorted by candidate id under a tie so the board is stable between polls.
        votes.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const leaderId = votes[0]?.[0] ?? null;
        const leader = leaderId ? candidateById.get(leaderId) : undefined;
        const leaderColor = leaderId ? colorFor(leaderId) : null;
        const hasVoted = voted.has(stateId);
        const name = nameFor(stateId);

        const background =
          leader && leaderColor
            ? hasVoted
              ? leaderColor
              : towardTrack(leaderColor, 0.55)
            : BLEND.track;

        return {
          stateId,
          name,
          leaderId,
          leaderName: leader?.name ?? null,
          background,
          ink: leader ? contrastTextColor(background) : BLEND.mutedDim,
          voted: hasVoted,
          title: leader
            ? `${name}: ${leader.name} ${hasVoted ? "won" : "projected to win"}`
            : `${name}: no projection yet`,
        };
      })
    : [];

  const carveUp: PrimaryCarveUpVM | null =
    detail && selectedStateId
      ? {
          stateId: selectedStateId,
          stateName: nameFor(selectedStateId),
          // Recoloured through the same map as the bar and the tiles: the
          // server builds its own from the candidate rows, and if that set ever
          // differs from the payload's the palette index would shift and a
          // candidate would change colour between the donut and the board.
          slices:
            buildPerStateSlices(
              detail.candidates.map((c) => ({ ...c, color: colorFor(c.id) })),
              detail.byState
            )[selectedStateId] ?? [],
          detailHref: `/president/primary/${detail.partyId}/state/${selectedStateId}`,
        }
      : null;

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
    board,
    carveUp,
    selectedStateId,
    campaign: detail?.viewerCampaign ?? null,
  };
}
