/**
 * View-model builder for the "Blend" region election display — the broadcast
 * chrome / editorial count cards on a region page's Politics → Elections tab.
 *
 * Pure function over the `ElectionDisplay[]` the tab already fetches, plus a
 * party-abbreviation lookup and the region's electorate. No DB, no React, no
 * fetch — so the copy generation ("REP on track for 9 of 19", the standfirst,
 * the wire ticker) can be unit-tested against hand-rolled fixtures.
 *
 * Every figure here resolves from live election state. Where a figure the
 * design shows cannot be sourced (no turnout denominator, only one counted
 * turn, a method with no quota), the field is omitted rather than faked — the
 * card drops the chip instead of printing a placeholder.
 */

import { getElectionMethod, isMultiSeatMethod } from "@/lib/elections/electionMethod";
import { MULTI_SEAT_TYPES } from "@/lib/utils/electionLabels";
import type { CountryId, ElectionMethod } from "@/lib/constants/countries";
import type { ElectionDisplay } from "@/lib/db/types";

/** Where a race sits on the ballot. Drives the card kicker. */
export type BlendTier = "federal" | "presidential" | "regional";

/**
 * Phase as the card reports it. Distinct from `ElectionDisplay.status` because
 * the card must separate "counting" from "certified" and "filing" from
 * "primary", which `status` alone does not.
 */
export type BlendPhase = "upcoming" | "primary" | "general" | "final";

export interface BlendCandidateRow {
  candidateId: string;
  name: string;
  /** True when this is the viewing player's own candidacy. */
  isYou: boolean;
  partyAbbr: string;
  partyName: string;
  color: string;
  votes: number;
  /** Share of the race's counted vote, 0-100. */
  pct: number;
  pctStr: string;
  votesStr: string;
  /** Seats won/projected. Null for a race that awards no per-candidate seats. */
  seats: number | null;
  /** Rendered seat cell ("7", "344", "WON", or an em dash). */
  seatsCell: string;
  /**
   * Change in vote share against the previous turn's snapshot, in points.
   * Null on the first counted turn — there is nothing to difference against,
   * and "+0.0" would read as "held steady" rather than "no prior reading".
   */
  deltaPts: number | null;
  deltaStr: string;
  isWinner: boolean;
}

export interface BlendSegment {
  widthPct: number;
  color: string;
  /** Party abbreviation, blank on slivers too narrow to letter. */
  label: string;
  title: string;
}

export interface BlendPrimaryGroup {
  partyId: string;
  label: string;
  color: string;
  partyVotes: number;
  partyVotesStr: string;
  candidates: BlendCandidateRow[];
}

/** One "Votes in · 2,546,160 · 38.1% of Georgia ballots" chip. */
export interface BlendMetaChip {
  key: string;
  value: string;
  sub: string;
}

export interface BlendRaceCard {
  electionId: string;
  href: string;
  tier: BlendTier;
  phase: BlendPhase;
  title: string;
  kicker: string;
  callTag: string;
  seatLine: string;
  /** Column heading for the seat cell — "Seats" or "EV". */
  seatLabel: string;
  verdict: string;
  standfirst: string;
  meta: BlendMetaChip[];
  segments: BlendSegment[];
  rows: BlendCandidateRow[];
  primaryGroups: BlendPrimaryGroup[];
  /** Declared candidates, shown before any ballots exist. */
  slate: BlendCandidateRow[];
  showSeats: boolean;
  /**
   * Whether any row has a turn-on-turn delta to report. False on the first
   * counted turn, and on any tally without snapshots — the column is then
   * dropped rather than reserving width for a row of em dashes, which on a
   * three-up card is width the candidate names badly need.
   */
  showDelta: boolean;
  showTally: boolean;
  showSlate: boolean;
  isPrimary: boolean;
  /** Total ballots counted in this race, this phase. */
  ballots: number;
  /**
   * Whether this phase has actual ballots to report.
   *
   * A down-ballot primary only accrues ballots over its closing window (as
   * long as the race's general window; see `primaryBallotWindow`), and only
   * where the region has registration data. Before that, and on worlds
   * without it, a primary card carries standings and nothing to count, and
   * every vote figure on it must be suppressed rather than printed as zero.
   * Presidential primaries model per-state votes and always have a count once
   * their stagger waves start.
   */
  hasBallots: boolean;
  /**
   * False when the figures are a nationwide total rather than this region's own
   * count (the presidency during its primary). Consumers must not measure such
   * a race against the region's electorate or ballots.
   */
  regionScoped: boolean;
}

export interface BlendWireItem {
  text: string;
  color: string;
}

export interface PartyLookup {
  /** Party abbreviation ("REP"), falling back to the party name then its id. */
  abbr: (partyId: string) => string;
  name: (partyId: string) => string;
  color: (partyId: string) => string;
}

export interface BlendRegionInput {
  elections: ElectionDisplay[];
  countryId: CountryId;
  regionName: string;
  parties: PartyLookup;
  /** Viewing character's id, so their own row can be marked. */
  viewerCharacterId?: string | null;
  /**
   * Viewing character's party id, so a primary headline can name the field the
   * viewer can actually vote or stand in. Absent for signed-out or
   * unaffiliated viewers, which falls the headline back to the largest field.
   */
  viewerPartyId?: string | null;
  /**
   * Region electorate, with the basis it was measured on. Undefined, or a count
   * of 0, suppresses every turnout figure rather than dividing by a guess.
   */
  electorate?: RegionElectorate;
  /** LARP year per election id, for the race title. */
  gameYearById?: Record<string, number | null>;
  /** Pre-resolved race titles, keyed by election id. */
  titleById?: Record<string, string>;
  /** Pre-resolved detail hrefs, keyed by election id. */
  hrefById?: Record<string, string>;
  /** Tier per election id, decided by the caller's existing federal/regional split. */
  tierById?: Record<string, BlendTier>;
  /**
   * Region code the cards are being shown on (e.g. "GA"). Used to tell a race
   * counted IN this region from a nationwide one whose figures are national
   * totals — the presidency during its primary has no per-state breakdown at
   * all, and dividing its national vote by one region's electorate would
   * produce a turnout figure that is simply false.
   */
  regionCode?: string;
  /**
   * Ballots cast across the region's WHOLE ballot, for the "x% of <region>
   * ballots" figure. Supply this when the caller renders the ballot in more
   * than one section (federal / presidential / regional): each section only
   * sees its own races, so a locally-computed denominator would make every
   * section sum to 100% on its own.
   */
  regionBallots?: number;
  /**
   * Region-scoped vote totals, keyed by election id then candidate id. A
   * nationwide race (the presidency) stores a NATIONAL `generalTally`, which is
   * the wrong count for a region page: the card must report how this region
   * voted. Supplying the region's own subdivision totals here overrides the
   * national tally for that race.
   */
  regionVotesByElectionId?: Record<string, Record<string, number>>;
  /**
   * Electoral votes this region awards, for a winner-take-all presidency. When
   * absent the card falls back to seat language rather than inventing a count.
   */
  regionElectoralVotes?: number;
}

// Theme tokens, not hex: the wire renders on every theme, and the light and
// high-contrast palettes redefine both of these.
const MUTED = "var(--muted)";
const GOLD = "var(--gold)";

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * What the turnout denominator actually counts.
 *
 * `eligible` is the region's voting-eligible population, the real electorate.
 * `residents` is total population, used only when a world has no cohort
 * vectors and so no eligible figure at all. The two are NOT interchangeable —
 * dividing by total population understates turnout by roughly a quarter — so
 * the basis travels with the number and the label says which one it is.
 */
export type ElectorateBasis = "eligible" | "residents";

export interface RegionElectorate {
  count: number;
  basis: ElectorateBasis;
}

/**
 * How the denominator is described next to a turnout figure.
 *
 * Always "est.": the eligible population is a derived cohort figure that moves
 * every turn with aging-in and deaths, and the resident fallback is further
 * still from the set of people who could actually cast a ballot. Neither is an
 * exact roll, so neither should be printed as one.
 */
export function describeElectorate(e: RegionElectorate): string {
  return `est. ${fmtShort(e.count)} ${e.basis === "eligible" ? "eligible" : "residents"}`;
}

/** Compact figure for a denominator — "4.12M", "812K", "940". */
export function fmtShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

/** The phase the card reports, from stored status and the primary flag. */
export function blendPhase(election: ElectionDisplay): BlendPhase {
  // ElectionStatus is "upcoming" | "active" | "completed" | "resolved" | "cancelled".
  // "cancelled" is deliberately not special-cased: no other election surface
  // treats it either, and inventing a phase for it here would put copy on the
  // card that no other page agrees with.
  // These mirror `phases.ts`, which the server has already applied: `status`
  // and `inPrimary` on an ElectionDisplay ARE its isEnded / isUpcoming /
  // inPrimary decision. Re-deriving the phase from whether votes exist would
  // disagree with every other election surface the moment a tally is missing.
  const status = (election.status ?? "").toLowerCase();
  if (status === "completed" || status === "resolved") return "final";
  if (election.inPrimary) return "primary";
  if (status === "upcoming") return "upcoming";
  return "general";
}

/**
 * Ballots counted for the candidates this card actually lists.
 *
 * Deliberately NOT the sum of every key in the tally. From the general phase
 * on, the API returns one nominee per party while the tally still holds the
 * primary-losers' votes; summing the raw tally would put votes in the
 * denominator that appear against no row, and every share on the card would
 * silently under-report.
 */
function countedVotes(election: ElectionDisplay): number {
  const totals = election.generalTally?.totalVotes;
  if (!totals) return 0;
  return election.candidates.reduce((sum, c) => sum + (totals[c.id] ?? 0), 0);
}

/**
 * Whether the race hands out more than one seat, decided the way the engine
 * decides it: the multi-seat type list first, then the configured method for
 * the single-type races that remain.
 */
export function isMultiSeatRace(election: ElectionDisplay, countryId: CountryId): boolean {
  // The engine allocates every type in MULTI_SEAT_TYPES proportionally
  // whatever the configured method says (the RU/UKR/BLR/BAL soviets run "fptp"
  // yet seat a whole delegation), and a Nigerian senate zone carries more
  // than one seat under the single-seat US type. Mirror allocateSeats first;
  // the method only decides the remaining single-type races.
  if (
    MULTI_SEAT_TYPES.has(election.electionType) ||
    (election.electionType === "senate" && (election.totalSeats ?? 1) > 1)
  ) {
    return true;
  }
  const method =
    getElectionMethod(election.countryId as CountryId | undefined, election.electionType) ??
    getElectionMethod(countryId, election.electionType);
  if (!method) return (election.totalSeats ?? 1) > 1;
  return isMultiSeatMethod(method);
}

function methodOf(election: ElectionDisplay, countryId: CountryId): ElectionMethod | undefined {
  return (
    getElectionMethod(election.countryId as CountryId | undefined, election.electionType) ??
    getElectionMethod(countryId, election.electionType)
  );
}

/**
 * The Hare quota, but ONLY where the game actually allocates on one. The
 * mockup hardcodes "Hare quota" copy; the live game runs seven methods, so a
 * quota line on a Sainte-Lague or AMS race would be a straight fabrication.
 */
export function hareQuota(election: ElectionDisplay, countryId: CountryId): number | null {
  if (methodOf(election, countryId) !== "pr_hareQuota") return null;
  const seats = election.totalSeats ?? 0;
  if (seats <= 0) return null;
  const votes = countedVotes(election);
  if (votes <= 0) return null;
  return Math.round(votes / seats);
}

function phaseTag(phase: BlendPhase): string {
  switch (phase) {
    case "upcoming":
      return "Not open";
    case "primary":
      return "Primary";
    case "final":
      return "Completed";
    default:
      return "General";
  }
}

/**
 * Per-candidate rows for the general count. Shares are computed from cumulative
 * `totalVotes` (not a turn snapshot's `sharesPct`) so this card and the
 * election detail page cannot disagree — the same choice `ElectionCard` makes.
 */
function buildRows(
  election: ElectionDisplay,
  parties: PartyLookup,
  viewerCharacterId: string | null | undefined,
  multiSeat: boolean,
  phase: BlendPhase
): BlendCandidateRow[] {
  const totals = election.generalTally?.totalVotes ?? {};
  // Denominator over the listed field only — see `countedVotes`.
  const grandTotal = election.candidates.reduce((sum, c) => sum + (totals[c.id] ?? 0), 0);
  const snapshots = election.generalTally?.turnSnapshots ?? [];
  const prior = snapshots.length >= 2 ? snapshots[snapshots.length - 2].sharesPct : null;

  // Summary-mode responses carry no vote tally, only `polling`. Fall back to it
  // for shares so the card still reports the standings, the same fallback
  // `ElectionCard` makes. Vote counts and turn deltas have no substitute, so
  // those stay absent and their chips drop out.
  const pollingShares =
    grandTotal <= 0 && election.polling?.sharesPct ? election.polling.sharesPct : null;

  const seatsByCandidate = election.seatsEstimate ?? {};

  const rows: BlendCandidateRow[] = election.candidates.map((candidate) => {
    const votes = totals[candidate.id] ?? 0;
    const pct =
      grandTotal > 0
        ? (votes / grandTotal) * 100
        : pollingShares
          ? (pollingShares[candidate.id] ?? 0)
          : 0;
    const priorPct = prior ? (prior[candidate.id] ?? null) : null;
    const deltaPts = priorPct === null ? null : pct - priorPct;
    const seats = multiSeat ? (seatsByCandidate[candidate.id] ?? 0) : null;

    return {
      candidateId: candidate.id,
      name: candidate.characterName,
      isYou: !!viewerCharacterId && candidate.characterId === viewerCharacterId,
      partyAbbr: parties.abbr(candidate.party),
      partyName: candidate.partyName || parties.name(candidate.party),
      color: candidate.partyColor || parties.color(candidate.party),
      votes,
      pct,
      pctStr: pct.toFixed(1),
      votesStr: fmtInt(votes),
      seats,
      seatsCell: multiSeat ? String(seats ?? 0) : "—",
      deltaPts,
      deltaStr: deltaPts === null ? "—" : `${deltaPts >= 0 ? "+" : ""}${deltaPts.toFixed(1)}`,
      // Set below, once the field is sorted and the method is known.
      isWinner: false,
    };
  });

  rows.sort((a, b) => b.pct - a.pct || b.votes - a.votes);

  if (phase !== "final") return rows;

  // Who actually won, decided per method rather than off `seatsEstimate` alone.
  // A single-winner race takes the top of the count: for the presidency
  // `seatsEstimate` holds NATIONAL electoral votes, so "has seats" there would
  // badge every candidate who carried any state as the winner of THIS region.
  if (multiSeat) {
    for (const row of rows) row.isWinner = (row.seats ?? 0) > 0;
    return rows;
  }
  const leader = rows[0];
  if (leader && leader.votes > 0) {
    leader.isWinner = true;
    leader.seatsCell = "WON";
  }
  return rows;
}

/** Stacked share bar. Only segments wide enough to letter carry a label. */
function buildSegments(rows: BlendCandidateRow[]): BlendSegment[] {
  return rows
    .filter((r) => r.pct > 0)
    .map((r) => ({
      widthPct: r.pct,
      color: r.color,
      label: r.pct >= 9 ? r.partyAbbr : "",
      title: `${r.name} · ${r.partyAbbr} · ${r.pctStr}%`,
    }));
}

/**
 * Party groups for the primary phase. Each candidate's share is of their OWN
 * party's primary vote, never of the region total — the mockup is explicit
 * about this and the copy under the group repeats it.
 */
function buildPrimaryGroups(
  election: ElectionDisplay,
  parties: PartyLookup,
  viewerCharacterId: string | null | undefined
): BlendPrimaryGroup[] {
  const shares = election.polling?.sharesPct ?? {};
  const byParty = new Map<string, typeof election.candidates>();
  for (const candidate of election.candidates) {
    const list = byParty.get(candidate.party) ?? [];
    list.push(candidate);
    byParty.set(candidate.party, list);
  }

  const groups: BlendPrimaryGroup[] = [];
  for (const [partyId, candidates] of byParty) {
    const totals = candidates.map((c) => ({
      candidate: c,
      // Primary ballots live in their own field, accrued by the engine during
      // the primary window. The general tally must never feed a primary card:
      // its totalVotes are general-phase ballots (and are empty mid-primary on
      // any real world anyway).
      votes: election.primaryVotes?.[c.id] ?? 0,
      share: shares[c.id] ?? 0,
    }));
    const partyVotes = totals.reduce((sum, t) => sum + t.votes, 0);
    const shareTotal = totals.reduce((sum, t) => sum + t.share, 0);

    const rows = totals
      .map(({ candidate, votes, share }) => {
        // Within a primary the denominator is the party's own field, so a
        // party that has votes uses them and one that only has polling falls
        // back to renormalized shares.
        const pct =
          partyVotes > 0
            ? (votes / partyVotes) * 100
            : shareTotal > 0
              ? (share / shareTotal) * 100
              : candidates.length > 0
                ? 100 / candidates.length
                : 0;
        return {
          candidateId: candidate.id,
          name: candidate.characterName,
          isYou: !!viewerCharacterId && candidate.characterId === viewerCharacterId,
          partyAbbr: parties.abbr(candidate.party),
          partyName: candidate.partyName || parties.name(candidate.party),
          color: candidate.partyColor || parties.color(candidate.party),
          votes,
          pct,
          pctStr: pct.toFixed(1),
          votesStr: fmtInt(votes),
          seats: null,
          seatsCell: "—",
          deltaPts: null,
          deltaStr: "—",
          isWinner: false,
        } satisfies BlendCandidateRow;
      })
      .sort((a, b) => b.pct - a.pct);

    groups.push({
      partyId,
      label: candidates[0]?.partyName || parties.name(partyId),
      color: candidates[0]?.partyColor || parties.color(partyId),
      partyVotes,
      partyVotesStr: fmtInt(partyVotes),
      candidates: rows,
    });
  }

  return groups.sort((a, b) => b.partyVotes - a.partyVotes || a.label.localeCompare(b.label));
}

/** Seats aggregated by party. A party abbreviation is only ever printed
 *  against a party total, never against one candidate's seat count. */
function aggregateByParty(rows: BlendCandidateRow[]) {
  const acc = new Map<string, { abbr: string; color: string; seats: number; pct: number }>();
  for (const row of rows) {
    const entry = acc.get(row.partyAbbr) ?? {
      abbr: row.partyAbbr,
      color: row.color,
      seats: 0,
      pct: 0,
    };
    entry.seats += row.seats ?? 0;
    entry.pct += row.pct;
    acc.set(row.partyAbbr, entry);
  }
  return [...acc.values()].sort((a, b) => b.seats - a.seats || b.pct - a.pct);
}

function buildVerdict(
  phase: BlendPhase,
  title: string,
  rows: BlendCandidateRow[],
  groups: BlendPrimaryGroup[],
  multiSeat: boolean,
  totalSeats: number,
  regionName?: string,
  presidentialEv?: number,
  regionScoped = true,
  viewerPartyId?: string | null
): string {
  if (phase === "upcoming") return `${title} opens for filing`;
  if (phase === "primary") {
    // Prefer the viewer's own party field: that is the primary they can vote
    // or stand in, and it is the only party-to-party choice the card can make
    // honestly. Ranking parties by primary vote volume instead would compare
    // figures the card itself says are not comparable (each share is of that
    // party's own vote), and would mostly be measuring which primary drew the
    // bigger turnout. Signed-out and unaffiliated viewers fall back to the
    // largest field, which at least is a stable, explicable choice.
    const own = viewerPartyId ? groups.find((g) => g.partyId === viewerPartyId) : undefined;
    const top = own ?? groups[0];
    const leader = top?.candidates[0];
    if (!leader) return `${title} primary under way`;
    return own
      ? `${leader.name} leads your ${top.label} field`
      : `${leader.name} leads the ${top.label} field`;
  }
  const lead = rows[0];
  if (!lead) return `${title} awaiting a count`;
  // Winner-take-all: the region is carried, not a seat taken. Only claim that
  // when the count on screen is actually this region's.
  if (regionName && presidentialEv && regionScoped) {
    return `${lead.name} ${phase === "final" ? "carries" : "leads"} ${regionName}`;
  }
  if (!multiSeat) return `${lead.name} ${phase === "final" ? "takes" : "leads"} ${title}`;
  const top = aggregateByParty(rows)[0];
  if (!top) return `${lead.name} ${phase === "final" ? "takes" : "leads"} ${title}`;
  return `${top.abbr} ${phase === "final" ? "takes" : "on track for"} ${top.seats} of ${totalSeats}`;
}

function buildStandfirst(
  phase: BlendPhase,
  regionName: string,
  rows: BlendCandidateRow[],
  groups: BlendPrimaryGroup[],
  multiSeat: boolean,
  totalSeats: number,
  ballots: number,
  quota: number | null,
  presidentialEv?: number,
  regionScoped = true,
  viewerPartyId?: string | null
): string {
  if (phase === "upcoming") {
    return "Candidates may file until the primary window opens. No votes counted.";
  }
  if (phase === "primary") {
    const n = groups.length;
    const closer = regionScoped
      ? `nothing is settled against the ${regionName} total until the general`
      : "these are national totals, not this region's own count";
    // Lead with the same field the headline names, and with its actual numbers
    // — the general standfirst carries the count, and a primary reading as
    // boilerplate on every card told the reader nothing about THIS race.
    const own = viewerPartyId ? groups.find((g) => g.partyId === viewerPartyId) : undefined;
    const top = own ?? groups[0];
    const leader = top?.candidates[0];
    const runnerUp = top?.candidates[1];
    if (leader) {
      const counted = top.partyVotes > 0;
      const contest = runnerUp
        ? counted
          ? `${leader.name} carries ${leader.pctStr}% of the ${top.partyVotesStr} votes cast in the ${top.label} primary, with ${runnerUp.name} on ${runnerUp.pctStr}%.`
          : `${leader.name} leads the ${top.label} primary on ${leader.pctStr}%, with ${runnerUp.name} on ${runnerUp.pctStr}%.`
        : counted
          ? `${leader.name} is unopposed in the ${top.label} primary on ${top.partyVotesStr} votes.`
          : `${leader.name} is unopposed in the ${top.label} primary.`;
      const fields =
        n === 1
          ? "One party runs a field here"
          : `${n} parties run their own fields, so each share is of that party's own vote`;
      return `${contest} ${fields}; ${closer}.`;
    }
    return `${n} ${n === 1 ? "party runs its own field" : "parties run their own fields"}. Each share below is of that party's primary vote alone; ${closer}.`;
  }
  const lead = rows[0];
  const second = rows[1];
  if (!lead) return `No ballots counted in ${regionName} yet.`;
  if (presidentialEv) {
    return `${lead.pctStr}% against ${second ? second.pctStr : "0.0"}% takes all ${presidentialEv} of ${regionName}'s electoral votes, with no share of them for the runner-up. ${fmtInt(ballots)} votes counted here.`;
  }
  if (!multiSeat) {
    const margin = lead.pct - (second?.pct ?? 0);
    return `${lead.pctStr}% against ${second ? second.pctStr : "0.0"}%, a margin of ${margin.toFixed(1)} points on ${fmtInt(ballots)} votes.`;
  }
  const agg = aggregateByParty(rows);
  const top = agg[0];
  const next = agg[1];
  const quotaClause = quota
    ? `at a quota of ${fmtInt(quota)} that is ${top.seats} ${top.seats === 1 ? "seat" : "seats"}`
    : `that is ${top.seats} of ${totalSeats} ${top.seats === 1 ? "seat" : "seats"}`;
  const otherClause =
    next && next.seats > 0 ? `${next.abbr} on ${next.seats}` : "no other party seated";
  return `${top.abbr} carries ${top.pct.toFixed(1)}% of ${fmtInt(ballots)} votes; ${quotaClause}, with ${otherClause}. ${lead.name} tops the slate on ${lead.pctStr}%.`;
}

function buildMeta(
  phase: BlendPhase,
  regionName: string,
  ballots: number,
  regionBallots: number,
  electorate: RegionElectorate | undefined,
  groupCount: number,
  regionScoped: boolean,
  hasBallots: boolean
): BlendMetaChip[] {
  if (phase === "upcoming") return [];
  // Nothing was counted, so there is nothing to report. A primary before its
  // ballot window opens has standings only; printing "0 votes" and "0.0%
  // turnout" would invent a count the game has not produced.
  if (!hasBallots) return [];
  const chips: BlendMetaChip[] = [];

  if (phase === "primary") {
    chips.push({
      key: "Primary votes",
      value: fmtInt(ballots),
      sub: regionScoped
        ? `across ${groupCount} party ${groupCount === 1 ? "primary" : "primaries"}`
        : `counted nationwide across ${groupCount} party ${groupCount === 1 ? "primary" : "primaries"}`,
    });
  } else {
    chips.push({
      key: "Votes in",
      value: fmtInt(ballots),
      sub: !regionScoped
        ? "counted nationwide"
        : regionBallots > 0
          ? `${((ballots / regionBallots) * 100).toFixed(1)}% of ${regionName} ballots`
          : "",
    });
  }

  // Turnout needs a denominator that matches the numerator. No electorate on
  // this world, or a national vote total against one region's roll, means there
  // is no honest figure to print — drop the chip rather than invent one.
  if (regionScoped && electorate && electorate.count > 0) {
    chips.push({
      // A primary draws its own, smaller electorate: calling that plain
      // "Turnout" invites comparison with a general-election figure it is not
      // comparable to.
      key: phase === "primary" ? "Primary turnout" : "Turnout",
      value: `${((ballots / electorate.count) * 100).toFixed(1)}%`,
      sub: `of ${describeElectorate(electorate)}`,
    });
  }

  return chips;
}

/**
 * Build every Blend race card for one region's ballot.
 *
 * `regionBallots` — the denominator behind "x% of <region> ballots" — is the
 * sum across the races passed in, so it reports the share of the day's voting
 * that this race drew rather than an invented total.
 */
export function buildBlendRegionCards(input: BlendRegionInput): BlendRaceCard[] {
  const {
    elections,
    countryId,
    regionName,
    parties,
    viewerCharacterId,
    viewerPartyId,
    electorate,
    titleById = {},
    hrefById = {},
    tierById = {},
    regionVotesByElectionId = {},
    regionElectoralVotes,
    regionCode,
  } = input;

  /**
   * Whether this race's votes are counted in the region on screen. True when
   * region-scoped totals were supplied, or the race simply belongs to this
   * region. False for a nationwide race reporting a national total — its
   * figures must not be measured against the region's electorate or ballots.
   */
  const isRegionScoped = (election: ElectionDisplay) =>
    !!regionVotesByElectionId[election.id] ||
    !regionCode ||
    election.state?.toUpperCase() === regionCode.toUpperCase();

  // A nationwide race carries a national tally; on a region page the region's
  // own subdivision totals are the honest count, so swap them in before
  // anything reads votes off the election.
  const scoped = elections.map((election) => {
    const regionVotes = regionVotesByElectionId[election.id];
    if (!regionVotes) return election;
    return {
      ...election,
      generalTally: {
        totalVotes: regionVotes,
        // Region-scoped snapshots do not exist, so the "+/- Turn" column has
        // nothing to difference and correctly renders as no reading.
        turnSnapshots: [],
      },
    } satisfies ElectionDisplay;
  });

  // Only races actually counted in this region belong in the "% of <region>
  // ballots" denominator. Folding a nationwide race's national total in here
  // would shrink every other card's share to nonsense.
  const regionBallots =
    input.regionBallots ??
    scoped.reduce((sum, e) => sum + (isRegionScoped(e) ? countedVotes(e) : 0), 0);

  return scoped.map((election) => {
    const regionScoped = isRegionScoped(election);
    const phase = blendPhase(election);
    const multiSeat = isMultiSeatRace(election, countryId);
    const totalSeats = election.totalSeats ?? 1;
    const isPresident = election.electionType === "president";
    const tier: BlendTier = tierById[election.id] ?? (isPresident ? "presidential" : "regional");

    const rows = buildRows(election, parties, viewerCharacterId, multiSeat, phase);
    const groups =
      phase === "primary" ? buildPrimaryGroups(election, parties, viewerCharacterId) : [];
    const ballots =
      phase === "primary"
        ? groups.reduce((sum, g) => sum + g.partyVotes, 0)
        : countedVotes(election);
    const hasBallots = ballots > 0;
    const quota = hareQuota(election, countryId);
    const title = titleById[election.id] ?? election.electionType;

    // The presidency awards this region's electoral votes whole, so it reports
    // an EV line rather than "1 seat", which would badly understate it.
    const presidentialEv = isPresident ? regionElectoralVotes : undefined;
    const seatLine = presidentialEv
      ? `${presidentialEv} EV`
      : multiSeat
        ? `${totalSeats} ${totalSeats === 1 ? "seat" : "seats"}`
        : "1 seat";

    const tierWord = tier === "regional" ? "REGIONAL" : "FEDERAL";
    // The mockup's kicker repeated the seat count, because its race titles were
    // bare chamber names with no seat count in them. This app's
    // `electionRaceTitle` already ends in "· 10 seats", so repeating it here and
    // again in the header's seat line printed the same figure three times on one
    // card. The kicker carries the method instead, which the card had nowhere
    // else to state.
    const kicker = presidentialEv
      ? `${tierWord} · ${presidentialEv} ELECTORAL VOTES`
      : multiSeat
        ? `${tierWord} · PROPORTIONAL`
        : `${tierWord} · SINGLE WINNER`;

    // Suppress the header's seat line when the canonical title already states
    // the seat count.
    const titleStatesSeats = /\d/.test(title) && /seat/i.test(title);

    return {
      electionId: election.id,
      href: hrefById[election.id] ?? `/elections/${election.id}`,
      tier,
      phase,
      title,
      kicker,
      callTag: phaseTag(phase),
      seatLine: titleStatesSeats && !presidentialEv ? "" : seatLine,
      seatLabel: presidentialEv ? "EV" : "Seats",
      verdict: buildVerdict(
        phase,
        title,
        rows,
        groups,
        multiSeat,
        totalSeats,
        regionName,
        presidentialEv,
        regionScoped,
        viewerPartyId
      ),
      standfirst: buildStandfirst(
        phase,
        regionName,
        rows,
        groups,
        multiSeat,
        totalSeats,
        ballots,
        quota,
        presidentialEv,
        regionScoped,
        viewerPartyId
      ),
      meta: buildMeta(
        phase,
        regionName,
        ballots,
        regionBallots,
        electorate,
        groups.length,
        regionScoped,
        hasBallots
      ),
      segments: phase === "primary" || phase === "upcoming" ? [] : buildSegments(rows),
      rows,
      primaryGroups: groups,
      slate: phase === "upcoming" ? rows : [],
      showSeats: multiSeat && phase !== "upcoming",
      showDelta: rows.some((r) => r.deltaPts !== null),
      showTally: phase === "general" || phase === "final",
      showSlate: phase === "upcoming",
      isPrimary: phase === "primary",
      ballots,
      hasBallots,
      regionScoped,
    } satisfies BlendRaceCard;
  });
}

/**
 * The wire ticker under the cards. Reads the FEATURED race — the one with the
 * most ballots, i.e. the biggest thing on the region's ballot — because a
 * ticker naming every race in a 5-race region scrolls for a minute.
 *
 * Returns an empty list when there is nothing true to say; the caller hides
 * the ticker rather than scrolling filler.
 */
export function buildBlendWire(
  cards: BlendRaceCard[],
  opts: {
    regionName: string;
    electorate?: RegionElectorate;
    quotaByElectionId?: Record<string, number | null>;
  }
): BlendWireItem[] {
  if (cards.length === 0) return [];
  const featured = [...cards].sort((a, b) => b.ballots - a.ballots)[0];
  const items: BlendWireItem[] = [];

  if (featured.phase === "upcoming") {
    for (const row of featured.slate) {
      items.push({ text: `${row.partyAbbr} ${row.name} · declared`, color: row.color });
    }
    items.push({
      text: `${cards.length} ${opts.regionName} ${cards.length === 1 ? "race" : "races"} open · no ballots cast`,
      color: MUTED,
    });
    return items;
  }

  if (featured.isPrimary) {
    for (const group of featured.primaryGroups) {
      const leader = group.candidates[0];
      if (!leader) continue;
      items.push({
        text:
          group.partyVotes > 0
            ? `${group.label} · ${leader.name} leads on ${leader.pctStr}% of ${group.partyVotesStr} primary votes`
            : `${group.label} · ${leader.name} leads on ${leader.pctStr}%`,
        color: group.color,
      });
    }
    items.push({
      text: `Nothing is allocated until the general`,
      color: MUTED,
    });
    return items;
  }

  for (const row of featured.rows) {
    const seatClause =
      row.seats !== null ? ` · ${row.seats} ${row.seats === 1 ? "seat" : "seats"}` : "";
    const deltaClause = row.deltaPts === null ? "" : ` · ${row.deltaStr} pts`;
    items.push({
      text: `${row.partyAbbr} ${row.name} · ${row.pctStr}%${seatClause}${deltaClause}`,
      color: row.color,
    });
  }

  const quota = opts.quotaByElectionId?.[featured.electionId] ?? null;
  if (quota) {
    items.push({ text: `Quota ${fmtInt(quota)} votes per seat`, color: GOLD });
  } else if (!featured.showSeats && featured.rows.length >= 2) {
    const margin = featured.rows[0].pct - featured.rows[1].pct;
    items.push({
      text: `Single seat · margin ${margin.toFixed(1)} pts over the runner-up`,
      color: GOLD,
    });
  }

  // Same rule as the card: a nationwide total has no business being divided by
  // one region's roll.
  if (featured.regionScoped && opts.electorate && opts.electorate.count > 0) {
    const turnout = (featured.ballots / opts.electorate.count) * 100;
    items.push({
      text: `${opts.regionName} turnout ${turnout.toFixed(1)}%`,
      color: MUTED,
    });
  }

  return items;
}
