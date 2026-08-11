import type {
  ElectionCandidate,
  PoliticalParty,
  PrimarySnapshot,
  ElectionVoteTally,
} from "@/lib/db/types";
import {
  applyMajoritarianBonus,
  getMultiSeatMinShare,
  type MajoritarianBonusConfig,
} from "@/lib/turn/election/seatAllocation";
import type { PartyGroup } from "./candidateEnrichment";
import type { PollingData } from "./electionResponseTypes";

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
  if (
    !totalSeats ||
    !tally ||
    ![
      "house",
      "stateSenate",
      "commons",
      "snap_commons",
      "regionalCouncil",
      "shugiin",
      "snap_shugiin",
      "sangiin",
      "npcDelegate",
      "peoplesCongress",
    ].includes(electionType)
  ) {
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
  const allEntries = Object.entries(activeVotes);

  // Eligibility must match `allocateSeats` exactly, or the projected-seats
  // panel reports a different result than the one the race will actually
  // resolve to (ticket #1032). Two divergences used to live here:
  //
  //  1. The gate was PER-CANDIDATE, while resolution pools a party's
  //     candidates. A party splitting 30/21/8 across three candidates was
  //     judged on each candidate alone instead of its 59% aggregate.
  //  2. The fallback re-admitted EVERY candidate whenever fewer of them
  //     cleared the gate than `min(totalSeats, candidates)`. Multi-seat
  //     chambers always have more seats than candidates (UK Commons: 5-12
  //     candidates for 18-90 seats), so that condition demanded every single
  //     candidate clear the gate and therefore fired in 11 of 12 Commons
  //     regions — the panel applied no threshold at all and seated parties
  //     polling 1.7-6.6% that resolution zeroes.
  //
  // Now: pool by party (independents stand alone), and fall back to ranked
  // order ONLY in the degenerate case where nobody clears the gate.
  const groupKey = (cid: string) => {
    const party = tally.candidateParties?.[cid];
    return party && party !== "independent" ? `party:${party}` : `cand:${cid}`;
  };
  const votesByGroup = new Map<string, number>();
  for (const [cid, v] of allEntries) {
    const k = groupKey(cid);
    votesByGroup.set(k, (votesByGroup.get(k) ?? 0) + v);
  }
  const eligible = allEntries.filter(
    ([cid]) => (votesByGroup.get(groupKey(cid)) ?? 0) / totalActiveVotes >= minShare
  );
  const pool =
    eligible.length > 0
      ? eligible
      : [...allEntries].sort((a, b) => b[1] - a[1]).slice(0, Math.min(totalSeats, allEntries.length));
  const poolVotes = pool.reduce((s, [, v]) => s + v, 0);
  if (poolVotes === 0) return null;

  // Initialise all active candidates to 0
  const seats: Record<string, number> = {};
  for (const [cid] of allEntries) seats[cid] = 0;

  // Cube-law re-split of the top-two party groups (party from the tally's
  // candidateParties map; candidates without one stand alone). Effective
  // weights sum to poolVotes, so the Largest Remainder step is untouched.
  const effectiveVotes =
    majoritarianBonus && pool.length > 1
      ? applyMajoritarianBonus(
          pool.map(([cid, v]) => {
            const party = tally.candidateParties?.[cid];
            return {
              id: cid,
              votes: v,
              group: party && party !== "independent" ? `party:${party}` : `cand:${cid}`,
            };
          }),
          majoritarianBonus
        )
      : undefined;

  const allocs = pool.map(([cid, v]) => {
    const exact = ((effectiveVotes?.get(cid) ?? v) / poolVotes) * totalSeats;
    return { cid, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  let allocated = 0;
  for (const a of allocs) {
    seats[a.cid] = a.floor;
    allocated += a.floor;
  }
  const remaining = totalSeats - allocated;
  if (remaining > 0) {
    const sorted = [...allocs].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < remaining && i < sorted.length; i++) {
      seats[sorted[i].cid]++;
    }
  }
  return seats;
}

// ---------------------------------------------------------------------------
// Polling data builder
// ---------------------------------------------------------------------------

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
  activeCandidates: ElectionCandidate[],
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
      const pid =
        !c.isNPP && charPartyMap.has(c.characterId.toString())
          ? (charPartyMap.get(c.characterId.toString()) ?? c.party)
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
