/**
 * One party's presidential-primary detail, assembled once for every surface
 * that shows it.
 *
 * Two screens render this material: the Blend primary screen at
 * `/elections/[id]`, which fetches it from
 * `GET /api/elections/[id]/primary/[partyId]`, and the deep dive at
 * `/president/primary/[partyId]`, which calls this module directly. They read
 * the same function rather than one calling the other's HTTP route, so their
 * figures cannot drift and the server page pays no round trip to itself.
 *
 * `loadPrimaryPartyData` returns the rich, server-only assembly (Mongo docs and
 * Maps) that the deep-dive page still needs for its choropleth and
 * endorsements. `buildPrimaryPartyDetail` returns the JSON-safe subset the
 * endpoint serves. Both derive `byState` from the same place, which is the
 * point: the carve-up on either screen is the same carve-up.
 */

import { ObjectId, type Db } from "mongodb";
import type {
  Campaign,
  Character,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  NPP,
  PlayerEndorsement,
  PoliticalParty,
  State,
  StateDemographics,
  StatePartyOrg,
} from "@/lib/db/types";
import { projectPrimaryByState, type ProjectionResult } from "@/lib/primaryProjection";
import { loadRegionalBonusMaps } from "@/lib/primaryRegionalBonusLoader";
import { fetchEnrichedCandidates } from "@/lib/electionEngine";
import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import { getTravelActionCost } from "@/lib/constants/states";
import {
  TRAVEL_STATE_IDS,
  loadStateTravelOptions,
  travelStateIds,
} from "@/lib/elections/stateTravelOptions";
import { buildCandidateColorMap } from "@/lib/campaigns/candidateColor";
import { getPartyHex } from "@/lib/utils/politics";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  PRIMARY_CAMPAIGN_TICK_CAP,
  PRIMARY_HOME_SURGE_COST_ACTIONS,
  PRIMARY_HOME_SURGE_COST_FUNDS,
  PRIMARY_HOME_SURGE_PCT,
} from "@/lib/electionEngine/constants";
import type { PrimaryCandidateInfo } from "@/lib/elections/primaryViewModel";
import type {
  PrimaryPartyDetail,
  PrimaryViewerCampaign,
} from "@/lib/elections/dto/primaryPartyDetail";

export type { PrimaryPartyDetail, PrimaryViewerCampaign };

/** The signed-in user, as both `getAuthUser` and `requireBasicAuth` report them. */
export interface PrimaryDetailViewer {
  userId: string;
  /** Set when the account is acting as a specific profile. */
  activeCharacterId?: string | null;
}

/** The full assembly, including the pieces only a server component can use. */
export interface PrimaryPartyData {
  detail: PrimaryPartyDetail;
  party: PoliticalParty;
  candidates: ElectionCandidate[];
  tally: ElectionVoteTally | null;
  /** Raw projection, still needed for the deep dive's choropleth tooltips. */
  projection: ProjectionResult;
  charMap: Map<string, Character>;
  nppMap: Map<string, NPP>;
  campaignColorByCandidateKey: Map<string, string | null>;
  endorsementCounts: Map<string, number>;
  allocationByState: Record<string, "PR" | "WTA">;
  candidateColorMap: Record<string, string>;
  apportionmentPreset: string | undefined;
  /** The viewer's own row in this party's primary, if they have one. */
  viewerCandidate: ElectionCandidate | null;
  viewerCharacter: Character | null;
}

interface BuildArgs {
  election: Election;
  /** Sequential id or abbreviation, as it appears in the URL. */
  partyId: string;
  viewer: PrimaryDetailViewer | null;
}

/**
 * The state board and travel costs are built from US electoral-vote units, so
 * this only speaks for US presidential races. Any other race returns null and
 * its caller renders nothing rather than a board of meaningless states.
 */
function isSupportedRace(election: Election): boolean {
  return election.electionType === "president" && election.countryId === "US";
}

export async function buildPrimaryPartyDetail(
  db: Db,
  args: BuildArgs
): Promise<PrimaryPartyDetail | null> {
  const data = await loadPrimaryPartyData(db, args);
  return data?.detail ?? null;
}

export async function loadPrimaryPartyData(
  db: Db,
  { election, partyId, viewer }: BuildArgs
): Promise<PrimaryPartyData | null> {
  if (!isSupportedRace(election)) return null;

  const countryId = election.countryId;
  const sequentialId = Number(partyId);
  const parties = db.collection<PoliticalParty>("politicalParties");
  const party =
    (Number.isFinite(sequentialId) ? await parties.findOne({ countryId, sequentialId }) : null) ??
    (await parties.findOne({ countryId, abbreviation: partyId }));
  // An unknown party is a 404. An empty roster is not: the deep dive renders a
  // "nobody has filed yet" call to action, and returning null here would turn
  // that navigable page into a dead end.
  if (!party) return null;

  const partyKey = party.sequentialId.toString();

  const [candidates, tally] = await Promise.all([
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: election._id, party: partyKey, status: "active" })
      .toArray(),
    db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ electionId: election._id }),
  ]);

  // Each candidate's chosen display colour lives on their campaign.
  const candidateKeys = candidates
    .map((c) => (c.isNPP ? c.nppId : c.characterId))
    .filter((id): id is NonNullable<typeof id> => id != null);
  const campaigns = candidateKeys.length
    ? await db
        .collection<Campaign>("campaigns")
        .find({ electionId: election._id, candidateId: { $in: candidateKeys } })
        .project<{ candidateId: (typeof candidateKeys)[number]; color?: string | null }>({
          candidateId: 1,
          color: 1,
        })
        .toArray()
    : [];
  const campaignColorByCandidateKey = new Map<string, string | null>();
  for (const camp of campaigns) {
    campaignColorByCandidateKey.set(camp.candidateId.toString(), camp.color ?? null);
  }

  const characterIds = candidates.filter((c) => !c.isNPP).map((c) => c.characterId);
  const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);
  const [chars, npps] = await Promise.all([
    characterIds.length > 0
      ? db
          .collection<Character>("characters")
          .find(
            { _id: { $in: characterIds } },
            { projection: { homeState: 1, nationalInfluence: 1, favorability: 1 } }
          )
          .toArray()
      : [],
    nppIds.length > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } }, { projection: { homeState: 1, favorability: 1 } })
          .toArray()
      : [],
  ]);
  const charMap = new Map(chars.map((c) => [c._id.toString(), c]));
  const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));

  const partyOrgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId, partyId: partyKey })
    .toArray();
  const orgMap = new Map<string, number>();
  const allocationByState: Record<string, "PR" | "WTA"> = {};
  for (const po of partyOrgs) {
    // Include active home-state surge bumps so the projection reflects them.
    orgMap.set(`${po.stateId}_${po.partyId}`, po.organization + (po.primarySurge ?? 0));
    if (po.primaryAllocation) allocationByState[po.stateId] = po.primaryAllocation;
  }

  const candidateMeta = candidates.map((c) => {
    const homeState = c.isNPP
      ? c.nppId
        ? (nppMap.get(c.nppId.toString())?.homeState ?? null)
        : null
      : (charMap.get(c.characterId.toString())?.homeState ?? null);
    return {
      candidateId: c._id.toString(),
      isNPP: Boolean(c.isNPP),
      homeState,
      primaryCampaignState: c.primaryCampaignState ?? null,
      primaryCampaignTicks: c.primaryCampaignTicks ?? 0,
      primarySurgeUsed: c.primarySurgeUsed ?? false,
      primarySurgeBoost: c.primarySurgeBoost,
      support: c.support,
    };
  });

  const [categoriesDocs, statesDocs, demographicsDocs, enriched] = await Promise.all([
    loadDemographicCategories(db),
    db
      .collection<State>("states")
      .find({ _id: { $in: TRAVEL_STATE_IDS } })
      .toArray(),
    db
      .collection<StateDemographics>("stateDemographics")
      .find({ _id: { $in: TRAVEL_STATE_IDS } })
      .toArray(),
    fetchEnrichedCandidates(candidates, { includePartyPositions: true, countryId }),
  ]);
  const stateMap = new Map(statesDocs.map((s) => [s._id as string, s]));
  const demographicsMap = new Map(demographicsDocs.map((d) => [d._id as string, d]));

  const stateNameById: Record<string, string> = {};
  for (const stateId of TRAVEL_STATE_IDS) {
    stateNameById[stateId] = stateMap.get(stateId)?.name ?? stateId;
  }

  const regionalBonuses = await loadRegionalBonusMaps(db, {
    candidates,
    homeStateByCharacterId: new Map(
      [...charMap.values()].map((c) => [c._id.toString(), c.homeState ?? null])
    ),
    homeStateByNppId: new Map(
      [...nppMap.values()].map((n) => [n._id.toString(), n.homeState ?? null])
    ),
  });

  const projection = projectPrimaryByState({
    candidates: enriched,
    candidateMeta,
    stateIds: TRAVEL_STATE_IDS,
    stateMap,
    demographicsMap,
    categories: categoriesDocs,
    statePartyOrgs: orgMap,
    partyPosition: {
      economicPosition: party.economicPosition,
      socialPosition: party.socialPosition,
    },
    // Mirror primaryStaggerPhase wiring so the projection matches what the wave
    // actually produces, otherwise regionally-funded wins surface as upsets.
    stateOrgByStateAndCandidate: regionalBonuses.stateOrgByStateAndCandidate,
    homeStateByCandidate: regionalBonuses.homeStateByCandidate,
    countryId,
  });

  const allEndorsements = await db
    .collection<PlayerEndorsement>("playerEndorsements")
    .find({ electionId: election._id, isActive: true })
    .project<{ candidateId: ObjectId }>({ candidateId: 1 })
    .toArray();
  const endorsementCounts = new Map<string, number>();
  for (const e of allEndorsements) {
    const cid = e.candidateId.toString();
    endorsementCounts.set(cid, (endorsementCounts.get(cid) ?? 0) + 1);
  }

  const partyColor = getPartyHex(party.abbreviation ?? partyKey, party.color);
  const candidateColorMap = buildCandidateColorMap(
    candidates.map((c) => {
      const candKey = c.isNPP ? c.nppId?.toString() : c.characterId.toString();
      return {
        candidateId: c._id.toString(),
        campaignColor: candKey ? (campaignColorByCandidateKey.get(candKey) ?? null) : null,
      };
    }),
    party.abbreviation ?? partyKey,
    party.color
  );

  const candidateInfo: PrimaryCandidateInfo[] = candidates.map((c) => ({
    id: c._id.toString(),
    name: c.characterName ?? "Unknown",
    color: candidateColorMap[c._id.toString()] ?? partyColor,
  }));

  const votedStateIds = collectVotedStates(tally);
  const byState = buildDisplayVotes({
    projection,
    tally,
    partyKey,
    votedStateIds,
    liveCandidateIds: new Set(candidates.map((c) => c._id.toString())),
  });

  const apportionmentPreset = (
    await db.collection<{ _id: string; preset?: string }>("gameState").findOne({ _id: "current" })
  )?.preset;

  const { viewerCandidate, viewerCharacter } = await resolveViewer(db, {
    viewer,
    candidates,
  });
  const viewerCampaign = await buildPrimaryViewerCampaign(db, {
    viewerCandidate,
    viewerCharacter,
    stateNameById,
    apportionmentPreset,
  });

  return {
    detail: {
      partyId: partyKey,
      partyName: party.name,
      partyColor,
      candidates: candidateInfo,
      byState,
      stateNameById,
      votedStateIds,
      viewerCampaign,
    },
    party,
    candidates,
    tally,
    projection,
    charMap,
    nppMap,
    campaignColorByCandidateKey,
    endorsementCounts,
    allocationByState,
    candidateColorMap,
    apportionmentPreset,
    viewerCandidate,
    viewerCharacter,
  };
}

/**
 * States whose wave has already fired.
 *
 * Read from the wave history rather than from `primaryDelegatesByState`: that
 * map is keyed by what a wave AWARDED this party, so a state that voted but
 * gave this party nothing would read as still upcoming.
 */
function collectVotedStates(tally: ElectionVoteTally | null): string[] {
  const voted = new Set<string>();
  for (const entry of tally?.primaryWaveHistory ?? []) {
    for (const stateId of entry.statesVoted) voted.add(stateId);
  }
  return [...voted];
}

/**
 * What each state's bar should show: the count where a contest has happened,
 * the forecast where it has not.
 *
 * Feeding the raw projection everywhere would keep showing a prediction for
 * contests that have already been decided, which is how the deep dive's
 * carve-up came to disagree with the map directly above it.
 *
 * Tally rows are scoped to candidates still in the race for the reason the
 * per-state page does it (#974): the tally keeps rows for withdrawn
 * candidates, which otherwise surface as an "Unknown" slice and skew every
 * other share in the state.
 */
function buildDisplayVotes(input: {
  projection: ProjectionResult;
  tally: ElectionVoteTally | null;
  partyKey: string;
  votedStateIds: string[];
  liveCandidateIds: ReadonlySet<string>;
}): Record<string, Record<string, number>> {
  const { projection, tally, partyKey, liveCandidateIds } = input;
  const voted = new Set(input.votedStateIds);
  const actualByState = tally?.primaryStateVotes?.[partyKey] ?? {};

  // The union, not just the projected states: a counted result must survive
  // even when the projection has no entry for that state, which is the case
  // once a race has no live candidates left to project.
  const stateIds = new Set([...Object.keys(projection.byState), ...voted]);

  const byState: Record<string, Record<string, number>> = {};
  for (const stateId of stateIds) {
    const projected = projection.byState[stateId] ?? {};
    if (!voted.has(stateId)) {
      byState[stateId] = projected;
      continue;
    }
    const counted: Record<string, number> = {};
    for (const [candidateId, votes] of Object.entries(actualByState[stateId] ?? {})) {
      if (votes > 0 && liveCandidateIds.has(candidateId)) counted[candidateId] = votes;
    }
    // A state can be marked voted before its counts land; fall back to the
    // projection rather than blanking the carve-up.
    byState[stateId] = Object.keys(counted).length > 0 ? counted : projected;
  }
  return byState;
}

/**
 * The viewer's row in this party's primary, resolved the way the deep-dive page
 * resolves it: by active profile when the account has one, else by user id.
 * Both surfaces must land on the same character or they disagree about whose
 * campaign is on screen.
 */
async function resolveViewer(
  db: Db,
  input: { viewer: PrimaryDetailViewer | null; candidates: ElectionCandidate[] }
): Promise<{ viewerCandidate: ElectionCandidate | null; viewerCharacter: Character | null }> {
  const { viewer, candidates } = input;
  if (!viewer?.userId) return { viewerCandidate: null, viewerCharacter: null };

  // The active profile is server-side state from the user's own record, but a
  // malformed value would throw inside ObjectId and turn stale session data
  // into a 500 on a read. Fall back to the user's character instead.
  const activeId =
    viewer.activeCharacterId && ObjectId.isValid(viewer.activeCharacterId)
      ? new ObjectId(viewer.activeCharacterId)
      : null;
  const viewerCharId = activeId ?? (await getCharacterByUserId(db, viewer.userId))?._id ?? null;
  if (!viewerCharId) return { viewerCandidate: null, viewerCharacter: null };

  const viewerCandidate =
    candidates.find(
      (c) => !c.isNPP && c.characterId && c.characterId.toString() === viewerCharId.toString()
    ) ?? null;
  const viewerCharacter = await db
    .collection<Character>("characters")
    .findOne({ _id: viewerCharId });

  return { viewerCandidate, viewerCharacter };
}

/**
 * The camp and surge controls' data for one candidate.
 *
 * Exported because the campaign manager shows the same two controls the primary
 * screen does, and building it twice would let the two quote different prices
 * for the same action. Pass the state names and preset when the caller has
 * already loaded them; otherwise they are fetched here.
 */
export async function buildPrimaryViewerCampaign(
  db: Db,
  input: {
    viewerCandidate: ElectionCandidate | null;
    viewerCharacter: Character | null;
    stateNameById?: Record<string, string>;
    apportionmentPreset?: string | undefined;
  }
): Promise<PrimaryViewerCampaign | null> {
  const { viewerCandidate, viewerCharacter } = input;
  if (!viewerCandidate || !viewerCharacter) return null;

  const loaded = input.stateNameById
    ? { stateNameById: input.stateNameById, preset: input.apportionmentPreset }
    : await loadStateTravelOptions(db, input.apportionmentPreset);
  const stateNameById = loaded.stateNameById;
  const apportionmentPreset = loaded.preset;

  // Price and balance both in LOCAL units, matching the field and rate the
  // surge route debits, so an affordable-looking surge is an affordable one.
  const forexEnabled = await isForexEnabled();
  const { rate } = forexEnabled
    ? await loadCharacterFxRate(db, getHomeCurrency(viewerCharacter))
    : { rate: 1 };
  const surgeCostFunds = PRIMARY_HOME_SURGE_COST_FUNDS * rate;
  const playerFunds = viewerCharacter.currencyBalances?.campaign ?? viewerCharacter.funds ?? 0;

  return {
    currentCampaignState: viewerCandidate.primaryCampaignState ?? null,
    currentTicks: viewerCandidate.primaryCampaignTicks ?? 0,
    tickCap: PRIMARY_CAMPAIGN_TICK_CAP,
    homeState: viewerCharacter.homeState ?? null,
    surgeUsed: viewerCandidate.primarySurgeUsed ?? false,
    playerActions: viewerCharacter.actions ?? 0,
    playerFunds,
    surgeCostFunds,
    surgeCostActions: PRIMARY_HOME_SURGE_COST_ACTIONS,
    surgeBoost: PRIMARY_HOME_SURGE_PCT,
    // Scoped to the world's own apportionment: the camp, travel, presence and
    // attack routes all validate against it, so offering the modern fifty on a
    // 1953 world was offering states the server refuses.
    states: travelStateIds(apportionmentPreset).map((id) => ({
      id,
      name: stateNameById[id] ?? id,
      actionCost: getTravelActionCost(id, apportionmentPreset),
    })),
  };
}
