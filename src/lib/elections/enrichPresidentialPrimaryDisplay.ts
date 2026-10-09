import { primaryWinMomentumFromTally } from "@/lib/elections/primaryRegional/rules";
import { loadPrimaryFieldOffices } from "@/lib/elections/primaryRegional/fieldOffices";
import { getGameTime } from "@/lib/time/gameTime";
import {
  activePrimaryNights,
  primaryNightForParty,
} from "@/lib/elections/liveResults/primaryNight";
import { usesCampaignAds } from "@/lib/campaignTargeting/rules";
import { loadCampaignProjectionContext } from "@/lib/campaignTargeting/audience";
import type { Db } from "mongodb";
import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import type {
  ElectionCandidate,
  Character,
  NPP,
  PoliticalParty,
  StatePartyOrg,
  ElectionVoteTally,
  State,
  StateDemographics,
} from "@/lib/db/types";
import { type CountryId } from "@/lib/constants/countries";
import {
  type EnrichedCandidate,
  type PartyGroup,
  type PrimaryCalendarWave,
} from "@/lib/elections/candidateEnrichment";
import type { PollingData } from "./electionResponseTypes";
import { projectPrimaryByState } from "@/lib/primaryProjection";
import { loadRegionalBonusMaps } from "@/lib/primaryRegionalBonusLoader";
import { fetchEnrichedCandidates } from "@/lib/electionEngine/candidateEnrichment";
import {
  getAllStaggerStates,
  getDelegateMajority,
  getTotalDelegatesForFamily,
  resolvePartyFamily,
  type PrimaryWaveSchedule,
} from "@/lib/constants/primaryCalendar";
import {
  applyProjectedDelegatePolling,
  applyProjectedDelegateShares,
  summarizePrimaryProjection,
} from "./presidentialPrimaryDisplay";

export async function applyPresidentialPrimaryDisplay(
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
  schedule: PrimaryWaveSchedule,
  preset?: string,
  campaignRulesVersion?: number
): Promise<{
  byParty: PartyGroup[];
  polling: PollingData | null;
  displayCandidates: EnrichedCandidate[];
  primaryCalendar: PrimaryCalendarWave[];
}> {
  // State membership is identical across schedules; the schedule is threaded so
  // this display path stays coherent with the race's actual calendar even if a
  // future schedule ever changes membership.
  const staggerStateIds = getAllStaggerStates(schedule);
  const campaignContext = usesCampaignAds({ campaignRulesVersion }, candidates)
    ? {
        ...(await loadCampaignProjectionContext(db, staggerStateIds)),
        campaignRulesVersion: campaignRulesVersion ?? 0,
      }
    : undefined;
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

  // Field offices lift a candidate's vote in the states they are in, in the
  // live wave and so in every projection of it. Loaded once for the race.
  const electionId = candidates[0]?.electionId;
  const fieldOffices = electionId
    ? await loadPrimaryFieldOffices(
        db,
        { _id: electionId, countryId },
        candidates,
        (await getGameTime()).currentTurn
      )
    : undefined;

  // Primary night: per party, the states whose result is not yet called.
  const nowMs = Date.now();
  const nightHiddenFor = (partyId: string): Set<string> =>
    electionId
      ? primaryNightForParty({
          electionId: String(electionId),
          partyId,
          waves: tally?.primaryWaveHistory,
          stateVotes: tally?.primaryStateVotes?.[partyId],
          nowMs,
        }).hidden
      : new Set();

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
          primarySurgeUsed: rawCandidate.primarySurgeUsed ?? false,
          primarySurgeBoost: rawCandidate.primarySurgeBoost,
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
      // Same seed as the live wave, so the projection sees the same state swing.
      regionalSeed: candidates[0]?.electionId ? String(candidates[0].electionId) : undefined,
      winMomentum: primaryWinMomentumFromTally(tally),
      fieldOffices,
      campaignContext,
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
      // A state still being counted on primary night stays projected here, so
      // the delegate race does not bank delegates the night has not called.
      actualVotesByState: withoutStates(
        tally?.primaryStateVotes?.[rawPartyId],
        nightHiddenFor(rawPartyId)
      ),
      awardedDelegatesByState: withoutStates(
        tally?.primaryDelegatesByState?.[rawPartyId],
        nightHiddenFor(rawPartyId)
      ),
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
          // Raw counts alongside the share, so the delegate race can show
          // "1,946 of 4,833, 471 to clinch" rather than a bare percentage.
          projectedDelegates,
          awardedDelegates: projectionSummary.awardedDelegatesByCandidate,
          totalDelegates: getTotalDelegatesForFamily(family, preset),
          delegateMajority: getDelegateMajority(family, preset),
        },
        projectedDelegates,
        getTotalDelegatesForFamily(family, preset),
        projectionSummary.nationalVotesByCandidate
      )
    );
  }

  projectedByParty.sort((a, b) => b.candidates.length - a.candidates.length);

  // The stagger calendar, marked against the waves the engine has already run.
  // `primaryStaggerWavesRun` is the runtime source of truth for how far the
  // primary has got, so waves before it are settled and the rest are pending.
  const wavesRun = tally?.primaryStaggerWavesRun ?? 0;
  const nightStates = activePrimaryNights(tally?.primaryWaveHistory, nowMs);
  const primaryCalendar: PrimaryCalendarWave[] = schedule.waves.map((wave, i) => ({
    label: wave.label,
    turnsRemaining: wave.turnsRemaining,
    states: wave.states,
    status:
      i >= wavesRun
        ? "upcoming"
        : wave.states.some((s) => nightStates.has(s))
          ? "live"
          : "complete",
  }));

  return {
    byParty: projectedByParty,
    polling: applyProjectedDelegatePolling(polling, projectedByParty),
    displayCandidates: projectedByParty.flatMap((group) => group.candidates),
    primaryCalendar,
  };
}

// ---------------------------------------------------------------------------
// Core enrichment (accepts pre-fetched deps — used by both single and batch)
// ---------------------------------------------------------------------------

/** A per-state record with some states left out. */
function withoutStates<T>(
  byState: Readonly<Record<string, T>> | undefined,
  hidden: ReadonlySet<string>
): Record<string, T> {
  if (!byState) return {};
  if (hidden.size === 0) return { ...byState };
  return Object.fromEntries(Object.entries(byState).filter(([s]) => !hidden.has(s)));
}
