/**
 * Per-tier primary aggregator for the non-presidential primary screens
 * (`/elections/primary/senate/[partyId]`, `/elections/primary/governor/...`,
 * `/elections/primary/house/...`). Loads every active or upcoming primary
 * of the given race tier in the country, filters candidates to the
 * requested party, and computes a leading-candidate-per-state summary
 * suitable for state-level map rendering.
 *
 * Presidential primaries deliberately route through their own dedicated
 * surface (`/president/primary/[partyId]`) and are NOT covered here —
 * they have different mechanics (national delegate calendar, stagger
 * waves) that don't generalize across the lower tiers.
 *
 * See plan §"Tier selector activation".
 */
import type { Db, ObjectId } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  Character,
  NPP,
  PoliticalParty,
  State,
  StatePartyOrg,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  enrichElectionCandidates,
  groupCandidatesByParty,
} from "@/lib/elections/candidateEnrichment";

export type LowerTier = "senate" | "stateSenate" | "governor" | "house";

export interface TierPrimaryAggregateCandidate {
  candidateId: string;
  candidateName: string;
  characterId: string | null;
  nppId: string | null;
  isNPP: boolean;
  votes: number;
  /**
   * Projected primary score (party-alignment + favorability + influence,
   * computed by `calcPrimaryScore` + NPP penalty). Used to rank
   * candidates within a state before any votes have been cast.
   */
  primaryScore: number;
  /**
   * Projected share of the state's primary (0..100). Computed by
   * dividing `primaryScore` by the state's score total — matches the
   * state primary detail page's per-candidate progress-bar percentage.
   * When the live tally has votes, the same field carries the actual
   * vote share instead.
   */
  sharePct: number;
  isProjected: boolean;
}

export interface TierPrimaryAggregateState {
  stateId: string;
  electionId: string;
  /** Sorted desc by sharePct. Top entry is the state's leader for this party. */
  candidates: TierPrimaryAggregateCandidate[];
  /** Total seats up for grabs in this state's primary (used by House for district allocation). */
  totalSeats: number;
  /** True once this party's candidates have non-zero votes in the tally. */
  hasResults: boolean;
}

export interface TierPrimaryAggregate {
  tier: LowerTier;
  partyId: string;
  countryId: CountryId;
  /** Keyed by stateId. Includes only states with at least one party candidate. */
  byState: Record<string, TierPrimaryAggregateState>;
}

/**
 * Load and aggregate active/upcoming primary contests of one race tier
 * for a single party in a single country.
 */
export async function loadTierPrimaryAggregate(
  db: Db,
  countryId: CountryId,
  tier: LowerTier,
  partyId: string
): Promise<TierPrimaryAggregate> {
  const elections = await db
    .collection<Election>("elections")
    .find({
      countryId,
      electionType: tier,
      status: { $in: ["active", "upcoming"] },
    })
    .toArray();

  if (elections.length === 0) {
    return {
      tier,
      partyId,
      countryId,
      byState: {},
    };
  }

  const electionIds = elections.map((e) => e._id);
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      electionId: { $in: electionIds },
      party: partyId,
      status: "active",
    })
    .toArray();

  if (candidates.length === 0) {
    return {
      tier,
      partyId,
      countryId,
      byState: {},
    };
  }

  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find({ electionId: { $in: electionIds } })
    .toArray();
  const tallyByElection = new Map<string, ElectionVoteTally>();
  for (const t of tallies) {
    tallyByElection.set(t.electionId.toString(), t);
  }

  // Batch-fetch the deps `enrichElectionCandidates` needs. We then slice them
  // per-election below — the goal is to call the SAME enricher the state
  // primary detail page uses (it's the source of truth for primaryScore +
  // sharePct + the NPP penalty). Re-using it avoids duplicating the math.
  const characterIds = candidates
    .filter((c) => !c.isNPP && c.characterId)
    .map((c) => c.characterId);
  const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId as ObjectId);
  const stateIds = [...new Set(elections.map((e) => e.state))];
  const [chars, npps, parties, statePartyOrgs, stateDocs] = await Promise.all([
    characterIds.length
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: characterIds } })
          .toArray()
      : [],
    nppIds.length
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } })
          .toArray()
      : [],
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
    stateIds.length
      ? db
          .collection<StatePartyOrg>("statePartyOrg")
          .find({ countryId, stateId: { $in: stateIds } })
          .toArray()
      : [],
    stateIds.length
      ? db
          .collection<State>("states")
          .find({ _id: { $in: stateIds } })
          .toArray()
      : [],
  ]);

  const charName = new Map(chars.map((c) => [c._id.toString(), c.name]));
  const nppName = new Map(npps.map((n) => [n._id.toString(), n.name]));
  const charsById = new Map(chars.map((c) => [c._id.toString(), c]));
  const nppsById = new Map(npps.map((n) => [n._id.toString(), n]));
  const stateById = new Map(stateDocs.map((s) => [s._id, s]));
  const statePartyOrgsByState = new Map<string, StatePartyOrg[]>();
  for (const spo of statePartyOrgs) {
    const bucket = statePartyOrgsByState.get(spo.stateId) ?? [];
    bucket.push(spo);
    statePartyOrgsByState.set(spo.stateId, bucket);
  }

  // Party lookup map is invariant across the loop — compute once.
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

  // Per-election (== per-state) enrichment + share calculation. Each call
  // produces the same `sharePct` the state primary detail page does — same
  // function, same inputs (modulo endorsements/campaigns, which we omit
  // because they're not loaded here; their absence reduces favorability
  // bonuses but doesn't change the ranking direction).
  const sharePctByCandidate = new Map<string, number>();
  const scoreByCandidate = new Map<string, number>();
  for (const election of elections) {
    const electionCandidates = candidates.filter((c) => c.electionId.equals(election._id));
    if (electionCandidates.length === 0) continue;

    const electionCharIds = new Set(
      electionCandidates
        .filter((c) => !c.isNPP && c.characterId)
        .map((c) => c.characterId.toString())
    );
    const electionNppIds = new Set(
      electionCandidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!.toString())
    );
    const electionChars = [...electionCharIds]
      .map((id) => charsById.get(id))
      .filter((c): c is Character => Boolean(c));
    const electionNpps = [...electionNppIds]
      .map((id) => nppsById.get(id))
      .filter((n): n is NPP => Boolean(n));

    const enriched = enrichElectionCandidates({
      candidates: electionCandidates,
      characters: electionChars,
      npps: electionNpps,
      parties,
      nppEndorsements: [],
      playerEndorsements: [],
      campaigns: [],
      statePartyOrgs: statePartyOrgsByState.get(election.state) ?? [],
      isPresident: false,
      myCharId: null,
      states: stateById,
      electionSeatId: election.seatId ?? null,
    });

    // groupCandidatesByParty computes the sharePct = primaryScore /
    // totalPartyScore * 100 — same math the state page surfaces on its
    // progress bars.
    const grouped = groupCandidatesByParty(enriched, partyMap);
    for (const group of grouped) {
      for (const ec of group.candidates) {
        sharePctByCandidate.set(ec.id, ec.sharePct);
        scoreByCandidate.set(ec.id, ec.primaryScore);
      }
    }
  }

  const electionsById = new Map(elections.map((e) => [e._id.toString(), e]));

  // Group candidates by election (== state for these tiers).
  const candidatesByElection = new Map<string, ElectionCandidate[]>();
  for (const cand of candidates) {
    const key = cand.electionId.toString();
    const bucket = candidatesByElection.get(key) ?? [];
    bucket.push(cand);
    candidatesByElection.set(key, bucket);
  }

  const byState: Record<string, TierPrimaryAggregateState> = {};

  for (const [electionIdStr, stateCandidates] of candidatesByElection) {
    const election = electionsById.get(electionIdStr);
    if (!election) continue;

    const tally = tallyByElection.get(electionIdStr);
    // During the primary phase, `tally.totalVotes` accumulates per-candidate
    // votes for the primary contest across every party in the election (the
    // tally is reset to the general at primary close). For pre-active
    // elections or those with no tally row yet, votes default to 0 and the
    // contest renders as "no leader yet". `hasResults` flags whether THIS
    // party's primary has any votes yet — we ignore other parties' votes
    // so a parallel R primary doesn't make the D primary report "live".
    const totalVotes = tally?.totalVotes ?? {};
    const partyVotesSum = stateCandidates.reduce(
      (sum, c) => sum + (totalVotes[c._id.toString()] ?? 0),
      0
    );
    const hasResults = partyVotesSum > 0;

    // When the live tally has party votes, sharePct is the actual vote
    // percentage within this party's primary — overrides the projected
    // sharePct from `enrichElectionCandidates`. Pre-primary, the projected
    // sharePct (= primaryScore / totalPartyScore × 100) is the same number
    // the state primary detail page renders on its progress bars.
    const aggCandidates: TierPrimaryAggregateCandidate[] = stateCandidates.map((c) => {
      const cidStr = c._id.toString();
      const votes = totalVotes[cidStr] ?? 0;
      const primaryScore = scoreByCandidate.get(cidStr) ?? 0;
      const projectedShare = sharePctByCandidate.get(cidStr) ?? 0;
      const sharePct = hasResults
        ? Math.round((votes / partyVotesSum) * 1000) / 10
        : projectedShare;
      const name = c.isNPP
        ? c.nppId
          ? (nppName.get(c.nppId.toString()) ?? c.characterName)
          : c.characterName
        : (charName.get(c.characterId.toString()) ?? c.characterName);
      return {
        candidateId: cidStr,
        candidateName: name,
        characterId: c.isNPP ? null : c.characterId.toString(),
        nppId: c.isNPP ? (c.nppId?.toString() ?? null) : null,
        isNPP: Boolean(c.isNPP),
        primaryScore,
        sharePct,
        votes,
        isProjected: !hasResults,
      };
    });
    // Sort by sharePct desc — works in both phases since the field
    // carries actual vote share (post-primary-start) or projected share
    // (pre-primary). Stable candidateId tie-break for deterministic order.
    aggCandidates.sort((a, b) => {
      if (b.sharePct !== a.sharePct) return b.sharePct - a.sharePct;
      return a.candidateId.localeCompare(b.candidateId);
    });

    byState[election.state] = {
      stateId: election.state,
      electionId: electionIdStr,
      candidates: aggCandidates,
      totalSeats: election.totalSeats ?? 1,
      hasResults,
    };
  }

  return {
    tier,
    partyId,
    countryId,
    byState,
  };
}
