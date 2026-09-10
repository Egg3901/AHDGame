import type { PoliticalParty, PrimarySnapshot, ElectionVoteTally } from "@/lib/db/types";
import {
  getMultiSeatMinShare,
  largestRemainderSeats,
  type MajoritarianBonusConfig,
} from "@/lib/turn/election/seatAllocation";
import type { PartyGroup } from "./candidateEnrichment";
import type { PollingData } from "./electionResponseTypes";
import { MULTI_SEAT_TYPES } from "@/lib/utils/electionLabels";

// ---------------------------------------------------------------------------
// Hamilton (Largest-Remainder) seat estimate helper
// ---------------------------------------------------------------------------

/**
 * Recalculates seat estimates from active-candidate vote totals using the
 * Hamilton/Largest-Remainder method. Returns null when the election is not a
 * multi-seat race or there are no votes yet.
 *
 * Applies the minimum vote-share threshold from getMultiSeatMinShare() to
 * match the logic used during actual election resolution.
 */
export function computeSeatEstimates(
  electionType: string,
  totalSeats: number | null | undefined,
  tally: ElectionVoteTally | null,
  activeCandidateIdSet: Set<string>,
  // FPTP winner's bonus (#3244): pass getMajoritarianBonus(electionType,
  // gameState.currentYear) so the projected-seats panel matches how the race
  // will actually resolve in historical in-game years (pre-1999).
  // Omitted/undefined → proportional (current behavior).
  majoritarianBonus?: MajoritarianBonusConfig
): Record<string, number> | null {
  // Same gate as the engine (allocateSeats + the per-turn estimate in
  // tallyManagement): every MULTI_SEAT_TYPES race, plus a "senate" race that
  // carries more than one seat (Nigerian zones). A private copy of the list
  // used to live here and had drifted to ten US/UK/JP/CN types, so the detail
  // page projected 0 seats for every Bundestag, Dail, Landtag, soviet and
  // eastern-bloc chamber the engine had already apportioned.
  const multiSeat =
    MULTI_SEAT_TYPES.has(electionType) || (electionType === "senate" && (totalSeats ?? 0) > 1);
  if (!totalSeats || !tally || !multiSeat) {
    return null;
  }

  const activeVotes: Record<string, number> = {};
  let totalActiveVotes = 0;
  for (const cid of activeCandidateIdSet) {
    const v = tally.totalVotes[cid] ?? 0;
    if (v > 0) {
      activeVotes[cid] = v;
      totalActiveVotes += v;
    }
  }
  if (totalActiveVotes === 0) return null;

  const minShare = getMultiSeatMinShare(electionType, {
    majoritarian: majoritarianBonus !== undefined,
  });

  // Eligibility, the fallback and Largest Remainder come from the resolver's
  // own implementation (#585), so the panel cannot drift from the seats the
  // race will actually resolve to. Two divergences used to live here and both
  // shipped to players (ticket #1032): the gate was PER-CANDIDATE while
  // resolution pools a party's candidates, and the fallback re-admitted every
  // candidate whenever fewer cleared the gate than min(totalSeats, candidates)
  // — which multi-seat chambers always satisfy, so ~11 of 12 Commons regions
  // applied no threshold at all and seated parties resolution zeroes.
  const { seats, poolVotes } = largestRemainderSeats(
    Object.entries(activeVotes).map(([cid, v]) => ({
      id: cid,
      votes: v,
      party: tally.candidateParties?.[cid],
    })),
    totalSeats,
    { minShare, totalVotesForShare: totalActiveVotes, majoritarianBonus }
  );
  if (poolVotes === 0) return null;

  return seats;
}

// ---------------------------------------------------------------------------
// Polling data builder
// ---------------------------------------------------------------------------

/**
 * The minimum a candidate row needs to appear in polling. `ElectionCandidate`
 * satisfies it structurally; so does a row rebuilt from a finished race's tally
 * after its candidacy document was deleted, which has no `characterId` left.
 */
export interface PollingCandidate {
  _id: { toString(): string };
  characterId?: { toString(): string } | null;
  characterName: string;
  party: string;
  isNPP?: boolean;
}

/**
 * Builds PollingData from tally or live primary scores.
 *
 * General phase: uses cumulative totalVotes from the tally, filtered to active
 * candidates and rescaled to 100% (matches the election detail page).
 *
 * Primary phase: prefers live per-party softmax shares from enriched party
 * groups (same source as the election detail "Labour Party" bars). Hourly
 * `primarySnapshots` are for trend charts only — using them for card % left
 * late joiners stuck at 0% on party/list surfaces (ticket-1022). Snapshot is
 * retained only as a fallback when live groups are not provided.
 *
 * Returns null when no meaningful data exists (prevents misleading equal-split display).
 */
export function buildPollingData(
  electionType: string,
  countryId: string,
  inPrimary: boolean,
  /**
   * Structural rather than `ElectionCandidate[]` so a finished race can also
   * pass rows REBUILT from the tally, whose candidacy document was deleted
   * after the fact (see `appendHistoricalTallyCandidates`). Without them the
   * polling donut rescales to a survivors-only denominator while the results
   * panel uses the published one, and the two disagree by several points on
   * the same race (#1276 / #1277).
   */
  activeCandidates: PollingCandidate[],
  parties: PoliticalParty[],
  tally: ElectionVoteTally | null,
  latestPrimarySnapshot: PrimarySnapshot | null,
  charPartyMap: Map<string, string>,
  /** Live primary party groups with `sharePct` already assigned (detail-page math). */
  livePrimaryByParty?: readonly PartyGroup[] | null
): PollingData | null {
  const activeCandidateIdSet = new Set(activeCandidates.map((c) => c._id.toString()));

  // Build name/party maps from authoritative DB data (NOT stale tally copies)
  const candidateNameById = new Map(
    activeCandidates.map((c) => [c._id.toString(), c.characterName])
  );
  const candidatePartyById = new Map(
    activeCandidates.map((c) => {
      // A row rebuilt from the tally has no character to look up, so it keeps
      // its ballot-time party — which is what an ended race wants anyway (#939).
      const charId = c.characterId ? c.characterId.toString() : null;
      const pid =
        !c.isNPP && charId && charPartyMap.has(charId)
          ? (charPartyMap.get(charId) ?? c.party)
          : c.party;
      return [c._id.toString(), pid] as const;
    })
  );

  // Party lookup maps for name/colour resolution (scoped by countryId)
  const partyNameMap = new Map(
    parties.map((p) => [`${p.countryId ?? "US"}_${p.sequentialId}`, p.name])
  );
  const partyColorMap = new Map(
    parties.map((p) => [`${p.countryId ?? "US"}_${p.sequentialId}`, p.color])
  );

  const resolvePartyName = (pid: string): string =>
    pid === "independent" ? "Independent" : (partyNameMap.get(`${countryId}_${pid}`) ?? pid);

  const resolvePartyColor = (pid: string): string =>
    pid === "independent" ? "#9CA3AF" : (partyColorMap.get(`${countryId}_${pid}`) ?? "#9CA3AF");

  const emptyPolling: PollingData = {
    leaderId: null,
    leaderName: null,
    leaderParty: null,
    sharesPct: {},
    candidateNames: {},
    candidateParties: {},
    candidatePartyNames: {},
    candidatePartyColors: {},
    source: null,
  };

  if (!inPrimary) {
    // General phase — use vote tally
    if (!tally || Object.keys(tally.totalVotes).length === 0) return null;

    // Compute from cumulative totalVotes to match the election detail page calculation
    let activeVoteTotal = 0;
    const activeCandidateVotes: Record<string, number> = {};
    for (const [cid, votes] of Object.entries(tally.totalVotes)) {
      if (activeCandidateIdSet.has(cid) && votes > 0) {
        activeCandidateVotes[cid] = votes;
        activeVoteTotal += votes;
      }
    }
    if (Object.keys(activeCandidateVotes).length === 0) return null;

    const filteredSharesPct: Record<string, number> = {};
    for (const [cid, votes] of Object.entries(activeCandidateVotes)) {
      filteredSharesPct[cid] =
        activeVoteTotal > 0 ? Math.round((votes / activeVoteTotal) * 100 * 10) / 10 : 0;
    }

    const filteredNames: Record<string, string> = {};
    const filteredParties: Record<string, string> = {};
    for (const cid of Object.keys(filteredSharesPct)) {
      const name = candidateNameById.get(cid);
      const party = candidatePartyById.get(cid);
      if (name) filteredNames[cid] = name;
      if (party) filteredParties[cid] = party;
    }

    const leaderId = Object.entries(filteredSharesPct).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const filteredPartyNames: Record<string, string> = {};
    const filteredPartyColors: Record<string, string> = {};
    for (const [cid, pid] of Object.entries(filteredParties)) {
      filteredPartyNames[cid] = resolvePartyName(pid);
      filteredPartyColors[cid] = resolvePartyColor(pid);
    }

    return {
      leaderId,
      leaderName: leaderId ? (filteredNames[leaderId] ?? null) : null,
      leaderParty: leaderId ? (filteredParties[leaderId] ?? null) : null,
      sharesPct: filteredSharesPct,
      candidateNames: filteredNames,
      candidateParties: filteredParties,
      candidatePartyNames: filteredPartyNames,
      candidatePartyColors: filteredPartyColors,
      source: "general",
    };
  }

  // Primary phase — prefer live enriched shares (detail-page parity).
  if (livePrimaryByParty && livePrimaryByParty.length > 0) {
    return buildLivePrimaryPolling(livePrimaryByParty, activeCandidateIdSet);
  }

  // Fallback: latest primary snapshot (legacy callers / tests without live groups)
  if (!latestPrimarySnapshot) return emptyPolling;

  const sharesPct: Record<string, number> = {};
  const candidateNames: Record<string, string> = {};
  const candidateParties: Record<string, string> = {};
  let topScore = -1;
  let leaderId: string | null = null;
  let leaderName: string | null = null;
  let leaderParty: string | null = null;

  for (const entries of Object.values(latestPrimarySnapshot.byParty)) {
    for (const entry of entries) {
      // Skip snapshot entries whose candidate is no longer active (e.g. they
      // withdrew or switched races after this snapshot was recorded). The
      // snapshot is not regenerated on withdrawal, so without this filter a
      // ghost candidate renders in the primary card — and unclickably, since
      // the renderer can't find them among the active candidates. Mirrors the
      // active-candidate filtering the general-phase branch already applies.
      if (!activeCandidateIdSet.has(entry.candidateId)) continue;
      sharesPct[entry.candidateId] = entry.sharePct;
      candidateNames[entry.candidateId] = entry.characterName;
      candidateParties[entry.candidateId] = entry.party;
      if (entry.sharePct > topScore) {
        topScore = entry.sharePct;
        leaderId = entry.candidateId;
        leaderName = entry.characterName;
        leaderParty = entry.party;
      }
    }
  }

  const primaryPartyNames: Record<string, string> = {};
  const primaryPartyColors: Record<string, string> = {};
  for (const [cid, pid] of Object.entries(candidateParties)) {
    primaryPartyNames[cid] = resolvePartyName(pid);
    primaryPartyColors[cid] = resolvePartyColor(pid);
  }

  return {
    leaderId,
    leaderName,
    leaderParty,
    sharesPct,
    candidateNames,
    candidateParties,
    candidatePartyNames: primaryPartyNames,
    candidatePartyColors: primaryPartyColors,
    source: "primary",
  };
}

/** Build primary polling from live party-group softmax shares. */
export function buildLivePrimaryPolling(
  livePrimaryByParty: readonly PartyGroup[],
  activeCandidateIdSet?: ReadonlySet<string>
): PollingData {
  const sharesPct: Record<string, number> = {};
  const candidateNames: Record<string, string> = {};
  const candidateParties: Record<string, string> = {};
  const candidatePartyNames: Record<string, string> = {};
  const candidatePartyColors: Record<string, string> = {};

  for (const group of livePrimaryByParty) {
    for (const candidate of group.candidates) {
      if (activeCandidateIdSet && !activeCandidateIdSet.has(candidate.id)) continue;
      sharesPct[candidate.id] = candidate.sharePct;
      candidateNames[candidate.id] = candidate.characterName;
      candidateParties[candidate.id] = group.partyId;
      candidatePartyNames[candidate.id] = group.partyName;
      candidatePartyColors[candidate.id] = group.partyColor;
    }
  }

  const leaderId = Object.entries(sharesPct).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

  return {
    leaderId,
    leaderName: leaderId ? (candidateNames[leaderId] ?? null) : null,
    leaderParty: leaderId ? (candidateParties[leaderId] ?? null) : null,
    sharesPct,
    candidateNames,
    candidateParties,
    candidatePartyNames,
    candidatePartyColors,
    source: "primary",
  };
}
