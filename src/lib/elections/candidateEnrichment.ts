import type {
  ElectionCandidate,
  Character,
  NPP,
  PoliticalParty,
  NPPEndorsement,
  PlayerEndorsement,
  Campaign,
  StatePartyOrg,
  State,
} from "@/lib/db/types";
import {
  calcPrimaryScore,
  calcPresidentPrimaryScore,
  primarySharePctSoftmax,
  effectivePartyInfluenceForPresidentialPrimary,
  buildPartyChairMaps,
  resolvePartyChairPrimaryRole,
} from "@/lib/primaryScore";
import { NPP_PRIMARY_SCORE_MULTIPLIER } from "@/lib/electionEngine/constants";
import { parseSeatId } from "@/lib/seats/seatId";

function clampPercentStat(value: number, fallback: number): number {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, safeValue));
}

export interface EnrichedCandidate {
  id: string;
  characterId: string | null;
  characterName: string;
  avatarUrl?: string;
  party: string;
  partyName: string;
  partyColor: string;
  partyEcon: number;
  partySocial: number;
  isNPP: boolean;
  nppId: string | null;
  economicPosition: number;
  socialPosition: number;
  favorability: number;
  politicalInfluence: number;
  nationalInfluence: number;
  /**
   * Character infamy (0..100). NPPs leave this undefined — yields no penalty
   * downstream in vote distribution.
   */
  infamy?: number;
  primaryScore: number;
  sharePct: number;
  enteredAt: Date;
  endorsements: Array<{
    type: "npp" | "player";
    nppId?: string;
    nppName?: string;
    source?: "organic" | "arranged";
    characterId?: string;
    characterName?: string;
  }>;
  isYou: boolean;
  runningMateId?: string | null;
  runningMateCharacterId?: string | null;
  runningMateName?: string | null;
  campaignId?: string | null;
  campaignFunds?: number | null;
  campaignColor?: string | null;
  campaignStrength?: number | null;
  /** Presidential races: state the candidate is currently campaigning in */
  travelState?: string | null;
  /** Presidential general: nominee suspended campaigning. */
  campaignSuspended?: boolean;
  /** Active endorsement target name when `campaignSuspended`. */
  endorsedCandidateName?: string | null;
  /** Endorsed nominee withdrew; EV transfers from this candidate have stopped. */
  endorsementTargetWithdrawn?: boolean;

  /**
   * Phase B Support score (0..100). Populated for every candidate by
   * `enrichElectionCandidates`, then stripped to `undefined` for
   * non-privileged viewers in `_enrichElection` per fog-of-war. The
   * PersuasionDrivers card uses this to compute the supportDelta
   * driver row — undefined falls back to a neutral 50 (driver = 0)
   * downstream.
   */
  support?: number;
}

export interface EnrichmentDependencies {
  candidates: ElectionCandidate[];
  characters: Character[];
  npps: NPP[];
  parties: PoliticalParty[];
  nppEndorsements: NPPEndorsement[];
  playerEndorsements: PlayerEndorsement[];
  campaigns: Campaign[];
  statePartyOrgs: StatePartyOrg[];
  isPresident: boolean;
  myCharId: string | null;
  /**
   * Optional. State documents keyed by stateId/regionId. Used to look up
   * `cachedEconomicLean`/`cachedSocialLean` for state-level primary scoring.
   * Caller passes only the states relevant to the elections being enriched.
   */
  states?: Map<string, State>;
  /**
   * Optional. The seatId of the election being enriched (e.g. `US-senate-TX-2`).
   * When provided, the local region is parsed from this seatId and used to
   * look up the state in `states` for state-aware alignment. Omit for races
   * without a single regional electorate (e.g. presidential).
   */
  electionSeatId?: string | null;
  /**
   * When true (ended / historical elections), labels and colours use the
   * candidacy-row party (`ElectionCandidate.party`) instead of the character's
   * live `character.party`. Prevents party switches after the race from
   * recolouring old results. In-progress races leave this false so the UI
   * still tracks live affiliation. (#939)
   */
  preferBallotParty?: boolean;
}

export function enrichElectionCandidates(deps: EnrichmentDependencies): EnrichedCandidate[] {
  const {
    candidates,
    characters,
    npps,
    parties,
    nppEndorsements,
    playerEndorsements,
    campaigns,
    statePartyOrgs,
    isPresident,
    myCharId,
    states,
    electionSeatId,
    preferBallotParty = false,
  } = deps;

  // Resolve state-of-race lean for state-level alignment in calcPrimaryScore.
  // Returns undefined when seatId is missing, parses to a non-region race
  // (e.g. presidential), or the state document/cached leans are absent.
  let raceStateEconLean: number | null | undefined;
  let raceStateSocialLean: number | null | undefined;
  if (!isPresident && electionSeatId && states) {
    const parsed = parseSeatId(electionSeatId);
    const regionId = parsed.localRegionId;
    if (regionId) {
      const state = states.get(regionId);
      if (
        state &&
        typeof state.cachedEconomicLean === "number" &&
        typeof state.cachedSocialLean === "number"
      ) {
        raceStateEconLean = state.cachedEconomicLean;
        raceStateSocialLean = state.cachedSocialLean;
      }
    }
  }

  // Build lookup maps
  const charMap = new Map(characters.map((c) => [c._id.toString(), c]));
  const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));
  const electionCandidateById = new Map(candidates.map((c) => [c._id.toString(), c]));
  // nppEndorsements.candidateId is the character/NPP identity id (see
  // getEndorsementTargetId); playerEndorsements.candidateId is the
  // electionCandidates row id (ticket #868). Both get normalized to row id
  // below so `endorsementsByCandidate` has one consistent key space.
  const rowIdByIdentityId = new Map(
    candidates.map((c) => [c.characterId.toString(), c._id.toString()])
  );
  // IMPORTANT: Callers must pre-filter parties by countryId to avoid cross-country collisions
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));
  const partyChairMaps = buildPartyChairMaps(parties, statePartyOrgs);
  const partyOrgByStateParty = new Map<string, number>();
  for (const po of statePartyOrgs) {
    partyOrgByStateParty.set(`${po.stateId}_${po.partyId}`, po.organization ?? 0);
  }

  // Campaign lookup by candidateId (character/NPP ObjectId)
  const campaignByCandidate = new Map<
    string,
    { id: string; funds: number; color?: string | null; campaignStrength?: number }
  >();
  for (const camp of campaigns) {
    campaignByCandidate.set(camp.candidateId.toString(), {
      id: camp._id.toString(),
      funds: camp.funds,
      color: camp.color ?? null,
      campaignStrength: camp.campaignStrength ?? undefined,
    });
  }

  // Group endorsements by candidate (NPP + player)
  const endorsementsByCandidate = new Map<
    string,
    Array<{
      type: "npp" | "player";
      nppId?: string;
      nppName?: string;
      source?: "organic" | "arranged";
      characterId?: string;
      characterName?: string;
    }>
  >();
  for (const e of nppEndorsements) {
    const identityId = e.candidateId.toString();
    const cid = rowIdByIdentityId.get(identityId) ?? identityId;
    if (!endorsementsByCandidate.has(cid)) endorsementsByCandidate.set(cid, []);
    endorsementsByCandidate.get(cid)!.push({
      type: "npp",
      nppId: e.nppId.toString(),
      nppName: e.nppName,
      source: e.source ?? "arranged",
    });
  }
  for (const e of playerEndorsements) {
    const cid = e.candidateId.toString();
    if (!endorsementsByCandidate.has(cid)) endorsementsByCandidate.set(cid, []);
    endorsementsByCandidate.get(cid)!.push({
      type: "player",
      characterId: e.characterId.toString(),
      characterName: e.characterName,
    });
  }

  // Enrich each candidate
  const enrichedCandidates = candidates.map((c) => {
    const cid = c._id.toString();
    // Ballot / primary mechanics use the candidate row (entry-time party).
    // In-progress races: labels follow current character.party so UI matches
    // profile after leaving/joining a party. Ended races: keep the ballot
    // party so historical maps/results are not recoloured by later switches (#939).
    const charForDisplay = !c.isNPP ? charMap.get(c.characterId.toString()) : undefined;
    const displayPartyKey =
      preferBallotParty || c.isNPP ? c.party : (charForDisplay?.party ?? c.party);

    const party = partyMap.get(c.party);
    const partyEcon = party?.economicPosition ?? 0;
    const partySocial = party?.socialPosition ?? 0;
    const displayParty = partyMap.get(displayPartyKey);
    const partyColor = displayParty?.color ?? "#888888";
    const partyName = displayParty?.name ?? displayPartyKey;

    let econ = 0,
      social = 0,
      favorability = 50,
      politicalInfluence = 0,
      nationalInfluence: number | undefined;

    if (c.isNPP && c.nppId) {
      const npp = nppMap.get(c.nppId.toString());
      if (npp) {
        econ = npp.policies.economic;
        social = npp.policies.social;
        favorability = npp.favorability;
        politicalInfluence = npp.politicalInfluence;
      }
    } else {
      const char = charMap.get(c.characterId.toString());
      if (char) {
        econ = char.policies.economic;
        social = char.policies.social;
        favorability = char.favorability;
        politicalInfluence = char.politicalInfluence;
        nationalInfluence = char.nationalInfluence;
      }
    }

    favorability = clampPercentStat(favorability, 50);
    politicalInfluence = clampPercentStat(politicalInfluence, 0);

    const candidateInfamy = c.isNPP
      ? undefined
      : (charMap.get(c.characterId.toString())?.infamy ?? 0);

    let primaryScore = isPresident
      ? (() => {
          // Party influence (candidate's own party clout), NPPs have none. See #934.
          // National chairs get +25% on the value used for primary calcs.
          // State chairs get no boost on the national snapshot (geographic only).
          const rawPartyInfluence = c.isNPP
            ? 0
            : (charMap.get(c.characterId.toString())?.partyInfluence ?? 0);
          const role = c.isNPP
            ? null
            : resolvePartyChairPrimaryRole(c.characterId.toString(), partyChairMaps);
          const partyInfluence = effectivePartyInfluenceForPresidentialPrimary(
            rawPartyInfluence,
            role
          );
          const nationalOrPol = nationalInfluence ?? politicalInfluence;
          return calcPresidentPrimaryScore(
            econ,
            social,
            partyEcon,
            partySocial,
            favorability,
            nationalOrPol,
            partyInfluence,
            candidateInfamy
          );
        })()
      : calcPrimaryScore(
          econ,
          social,
          partyEcon,
          partySocial,
          favorability,
          politicalInfluence,
          candidateInfamy,
          raceStateEconLean,
          raceStateSocialLean
        );

    // NPP penalty: when a player is in the same party primary, reduce NPP score.
    // (matches the penalty applied in primaryResolution.ts snapshot recording;
    //  see NPP_PRIMARY_SCORE_MULTIPLIER in electionEngine/constants.ts)
    if (c.isNPP) {
      const partyCandidates = candidates.filter((x) => x.party === c.party);
      const hasPlayerInParty = partyCandidates.some((x) => !x.isNPP);
      if (hasPlayerInParty) primaryScore *= NPP_PRIMARY_SCORE_MULTIPLIER;
    }

    const char = c.isNPP ? undefined : charMap.get(c.characterId.toString());
    // Resolve npp early so avatarUrl can fall back to the NPP's own portrait
    const npp = c.isNPP && c.nppId ? nppMap.get(c.nppId.toString()) : null;
    const avatarUrl = char?.avatarUrl ?? npp?.avatarUrl;

    const runningMateChar = c.runningMateId ? charMap.get(c.runningMateId.toString()) : null;
    const runningMateCharacterId =
      runningMateChar?._id.toString() ?? c.runningMateId?.toString() ?? null;
    const runningMateId =
      runningMateChar?.sequentialId?.toString() ?? c.runningMateId?.toString() ?? null;
    const runningMateName = runningMateChar?.name ?? null;

    const campaignInfo = campaignByCandidate.get(c.characterId?.toString() ?? "");

    // Use sequentialId for URLs when available (npp already resolved above)
    const characterIdForUrl = char?.sequentialId?.toString() ?? c.characterId?.toString() ?? null;
    const nppIdForUrl = npp?.sequentialId?.toString() ?? c.nppId?.toString() ?? null;

    return {
      id: cid,
      characterId: characterIdForUrl,
      characterName: c.characterName,
      avatarUrl: avatarUrl ?? undefined,
      party: displayPartyKey,
      partyName,
      partyColor,
      partyEcon,
      partySocial,
      isNPP: c.isNPP ?? false,
      nppId: nppIdForUrl,
      economicPosition: econ,
      socialPosition: social,
      favorability,
      politicalInfluence,
      nationalInfluence: nationalInfluence ?? 0,
      infamy: candidateInfamy,
      primaryScore,
      sharePct: 0, // Will be computed in grouping step
      enteredAt: c.enteredAt,
      endorsements: endorsementsByCandidate.get(cid) ?? [],
      isYou: !c.isNPP && c.characterId != null && c.characterId.toString() === myCharId,
      runningMateId,
      runningMateCharacterId,
      runningMateName,
      campaignId: campaignInfo?.id ?? null,
      campaignFunds: campaignInfo?.funds ?? null,
      campaignColor: campaignInfo?.color ?? null,
      campaignStrength: campaignInfo?.campaignStrength ?? null,
      travelState: c.travelState ?? null,
      support: typeof c.support === "number" ? c.support : undefined,
      ...(c.campaignSuspended
        ? {
            campaignSuspended: true,
            endorsedCandidateName: c.endorsedElectionCandidateId
              ? (electionCandidateById.get(c.endorsedElectionCandidateId.toString())
                  ?.characterName ?? null)
              : null,
            endorsementTargetWithdrawn: c.endorsementTargetWithdrawnAt != null,
          }
        : {}),
    };
  });

  return enrichedCandidates;
}

export interface PartyGroup {
  partyId: string;
  partyName: string;
  partyColor: string;
  countryId: "US" | "UK" | "DE";
  partyEcon: number;
  partySocial: number;
  hasCompetitivePrimary: boolean;
  candidates: EnrichedCandidate[];
}

export function groupCandidatesByParty(
  enrichedCandidates: EnrichedCandidate[],
  partyMap: Map<string, PoliticalParty>
): PartyGroup[] {
  const partiesPresent = [...new Set(enrichedCandidates.map((c) => c.party))];
  const byParty = partiesPresent
    .map((partyId) => {
      const partyCandidates = enrichedCandidates
        .filter((c) => c.party === partyId)
        .sort((a, b) => b.primaryScore - a.primaryScore);

      const shares = primarySharePctSoftmax(partyCandidates.map((c) => c.primaryScore));
      const withShare = partyCandidates.map((c, i) => ({
        ...c,
        sharePct: shares[i],
      }));

      const party = partyMap.get(partyId);
      return {
        partyId,
        partyName: party?.name ?? partyId,
        partyColor: party?.color ?? "#888888",
        countryId: (party?.countryId ?? "US") as "US" | "UK" | "DE",
        partyEcon: party?.economicPosition ?? 0,
        partySocial: party?.socialPosition ?? 0,
        hasCompetitivePrimary: partyCandidates.length > 1,
        candidates: withShare,
      };
    })
    .sort((a, b) => b.candidates.length - a.candidates.length);

  return byParty;
}
