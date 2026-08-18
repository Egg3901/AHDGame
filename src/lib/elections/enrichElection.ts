import type { Db, ObjectId as MongoObjectId } from "mongodb";
import { blocListQuota } from "@/lib/constants/blocList";
import { allocateBlocListSeats } from "@/lib/turn/election/blocListAllocation";
import { MULTI_SEAT_TYPES } from "@/lib/utils/electionLabels";
import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import { ObjectId } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  Character,
  NPP,
  PoliticalParty,
  GameState,
  NPPEndorsement,
  PlayerEndorsement,
  PrimarySnapshot,
  Campaign,
  StatePartyOrg,
  StateRegistrationPool,
  ElectionVoteTally,
  DemographicCategory,
  State,
  StateDemographics,
} from "@/lib/db/types";
import {
  getPrimaryWinnersForElection,
  getRegionalExecutiveOfficeKey,
  type CountryId,
} from "@/lib/constants/countries";
import {
  isHeadOfGovernmentRace,
  resolvePresidentApproval,
  buildPresidentialModifierByParty,
  presidentialModifierToPct,
} from "@/lib/electionEngine/presidentialCoattail";
import {
  buildGovModifierByParty,
  govModifierToPct,
  resolveGovExecutiveApproval,
  isCoattailEligibleRace,
  isOwnRegionalExecutiveRace,
} from "@/lib/electionEngine/govCoattail";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { type GameTimeContext } from "@/lib/time/gameTime";
import { computeElectionPhase } from "@/lib/elections/phases";
import {
  enrichElectionCandidates,
  groupCandidatesByParty,
  type EnrichedCandidate,
  type PartyGroup,
} from "@/lib/elections/candidateEnrichment";
import { getOrCreateVoteTally } from "@/lib/elections/voteTallyService";
import { isRedistrictingEnabled } from "@/lib/redistricting/flag";
import { districtedHouseResolution } from "@/lib/redistricting/districtedHouseResolution";
import { buildPrimaryShareMap } from "@/lib/turn/election/generalResolutionHelpers";
import { getMajoritarianBonus } from "@/lib/turn/election/seatAllocation";
import { withCommonsOrgRanking } from "@/lib/turn/election/commonsOrgRanking";
import { selectEndedDisplayCandidates } from "@/lib/elections/endedResultsCandidates";
import { selectGeneralPhaseDisplayCandidates } from "@/lib/elections/generalPhaseCandidates";
import { computeElectoralVotes } from "@/lib/elections/electoralVoteService";
import { getFundsByPartyForElection } from "@/lib/electionEngine/fundsByParty";
import { partyTenureFatiguePenalty } from "@/lib/electionEngine/partyTenureFatigue";
import { getPresidentialConsecutiveTerms } from "@/lib/turn/election/presidentialTenureLedger";
import { getIncumbentSeatShareByParty } from "@/lib/electionEngine/incumbentSeatShare";
import {
  resolveSingleSeatLegislativeIncumbent,
  isSingleSeatLegislativeRace,
} from "@/lib/electionEngine/singleSeatIncumbency";
import {
  computeMedianVoter,
  computeNationalEvWeightedMedian,
  usesEvWeightedNationalMedian,
} from "@/lib/electionEngine/medianVoter";
import { loadApportionment } from "@/lib/elections/apportionment";
import {
  buildMidtermOppositionModifierByParty,
  isMidtermOppositionBoostEligible,
  midtermOppositionModifierToPct,
} from "@/lib/electionEngine/midtermOppositionBoost";
import { resolveGoverningPartyIds } from "@/lib/government/governingPartyIds";
import type {
  ElectionResponse,
  ResolveElectionOptions,
  ElectionDeps,
  SnapshotEntry,
  GeneralVotesData,
  PollingData,
} from "./electionResponseTypes";
import { buildPollingData, computeSeatEstimates } from "./buildPollingData";
import { seatEstimateForVoteTotals } from "./snapshotSeats";
import { getPartyHex } from "@/lib/utils/politics";
import { projectPrimaryByState } from "@/lib/primaryProjection";
import { loadRegionalBonusMaps } from "@/lib/primaryRegionalBonusLoader";
import { fetchEnrichedCandidates } from "@/lib/electionEngine/candidateEnrichment";
import {
  getAllStaggerStates,
  getTotalDelegatesForFamily,
  resolvePartyFamily,
} from "@/lib/constants/primaryCalendar";
import {
  applyProjectedDelegatePolling,
  applyProjectedDelegateShares,
  summarizePrimaryProjection,
} from "./presidentialPrimaryDisplay";
import { buildActiveVisibleNppEndorsementFilter } from "@/lib/nppEndorsements";
import { parseSeatId } from "@/lib/seats/seatId";
import { buildPartyDisplayById, buildPresidentialRegByStateInput } from "./presidentialRegByState";
import { resolveElectionDisplayParty } from "./resolveElectionParty";

async function applyPresidentialPrimaryDisplay(
  db: Db,
  countryId: string,
  candidates: ElectionCandidate[],
  characters: Character[],
  npps: NPP[],
  parties: PoliticalParty[],
  tally: ElectionVoteTally | null,
  byParty: PartyGroup[],
  polling: PollingData | null,
  preloadedStatePartyOrgs: StatePartyOrg[],
  preset?: string
): Promise<{
  byParty: PartyGroup[];
  polling: PollingData | null;
  displayCandidates: EnrichedCandidate[];
}> {
  const staggerStateIds = getAllStaggerStates();
  const [categories, states, demographics, resolvedStatePartyOrgs, engineEnriched] =
    await Promise.all([
      loadDemographicCategories(db),
      db
        .collection<State>("states")
        .find({ _id: { $in: staggerStateIds } })
        .toArray(),
      db
        .collection<StateDemographics>("stateDemographics")
        .find({ _id: { $in: staggerStateIds } })
        .toArray(),
      preloadedStatePartyOrgs.length > 0
        ? Promise.resolve(
            preloadedStatePartyOrgs.filter((org) => (org.countryId ?? "US") === countryId)
          )
        : db
            .collection<StatePartyOrg>("statePartyOrg")
            .find({ countryId: countryId as CountryId })
            .toArray(),
      // Full engine enrichment (partyInfluence + chair roles) — must match the
      // primary map page / stagger path. Hand-building from display candidates
      // previously dropped partyInfluence and flipped WTA projections vs
      // `/president/primary/[partyId]`.
      fetchEnrichedCandidates(candidates, {
        includePartyPositions: true,
        countryId: countryId as CountryId,
      }),
    ]);

  const stateMap = new Map(states.map((state) => [state._id as string, state]));
  const demographicsMap = new Map(
    demographics.map((demographic) => [demographic._id as string, demographic])
  );
  const characterMap = new Map(
    characters.map((character) => [character._id.toString(), character])
  );
  const nppMap = new Map(npps.map((npp) => [npp._id.toString(), npp]));
  const engineEnrichedById = new Map(
    engineEnriched.map((candidate) => [candidate.candidateId, candidate])
  );
  const statePartyOrgMap = new Map(
    resolvedStatePartyOrgs.map((org) => [`${org.stateId}_${org.partyId}`, org])
  );
  const partyMap = new Map(parties.map((party) => [String(party.sequentialId), party]));
  const rawCandidateMap = new Map(
    candidates.map((candidate) => [candidate._id.toString(), candidate])
  );
  const displayCandidateMap = new Map(
    byParty.flatMap((group) =>
      group.candidates.map((candidate) => [candidate.id, candidate] as const)
    )
  );
  const rawCandidateIdsByParty = new Map<string, string[]>();
  for (const candidate of candidates) {
    const candidateId = candidate._id.toString();
    if (!displayCandidateMap.has(candidateId)) continue;
    const bucket = rawCandidateIdsByParty.get(candidate.party) ?? [];
    bucket.push(candidateId);
    rawCandidateIdsByParty.set(candidate.party, bucket);
  }

  const projectedByParty: PartyGroup[] = [];

  // Regional bases L1+C — load once for ALL candidates in this election; the
  // per-party loop reuses the same maps. Without this, regionally-funded
  // primary wins surface as upsets against the projected centrist winner.
  const homeStateByCharacterIdForBonuses = new Map(
    [...characterMap.values()].map((c) => [c._id.toString(), c.homeState ?? null])
  );
  const homeStateByNppIdForBonuses = new Map(
    [...nppMap.values()].map((n) => [n._id.toString(), n.homeState ?? null])
  );
  const regionalBonuses = await loadRegionalBonusMaps(db, {
    candidates,
    homeStateByCharacterId: homeStateByCharacterIdForBonuses,
    homeStateByNppId: homeStateByNppIdForBonuses,
  });

  for (const [rawPartyId, candidateIds] of rawCandidateIdsByParty.entries()) {
    const party = partyMap.get(rawPartyId);
    if (candidateIds.length === 0) continue;

    const rawDisplayCandidates = candidateIds
      .map((candidateId) => {
        const displayCandidate = displayCandidateMap.get(candidateId);
        if (!displayCandidate) return null;

        return {
          ...displayCandidate,
          party: rawPartyId,
          partyName: party?.name ?? rawPartyId,
          partyColor: party?.color ?? displayCandidate.partyColor,
          partyEcon: party?.economicPosition ?? displayCandidate.partyEcon,
          partySocial: party?.socialPosition ?? displayCandidate.partySocial,
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

    if (rawDisplayCandidates.length === 0) continue;

    const candidateMeta = candidateIds
      .map((candidateId) => {
        const rawCandidate = rawCandidateMap.get(candidateId);
        if (!rawCandidate) return null;

        return {
          candidateId,
          isNPP: Boolean(rawCandidate.isNPP),
          homeState: rawCandidate.isNPP
            ? rawCandidate.nppId
              ? (nppMap.get(rawCandidate.nppId.toString())?.homeState ?? null)
              : null
            : (characterMap.get(rawCandidate.characterId.toString())?.homeState ?? null),
          primaryCampaignState: rawCandidate.primaryCampaignState ?? null,
          primaryCampaignTicks: rawCandidate.primaryCampaignTicks ?? 0,
          support: rawCandidate.support,
        };
      })
      .filter((meta): meta is NonNullable<typeof meta> => meta !== null);

    const projectionCandidates = candidateIds
      .map((candidateId) => engineEnrichedById.get(candidateId))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null);

    if (projectionCandidates.length === 0) continue;

    const statePartyOrgsForParty = new Map<string, number>();
    const allocationByState: Record<string, "PR" | "WTA"> = {};
    for (const stateId of staggerStateIds) {
      const org = statePartyOrgMap.get(`${stateId}_${rawPartyId}`);
      if (!org) continue;
      statePartyOrgsForParty.set(
        `${stateId}_${rawPartyId}`,
        org.organization + (org.primarySurge ?? 0)
      );
      if (org.primaryAllocation) {
        allocationByState[stateId] = org.primaryAllocation;
      }
    }

    const projection = projectPrimaryByState({
      candidates: projectionCandidates,
      candidateMeta,
      stateIds: staggerStateIds,
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: statePartyOrgsForParty,
      partyPosition: {
        economicPosition: party?.economicPosition ?? 0,
        socialPosition: party?.socialPosition ?? 0,
      },
      stateOrgByStateAndCandidate: regionalBonuses.stateOrgByStateAndCandidate,
      homeStateByCandidate: regionalBonuses.homeStateByCandidate,
      countryId: countryId as CountryId,
    });

    const family = resolvePartyFamily(rawPartyId, {
      primaryCalendar: party?.primaryCalendar ?? null,
      economicPosition: party?.economicPosition ?? 0,
    });
    const mergedAllocationByState = {
      ...allocationByState,
      ...(tally?.primaryAllocationByState?.[rawPartyId] ?? {}),
    };
    const projectionSummary = summarizePrimaryProjection({
      stateIds: staggerStateIds,
      family,
      candidateIds,
      totalDelegates: getTotalDelegatesForFamily(family, preset),
      projectedVotesByState: projection.byState,
      actualVotesByState: tally?.primaryStateVotes?.[rawPartyId] ?? {},
      awardedDelegatesByState: tally?.primaryDelegatesByState?.[rawPartyId] ?? {},
      allocationByState: mergedAllocationByState,
      preset,
    });
    const projectedDelegates = projectionSummary.delegatesByCandidate;

    projectedByParty.push(
      applyProjectedDelegateShares(
        {
          partyId: rawPartyId,
          partyName: party?.name ?? rawPartyId,
          partyColor: party?.color ?? rawDisplayCandidates[0]?.partyColor ?? "#888888",
          countryId: (party?.countryId ?? countryId) as PartyGroup["countryId"],
          partyEcon: party?.economicPosition ?? rawDisplayCandidates[0]?.partyEcon ?? 0,
          partySocial: party?.socialPosition ?? rawDisplayCandidates[0]?.partySocial ?? 0,
          hasCompetitivePrimary: rawDisplayCandidates.length > 1,
          candidates: rawDisplayCandidates,
        },
        projectedDelegates,
        getTotalDelegatesForFamily(family, preset),
        projectionSummary.nationalVotesByCandidate
      )
    );
  }

  projectedByParty.sort((a, b) => b.candidates.length - a.candidates.length);

  return {
    byParty: projectedByParty,
    polling: applyProjectedDelegatePolling(polling, projectedByParty),
    displayCandidates: projectedByParty.flatMap((group) => group.candidates),
  };
}

// ---------------------------------------------------------------------------
// Core enrichment (accepts pre-fetched deps — used by both single and batch)
// ---------------------------------------------------------------------------

/**
 * Low-level enrichment function that accepts pre-fetched dependencies.
 * Exported with underscore prefix to signal that it is an internal helper
 * intended for use by resolveElection() and the upcoming resolveElections()
 * batch function (Task 2).
 *
 * @param election   - The election document
 * @param deps       - All pre-fetched dependency data
 * @param options    - View mode and user context
 * @param gameTime   - Pre-fetched game time context
 * @param gameState  - Pre-fetched game state document (may be null)
 * @param db         - Database connection (needed for full-view tally operations)
 * @param adjacentElections - For nav; pass null/undefined in summary mode
 */
export async function _enrichElection(
  election: Election,
  deps: ElectionDeps,
  options: ResolveElectionOptions,
  gameTime: GameTimeContext,
  gameState: GameState | null,
  db: Db,
  adjacentElections?: Array<{ _id: MongoObjectId; cycle: number; seatId?: string }> | null
): Promise<ElectionResponse> {
  const { view, userId, isAdmin = false, activeCharacterId } = options;
  const isFull = view === "full";
  const {
    candidates,
    characters,
    npps,
    parties,
    nppEndorsements,
    playerEndorsements,
    snapshots,
    statePartyOrgs,
    campaigns,
    tally,
    latestPrimarySnapshot,
  } = deps;

  const electionOid = election._id;
  const countryId = election.countryId ?? "US";
  const isPresident = election.electionType === "president";

  // Live apportionment: census-updated `state.houseDistricts` (preset seed
  // fallback). Equals the seed until a decennial census reapportions (P1d-2).
  const {
    electoralVotes: evByState,
    electoralVoteUnits: evUnits,
    houseSeats,
  } = await loadApportionment(db, gameState?.preset);

  // For state-level primary alignment, look up the cached lean of the seat's region.
  // Presidential races have no single regional electorate, so they skip this fetch.
  const electionSeatId = election.seatId ?? null;
  const statesForEnrichment = new Map<string, State>();
  if (!isPresident && electionSeatId) {
    const localRegionId = parseSeatId(electionSeatId).localRegionId;
    if (localRegionId) {
      const stateDoc = await db
        .collection<State>("states")
        .findOne({ _id: localRegionId, countryId });
      if (stateDoc) statesForEnrichment.set(localRegionId, stateDoc);
    }
  }

  // Phase
  const phase = computeElectionPhase(
    election.startTime ?? null,
    election.primaryEndTime ?? null,
    election.endTime ?? null,
    election.status,
    gameTime,
    {
      startTurn: election.startTurn,
      primaryEndTurn: election.primaryEndTurn,
      endTurn: election.endTurn,
    }
  );
  const { inPrimary, isEnded, isUpcoming, inGeneral } = phase;

  // Build char party map for display-party resolution (used by polling builder)
  const charPartyMap = new Map(characters.map((c) => [c._id.toString(), c.party]));

  // Enrich candidates. Ended races keep ballot-time party on labels/colours so
  // later party switches cannot recolour historical results (#939).
  const enrichedCandidates = enrichElectionCandidates({
    candidates,
    characters,
    npps,
    parties,
    nppEndorsements,
    playerEndorsements,
    campaigns,
    statePartyOrgs,
    isPresident,
    myCharId: null, // isYou set separately below after myCharId lookup
    states: statesForEnrichment,
    electionSeatId,
    preferBallotParty: isEnded,
  });

  // Determine current user's character ID. Multi-profile aware: prefer the
  // explicit activeCharacterId from auth when available, so users with
  // multiple characters don't get "isYou" mapped onto an arbitrary one.
  let myCharId: string | null = null;
  if (isFull && userId) {
    if (activeCharacterId) {
      myCharId = activeCharacterId;
    } else {
      const myChar = await getCharacterByUserId(db, userId);
      if (myChar) myCharId = myChar._id.toString();
    }
  }

  // Re-mark isYou after myCharId is resolved
  const enrichedWithIsYou: EnrichedCandidate[] = enrichedCandidates.map((c) => ({
    ...c,
    isYou:
      !c.isNPP && c.characterId != null && myCharId != null
        ? // characterId in enriched candidates is already sequentialId; we need ObjectId match
          // Re-check using original candidates array for accuracy
          candidates.some(
            (raw) =>
              raw._id.toString() === c.id && !raw.isNPP && raw.characterId.toString() === myCharId
          )
        : false,
  }));

  // Phase B fog-of-war: strip `support` from candidate rows unless the
  // viewer is admin or has a candidate in this race. The PersuasionDrivers
  // card's supportDelta driver row falls back to neutral when Support is
  // undefined, so non-privileged viewers see a 0 row instead of inferring
  // opponent Support values from the engine math.
  const isViewerInRace = enrichedWithIsYou.some((c) => c.isYou);
  const supportPrivileged = isAdmin || isViewerInRace;
  const enrichedWithYou: EnrichedCandidate[] = supportPrivileged
    ? enrichedWithIsYou
    : enrichedWithIsYou.map((c) => ({ ...c, support: undefined }));

  // Group by the currently displayed party label; presidential primary display
  // may remap this later to the raw candidacy-party buckets for synchronization.
  const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));
  let byParty = groupCandidatesByParty(enrichedWithYou, partyMap);

  // Primary-winner cap for this race: US=1, UK=3, JP=3; single-winner
  // governor/president races are always 1. Resolved once here and returned as
  // `primaryAdvanceCount` so client surfaces read it instead of recomputing it.
  const primaryAdvanceCount = getPrimaryWinnersForElection(
    countryId as CountryId,
    election.electionType
  );

  // Display candidates: post-primary dedup, keeping up to `primaryAdvanceCount`
  // per party. Safety net for the window between primaryEndTime and the next
  // primary-resolution turn — and for multi-advance races that intentionally
  // leave several same-party nominees active through the general (#1043).
  // Always include the current user's candidate even if they lost the primary.
  let displayCandidates: EnrichedCandidate[] = enrichedWithYou;
  if (!inPrimary && !isEnded) {
    displayCandidates = selectGeneralPhaseDisplayCandidates(enrichedWithYou, primaryAdvanceCount);
  } else if (isEnded) {
    // Final results show the field that actually contested the general. Ended
    // elections fetch ALL candidacies (active + withdrawn) so the primary field
    // is visible mid-race. Resolution withdraws EVERY candidate as cleanup, so
    // withdrawn-status can't distinguish a real contestant from a primary loser
    // / pre-general drop-out — pick by final-tally votes instead (falls back to
    // dropping withdrawn rows when no tally votes exist). See
    // selectEndedDisplayCandidates.
    const withdrawnIds = new Set(
      candidates.filter((c) => c.status === "withdrawn").map((c) => c._id.toString())
    );
    displayCandidates = selectEndedDisplayCandidates(
      enrichedWithYou,
      withdrawnIds,
      tally?.totalVotes
    );
  }

  // Defensive: never show the same character twice in one election's results.
  // The partial unique index on { characterId } (status:"active") can be
  // bypassed when a prior candidacy is withdrawn, leaving two rows for one
  // character; collapse to the first occurrence so duplicates never render.
  {
    const rawById = new Map(candidates.map((c) => [c._id.toString(), c]));
    const seenCharIds = new Set<string>();
    displayCandidates = displayCandidates.filter((c) => {
      const charId = rawById.get(c.id)?.characterId?.toString();
      if (!charId) return true;
      if (seenCharIds.has(charId)) return false;
      seenCharIds.add(charId);
      return true;
    });
  }

  // Active candidates (for polling)
  const activeCandidateIdSet = new Set(displayCandidates.map((c) => c.id));
  const activeCandidates = candidates.filter((c) => activeCandidateIdSet.has(c._id.toString()));

  // Polling data (always computed for both views).
  // Ended races: omit live character.party so polling colours stay on the
  // candidacy-row (ballot) party — same historical rule as map colours (#939).
  // Primary: pass live byParty shares so party/list cards match the detail page
  // (ticket-1022 — snapshot shares left late joiners at 0%).
  let polling = buildPollingData(
    election.electionType,
    countryId,
    inPrimary,
    activeCandidates,
    parties,
    tally,
    latestPrimarySnapshot,
    isEnded ? new Map() : charPartyMap,
    inPrimary ? byParty : null
  );

  // Seat estimates (always computed for multi-seat races — needed by both views)
  // FPTP winner's bonus (#3244): UK Commons in historical in-game years
  // projects with the same cube-law re-split the resolver applies; undefined
  // (proportional) once the world's clock reaches 1999.
  const majoritarianBonus = await withCommonsOrgRanking(
    db,
    getMajoritarianBonus(election.electionType, gameState?.currentYear),
    election.countryId ?? "UK",
    election.state
  );
  let seatsEstimate = computeSeatEstimates(
    election.electionType,
    election.totalSeats,
    tally,
    activeCandidateIdSet,
    majoritarianBonus
  );

  // US House with redistricting on: project seats district-by-district using the
  // SAME engine that decides the final result (districtedHouseResolution on the
  // current tally), instead of the statewide proportional estimate above — so
  // the live "Projected Seats" panel matches how the race will actually resolve.
  // Falls back to the proportional estimate for states with no districts drawn.
  // Read-only: `persist` is left off, so this projection cannot write holders.
  // It used to, which meant opening a live House race rewrote that state's
  // sitting members from an in-progress tally, and wrote `npps` ids into
  // `holderCharacterId` because this path has no NPP id map.
  if (
    election.electionType === "house" &&
    (countryId ?? "US") === "US" &&
    isRedistrictingEnabled(gameState) &&
    tally
  ) {
    const candidateVotes: Record<string, number> = {};
    const candidateParty: Record<string, string> = {};
    const candidateCharacterId: Record<string, string | null> = {};
    for (const c of activeCandidates) {
      const id = c._id.toString();
      candidateVotes[id] = tally.totalVotes?.[id] ?? 0;
      candidateParty[id] = c.party ?? tally.candidateParties?.[id] ?? "";
      candidateCharacterId[id] = c.characterId ? c.characterId.toString() : null;
    }
    const districted = await districtedHouseResolution(db, {
      countryId: "US",
      stateId: election.state as string,
      candidateVotes,
      candidateParty,
      candidateCharacterId,
      primaryShares: buildPrimaryShareMap(tally.primaryResults ?? null),
      districtBoosts: (
        election as { districtCampaignBoosts?: Record<string, Record<string, number>> }
      ).districtCampaignBoosts,
      now: new Date(),
    });
    if (districted?.seatsEstimate && Object.keys(districted.seatsEstimate).length > 0) {
      seatsEstimate = districted.seatsEstimate;
    }
  }

  // National Front chambers: project with the SAME quota the resolver will use,
  // for the same reason the districted branch above exists. `computeSeatEstimates`
  // has no bloc-list whitelist entry and returns null here, so before this the
  // DDR showed a cross-party vote pie and no seat projection at all. That pie is
  // the most misleading surface in the game for a bloc list: it invites players
  // to read a popular bloc party as a chamber-winning one when the quota means
  // it can never be. Overriding caller-side keeps the shared helper's signature
  // and its other two call sites untouched.
  const blocQuota = MULTI_SEAT_TYPES.has(election.electionType)
    ? blocListQuota(countryId ?? election.countryId)
    : null;
  if (blocQuota && election.totalSeats) {
    const ranked = activeCandidates
      .map((c) => {
        const id = c._id.toString();
        return {
          id,
          votes: tally?.totalVotes?.[id] ?? 0,
          party: c.party ?? tally?.candidateParties?.[id] ?? undefined,
        };
      })
      .sort((a, b) => b.votes - a.votes || (a.id < b.id ? -1 : 1));
    if (ranked.length > 0) {
      seatsEstimate = allocateBlocListSeats(election.totalSeats, blocQuota.shares, ranked);
    }
  }

  // ----- Full-view only fields -----
  let prevElectionId: string | null = null;
  let nextElectionId: string | null = null;
  let snapshotHistory: SnapshotEntry[] | null = null;
  let generalVotes: GeneralVotesData | null = null;
  let myEndorsedCandidateId: string | null = null;

  if (isPresident && inPrimary) {
    const projectedDisplay = await applyPresidentialPrimaryDisplay(
      db,
      countryId,
      candidates,
      characters,
      npps,
      parties,
      tally,
      byParty,
      polling,
      statePartyOrgs,
      gameState?.preset
    );
    byParty = projectedDisplay.byParty;
    polling = projectedDisplay.polling;
    displayCandidates = projectedDisplay.displayCandidates;
  }

  if (isFull) {
    // Prev/next navigation
    if (adjacentElections && adjacentElections.length > 0) {
      const idx = adjacentElections.findIndex((e) => e._id.equals(electionOid));
      if (idx > 0) {
        const prev = adjacentElections[idx - 1];
        prevElectionId = prev.seatId ? `${prev.seatId}?cycle=${prev.cycle}` : prev._id.toString();
      }
      if (idx >= 0 && idx < adjacentElections.length - 1) {
        const next = adjacentElections[idx + 1];
        nextElectionId = next.seatId ? `${next.seatId}?cycle=${next.cycle}` : next._id.toString();
      }
    }

    // Snapshot history
    snapshotHistory = snapshots.map((s) => ({
      recordedAt: s.recordedAt,
      byParty: s.byParty,
    }));

    // User endorsement
    if (myCharId) {
      myEndorsedCandidateId =
        playerEndorsements
          .find((e) => e.characterId.toString() === myCharId)
          ?.candidateId.toString() ?? null;
    }

    // Vote tally
    const resolvedTally = await getOrCreateVoteTally(
      db,
      electionOid,
      election,
      candidates,
      displayCandidates,
      inPrimary,
      isEnded
    );

    if (resolvedTally) {
      // Filter tally to active candidates only
      const filterRecord = <T>(rec: Record<string, T>): Record<string, T> => {
        const out: Record<string, T> = {};
        for (const [k, v] of Object.entries(rec)) {
          if (activeCandidateIdSet.has(k)) out[k] = v;
        }
        return out;
      };

      // Electoral votes (president only). For historical races, overlay
      // ballot-time parties onto the tally so EV map colours never fall back
      // to a missing snapshot key while the battleground map uses ballot party.
      let electoralVotesResult = {};
      if (isPresident) {
        const candidateNameMap = new Map(enrichedWithYou.map((c) => [c.id, c.characterName]));
        const preferElectionTimeParty = isEnded || resolvedTally.finalized === true;
        let tallyForEv: typeof resolvedTally = resolvedTally;
        if (preferElectionTimeParty) {
          const mergedParties: Record<string, string> = {
            ...(resolvedTally.candidateParties ?? {}),
          };
          for (const c of candidates) {
            const cid = c._id.toString();
            if (!mergedParties[cid]) mergedParties[cid] = c.party;
          }
          tallyForEv = { ...resolvedTally, candidateParties: mergedParties };
        }
        electoralVotesResult = await computeElectoralVotes(
          db,
          tallyForEv,
          candidateNameMap,
          partyMap,
          evUnits
        );
      }

      // Candidate names/parties/colours must cover ALL candidates that appear in
      // state-level or historical data, not just active display candidates.
      // Presidential unit-level tallies may retain votes from withdrawn/primary
      // candidates, and those candidates must still render with a name.
      const referencedCandidateIds = new Set<string>(activeCandidateIdSet);
      for (const cid of Object.keys(resolvedTally.candidateNames ?? {})) {
        referencedCandidateIds.add(cid);
      }
      if (isPresident) {
        const evr = electoralVotesResult as {
          stateVoteData?: Record<
            string,
            { votesByCandidate: Record<string, number>; evByCandidate: Record<string, number> }
          >;
          stateVotesOverTime?: Record<string, Array<{ cumulativeVotes: Record<string, number> }>>;
          evByTurn?: Array<{ electoralVotesByCandidate: Record<string, number> }>;
        };
        if (evr.stateVoteData) {
          for (const data of Object.values(evr.stateVoteData)) {
            for (const cid of Object.keys(data.votesByCandidate)) referencedCandidateIds.add(cid);
            for (const cid of Object.keys(data.evByCandidate)) referencedCandidateIds.add(cid);
          }
        }
        if (evr.stateVotesOverTime) {
          for (const snaps of Object.values(evr.stateVotesOverTime)) {
            for (const snap of snaps) {
              for (const cid of Object.keys(snap.cumulativeVotes)) referencedCandidateIds.add(cid);
            }
          }
        }
        if (evr.evByTurn) {
          for (const point of evr.evByTurn) {
            for (const cid of Object.keys(point.electoralVotesByCandidate))
              referencedCandidateIds.add(cid);
          }
        }
      }

      const fullCandidateNames: Record<string, string> = {};
      const fullCandidateParties: Record<string, string> = {};
      // For an ended/finalized election, a candidate's live party can differ from
      // the party they ran under (they may have switched since). Prefer the tally
      // snapshot, then the candidacy-row (ballot) party — never the live
      // character.party — so historical maps/results keep election-time colours.
      // In-progress elections still use the live party. (#939)
      const preferElectionTimeParty = isEnded || resolvedTally.finalized === true;
      const ballotPartyById = new Map(candidates.map((c) => [c._id.toString(), c.party]));
      for (const cid of referencedCandidateIds) {
        const enriched = enrichedWithYou.find((c) => c.id === cid);
        fullCandidateNames[cid] =
          enriched?.characterName ?? resolvedTally.candidateNames?.[cid] ?? "Unknown";
        fullCandidateParties[cid] = resolveElectionDisplayParty({
          preferElectionTimeParty,
          snapshotParty: resolvedTally.candidateParties?.[cid],
          ballotParty: ballotPartyById.get(cid),
          liveParty: enriched?.party,
        });
      }
      const fullCandidateColors: Record<string, string> = {};
      for (const [cid, pid] of Object.entries(fullCandidateParties)) {
        const partyObj = partyMap.get(pid);
        fullCandidateColors[cid] = getPartyHex(pid, partyObj?.color);
      }

      generalVotes = {
        totalVotes: filterRecord(resolvedTally.totalVotes),
        candidateNames: fullCandidateNames,
        candidateParties: fullCandidateParties,
        candidateColors: fullCandidateColors,
        finalized: resolvedTally.finalized,
        seatsEstimate,
        turnSnapshots: resolvedTally.turnSnapshots.slice(-96).map((t) => {
          const persisted =
            t.seatsEstimate && Object.keys(t.seatsEstimate).length > 0
              ? t.seatsEstimate
              : undefined;
          const seatsEstimateSnapshot =
            persisted ??
            seatEstimateForVoteTotals(
              election.electionType,
              election.state,
              election.totalSeats,
              t.cumulativeVotes,
              houseSeats,
              fullCandidateParties,
              majoritarianBonus
            );
          return {
            turn: t.turn,
            recordedAt: t.recordedAt,
            cumulativeVotes: t.cumulativeVotes,
            sharesPct: t.sharesPct,
            ...(seatsEstimateSnapshot ? { seatsEstimate: seatsEstimateSnapshot } : {}),
          };
        }),
        ...electoralVotesResult,
        // Per-state EV totals for the active preset (president display surfaces
        // read this instead of the 2020-census constant directly).
        ...(isPresident ? { evByState } : {}),
        ...(isPresident && resolvedTally.resolutionMode
          ? { resolutionMode: resolvedTally.resolutionMode }
          : {}),
        ...(isPresident && resolvedTally.contingentResult
          ? { contingentResult: resolvedTally.contingentResult }
          : {}),
        ...(isPresident && resolvedTally.contingentResolutionPending
          ? { contingentResolutionPending: true }
          : {}),
        ...(isPresident && resolvedTally.executiveSeatingPending
          ? { executiveSeatingPending: true }
          : {}),
      };
    }
  }

  // Resolve incumbent display info from raw partyId → party name + color
  let incumbentDisplay: { name: string; party: string; partyColor: string | null } | null = null;
  if (deps.incumbent) {
    const incumbentParty = partyMap.get(deps.incumbent.partyId);
    incumbentDisplay = {
      name: deps.incumbent.name,
      party:
        incumbentParty?.name ??
        (deps.incumbent.partyId === "independent" ? "Independent" : deps.incumbent.partyId),
      partyColor: incumbentParty?.color ?? null,
    };
  }

  // Phase B follow-up — driver inputs for the PersuasionDrivers card.
  // Computed only in full-view, general phase (the card only renders for
  // active general elections). The card consumer (`computePersuasionDriverDisplay`)
  // treats missing maps as "neutral / no data" so primaries / summary views
  // omit cleanly.
  let fundsByPartyMap: Record<string, number> | undefined;
  let incumbentSeatShareByPartyMap: Record<string, number> | undefined;
  let persuasionRegByPartyMap: Record<string, number> | undefined;
  let medianVoter: { ep: number; sp: number } | undefined;
  let presidentialCoattailPctByParty: Record<string, number> | undefined;
  let gubernatorialCoattailPctByParty: Record<string, number> | undefined;
  let midtermOppositionBoostPctByParty: Record<string, number> | undefined;
  let incumbentApprovalForDisplay: number | undefined;
  let incumbentPartyIdForDisplay: string | undefined;
  let incumbentTenurePenaltyForDisplay: number | undefined;
  let legislativeIncumbentPartyIdForDisplay: string | undefined;
  let legislativeIncumbentTenureTermsForDisplay: number | undefined;
  if (isFull && inGeneral) {
    // M5 — feed the policy-distance driver with a real reference point
    // instead of the engine's `(0, 0)` fallback. State-scoped races use
    // the seat's own state median; US presidential uses an EV-weighted
    // national aggregate so the card reflects what candidates actually
    // court on the EV map. See `medianVoter.ts` for the math.
    const useEvWeightedMedian = usesEvWeightedNationalMedian(
      election.electionType,
      countryId as CountryId
    );
    const demographicsQueryStateIds: string[] = useEvWeightedMedian
      ? Object.keys(evByState)
      : election.state
        ? [election.state]
        : [];

    const [fundsMap, seatShareMap, categories, allDemographics] = await Promise.all([
      getFundsByPartyForElection(electionOid, db),
      getIncumbentSeatShareByParty(election, db),
      demographicsQueryStateIds.length > 0
        ? loadDemographicCategories(db)
        : Promise.resolve([] as DemographicCategory[]),
      demographicsQueryStateIds.length > 0
        ? db
            .collection<StateDemographics>("stateDemographics")
            .find({ _id: { $in: demographicsQueryStateIds } })
            .toArray()
        : Promise.resolve([] as StateDemographics[]),
    ]);
    if (fundsMap.size > 0) {
      fundsByPartyMap = Object.fromEntries(fundsMap);
    }
    if (seatShareMap.size > 0 && !isSingleSeatLegislativeRace(election)) {
      incumbentSeatShareByPartyMap = Object.fromEntries(seatShareMap);
    }

    // Per-party registration for the race's state so the driver card can
    // scale its rows by the engine's effective peelable fraction (mirrors
    // the `regByParty` map the swing-flow engine consumes). State-scoped
    // races only; rows without seeded `registration` are omitted so the
    // display falls back to the engine's no-Reg baseline.
    if (election.state) {
      const regEntries: Record<string, number> = {};
      for (const po of statePartyOrgs) {
        if (
          po.stateId === election.state &&
          (po.countryId ?? "US") === countryId &&
          typeof po.registration === "number"
        ) {
          regEntries[po.partyId] = po.registration;
        }
      }
      if (Object.keys(regEntries).length > 0) {
        persuasionRegByPartyMap = regEntries;
      }
    }

    if (categories.length > 0 && allDemographics.length > 0) {
      if (useEvWeightedMedian) {
        const evEntries = allDemographics
          .map((d) => ({
            demographics: d,
            ev: evByState[d._id as string] ?? 0,
          }))
          .filter((e) => e.ev > 0);
        if (evEntries.length > 0) {
          medianVoter = computeNationalEvWeightedMedian(evEntries, categories);
        }
      } else if (election.state) {
        const stateDemographics = allDemographics.find((d) => d._id === election.state);
        if (stateDemographics) {
          medianVoter = computeMedianVoter(stateDemographics, categories);
        }
      }
    }

    // Coattails inputs for the persuasion-drivers card (mirrors the turn
    // engine; display values here). Both are nominal-share multipliers
    // converted to a percentage tilt: presidential is the sitting President's
    // party nationwide; gubernatorial is the sitting governor's party in-state.
    const cid = countryId as CountryId;
    const partyIdsInRace = new Set(enrichedWithYou.map((c) => c.party));
    const isPresidentialRace = isHeadOfGovernmentRace(election.electionType, cid);
    if (!isPresidentialRace) {
      const president = await resolvePresidentApproval(db, cid);
      const presMod = buildPresidentialModifierByParty(president, partyIdsInRace);
      if (presMod.size > 0) presidentialCoattailPctByParty = presidentialModifierToPct(presMod);
    }
    if (isMidtermOppositionBoostEligible(election)) {
      const governingPartyIds = await resolveGoverningPartyIds(db, cid);
      const midtermMod = buildMidtermOppositionModifierByParty(governingPartyIds, partyIdsInRace);
      if (midtermMod.size > 0) {
        midtermOppositionBoostPctByParty = midtermOppositionModifierToPct(midtermMod);
      }
    }
    if (
      election.state &&
      isCoattailEligibleRace({
        isGeneralElection: inGeneral,
        electionType: election.electionType,
        regionalExecOfficeType: getRegionalExecutiveOfficeKey(cid),
        isOwnHeadOfGovernmentRace: isPresidentialRace,
      })
    ) {
      const exec = await resolveGovExecutiveApproval(db, cid, election.state);
      const partyIdsInState = new Set(enrichedWithYou.map((c) => c.party));
      const govMod = buildGovModifierByParty(exec, partyIdsInState);
      if (govMod.size > 0) gubernatorialCoattailPctByParty = govModifierToPct(govMod);
    }

    // Approval-scaled incumbency for the governor's OWN race (the gov coattail
    // block above skips it). Mirrors the turn engine so the card matches.
    if (
      election.state &&
      isOwnRegionalExecutiveRace({
        isGeneralElection: inGeneral,
        electionType: election.electionType,
        regionalExecOfficeType: getRegionalExecutiveOfficeKey(cid),
        hasState: Boolean(election.state),
      })
    ) {
      const exec = await resolveGovExecutiveApproval(db, cid, election.state);
      if (exec) {
        incumbentPartyIdForDisplay = exec.partyId;
        incumbentApprovalForDisplay = exec.approval;
      }
    }

    // Approval-scaled incumbency for the President's OWN race. Mirrors the turn
    // engine (presidentialElectionEngine.ts), which now threads the sitting
    // President's party + national approval into the incumbency driver. Sourced
    // from the sitting President, not the live tally, so the card matches the
    // shield/drag the engine applies (VP rides the same ticket).
    if (isPresidentialRace) {
      const president = await resolvePresidentApproval(db, cid);
      if (president) {
        incumbentPartyIdForDisplay = president.partyId;
        incumbentApprovalForDisplay = president.approval;
        // Party-tenure voter-fatigue drag folded into the Incumbency row so the
        // card matches the engine (no separate row).
        incumbentTenurePenaltyForDisplay = partyTenureFatiguePenalty(
          getPresidentialConsecutiveTerms(gameState, cid, president.partyId)
        );
      }
    }

    // Single-seat legislative own-race (US Senate): flat incumbency shield for
    // the sitting senator, matching the turn engine. Open seats / non-senate
    // races leave these undefined (card falls back to neutral).
    if (isSingleSeatLegislativeRace(election)) {
      const runningIdentities = new Set(
        candidates
          .map((c) => (c.characterId ?? c.nppId)?.toString())
          .filter((id): id is string => Boolean(id))
      );
      const legInc = await resolveSingleSeatLegislativeIncumbent(election, runningIdentities, db);
      if (legInc) {
        legislativeIncumbentPartyIdForDisplay = legInc.incumbentPartyId;
        legislativeIncumbentTenureTermsForDisplay = legInc.tenureTerms;
      }
    }
  }

  // Registration Influence card — per-state party-lean breakdown for the US
  // presidential shell. `statePartyOrgs` already holds every state's rows for
  // the presidential full view (fetchDepsForElection); pair them with the
  // non-party pool buckets so the card can render real lean data instead of
  // the "no data tracked" placeholder. States without seeded registration are
  // omitted by the builder, preserving the honest placeholder per-state.
  // partyDisplayById is always attached for the presidential shell so the
  // battleground hover cards can resolve abbreviations (not raw sequentialIds).
  let regByState: ElectionResponse["regByState"];
  let partyDisplayById: ElectionResponse["partyDisplayById"];
  // General OR ended — the presidential shell (and this card) renders for both
  // (`!inPrimary && !isUpcoming`), and registration is a phase-agnostic
  // baseline, so populate it wherever the card is shown rather than only mid-race.
  if (isFull && isPresident && (inGeneral || isEnded)) {
    partyDisplayById = buildPartyDisplayById(parties);
    const pools = await db
      .collection<StateRegistrationPool>("stateRegistrationPool")
      .find({ countryId })
      .toArray();
    // The presidential deps load every country's statePartyOrg rows
    // (`fetchDepsForElection` uses `find({})`); scope to this election's
    // country so foreign states never leak into the US breakdown. Legacy
    // rows without `countryId` are treated as US, matching the rest of the file.
    const countryStatePartyOrgs = statePartyOrgs.filter(
      (po) => (po.countryId ?? "US") === countryId
    );
    const built = buildPresidentialRegByStateInput(countryStatePartyOrgs, pools);
    if (Object.keys(built).length > 0) {
      regByState = built;
    }
  }

  return {
    // Identity
    id: election._id.toString(),
    seatId: election.seatId ?? null,
    electionType: election.electionType,
    state: election.state,
    countryId,
    senateClass: election.senateClass ?? null,
    chamberClass: election.chamberClass ?? null,
    cycle: election.cycle,
    electionYear: election.electionYear ?? null,
    status: election.status,
    totalSeats: election.totalSeats ?? null,

    // Timing
    startTime: election.startTime ?? null,
    endTime: election.endTime ?? null,
    primaryEndTime: election.primaryEndTime ?? null,
    // Turn-based deadlines for drift-free countdowns (see ElectionResponse).
    startTurn: election.startTurn ?? null,
    endTurn: election.endTurn ?? null,
    primaryEndTurn: election.primaryEndTurn ?? null,
    durationHours: election.durationHours ?? null,
    primaryDurationHours: election.primaryDurationHours ?? null,

    // Phase
    inPrimary,
    isEnded,
    isUpcoming,
    inGeneral,
    primaryAdvanceCount,

    // Core data
    candidates: displayCandidates,
    byParty,
    polling,
    seatsEstimate,
    incumbent: incumbentDisplay,

    // Full-view fields
    prevElectionId: isFull ? prevElectionId : null,
    nextElectionId: isFull ? nextElectionId : null,
    allCandidates: isFull ? enrichedWithYou : null,
    snapshotHistory: isFull ? snapshotHistory : null,
    generalVotes: isFull ? generalVotes : null,
    myCharId: isFull ? myCharId : null,
    myEndorsedCandidateId: isFull ? myEndorsedCandidateId : null,
    isAdmin: isFull ? isAdmin : false,
    gameState:
      isFull && gameState
        ? {
            isActive: gameState.isActive,
            pausedAt: gameState.pausedAt ?? null,
            lastTurnProcessed: gameState.lastTurnProcessed ?? null,
            currentTurn: gameState.currentTurn,
            effectiveNow: gameTime.effectiveNow.toISOString(),
            redistrictingEnabled: isRedistrictingEnabled(gameState),
          }
        : null,

    // Phase B follow-up — driver inputs (general phase only).
    ...(fundsByPartyMap ? { fundsByParty: fundsByPartyMap } : {}),
    ...(incumbentSeatShareByPartyMap
      ? { incumbentSeatShareByParty: incumbentSeatShareByPartyMap }
      : {}),
    ...(persuasionRegByPartyMap ? { persuasionRegByParty: persuasionRegByPartyMap } : {}),
    ...(medianVoter ? { medianVoter } : {}),
    ...(presidentialCoattailPctByParty ? { presidentialCoattailPctByParty } : {}),
    ...(gubernatorialCoattailPctByParty ? { gubernatorialCoattailPctByParty } : {}),
    ...(midtermOppositionBoostPctByParty ? { midtermOppositionBoostPctByParty } : {}),
    ...(incumbentApprovalForDisplay != null
      ? { incumbentApproval: incumbentApprovalForDisplay }
      : {}),
    ...(incumbentPartyIdForDisplay != null ? { incumbentPartyId: incumbentPartyIdForDisplay } : {}),
    ...(incumbentTenurePenaltyForDisplay
      ? { incumbentTenurePenalty: incumbentTenurePenaltyForDisplay }
      : {}),
    ...(legislativeIncumbentPartyIdForDisplay != null
      ? {
          legislativeIncumbentPartyId: legislativeIncumbentPartyIdForDisplay,
          legislativeIncumbentTenureTerms: legislativeIncumbentTenureTermsForDisplay,
        }
      : {}),

    // Registration Influence card inputs (US presidential general only).
    ...(regByState ? { regByState } : {}),
    ...(partyDisplayById ? { partyDisplayById } : {}),
  };
}

// ---------------------------------------------------------------------------
// Dependency fetcher for a single election
// ---------------------------------------------------------------------------

export async function fetchDepsForElection(
  db: Db,
  election: Election,
  view: "full" | "summary"
): Promise<ElectionDeps> {
  const electionOid = election._id;
  const isFull = view === "full";
  const isPresident = election.electionType === "president";
  const countryId = election.countryId ?? "US";

  // Candidates: for completed/resolved include all; for active/upcoming only active
  const candidateQuery: Record<string, unknown> = { electionId: electionOid };
  if (election.status !== "completed" && election.status !== "resolved") {
    candidateQuery.status = "active";
  }
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(candidateQuery)
    .toArray();

  // Collect IDs
  const characterIds = candidates.filter((c) => !c.isNPP).map((c) => c.characterId);
  const runningMateIds = candidates.filter((c) => c.runningMateId).map((c) => c.runningMateId!);
  const allCharIds = [
    ...new Set([...characterIds, ...runningMateIds].map((id) => id.toString())),
  ].map((s) => new ObjectId(s));
  const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);

  // Parallel fetches (core data always; endorsements/campaigns only for full view)
  const [
    characters,
    npps,
    parties,
    nppEndorsements,
    playerEndorsements,
    snapshots,
    statePartyOrgs,
    campaigns,
    tally,
  ] = await Promise.all([
    allCharIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: allCharIds } })
          .toArray()
      : Promise.resolve([] as Character[]),
    nppIds.length > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } })
          .toArray()
      : Promise.resolve([] as NPP[]),
    db.collection<PoliticalParty>("politicalParties").find({ countryId }).toArray(),
    isFull
      ? db
          .collection<NPPEndorsement>("nppEndorsements")
          .find(buildActiveVisibleNppEndorsementFilter({ electionId: electionOid }))
          .toArray()
      : Promise.resolve([] as NPPEndorsement[]),
    isFull
      ? db
          .collection<PlayerEndorsement>("playerEndorsements")
          .find({ electionId: electionOid, isActive: true })
          .toArray()
      : Promise.resolve([] as PlayerEndorsement[]),
    isFull
      ? db
          .collection<PrimarySnapshot>("primarySnapshots")
          .find({ electionId: electionOid })
          .sort({ recordedAt: 1 })
          .limit(72)
          .toArray()
      : Promise.resolve([] as PrimarySnapshot[]),
    isFull && isPresident
      ? db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray()
      : Promise.resolve([] as StatePartyOrg[]),
    isFull
      ? db
          .collection<Campaign>("campaigns")
          .find(
            { electionId: electionOid },
            {
              projection: {
                _id: 1,
                candidateId: 1,
                funds: 1,
                color: 1,
                campaignStrength: 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([] as Campaign[]),
    db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ electionId: electionOid }),
  ]);

  // Latest primary snapshot — trend charts (full view) + fallback when live
  // primary groups are not available. Card/list polling % now uses live
  // byParty shares (ticket-1022).
  let latestPrimarySnapshot: PrimarySnapshot | null = null;
  if (snapshots.length > 0) {
    latestPrimarySnapshot = snapshots[snapshots.length - 1];
  } else {
    // summary mode (snapshots array is empty) — fetch the single latest
    const latest = await db
      .collection<PrimarySnapshot>("primarySnapshots")
      .find({ electionId: electionOid })
      .sort({ recordedAt: -1 })
      .limit(1)
      .toArray();
    latestPrimarySnapshot = latest[0] ?? null;
  }

  // Incumbent lookup for single-seat races
  const SINGLE_SEAT_TYPES = new Set([
    "senate",
    "governor",
    "president",
    "primeMinister",
    "uachtaran",
  ]);
  let incumbent: { name: string; partyId: string } | null = null;
  if (SINGLE_SEAT_TYPES.has(election.electionType)) {
    const isNational =
      election.electionType === "president" ||
      election.electionType === "primeMinister" ||
      election.electionType === "uachtaran";
    const q: Record<string, unknown> = { "currentOffice.type": election.electionType };
    if (!isNational) q["currentOffice.state"] = election.state;
    if (election.electionType === "senate" && election.senateClass != null) {
      q["currentOffice.senateClass"] = election.senateClass;
    }
    const [incumbentChar, incumbentNPP] = await Promise.all([
      db.collection<Character>("characters").findOne(q, { projection: { name: 1, party: 1 } }),
      db.collection<NPP>("npps").findOne(q, { projection: { name: 1, party: 1 } }),
    ]);
    const holder = incumbentChar ?? incumbentNPP;
    if (holder) incumbent = { name: holder.name, partyId: holder.party };
  }

  return {
    candidates,
    characters,
    npps,
    parties,
    nppEndorsements,
    playerEndorsements,
    snapshots,
    statePartyOrgs,
    campaigns,
    tally,
    latestPrimarySnapshot,
    incumbent,
  };
}
