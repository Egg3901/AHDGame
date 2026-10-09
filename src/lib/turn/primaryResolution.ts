/**
 * Primaries count party ballots and select candidates for the general election.
 * resolvePrimariesIfNeeded retains all registered Russian national list nominees;
 * constituency contests keep their normal party nomination limit.
 */
import { nativeAssemblyPrimaryAdvanceLimit } from "./election/assemblyPrimaryProgression";
import { isBrazilIndirectPresidentialElection } from "@/lib/countries/br/rules/presidential";
import {
  bindBallotElectorate,
  nationwideBallotCountries,
} from "@/lib/electionEngine/ballotElectoratePreload";

import { usesLegacyPresidentialCampaign } from "@/lib/countries/ru/rules/presidentialCampaign";
import { preloadIncumbentSeatShares } from "@/lib/electionEngine/incumbentSeatShare";
import { preloadLegislativeIncumbencies } from "@/lib/electionEngine/singleSeatIncumbency";
import { applyStandingAds } from "@/lib/campaignTargeting/standingAds";
import {
  usesCampaignRules,
  usesCampaignAds,
  targetedAdBonuses,
  meanAdBonus,
  campaignPrimaryScore,
} from "@/lib/campaignTargeting/rules";
import { loadRegionalCampaignCells } from "@/lib/campaignTargeting/audience";
import { getDb } from "@/lib/mongodb";
import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import { accumulateNGPresidentVoteTurn } from "@/lib/turn/election/ngPresidentAccumulation";
import { TALLY_WITH_SNAPSHOT_TURNS_ONLY } from "@/lib/electionEngine/tallyProjections";
import { COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS } from "@/lib/constants/countries";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type {
  Campaign,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticalParty as PoliticalPartyType,
  PrimaryResults,
  PrimaryResultEntry,
  State,
  StateDemographics,
  StateDemographicTurnout,
  StatePartyOrg,
  StateRegistrationPool,
} from "@/lib/db/types";
import {
  fetchEnrichedCandidates,
  initElectionVoteTally,
  accumulateVoteTurn,
} from "@/lib/electionEngine";
import {
  initPresidentVoteTally,
  accumulatePresidentVoteTurn,
} from "@/lib/presidentialElectionEngine";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import {
  primarySharePctSoftmax,
  PRIMARY_SHARE_SOFTMAX_TEMPERATURE,
  buildPartyChairMaps,
  resolvePartyChairPrimaryRole,
  scorePrimaryCandidate,
} from "@/lib/primaryScore";
import { parseSeatId } from "@/lib/seats/seatId";
import { getAllStateApprovalsForElection } from "@/lib/utils/getStateApprovalForElection";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";
import { getPrimaryWinnersForElection, type CountryId } from "@/lib/constants/countries";
import { createVoteTurnMemo } from "@/lib/electionEngine/tallyManagement";
import { writeVoteTallies } from "./election/writeVoteTallies";
import { loadFundsByPartyForElections } from "@/lib/electionEngine/fundsByParty";
import { ballotSharesWithinParty, scoreByPrimaryVotes } from "@/lib/turn/primaryBallots";
import { processPrimaryStaggerWaves } from "./primaryStaggerPhase";
import { autoAssignTentativeRunningMates } from "./primaryRunningMates";
import {
  primaryClosedFilter,
  generalPhaseFilter,
  electionOpenFilter,
} from "@/lib/elections/electionDeadlineFilters";
import { voidDebateSessionsForElection } from "@/lib/debate/debateSessionLifecycle";
import { resolvePartyFamily, getPrimaryWaveSchedule } from "@/lib/constants/primaryCalendar";
import { presidentialRulesetFor } from "@/lib/elections/presidentialRuleset";
import {
  resolveNominationForParty,
  type NominationResolutionResult,
} from "@/lib/turn/election/conventionResolution";
import { logger } from "../observability/logger";
import { buildNationwideElectoratePreload } from "@/lib/electionEngine/nationwideElectorate";
import { resolveGoverningPartyIds } from "@/lib/government/governingPartyIds";
import { isMidtermOppositionBoostEligible } from "@/lib/electionEngine/midtermOppositionBoost";
import { finaliseManifestosAtElectionCall } from "@/lib/uk/manifesto/manifestoLifecycle";
import { getStandingPlatformsForCountry } from "@/lib/uk/conference/conferenceCommands";
import { hydrateVoteTurnMemo } from "@/lib/turn/voteAccumulationPreload";
import { capturePrimaryOutcome } from "@/lib/analytics/electionAnalytics";
import { loadCandidateEnrichmentPreload } from "@/lib/electionEngine/candidateEnrichment";
import { loadEnrichmentCountryConfigsByElection } from "./electionEnrichmentPreload";
import { forEachWithConcurrency } from "@/lib/utils/forEachWithConcurrency";
import {
  loadDemographicsV2Preload,
  loadElectionDemographicsGameState,
} from "@/lib/electionEngine/demographicsV2Preload";

import { scopeFilter, type ElectionSweepScope } from "./electionSweepScope";
import { hasBankedGeneralTurn } from "@/lib/electionEngine/rules/turnSlice";

export type { ElectionSweepScope } from "./electionSweepScope";
export { recordPrimarySnapshots } from "./primarySnapshots";

const VOTE_ACCUMULATION_CONCURRENCY = 8;

/**
 * For elections whose primaryEndTime just passed, eliminate losers per party.
 * Sends win/loss notifications and initialises the general vote tally.
 */
export async function resolvePrimariesIfNeeded(
  now: Date,
  currentTurn: number,
  scope?: ElectionSweepScope
): Promise<void> {
  const db = await getDb();

  // Past-primary but not-yet-ended — turn-first (drift-immune, freezes on
  // pause) with a Date fallback for un-backfilled docs.
  const pastPrimary = await db
    .collection<Election>("elections")
    .find({
      ...scopeFilter(scope),
      status: { $in: ["active", "upcoming"] },
      $and: [primaryClosedFilter(currentTurn, now), electionOpenFilter(currentTurn, now)],
    })
    .toArray();

  if (pastPrimary.length === 0) return;

  const electionIds = pastPrimary.map((e) => e._id as ObjectId);
  const hasPresident = pastPrimary.some((e) => usesLegacyPresidentialCampaign(e));

  // Region IDs needed for state-level primary alignment (skip presidential — national race).
  const regionLookups = pastPrimary
    .filter((e) => !usesLegacyPresidentialCampaign(e))
    .map((e) => ({
      regionId: e.seatId ? parseSeatId(e.seatId).localRegionId : e.state,
      countryId: (e.countryId ?? "US") as CountryId,
    }))
    .filter((r): r is { regionId: string; countryId: CountryId } => Boolean(r.regionId));
  const uniqueRegionKeys = new Set(regionLookups.map((r) => `${r.countryId}:${r.regionId}`));

  // Tallies for every past-primary race (not just presidential): the gate below
  // keys on `primaryResults` so we never re-init a general-phase tally, and the
  // presidential path still reads primaryDelegates from the same map.
  const [parties, allCandidates, statePartyOrgs, pastPrimaryTallies, stateDocs] = await Promise.all(
    [
      db.collection<PoliticalPartyType>("politicalParties").find({}).toArray(),
      db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: { $in: electionIds }, status: "active" })
        .toArray(),
      hasPresident
        ? db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray()
        : Promise.resolve([] as StatePartyOrg[]),
      db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .find({ electionId: { $in: electionIds } }, { projection: TALLY_WITH_SNAPSHOT_TURNS_ONLY })
        .toArray(),
      uniqueRegionKeys.size > 0
        ? db
            .collection<State>("states")
            .find({
              $or: [...uniqueRegionKeys].map((key) => {
                const [countryId, regionId] = key.split(":");
                return countryId === regionId
                  ? { countryId: countryId as CountryId }
                  : { _id: regionId, countryId: countryId as CountryId };
              }),
            })
            .toArray()
        : Promise.resolve([] as State[]),
    ]
  );
  const tallyByElection = new Map(pastPrimaryTallies.map((t) => [t.electionId.toString(), t]));
  const presidentialTallyMap = tallyByElection;
  // Use composite keys to avoid cross-country sequential ID collisions
  const partyMap = new Map(parties.map((p) => [`${p.countryId ?? "US"}:${p.sequentialId}`, p]));
  const partyChairMaps = buildPartyChairMaps(parties, statePartyOrgs);
  const partyOrgByStateParty = new Map<string, number>();
  for (const po of statePartyOrgs) {
    partyOrgByStateParty.set(`${po.stateId}_${po.partyId}`, po.organization ?? 0);
  }
  // Composite key (countryId:stateId) keeps UK/DE region docs from colliding with US.
  const stateMap = new Map(stateDocs.map((s) => [`${s.countryId}:${s._id}`, s]));
  const candidatesByElection = new Map<string, ElectionCandidate[]>();
  for (const c of allCandidates) {
    const eid = c.electionId.toString();
    const list = candidatesByElection.get(eid) ?? [];
    list.push(c);
    candidatesByElection.set(eid, list);
  }

  let totalEliminated = 0;

  // Gate pre-pass: resolve each past-primary election exactly once.
  // Idempotency is keyed on tally.primaryResults (not "party count ≤ maxAdvancing"):
  // a multi-advance race (UK/JP/DE legislatures, one-party states) can seat
  // fewer candidates than the cap, so the old count gate skipped those races
  // entirely, left co-nominees on the general ballot with no primaryResults,
  // and the districted seat splitter fell back to general-vote shares (#1043).
  // Computing the gate up front lets the character fetch below be ONE batched
  // $in query across every resolving election instead of one per election.
  const resolvingElections: Array<{
    election: (typeof pastPrimary)[number];
    candidates: ElectionCandidate[];
    partyCounts: Map<string, number>;
    maxAdvancing: number;
  }> = [];
  for (const election of pastPrimary) {
    const eid = (election._id as ObjectId).toString();
    const candidates = candidatesByElection.get(eid) ?? [];
    if (candidates.length === 0) continue;
    const partyCounts = new Map<string, number>();
    for (const c of candidates) partyCounts.set(c.party, (partyCounts.get(c.party) ?? 0) + 1);
    const maxAdvancing =
      nativeAssemblyPrimaryAdvanceLimit(election, candidates.length) ??
      getPrimaryWinnersForElection(
        (election.countryId ?? "US") as CountryId,
        election.electionType
      );
    const tally = tallyByElection.get(eid);
    // Already stamped — never re-init (would wipe general-phase vote accumulation).
    if (tally?.primaryResults) continue;
    const needsElimination = [...partyCounts.values()].some((v) => v > maxAdvancing);
    // Mid-general legacy tallies that skipped the one-shot stamp: do not wipe
    // accumulating votes. Districted resolution falls back to vote-share nominees.
    // A tally that only holds primary ballots (recordPrimarySnapshots upserts
    // one during the primary) has no general votes to lose, so it is stamped
    // like a race with no tally at all — otherwise every race whose parties
    // already sat within the cap (UK/JP/DE multi-advance, one-party states)
    // went through the general without a primaryResults record.
    const hasGeneralVotes =
      tally !== undefined &&
      (Object.values(tally.totalVotes ?? {}).some((v) => v > 0) ||
        (tally.turnSnapshots?.length ?? 0) > 0);
    if (!needsElimination && hasGeneralVotes) continue;
    resolvingElections.push({ election, candidates, partyCounts, maxAdvancing });
  }

  const allResolvingCandidates = resolvingElections.flatMap((r) => r.candidates);
  const [enrichmentPreload, enrichmentCountryConfigByElection] = await Promise.all([
    loadCandidateEnrichmentPreload(
      db,
      allResolvingCandidates,
      resolvingElections.map(({ election }) => election._id as ObjectId),
      hasPresident ? statePartyOrgs : undefined
    ),
    loadEnrichmentCountryConfigsByElection(
      db,
      resolvingElections.map(({ election }) => election)
    ),
  ]);
  const charMap = enrichmentPreload.charactersById;
  applyStandingAds(allResolvingCandidates, charMap);

  // Active preset for delegate-majority thresholds (convention path). Fetched
  // once for the whole resolution pass; only presidential races consume it.
  const presPreset = hasPresident
    ? (
        await db
          .collection<{ _id: string; preset?: string }>("gameState")
          .findOne({ _id: "current" }, { projection: { preset: 1 } })
      )?.preset
    : undefined;

  const advertisedRegions = new Set(
    resolvingElections
      .filter(
        ({ election, candidates }) =>
          usesCampaignAds(election, candidates) &&
          !usesLegacyPresidentialCampaign(election) &&
          candidates.some((candidate) => candidate.targetedAds?.length)
      )
      .map(({ election }) => `${election.countryId}:${election.state}`)
  );
  const campaignCellsByRegion = advertisedRegions.size
    ? await loadRegionalCampaignCells(
        db,
        stateDocs.filter(
          (state) =>
            advertisedRegions.has(`${state.countryId}:${state._id}`) ||
            advertisedRegions.has(`${state.countryId}:${state.countryId}`)
        ),
        new Set(
          resolvingElections
            .filter(({ election }) => !usesCampaignRules(election))
            .map(({ election }) => `${election.countryId}:${election.state}`)
        )
      )
    : new Map<string, import("@/lib/campaignTargeting/rules").CampaignCell[]>();

  for (const { election, candidates, partyCounts, maxAdvancing } of resolvingElections) {
    const electionId = election._id as ObjectId;

    const enriched = await fetchEnrichedCandidates(candidates, {
      countryId: (election.countryId ?? "US") as CountryId,
      parties: parties.filter(
        (party) => (party.countryId ?? "US") === (election.countryId ?? "US")
      ),
      preload: enrichmentPreload,
      countryConfig: enrichmentCountryConfigByElection.get(electionId.toString()),
      db,
    });

    // UK manifestos finalise at the primary→general transition (epic #856):
    // lock each player party's complete draft, auto-generate + lock NPP
    // manifestos. Only writes to the `manifestos` collection; the vote-share
    // effect stays gated by UK_MANIFESTO_VOTE_EFFECT, so this is inert on the
    // result until that flag is set.
    if (
      election.countryId === "UK" &&
      (election.electionType === "commons" || election.electionType === "snap_commons")
    ) {
      const manifestoParties = [...partyCounts.keys()].map((partyId) => {
        const party = partyMap.get(`UK:${partyId}`);
        return {
          party: String(partyId),
          isNpp: !party?.chairId,
          economic: party?.economicPosition ?? 0,
          social: party?.socialPosition ?? 0,
        };
      });
      const standingPlatformByParty = await getStandingPlatformsForCountry(db, "UK");
      await finaliseManifestosAtElectionCall(db, {
        countryId: "UK",
        electionId,
        parties: manifestoParties,
        now,
        standingPlatformByParty,
      });
    }

    const loserIds: string[] = [];
    const primaryResultsByParty: Record<string, PrimaryResultEntry[]> = {};

    // President-only: nomination resolution (convention/delegate-majority) per
    // party, recorded onto the general tally after it re-inits below. Populated
    // only on convention-enabled rulesets (v3+); v1/v2 keep the plurality pick.
    const nominationResolutionByParty: Record<string, NominationResolutionResult> = {};

    // Resolve state lean for state-level alignment (skip president — national).
    let raceStateEconLean: number | null | undefined;
    let raceStateSocialLean: number | null | undefined;
    if (!usesLegacyPresidentialCampaign(election) && election.seatId) {
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

    for (const [partyId, count] of partyCounts) {
      const partyCandidates = candidates.filter((c) => c.party === partyId);
      const party = partyMap.get(`${election.countryId ?? "US"}:${partyId}`);
      const partyEP = party?.economicPosition ?? 0;
      const partySP = party?.socialPosition ?? 0;
      const hasPlayerInParty = partyCandidates.some((c) => !c.isNPP);

      /*
       * Presidential primary resolution reads the delegate tally produced by the
       * stagger-phase accumulator (final 6 turns of the primary). Non-presidential
       * primaries continue to use calcPrimaryScore — their path is unchanged.
       * The presidential path falls back to score-based ranking only if no delegate
       * data is present (e.g. admin-forced resolution skipping the stagger window).
       */
      const presidentialTally = usesLegacyPresidentialCampaign(election)
        ? presidentialTallyMap.get(electionId.toString())
        : null;
      const partyDelegates = presidentialTally?.primaryDelegates?.[partyId];
      const usePresidentialDelegatePath =
        usesLegacyPresidentialCampaign(election) &&
        partyDelegates &&
        Object.values(partyDelegates).some((v) => v > 0);

      let scored: { candidateId: string; characterName: string; score: number }[];

      // Vote fallback: stagger ran and recorded per-state votes but no delegates
      // crossed zero yet (e.g. admin-forced resolution mid-stagger). Rank by the
      // national sum of real per-state votes so the winner still matches the
      // vote engine rather than the ideology score (#3022).
      const partyStateVotes = usesLegacyPresidentialCampaign(election)
        ? presidentialTally?.primaryStateVotes?.[partyId]
        : undefined;
      const partyNationalVotes: Record<string, number> = {};
      if (partyStateVotes) {
        for (const byCandidate of Object.values(partyStateVotes)) {
          for (const [cid, v] of Object.entries(byCandidate)) {
            partyNationalVotes[cid] = (partyNationalVotes[cid] ?? 0) + v;
          }
        }
      }
      const usePresidentialVoteFallback =
        !usePresidentialDelegatePath &&
        usesLegacyPresidentialCampaign(election) &&
        Object.values(partyNationalVotes).some((v) => v > 0);

      // Down-ballot: cumulative primary ballots accrued turn by turn, when the
      // race has any. Null keeps the legacy score path.
      const downBallotBallots = !usesLegacyPresidentialCampaign(election)
        ? scoreByPrimaryVotes(
            partyCandidates.map((c) => c._id.toString()),
            tallyByElection.get(electionId.toString())?.primaryVotes
          )
        : null;

      if (usePresidentialDelegatePath && partyDelegates) {
        scored = partyCandidates
          .map((c) => ({
            candidateId: c._id.toString(),
            characterName: c.characterName,
            score: partyDelegates[c._id.toString()] ?? 0,
          }))
          .sort((a, b) => b.score - a.score);

        // Convention nomination (v3+ structural): only on a convention-enabled
        // ruleset AND once every stagger wave has run, so partial delegate data
        // can't trigger a premature convention. When gated off (v1/v2, or an
        // admin-forced early resolution) this whole block is skipped and the
        // plurality pick above stands byte-for-byte. When it fires, the winner is
        // reordered to the front so the downstream primaryResults/elimination
        // machinery seats them exactly as it seats a plurality winner.
        const ruleset = presidentialRulesetFor(election);
        const waveCount = getPrimaryWaveSchedule(ruleset).waves.length;
        const wavesRun =
          presidentialTally?.primaryStaggerWavesRun ??
          presidentialTally?.primaryWaveHistory?.length ??
          0;
        if (ruleset.conventionEnabled && wavesRun >= waveCount) {
          const family = resolvePartyFamily(partyId, {
            primaryCalendar: party?.primaryCalendar ?? null,
            economicPosition: party?.economicPosition ?? 0,
          });
          const resolution = resolveNominationForParty({
            partyCandidates: partyCandidates.map((c) => ({ candidateId: c._id.toString() })),
            partyDelegates,
            family,
            preset: presPreset,
            enriched: enriched
              .filter((ec) => partyCandidates.some((c) => c._id.toString() === ec.candidateId))
              .map((ec) => ({
                candidateId: ec.candidateId,
                charEP: ec.charEP,
                charSP: ec.charSP,
                party: ec.party,
              })),
            nationalVotes: partyNationalVotes,
            ruleset,
            now,
          });
          if (resolution) {
            nominationResolutionByParty[partyId] = resolution;
            const winnerId = resolution.winnerCandidateId;
            scored = [
              ...scored.filter((s) => s.candidateId === winnerId),
              ...scored.filter((s) => s.candidateId !== winnerId),
            ];
          }
        }
      } else if (usePresidentialVoteFallback) {
        scored = partyCandidates
          .map((c) => ({
            candidateId: c._id.toString(),
            characterName: c.characterName,
            score: partyNationalVotes[c._id.toString()] ?? 0,
          }))
          .sort((a, b) => b.score - a.score);
      } else if (downBallotBallots) {
        // Non-presidential race whose primary accrued real ballots (see
        // recordPrimarySnapshots): the nominee is whoever the cumulative count
        // says, exactly as the presidential vote fallback ranks by real
        // per-state votes. Parties with no accrued ballots (missing
        // registration data, legacy races mid-flight) fall through to the
        // score ranking below unchanged.
        scored = partyCandidates
          .map((c) => ({
            candidateId: c._id.toString(),
            characterName: c.characterName,
            score: downBallotBallots[c._id.toString()] ?? 0,
          }))
          .sort((a, b) => b.score - a.score);
      } else {
        scored = partyCandidates
          .map((c) => {
            const ec = enriched.find((e) => e.candidateId === c._id.toString());
            if (!ec)
              return { candidateId: c._id.toString(), characterName: c.characterName, score: 0 };
            let score = scorePrimaryCandidate({
              isPresidential: usesLegacyPresidentialCampaign(election),
              isNPP: Boolean(c.isNPP),
              hasPlayerInParty,
              candidateEcon: ec.charEP,
              candidateSocial: ec.charSP,
              partyEcon: partyEP,
              partySocial: partySP,
              favorability: ec.favorability,
              politicalInfluence: ec.politicalInfluence,
              nationalInfluence: charMap.get(c.characterId.toString())?.nationalInfluence,
              partyInfluence: charMap.get(c.characterId.toString())?.partyInfluence,
              partyChairRole: c.isNPP
                ? null
                : resolvePartyChairPrimaryRole(c.characterId.toString(), partyChairMaps),
              infamy: ec.infamy,
              stateEconLean: raceStateEconLean,
              stateSocialLean: raceStateSocialLean,
            });
            const campaignCells = campaignCellsByRegion.get(
              `${election.countryId}:${election.state}${usesCampaignRules(election) ? "" : ":0"}`
            );
            if (campaignCells && c.targetedAds?.length) {
              const bonus = meanAdBonus(
                campaignCells,
                targetedAdBonuses(
                  campaignCells,
                  { economicLean: ec.charEP, socialLean: ec.charSP },
                  c.targetedAds,
                  election.state,
                  currentTurn
                )
              );
              score = campaignPrimaryScore(score, bonus, PRIMARY_SHARE_SOFTMAX_TEMPERATURE);
            }
            return { candidateId: c._id.toString(), characterName: c.characterName, score };
          })
          .sort((a, b) => b.score - a.score);
      }

      // Advancers per party via getPrimaryWinnersForElection: keyed by
      // government type (presidential 1, parliamentary 3, onePartyState 7
      // e.g. CN/RU/DD), except single-winner executives which always advance 1.
      // Ballot-ranked parties record PROPORTIONAL shares — the softmax exists
      // to decompress clustered scores and would collapse real vote counts to
      // 100/0. Score-ranked parties keep the softmax display shares.
      const ballotResultShares = downBallotBallots
        ? ballotSharesWithinParty(
            scored.map((x) => x.candidateId),
            downBallotBallots
          )
        : null;
      const shares = ballotResultShares
        ? scored.map((x) => ballotResultShares.get(x.candidateId) ?? 0)
        : primarySharePctSoftmax(scored.map((x) => x.score));
      primaryResultsByParty[partyId] = scored.map((s, i) => ({
        candidateId: s.candidateId,
        characterName: s.characterName,
        party: partyId,
        primaryScore: Math.round(s.score * 10) / 10,
        sharePct: shares[i],
        won: i < maxAdvancing,
      }));

      if (count > maxAdvancing) {
        for (const s of scored.slice(maxAdvancing)) loserIds.push(s.candidateId);
      }
    }

    const primaryResults: PrimaryResults = {
      byParty: primaryResultsByParty,
      recordedAt: now,
    };

    if (loserIds.length > 0) {
      const loserObjectIds = loserIds.map((id) => new ObjectId(id));
      await db
        .collection("electionCandidates")
        .updateMany(
          { _id: { $in: loserObjectIds } },
          { $set: { status: "withdrawn", withdrawnAt: now } }
        );

      // A debate challenge tied to this primary is moot the instant its
      // candidate is eliminated — void any still-pending session rather than
      // letting it live on for up to its own 12h real-time deadline.
      await voidDebateSessionsForElection(db, electionId, now);

      // Archive campaign docs for eliminated candidates instead of deleting
      // them. A primary loser keeps their campaign (hidden from active surfaces)
      // so a re-entry can reactivate it and an accidental wipe can't strand an
      // active candidate without a campaign. Campaigns are only hard-deleted
      // when the election itself resolves (presidentResolution / generalResolution).
      const loserCandidateDocs = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find(
          { _id: { $in: loserObjectIds } },
          { projection: { characterId: 1, nppId: 1, isNPP: 1 } }
        )
        .toArray();
      const loserCharIds = loserCandidateDocs
        .filter((c) => !c.isNPP && c.characterId)
        .map((c) => c.characterId);
      const loserNppIds = loserCandidateDocs.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);
      const loserCandidateKeys = [...loserCharIds, ...loserNppIds];
      if (loserCandidateKeys.length > 0) {
        await db.collection<Campaign>("campaigns").updateMany(
          { electionId, candidateId: { $in: loserCandidateKeys }, status: { $ne: "archived" } },
          {
            $set: {
              status: "archived",
              archivedAt: now,
              archivedReason: "primary_loss",
              updatedAt: now,
            },
          }
        );
      }

      totalEliminated += loserIds.length;

      const typeLabel = formatElectionTypeLabel(election.electionType, election.countryId);

      const loserIdSet = new Set(loserIds);
      // Character docs were already fetched in the batched pre-loop query; the
      // per-election re-fetch this replaces was one more round-trip per race.
      const charMapNotify = charMap;
      const notificationInputs: NotificationInput[] = [];
      const achievementPromises: Promise<unknown>[] = [];
      const achievementModule = usesLegacyPresidentialCampaign(election)
        ? import("@/lib/achievements")
        : null;
      for (const c of candidates) {
        if (c.isNPP) continue;
        const char = charMapNotify.get(c.characterId.toString());
        if (!char) continue;
        const isLoser = loserIdSet.has(c._id.toString());
        notificationInputs.push({
          userId: char.userId,
          type: isLoser ? "primary_loss" : "primary_win",
          title: isLoser
            ? `Primary Lost — ${typeLabel} (${election.state === "US" ? "National" : election.state})`
            : `Primary Won — ${typeLabel} (${election.state === "US" ? "National" : election.state})`,
          message: isLoser
            ? `You were eliminated in the ${c.party} primary for ${typeLabel}${election.state === "US" ? "" : ` in ${election.state}`}.`
            : `Congratulations! You won the ${c.party} primary for ${typeLabel}${election.state === "US" ? "" : ` in ${election.state}`} and advance to the general election.`,
          metadata: {
            electionId: electionId.toString(),
            state: election.state,
            electionType: election.electionType,
            party: c.party,
          },
        });
        if (!isLoser && achievementModule) {
          achievementPromises.push(
            achievementModule
              .then(({ awardAchievement }) =>
                awardAchievement(char.userId, "presidential_nominee", c.characterId)
              )
              .catch((e) => console.error("Achievement check failed:", e))
          );
        }
      }
      await Promise.all([createNotifications(notificationInputs), ...achievementPromises]);
    }

    // Clear primary-phase campaigning state for every candidate in this election —
    // the primary is over, so the badge and ticks should reset before general-phase
    // travel takes over. Only affects presidential (state primaries don't set these).
    if (usesLegacyPresidentialCampaign(election)) {
      await db.collection<ElectionCandidate>("electionCandidates").updateMany(
        { electionId },
        {
          $set: {
            primaryCampaignState: null,
            primaryCampaignTicks: 0,
            primarySurgeUsed: false,
          },
        }
      );

      // Clear primarySurge bumps on every state party org for this country —
      // the surge bonus exists only for the duration of the primary cycle.
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateMany(
          { countryId: election.countryId, primarySurge: { $gt: 0 } },
          { $unset: { primarySurge: "" }, $set: { updatedAt: now } }
        );
    }

    // Always reinitialise the tally so any stale vote snapshots from a previous
    // general-phase window (e.g. after an admin timer reset puts the election back
    // into primary) are wiped clean. The gate above ensures this only runs once
    // per primary close (tally.primaryResults absent); subsequent turns skip.
    if (
      election.countryId === "RU" &&
      election.electionType === "president" &&
      election.russianPresidentialRound
    ) {
      const { prepareRussianPresidentialTickets } =
        await import("@/lib/countries/ru/presidentialTickets");
      await prepareRussianPresidentialTickets({ db, election, now });
    }
    const generalCandidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId, status: "active" })
      .toArray();
    if (usesLegacyPresidentialCampaign(election)) {
      // Auto-pick a tentative running mate for any player nominee who hasn't
      // chosen one yet. Nominees can override via the running-mate UI at any
      // time during the general phase — this is a fallback so a player who wins
      // the primary on the final turn isn't VP-less when votes start accumulating.
      await autoAssignTentativeRunningMates(db, generalCandidates, election.countryId as CountryId);
      await initPresidentVoteTally(electionId, generalCandidates, primaryResults);
      // Persist the nomination resolution AFTER the general re-init (which
      // replaces the whole tally doc), so the audit record survives. Additive
      // and president-only; never written for v1/v2 (map stays empty).
      if (Object.keys(nominationResolutionByParty).length > 0) {
        await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
          { electionId },
          {
            $set: {
              nominationResolution: { byParty: nominationResolutionByParty },
              updatedAt: now,
            },
          }
        );
      }
    } else {
      await initElectionVoteTally(
        electionId,
        generalCandidates,
        election.state as string,
        primaryResults
      );
    }

    await capturePrimaryOutcome(db, election, candidates, primaryResultsByParty, currentTurn);
  }

  if (totalEliminated > 0)
    console.log(`[Turn] Primaries resolved: ${totalEliminated} candidate(s) eliminated`);
}

/**
 * For every general-phase election (past primaryEndTime), accumulate one turn
 * of votes into the ElectionVoteTally.  Auto-creates missing tally documents.
 *
 * Also runs the presidential-primary stagger phase: during the final 6 turns
 * of each presidential primary, one wave of states accumulates real votes +
 * awards delegates per the calendar in `primaryCalendar.ts`.
 */
export async function accumulateGeneralElectionVotes(
  now: Date,
  turn: number,
  scope?: ElectionSweepScope,
  options?: { slice?: "early" }
): Promise<void> {
  const db = await getDb();
  // Half-hour results tick (electionHalfTick.ts): early halves of races
  // already counting general turns only; primary stagger waves and new
  // tallies stay on the turn.
  const early = options?.slice === "early";

  // Run presidential primary stagger waves first (before general accumulation).
  // Affects only presidential elections in primary phase within 6h of ending.
  try {
    if (!early) await processPrimaryStaggerWaves(db, now, turn, scope?.electionIds);
  } catch (err) {
    logger.error("Turn", "Primary stagger failed", err);
  }

  // No upper-bound on endTime: elections that just hit their endTime are still
  // "active" when vote accumulation runs (resolution is a later phase). Excluding
  // them via endTime > now causes the final turn's votes to be dropped whenever
  // turn processing runs a few milliseconds after the scheduled endTime.
  const generalElections = await db
    .collection<Election>("elections")
    .find({
      ...scopeFilter(scope),
      status: "active",
      // General phase = primary closed OR no primary at all (turn-first).
      ...generalPhaseFilter(turn, now),
    })
    .toArray();

  const stateElections = generalElections.filter((e) => !usesLegacyPresidentialCampaign(e));
  const hasStateElections = stateElections.length > 0;

  let approvalMap: Map<string, number> | undefined;
  let preload: import("@/lib/electionEngine").AccumulateVoteTurnPreload | undefined;

  if (hasStateElections) {
    const uniqueStateIds = [...new Set(stateElections.map((e) => e.state as string))];
    const uniqueCountries = [
      ...new Set(stateElections.map((e) => (e.countryId ?? "US") as CountryId)),
    ];
    const midtermCountries = [
      ...new Set(
        stateElections
          .filter(isMidtermOppositionBoostEligible)
          .map((election) => (election.countryId ?? "US") as CountryId)
      ),
    ];
    const nationwideCountries = nationwideBallotCountries(stateElections);
    const regionalScope =
      nationwideCountries.length > 0
        ? {
            $or: [{ _id: { $in: uniqueStateIds } }, { countryId: { $in: nationwideCountries } }],
          }
        : { _id: { $in: uniqueStateIds } };
    [approvalMap, preload] = await Promise.all([
      getAllStateApprovalsForElection({ countryIds: uniqueCountries }),
      (async () => {
        const [
          categories,
          states,
          demographics,
          statePartyOrgs,
          turnoutDocs,
          registrationPools,
          gsPreset,
          demoDefaults,
          governingPartyEntries,
        ] = await Promise.all([
          loadDemographicCategories(db),
          db.collection<State>("states").find(regionalScope).toArray(),
          db.collection<StateDemographics>("stateDemographics").find(regionalScope).toArray(),
          db
            .collection<StatePartyOrg>("statePartyOrg")
            .find(
              nationwideCountries.length > 0
                ? {
                    $or: [
                      { stateId: { $in: uniqueStateIds } },
                      { countryId: { $in: nationwideCountries } },
                    ],
                  }
                : { stateId: { $in: uniqueStateIds } }
            )
            .toArray(),
          db
            .collection<StateDemographicTurnout>("stateDemographicTurnout")
            .find(regionalScope)
            .toArray(),
          db
            .collection<StateRegistrationPool>("stateRegistrationPool")
            .find(
              nationwideCountries.length > 0
                ? {
                    $or: [
                      { stateId: { $in: uniqueStateIds } },
                      { countryId: { $in: nationwideCountries } },
                    ],
                  }
                : { stateId: { $in: uniqueStateIds } }
            )
            .toArray(),
          loadElectionDemographicsGameState(db),
          // Seeded snapshots for the granular substrate's legislation
          // lean-drift fold (only consumed when the flag is on).
          db.collection<StateDemographics>("demographicDefaults").find(regionalScope).toArray(),
          Promise.all(
            midtermCountries.map(
              async (countryId) =>
                [countryId, await resolveGoverningPartyIds(db, countryId)] as const
            )
          ),
        ]);
        const { regionDemographicsByState, demographicsV2Countries, votingAgeByCountry } =
          await loadDemographicsV2Preload({
            db,
            countries: uniqueCountries,
            regionFilter: regionalScope,
            states,
            nationwideCountries,
            gameState: gsPreset,
          });
        const stateMap = new Map(states.map((s) => [s._id as string, s]));
        const demographicsMap = new Map(demographics.map((d) => [d._id as string, d]));
        const turnoutByState = new Map(turnoutDocs.map((t) => [t._id as string, t]));
        const registrationPoolByState = new Map(
          registrationPools.map((pool) => [pool.stateId, pool])
        );
        const statePartyOrgsByState = new Map<string, typeof statePartyOrgs>();
        for (const po of statePartyOrgs) {
          const list = statePartyOrgsByState.get(po.stateId) ?? [];
          list.push(po);
          statePartyOrgsByState.set(po.stateId, list);
        }
        for (const countryId of nationwideCountries) {
          const national = buildNationwideElectoratePreload(
            countryId,
            states,
            demographics,
            turnoutDocs,
            statePartyOrgs
          );
          if (!national) continue;
          stateMap.set(countryId, national.state);
          demographicsMap.set(countryId, national.demographics);
          turnoutByState.set(countryId, national.turnout);
          statePartyOrgsByState.set(countryId, national.partyOrgs);
        }
        return {
          preset: gsPreset?.preset,
          currentYear: gsPreset?.currentYear,
          startingYear: gsPreset?.startingYear,
          eraSystemEnabled: gsPreset?.eraSystemEnabled === true,
          categories,
          stateMap,
          demographicsMap,
          statePartyOrgsByState,
          turnoutByState,
          registrationPoolByState,
          demographicDefaultsByState: new Map(demoDefaults.map((d) => [d._id as string, d])),
          regionDemographicsByState,
          demographicsV2Countries,
          votingAgeByCountry,
          governingPartyIdsByCountry: new Map(governingPartyEntries),
          turnMemo: createVoteTurnMemo(),
        };
      })(),
    ]);
  }

  const electionIds = generalElections.map((e) => e._id);
  const [existingTallies, allActiveCandidates] = await Promise.all([
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } })
      .toArray(),
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .toArray(),
  ]);
  const tallyByElection = new Map(existingTallies.map((t) => [t.electionId.toString(), t]));
  if (preload?.turnMemo) {
    await hydrateVoteTurnMemo(db, preload.turnMemo, allActiveCandidates, electionIds);
  }
  // Money driver inputs for every general election in one read; the per
  // election path stays for callers without a preload.
  if (preload) {
    preload.fundsByPartyByElection = await loadFundsByPartyForElections(
      generalElections.filter((e) => !usesLegacyPresidentialCampaign(e)).map((e) => e._id),
      db
    );
    // One handle for the phase so per-Db caches (country state) hit, and
    // incumbent seat shares for every race in two reads (#2695).
    preload.db = db;
    preload.incumbentSeatShareByElection = await preloadIncumbentSeatShares(
      generalElections.filter((e) => e.electionType !== "president"),
      db
    );
  }
  const candidatesByElection = new Map<string, ElectionCandidate[]>();
  for (const c of allActiveCandidates) {
    const eid = c.electionId.toString();
    const list = candidatesByElection.get(eid) ?? [];
    list.push(c);
    candidatesByElection.set(eid, list);
  }
  if (preload) {
    const [legislativeIncumbency, enrichmentCountryConfigByElection] = await Promise.all([
      preloadLegislativeIncumbencies(stateElections, candidatesByElection, db),
      loadEnrichmentCountryConfigsByElection(db, stateElections),
    ]);
    preload.legislativeIncumbentByElection = legislativeIncumbency.singleSeatByElection;
    preload.houseIncumbentTenuresByElection = legislativeIncumbency.houseTenuresByElection;
    preload.enrichmentCountryConfigByElection = enrichmentCountryConfigByElection;
  }

  const legacyPresidentialElections = generalElections.filter(usesLegacyPresidentialCampaign);
  const independentlyAccumulatedElections = generalElections.filter(
    (election) => !usesLegacyPresidentialCampaign(election)
  );

  // Every state-race tally update goes out in one bulk write after the sweep
  // (#2695). Unordered: one failing race does not block the others.
  const tallyWrites: AnyBulkWriteOperation<ElectionVoteTally>[] = [];
  const accumulateElection = async (election: Election): Promise<void> => {
    try {
      if (isBrazilIndirectPresidentialElection(election, preload?.preset)) return;
      const existing = tallyByElection.get(election._id.toString());
      const activeCandidates = candidatesByElection.get(election._id.toString()) ?? [];

      // The early half only extends a race already counting general turns:
      // a tally holding just primary ballots still has its primary to
      // resolve on the turn, which stamps or resets the tally.
      if (early && !hasBankedGeneralTurn(existing)) return;
      const slice = early ? { slice: "early" as const } : undefined;
      if (usesLegacyPresidentialCampaign(election)) {
        if (!existing && activeCandidates.length > 0) {
          await initPresidentVoteTally(election._id, activeCandidates);
        }
        // Per-country accumulation: US electoral college vs NG/bespoke per-zone.
        if (
          election.countryId != null &&
          COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS.has(election.countryId)
        ) {
          await accumulateNGPresidentVoteTurn(db, election._id, now, turn, slice);
        } else {
          await accumulatePresidentVoteTurn(election._id, turn, now, undefined, slice);
        }
      } else {
        if (!existing && activeCandidates.length > 0) {
          await initElectionVoteTally(election._id, activeCandidates, election.state as string);
        }
        // A tally created just above is not in `existing`; let the turn read it.
        await accumulateVoteTurn(election._id, turn, now, {
          tallyWrites,
          approvalMap,
          preload: preload ? bindBallotElectorate(election, preload) : preload,
          election,
          tally: existing ?? undefined,
          candidates: activeCandidates,
          ...slice,
        });
      }
    } catch (err) {
      logger.error("Turn", `Error accumulating votes for election ${election._id}`, err);
      if (tallyByElection.get(election._id.toString())?.countingMethod === "pr_stv") throw err;
    }
  };

  // Bespoke presidential engines write directly and remain sequential. The
  // state engine has no live presidential-tally dependency: coattails read the
  // sitting executive and approval, so its independent races can run with a
  // bounded worker pool before their shared unordered bulk write.
  for (const election of legacyPresidentialElections) await accumulateElection(election);
  await forEachWithConcurrency(
    independentlyAccumulatedElections,
    VOTE_ACCUMULATION_CONCURRENCY,
    accumulateElection
  );
  await writeVoteTallies(
    db,
    tallyWrites,
    generalElections.some((e) => tallyByElection.get(e._id.toString())?.countingMethod === "pr_stv")
  );
}
