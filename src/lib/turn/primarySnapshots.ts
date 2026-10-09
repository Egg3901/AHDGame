/**
 * Primary-phase snapshots: each turn records every open primary's standings,
 * accrues non-presidential primary ballots over the ballot window, and writes
 * the presidential per-state polling projection.
 */
import { usesLegacyPresidentialCampaign } from "@/lib/countries/ru/rules/presidentialCampaign";
import { applyStandingAds } from "@/lib/campaignTargeting/standingAds";
import { buildGranularElectorateSubstrate } from "@/lib/demographics/granularElectorate";
import {
  usesCampaignRules,
  usesCampaignAds,
  turnoutForElection,
  targetedAdBonuses,
  meanAdBonus,
  campaignPrimaryScore,
  CAMPAIGN_RULES_VERSION,
} from "@/lib/campaignTargeting/rules";
import {
  loadCampaignProjectionContext,
  loadRegionalCampaignCells,
} from "@/lib/campaignTargeting/audience";
import { getDb } from "@/lib/mongodb";
import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import { TALLY_WITH_SNAPSHOT_TURNS_ONLY } from "@/lib/electionEngine/tallyProjections";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type {
  DemographicCategory,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  Character,
  NPP,
  PoliticalParty as PoliticalPartyType,
  PrimarySnapshot,
  PrimarySnapshotEntry,
  State,
  StateDemographics,
  StateDemographicTurnout,
  StatePartyOrg,
} from "@/lib/db/types";
import {
  primarySharePctSoftmax,
  PRIMARY_SHARE_SOFTMAX_TEMPERATURE,
  buildPartyChairMaps,
  resolvePartyChairPrimaryRole,
  scorePrimaryCandidate,
} from "@/lib/primaryScore";
import { parseSeatId } from "@/lib/seats/seatId";
import { type CountryId } from "@/lib/constants/countries";
import { resolveTurnout } from "@/lib/electionEngine/resolvedTurnout";
import { resolveTurnWindow } from "@/lib/electionEngine/voteCalculations";
import { eraYearContextFromGameState } from "@/lib/era/context";
import {
  accruePrimaryBallotTurn,
  ballotSharesWithinParty,
  partyPrimaryPools,
  primaryBallotWindow,
} from "@/lib/turn/primaryBallots";
import {
  summarizePrimaryProjection,
  presidentialPrimaryStanding,
} from "@/lib/elections/presidentialPrimaryDisplay";
import { resolvePartyFamily, getTotalDelegatesForFamily } from "@/lib/constants/primaryCalendar";
import {
  loadCandidateEnrichmentPreload,
  type CandidateEnrichmentPreload,
} from "@/lib/electionEngine/candidateEnrichment";
import { primaryOpenFilter } from "@/lib/elections/electionDeadlineFilters";
import { scopeFilter, type ElectionSweepScope } from "./electionSweepScope";
import { planTurnSlice, type TurnSlicePart } from "@/lib/electionEngine/rules/turnSlice";

/**
 * Record a primary standings snapshot for every election currently in primary phase.
 * Called each turn so the hourly trend graph stays populated.
 *
 * `slice: "early"` is the half-hour results tick: it banks half of the coming
 * turn's primary ballots for races whose turn-bounded ballot window is open,
 * and the turn banks the rest. Presidential primaries, score-only races and
 * the presidential polling projection stay on the turn.
 */
export async function recordPrimarySnapshots(
  now: Date,
  currentTurn: number,
  scope?: ElectionSweepScope,
  options?: { slice?: "early" }
): Promise<number> {
  const db = await getDb();
  const early = options?.slice === "early";

  // Elections still in their primary phase — turn-first with Date fallback.
  const activeElections = await db
    .collection<Election>("elections")
    .find({
      ...scopeFilter(scope),
      status: { $in: ["upcoming", "active"] },
      ...primaryOpenFilter(currentTurn, now),
    })
    .toArray();

  if (activeElections.length === 0) return 0;

  const electionIds = activeElections.map((e) => e._id);
  const hasPresident = activeElections.some((e) => usesLegacyPresidentialCampaign(e));

  // Region IDs for state-level alignment lookups (skip presidential).
  const snapshotRegionLookups = activeElections
    .filter((e) => !usesLegacyPresidentialCampaign(e))
    .map((e) => ({
      regionId: e.seatId ? parseSeatId(e.seatId).localRegionId : e.state,
      countryId: (e.countryId ?? "US") as CountryId,
    }))
    .filter((r): r is { regionId: string; countryId: CountryId } => Boolean(r.regionId));
  const uniqueSnapshotRegionKeys = new Set(
    snapshotRegionLookups.map((r) => `${r.countryId}:${r.regionId}`)
  );

  const snapshotRegionIds = [...new Set(snapshotRegionLookups.map((r) => r.regionId))] as string[];

  const [
    parties,
    statePartyOrgs,
    allCandidates,
    stateDocs,
    regionDemographicsDocs,
    regionTurnoutDocs,
    regionDefaultsDocs,
    demographicCategoryDocs,
    existingPrimaryTallies,
    snapshotGameState,
  ] = await Promise.all([
    db.collection<PoliticalPartyType>("politicalParties").find({}).toArray(),
    // The presidential path needs every state's org rows; ballot accrual only
    // needs the rows for the regions actually holding a primary this turn.
    hasPresident
      ? db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray()
      : snapshotRegionIds.length > 0
        ? db
            .collection<StatePartyOrg>("statePartyOrg")
            .find({ stateId: { $in: snapshotRegionIds } })
            .toArray()
        : Promise.resolve([] as StatePartyOrg[]),
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .toArray(),
    uniqueSnapshotRegionKeys.size > 0
      ? db
          .collection<State>("states")
          .find({
            $or: [...uniqueSnapshotRegionKeys].map((key) => {
              const [countryId, regionId] = key.split(":");
              return countryId === regionId
                ? { countryId: countryId as CountryId }
                : { _id: regionId, countryId: countryId as CountryId };
            }),
          })
          .toArray()
      : Promise.resolve([] as State[]),
    // Ballot-accrual inputs: the same demographic turnout machinery the
    // general's vote engine runs, so a primary's pool and a general's pool
    // come from one source of truth. All of these degrade to "no accrual, keep
    // score-based shares" when a world has not seeded them.
    snapshotRegionIds.length > 0
      ? db
          .collection<StateDemographics>("stateDemographics")
          .find({ _id: { $in: snapshotRegionIds } })
          .toArray()
      : Promise.resolve([] as StateDemographics[]),
    snapshotRegionIds.length > 0
      ? db
          .collection<StateDemographicTurnout>("stateDemographicTurnout")
          .find({ _id: { $in: snapshotRegionIds } })
          .toArray()
      : Promise.resolve([] as StateDemographicTurnout[]),
    snapshotRegionIds.length > 0
      ? db
          .collection<StateDemographics>("demographicDefaults")
          .find({ _id: { $in: snapshotRegionIds } })
          .toArray()
      : Promise.resolve([] as StateDemographics[]),
    snapshotRegionIds.length > 0
      ? db.collection<DemographicCategory>("demographicCategories").find({}).toArray()
      : Promise.resolve([] as DemographicCategory[]),
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } }, { projection: TALLY_WITH_SNAPSHOT_TURNS_ONLY })
      .project<Pick<ElectionVoteTally, "electionId" | "primaryVotes">>({
        electionId: 1,
        primaryVotes: 1,
      })
      .toArray(),
    db
      .collection<{
        _id: string;
        preset?: string;
        currentYear?: number;
        startingYear?: number;
        eraSystemEnabled?: boolean;
      }>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { preset: 1, currentYear: 1, startingYear: 1, eraSystemEnabled: 1 } }
      ),
  ]);

  // Use composite keys to avoid cross-country sequential ID collisions
  const partyMap = new Map(parties.map((p) => [`${p.countryId ?? "US"}:${p.sequentialId}`, p]));
  const partyChairMaps = buildPartyChairMaps(parties, statePartyOrgs);
  const partyOrgByStateParty = new Map<string, number>();
  for (const po of statePartyOrgs) {
    partyOrgByStateParty.set(`${po.stateId}_${po.partyId}`, po.organization ?? 0);
  }
  const stateMap = new Map(stateDocs.map((s) => [`${s.countryId}:${s._id}`, s]));

  const candidatesByElection = new Map<string, typeof allCandidates>();
  for (const c of allCandidates) {
    const eid = c.electionId.toString();
    const list = candidatesByElection.get(eid) ?? [];
    list.push(c);
    candidatesByElection.set(eid, list);
  }

  const enrichmentPreload = await loadCandidateEnrichmentPreload(
    db,
    allCandidates,
    electionIds,
    statePartyOrgs
  );
  const charMap = enrichmentPreload.charactersById;
  applyStandingAds(allCandidates, charMap);
  const nppMap = enrichmentPreload.nppsById;

  // Presidential-only: compute per-state projections FIRST (also writes the
  // per-state polling history to the tally). The returned projections drive a
  // delegate-consistent national standing on the primarySnapshots doc below, so
  // the persisted standing (read by wiki/discord/trend) matches the delegate
  // winner instead of the old calcPresidentPrimaryScore ranking (#3022).
  const presProjections = await recordPresidentialStatePollingSnapshots(
    db,
    early ? [] : activeElections.filter((e) => usesLegacyPresidentialCampaign(e)),
    candidatesByElection,
    charMap,
    nppMap,
    partyMap,
    statePartyOrgs,
    enrichmentPreload,
    now
  );
  const presPreset = hasPresident ? snapshotGameState?.preset : undefined;

  // ── Primary ballot accrual inputs ─────────────────────────────────────────
  // Per-region turnout pool via the SAME resolveTurnout the general vote
  // engine uses, and per-region party registration shares. Regions missing any
  // of the inputs simply never enter these maps, and their races keep the
  // legacy score-share behavior end to end.
  const eraYear = eraYearContextFromGameState(snapshotGameState);
  const demographicsByRegion = new Map(regionDemographicsDocs.map((d) => [d._id as string, d]));
  const turnoutDocByRegion = new Map(regionTurnoutDocs.map((t) => [t._id as string, t]));
  const registrationByRegion = new Map<string, Map<string, number>>();
  for (const po of statePartyOrgs) {
    if (typeof po.registration !== "number") continue;
    const perParty = registrationByRegion.get(po.stateId) ?? new Map<string, number>();
    perParty.set(po.partyId, po.registration);
    registrationByRegion.set(po.stateId, perParty);
  }
  const turnoutPoolByRegionKey = new Map<string, number>();
  for (const key of uniqueSnapshotRegionKeys) {
    const [, regionId] = key.split(":");
    const stateDoc = stateMap.get(key);
    const demographics = demographicsByRegion.get(regionId);
    if (!stateDoc || !demographics || demographicCategoryDocs.length === 0) continue;
    const electorate = stateDoc.votingEligiblePopulation ?? stateDoc.population;
    if (!(electorate > 0)) continue;
    const { totalPool } = resolveTurnout(
      electorate,
      demographics,
      demographicCategoryDocs,
      turnoutDocByRegion.get(regionId),
      { preset: snapshotGameState?.preset, year: eraYear.year, startingYear: eraYear.startingYear }
    );
    if (totalPool > 0) turnoutPoolByRegionKey.set(key, totalPool);
  }
  const modernRegionKeys = new Set(
    activeElections
      .filter((e) => usesCampaignAds(e, candidatesByElection.get(e._id.toString()) ?? []))
      .filter((e) => !usesLegacyPresidentialCampaign(e))
      .map(
        (e) =>
          `${e.countryId}:${e.seatId ? parseSeatId(e.seatId).localRegionId : e.state}:${usesCampaignRules(e) ? 1 : 0}`
      )
  );
  const defaultsByRegion = new Map(regionDefaultsDocs.map((doc) => [doc._id, doc]));
  const campaignSubstrates = new Map<
    string,
    NonNullable<ReturnType<typeof buildGranularElectorateSubstrate>>
  >();
  for (const key of modernRegionKeys) {
    const [country, regionId, version] = key.split(":");
    const state = stateMap.get(`${country}:${regionId}`);
    const demographics = demographicsByRegion.get(regionId);
    if (!state || !demographics) continue;
    const turnoutDoc = turnoutForElection(turnoutDocByRegion.get(regionId), {
      campaignRulesVersion: Number(version),
    });
    const electorate = state.votingEligiblePopulation ?? state.population;
    const liveTurnouts = resolveTurnout(
      electorate,
      demographics,
      demographicCategoryDocs,
      turnoutDoc,
      { preset: snapshotGameState?.preset, ...eraYear }
    ).byGroup;
    const substrate = buildGranularElectorateSubstrate({
      countryId: country,
      stateId: regionId,
      preset: snapshotGameState?.preset,
      ...eraYear,
      campaignRulesVersion: CAMPAIGN_RULES_VERSION,
      currentTurn,
      turnoutDoc,
      statePopulation: electorate,
      demographics,
      categories: demographicCategoryDocs,
      enriched: [],
      liveTurnouts,
      demographicDefaults: defaultsByRegion.get(regionId),
    });
    if (substrate) campaignSubstrates.set(key, substrate);
  }
  const advertisedCountries = new Set(
    activeElections
      .filter(
        (e) =>
          !usesLegacyPresidentialCampaign(e) &&
          e.state === e.countryId &&
          candidatesByElection
            .get(e._id.toString())
            ?.some((candidate) => candidate.targetedAds?.length)
      )
      .map((e) => e.countryId)
  );
  const nationalCampaignCells = advertisedCountries.size
    ? await loadRegionalCampaignCells(
        db,
        stateDocs.filter((state) => advertisedCountries.has(state.countryId)),
        new Set(
          activeElections
            .filter((e) => !usesCampaignRules(e))
            .map((e) => `${e.countryId}:${e.state}`)
        )
      )
    : new Map();
  const primaryVotesByElection = new Map<string, Record<string, number>>();
  for (const t of existingPrimaryTallies) {
    if (t.primaryVotes) primaryVotesByElection.set(t.electionId.toString(), t.primaryVotes);
  }
  const ballotTallyOps: AnyBulkWriteOperation<ElectionVoteTally>[] = [];
  // Per-turn idempotency: a turn whose later phase stalled (a stuck
  // corporationTurn lock, cleared and re-run) runs this phase again under the
  // SAME turn number. Live turn 460 ran three times and every open general
  // banked three slices; the primary accrual would do the same. A split turn
  // holds an early and a rest snapshot; each half is recorded once.
  const recordedParts = new Map<string, (TurnSlicePart | undefined)[]>();
  for (const s of await db
    .collection<PrimarySnapshot>("primarySnapshots")
    .find({
      electionId: { $in: activeElections.map((e) => e._id as ObjectId) },
      turn: currentTurn,
    })
    .toArray()) {
    const eid = s.electionId.toString();
    recordedParts.set(eid, [...(recordedParts.get(eid) ?? []), s.slicePart]);
  }

  const snapshots: PrimarySnapshot[] = [];

  for (const election of activeElections) {
    const electionObjectId = election._id as ObjectId;
    const candidates = candidatesByElection.get(electionObjectId.toString()) ?? [];

    if (candidates.length === 0) continue;
    const slicePlan = planTurnSlice(
      recordedParts.get(electionObjectId.toString()) ?? [],
      options?.slice
    );
    if (!slicePlan) continue;

    const isPresident = usesLegacyPresidentialCampaign(election);
    // The early half needs a turn-bounded ballot window, so the turn sees the
    // same open window and banks the rest.
    if (
      early &&
      (isPresident ||
        typeof election.startTurn !== "number" ||
        typeof election.primaryEndTurn !== "number")
    )
      continue;

    // Resolve state lean for state-level alignment (skip president).
    let raceStateEconLean: number | null | undefined;
    let raceStateSocialLean: number | null | undefined;
    if (!isPresident && election.seatId) {
      const localRegionId = parseSeatId(election.seatId).localRegionId;
      if (localRegionId) {
        const stateDoc = stateMap.get(`${election.countryId ?? "US"}:${localRegionId}`);
        if (
          stateDoc &&
          typeof stateDoc.cachedEconomicLean === "number" &&
          typeof stateDoc.cachedSocialLean === "number"
        ) {
          raceStateEconLean = stateDoc.cachedEconomicLean;
          raceStateSocialLean = stateDoc.cachedSocialLean;
        }
      }
    }

    const regionIdForAds = election.seatId
      ? parseSeatId(election.seatId).localRegionId
      : election.state;
    const campaignSubstrate = usesCampaignAds(election, candidates)
      ? campaignSubstrates.get(
          `${election.countryId}:${regionIdForAds}:${usesCampaignRules(election) ? 1 : 0}`
        )
      : undefined;
    const regionalAdBonuses: Record<string, number> = {};
    const byParty: Record<string, PrimarySnapshotEntry[]> = {};

    // Presidential standings derive from the SAME per-state vote projection that
    // produces the delegate winner (#3022): rank by projected delegates, votes
    // as tiebreak, with delegate share as the displayed sharePct. Falls back to
    // the ideology score only for a party with no projected votes yet (very
    // early primary). Non-presidential races keep calcPrimaryScore untouched.
    const presStandingByCandidate = new Map<string, { standing: number; sharePct: number }>();
    const presPartiesWithProjection = new Set<string>();
    if (isPresident) {
      const projByParty = presProjections.get(electionObjectId.toString()) ?? {};
      const partyIds = [...new Set(candidates.map((c) => c.party))];
      for (const partyId of partyIds) {
        const byState = projByParty[partyId];
        if (!byState) continue;
        const partyDoc = partyMap.get(`${election.countryId ?? "US"}:${partyId}`);
        const partyCandidateIds = candidates
          .filter((c) => c.party === partyId)
          .map((c) => c._id.toString());
        const family = resolvePartyFamily(partyId, {
          primaryCalendar: partyDoc?.primaryCalendar ?? null,
          economicPosition: partyDoc?.economicPosition ?? 0,
        });
        const stateIds = Object.keys(byState);
        const summary = summarizePrimaryProjection({
          stateIds,
          family,
          candidateIds: partyCandidateIds,
          totalDelegates: getTotalDelegatesForFamily(family, presPreset),
          projectedVotesByState: byState,
          preset: presPreset,
        });
        const totalVotes = Object.values(summary.nationalVotesByCandidate).reduce(
          (s, v) => s + v,
          0
        );
        if (totalVotes <= 0) continue; // no signal yet — fall back to score below
        presPartiesWithProjection.add(partyId);
        const totalDelegates = Object.values(summary.delegatesByCandidate).reduce(
          (s, v) => s + v,
          0
        );
        for (const cid of partyCandidateIds) {
          const standing = presidentialPrimaryStanding(
            summary.delegatesByCandidate[cid] ?? 0,
            (summary.nationalVoteSharePct[cid] ?? 0) / 100
          );
          // Prefer delegate share; before any delegates are awarded show vote share.
          const sharePct =
            totalDelegates > 0
              ? (summary.nationalDelegateSharePct[cid] ?? 0)
              : (summary.nationalVoteSharePct[cid] ?? 0);
          presStandingByCandidate.set(cid, { standing, sharePct });
        }
      }
    }

    const partiesWithPlayerCandidate = new Set(
      candidates.filter((candidate) => !candidate.isNPP).map((candidate) => candidate.party)
    );
    for (const c of candidates) {
      const party = partyMap.get(`${election.countryId ?? "US"}:${c.party}`);
      const partyEcon = party?.economicPosition ?? 0;
      const partySocial = party?.socialPosition ?? 0;

      let econ = 0,
        social = 0,
        favorability = 50,
        politicalInfluence = 0,
        nationalInfluence: number | undefined,
        candidateInfamy: number | undefined;
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
          candidateInfamy = char.infamy;
        }
      }

      const adCells =
        campaignSubstrate?.campaignCells ??
        nationalCampaignCells.get(
          `${election.countryId}:${election.state}${usesCampaignRules(election) ? "" : ":0"}`
        );
      if (!isPresident && adCells && c.targetedAds?.length) {
        const cells = adCells;
        regionalAdBonuses[c._id.toString()] = meanAdBonus(
          cells,
          targetedAdBonuses(
            cells,
            { economicLean: econ, socialLean: social },
            c.targetedAds,
            regionIdForAds ?? election.state,
            currentTurn
          )
        );
      }

      // President with a live projection → delegate-consistent standing (#3022).
      const presStanding = isPresident ? presStandingByCandidate.get(c._id.toString()) : undefined;
      const usePresProjection = isPresident && presPartiesWithProjection.has(c.party);
      let primaryScore = usePresProjection
        ? (presStanding?.standing ?? 0)
        : scorePrimaryCandidate({
            isPresidential: isPresident,
            isNPP: Boolean(c.isNPP),
            hasPlayerInParty: partiesWithPlayerCandidate.has(c.party),
            candidateEcon: econ,
            candidateSocial: social,
            partyEcon,
            partySocial,
            favorability,
            politicalInfluence,
            nationalInfluence,
            partyInfluence: charMap.get(c.characterId.toString())?.partyInfluence,
            partyChairRole: c.isNPP
              ? null
              : resolvePartyChairPrimaryRole(c.characterId.toString(), partyChairMaps),
            infamy: candidateInfamy,
            stateEconLean: raceStateEconLean,
            stateSocialLean: raceStateSocialLean,
          });
      const adBonus = regionalAdBonuses[c._id.toString()] ?? 0;
      if (adBonus > 0)
        primaryScore = campaignPrimaryScore(
          primaryScore,
          adBonus,
          PRIMARY_SHARE_SOFTMAX_TEMPERATURE
        );
      if (!byParty[c.party]) byParty[c.party] = [];
      byParty[c.party].push({
        candidateId: c._id.toString(),
        characterName: c.characterName,
        party: c.party,
        primaryScore,
        sharePct: presStanding?.sharePct ?? 0,
      });
    }

    for (const [partyId, entries] of Object.entries(byParty)) {
      // Projection path already set delegate/vote sharePct; just order it.
      if (presPartiesWithProjection.has(partyId)) {
        entries.sort((a, b) => b.primaryScore - a.primaryScore);
        continue;
      }
      const shares = primarySharePctSoftmax(entries.map((e) => e.primaryScore));
      entries.forEach((entry, i) => {
        entry.sharePct = shares[i];
      });
      entries.sort((a, b) => b.primaryScore - a.primaryScore);
    }

    // ── Real primary ballots (non-presidential) ───────────────────────────
    // This turn's score shares allocate this turn's slice of each party's
    // registered-voter pool, accumulating actual ballot counts on the tally.
    // The persisted snapshot then shows CUMULATIVE ballot shares — the same
    // figure resolution will pick the nominee from — mirroring how the
    // presidential path keeps its standing delegate-consistent (#3022).
    // Ballots count only inside the closing window of the primary (as long as
    // the race's general window); before it opens the snapshot carries score
    // standings alone. See primaryBallotWindow for why.
    const ballotWindow = !isPresident ? primaryBallotWindow(election, currentTurn, now) : null;
    let bankedBallots = false;
    if (!isPresident && election.seatId && ballotWindow?.open) {
      const accrualRegionId = parseSeatId(election.seatId).localRegionId;
      const regionKey = `${election.countryId ?? "US"}:${accrualRegionId}`;
      const totalPool = accrualRegionId
        ? ((usesCampaignRules(election)
            ? campaignSubstrates.get(`${regionKey}:1`)?.totalPool
            : undefined) ?? turnoutPoolByRegionKey.get(regionKey))
        : undefined;
      const registration = accrualRegionId ? registrationByRegion.get(accrualRegionId) : undefined;
      if (accrualRegionId && totalPool && registration) {
        // A split turn's half carries its share of the turn's ballots.
        const pools = partyPrimaryPools(
          totalPool * slicePlan.fraction,
          Object.keys(byParty),
          registration
        );
        if (pools.size > 0) {
          const window = resolveTurnWindow({
            startTurn: ballotWindow.startTurn,
            endTurn: ballotWindow.endTurn,
            startTime: ballotWindow.startTime,
            endTime: ballotWindow.endTime,
            createdAt: election.createdAt,
            currentTurn,
            now,
          });
          const eid = electionObjectId.toString();
          const cumulative = accruePrimaryBallotTurn({
            cumulative: primaryVotesByElection.get(eid) ?? {},
            entriesByParty: new Map(
              Object.entries(byParty).map(([p, entries]) => [
                p,
                entries.map((e) => ({ candidateId: e.candidateId, sharePct: e.sharePct })),
              ])
            ),
            poolsByParty: pools,
            totalTurns: window.totalTurns,
            turnIndex: window.turnIndex,
          });
          primaryVotesByElection.set(eid, cumulative);
          bankedBallots = true;

          // Display parity: the snapshot standing becomes the cumulative
          // ballot share wherever the party actually has ballots. Parties
          // with no registration data keep their score-softmax shares.
          for (const entries of Object.values(byParty)) {
            const ballotShares = ballotSharesWithinParty(
              entries.map((e) => e.candidateId),
              cumulative
            );
            if (!ballotShares) continue;
            for (const entry of entries) {
              entry.sharePct = ballotShares.get(entry.candidateId) ?? entry.sharePct;
            }
            entries.sort(
              (a, b) => (cumulative[b.candidateId] ?? 0) - (cumulative[a.candidateId] ?? 0)
            );
          }

          // Names/parties refresh every turn so late entrants appear; _id is
          // pinned to the electionId on insert because the general-phase
          // initElectionVoteTally replaceOne writes a doc with that _id.
          const candidateNames: Record<string, string> = {};
          const candidateParties: Record<string, string> = {};
          for (const c of candidates) {
            candidateNames[c._id.toString()] = c.characterName;
            candidateParties[c._id.toString()] = c.party;
          }
          ballotTallyOps.push({
            updateOne: {
              filter: { electionId: electionObjectId },
              update: {
                $set: {
                  primaryVotes: cumulative,
                  candidateNames,
                  candidateParties,
                  updatedAt: now,
                },
                $setOnInsert: {
                  _id: electionObjectId,
                  electionId: electionObjectId,
                  state: (election.state ?? accrualRegionId) as string,
                  totalVotes: {},
                  turnSnapshots: [],
                  finalized: false,
                  createdAt: now,
                },
              },
              upsert: true,
            },
          });
        }
      }
    }

    // A score-only race has no ballots to split; it keeps the hourly snapshot.
    if (early && !bankedBallots) continue;
    snapshots.push({
      _id: new ObjectId(),
      electionId: electionObjectId,
      recordedAt: now,
      turn: currentTurn,
      ...(slicePlan.slicePart ? { slicePart: slicePlan.slicePart } : {}),
      byParty,
    });
  }

  if (snapshots.length > 0) {
    await db.collection<PrimarySnapshot>("primarySnapshots").insertMany(snapshots);
  }
  if (ballotTallyOps.length > 0) {
    await db.collection<ElectionVoteTally>("electionVoteTallies").bulkWrite(ballotTallyOps);
  }

  return snapshots.length;
}

/**
 * @internal recordPrimarySnapshots helper — per-state projection history for pres
 * primaries. Returns the per-election projected votes-by-state (party → state →
 * candidate → votes) so the caller can build a delegate-consistent national
 * standing for the primarySnapshots doc from the SAME projection (#3022).
 */
type PresProjectionByElection = Map<string, Record<string, Record<string, Record<string, number>>>>;

async function recordPresidentialStatePollingSnapshots(
  db: Awaited<ReturnType<typeof getDb>>,
  presElections: Election[],
  candidatesByElection: Map<string, ElectionCandidate[]>,
  charMap: Map<string, Character>,
  nppMap: Map<string, NPP>,
  partyMap: Map<string, PoliticalPartyType>,
  statePartyOrgs: StatePartyOrg[],
  enrichmentPreload: CandidateEnrichmentPreload,
  now: Date
): Promise<PresProjectionByElection> {
  const projectionsByElection: PresProjectionByElection = new Map();
  if (presElections.length === 0) return projectionsByElection;

  const { projectPrimaryByState } = await import("@/lib/primaryProjection");
  const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
  const { loadRegionalBonusMaps } = await import("@/lib/primaryRegionalBonusLoader");
  const { ELECTORAL_VOTE_UNITS } = await import("@/lib/constants/states");
  const stateIds = [...new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId))];
  const campaignContext = presElections.some((e) =>
    usesCampaignAds(e, candidatesByElection.get(e._id.toString()) ?? [])
  )
    ? await loadCampaignProjectionContext(db, stateIds)
    : undefined;

  // One-shot fetch for demographics + state + categories used across all
  // pres elections in this turn.
  const [categoriesDocs, statesDocs, demographicsDocs] = await Promise.all([
    loadDemographicCategories(db),
    db
      .collection<State>("states")
      .find({ _id: { $in: stateIds } })
      .toArray(),
    db
      .collection<StateDemographics>("stateDemographics")
      .find({ _id: { $in: stateIds } })
      .toArray(),
  ]);
  const stateMap = new Map(statesDocs.map((s) => [s._id as string, s]));
  const demographicsMap = new Map(demographicsDocs.map((d) => [d._id as string, d]));

  const orgMap = new Map<string, number>();
  for (const po of statePartyOrgs) {
    orgMap.set(`${po.stateId}_${po.partyId}`, (po.organization ?? 0) + (po.primarySurge ?? 0));
  }

  for (const election of presElections) {
    const candidates = candidatesByElection.get(election._id.toString()) ?? [];
    if (candidates.length === 0) continue;
    const uniqueParties = [...new Set(candidates.map((c) => c.party))];
    const byParty: Record<string, Record<string, Record<string, number>>> = {};
    // Scope the party lookup by countryId so sequentialId collisions across
    // countries cannot invert candidate party positions.
    const enrichedAll = await fetchEnrichedCandidates(candidates, {
      includePartyPositions: true,
      countryId: (election.countryId ?? "US") as CountryId,
      parties: [...partyMap.values()].filter(
        (party) => (party.countryId ?? "US") === (election.countryId ?? "US")
      ),
      preload: enrichmentPreload,
      db,
    });

    // Regional bases L1+C — mirror primaryStaggerPhase wiring so the
    // snapshot projection matches what the live stagger produced.
    const homeStateByCharacterIdForBonuses = new Map<string, string | null>();
    const homeStateByNppIdForBonuses = new Map<string, string | null>();
    for (const c of candidates) {
      if (c.isNPP && c.nppId) {
        const npp = nppMap.get(c.nppId.toString());
        homeStateByNppIdForBonuses.set(c.nppId.toString(), npp?.homeState ?? null);
      } else if (!c.isNPP && c.characterId) {
        const char = charMap.get(c.characterId.toString());
        homeStateByCharacterIdForBonuses.set(c.characterId.toString(), char?.homeState ?? null);
      }
    }
    const regionalBonuses = await loadRegionalBonusMaps(db, {
      candidates,
      homeStateByCharacterId: homeStateByCharacterIdForBonuses,
      homeStateByNppId: homeStateByNppIdForBonuses,
    });

    for (const partyId of uniqueParties) {
      const partyCandidates = candidates.filter((c) => c.party === partyId);
      if (partyCandidates.length === 0) continue;
      const partyDoc = partyMap.get(`${election.countryId ?? "US"}:${partyId}`);
      const enriched = enrichedAll.filter((ec) => ec.party === partyId);
      const candidateMeta = partyCandidates.map((c) => {
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
        };
      });
      const { byState } = projectPrimaryByState({
        campaignContext:
          usesCampaignAds(election, enriched) && campaignContext
            ? { ...campaignContext, campaignRulesVersion: election.campaignRulesVersion ?? 0 }
            : undefined,
        candidates: enriched,
        candidateMeta,
        stateIds,
        stateMap,
        demographicsMap,
        categories: categoriesDocs,
        statePartyOrgs: orgMap,
        partyPosition: {
          economicPosition: partyDoc?.economicPosition ?? 0,
          socialPosition: partyDoc?.socialPosition ?? 0,
        },
        stateOrgByStateAndCandidate: regionalBonuses.stateOrgByStateAndCandidate,
        homeStateByCandidate: regionalBonuses.homeStateByCandidate,
        countryId: (election.countryId ?? "US") as CountryId,
      });
      byParty[partyId] = byState;
    }

    projectionsByElection.set(election._id.toString(), byParty);

    // Do NOT upsert — a tally-less election is pre-stagger and has no valid
    // totalVotes / totalVotesByUnit structure. Creating a stub doc with ONLY
    // primaryStatePollingHistory would crash full-view rendering downstream.
    // Skip the snapshot if the tally doesn't exist yet; it will start being
    // recorded after the stagger initializes the tally.
    await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
      { electionId: election._id },
      {
        $push: {
          primaryStatePollingHistory: {
            $each: [{ turn: 0, recordedAt: now, byParty }],
            $slice: -24,
          },
        } as never,
        $set: { updatedAt: now },
      }
    );
  }

  return projectionsByElection;
}
