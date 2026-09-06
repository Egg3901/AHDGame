import { getDb } from "@/lib/mongodb";
import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import { accumulateNGPresidentVoteTurn } from "@/lib/turn/election/ngPresidentAccumulation";
import { COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS } from "@/lib/constants/countries";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type {
  Campaign,
  DemographicCategory,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  Character,
  NPP,
  PoliticalParty as PoliticalPartyType,
  PrimaryResults,
  PrimaryResultEntry,
  PrimarySnapshot,
  PrimarySnapshotEntry,
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
  calcPrimaryScore,
  calcPresidentPrimaryScore,
  primarySharePctSoftmax,
  effectivePartyInfluenceForPresidentialPrimary,
  buildPartyChairMaps,
  resolvePartyChairPrimaryRole,
} from "@/lib/primaryScore";
import { parseSeatId } from "@/lib/seats/seatId";
import { getAllStateApprovalsForElection } from "@/lib/utils/getStateApprovalForElection";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";
import {
  getCountryConfig,
  getPrimaryWinnersForElection,
  type CountryId,
} from "@/lib/constants/countries";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import { NPP_PRIMARY_SCORE_MULTIPLIER } from "@/lib/electionEngine/constants";
import { resolveTurnout } from "@/lib/electionEngine/resolvedTurnout";
import { resolveTurnWindow } from "@/lib/electionEngine/voteCalculations";
import { eraYearContextFromGameState } from "@/lib/era/context";
import {
  accruePrimaryBallotTurn,
  ballotSharesWithinParty,
  partyPrimaryPools,
  primaryBallotWindow,
  scoreByPrimaryVotes,
} from "@/lib/turn/primaryBallots";
import { processPrimaryStaggerWaves } from "./primaryStaggerPhase";
import { hasReachedExecutiveTermLimit } from "@/lib/elections/executiveTermLimits";
import {
  primaryOpenFilter,
  primaryClosedFilter,
  generalPhaseFilter,
  electionOpenFilter,
} from "@/lib/elections/electionDeadlineFilters";
import { voidDebateSessionsForElection } from "@/lib/debate/debateSessionLifecycle";
import {
  summarizePrimaryProjection,
  presidentialPrimaryStanding,
} from "@/lib/elections/presidentialPrimaryDisplay";
import {
  resolvePartyFamily,
  getTotalDelegatesForFamily,
  getPrimaryWaveSchedule,
} from "@/lib/constants/primaryCalendar";
import { presidentialRulesetFor } from "@/lib/elections/presidentialRuleset";
import {
  resolveNominationForParty,
  type NominationResolutionResult,
} from "@/lib/turn/election/conventionResolution";
import { logger } from "../observability/logger";
import { isNationwideDirectExecutiveElection } from "@/lib/elections/nationwideExecutive";
import { buildNationwideElectoratePreload } from "@/lib/electionEngine/nationwideElectorate";
import { resolveGoverningPartyIds } from "@/lib/government/governingPartyIds";
import { isMidtermOppositionBoostEligible } from "@/lib/electionEngine/midtermOppositionBoost";
import { finaliseManifestosAtElectionCall } from "@/lib/uk/manifesto/manifestoLifecycle";

/**
 * Optional restriction of a turn sweep to specific elections. Absent (the
 * turn processor's call) = every election the sweep would normally touch.
 * Exists for harnesses that drive a handful of races through the real engine
 * without disturbing the rest of a world.
 */
export interface ElectionSweepScope {
  electionIds?: ObjectId[];
}

function scopeFilter(scope?: ElectionSweepScope): { _id?: { $in: ObjectId[] } } {
  return scope?.electionIds ? { _id: { $in: scope.electionIds } } : {};
}

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
  const hasPresident = pastPrimary.some((e) => e.electionType === "president");

  // Region IDs needed for state-level primary alignment (skip presidential — national race).
  const regionLookups = pastPrimary
    .filter((e) => e.electionType !== "president" && e.seatId)
    .map((e) => ({
      regionId: parseSeatId(e.seatId as string).localRegionId,
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
        .find({ electionId: { $in: electionIds } })
        .toArray(),
      uniqueRegionKeys.size > 0
        ? db
            .collection<State>("states")
            .find({
              $or: [...uniqueRegionKeys].map((key) => {
                const [countryId, regionId] = key.split(":");
                return { _id: regionId, countryId: countryId as CountryId };
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
    const maxAdvancing = getPrimaryWinnersForElection(
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

  // Characters for infamy lookup, batched across all resolving elections.
  // Presidential races also need this map for partyOrg/national-influence
  // lookups below; non-presidential paths only need char.infamy.
  const allResolvingCandidates = resolvingElections.flatMap((r) => r.candidates);
  const allCharacterIds = allResolvingCandidates.filter((c) => !c.isNPP).map((c) => c.characterId);
  const chars =
    allCharacterIds.length > 0
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: allCharacterIds } })
          .toArray()
      : [];
  const charMap: Map<string, Character> = new Map(chars.map((c) => [c._id.toString(), c]));

  // Active preset for delegate-majority thresholds (convention path). Fetched
  // once for the whole resolution pass; only presidential races consume it.
  const presPreset = hasPresident
    ? (
        await db
          .collection<{ _id: string; preset?: string }>("gameState")
          .findOne({ _id: "current" }, { projection: { preset: 1 } })
      )?.preset
    : undefined;

  for (const { election, candidates, partyCounts, maxAdvancing } of resolvingElections) {
    const electionId = election._id as ObjectId;

    const enriched = await fetchEnrichedCandidates(candidates, {
      countryId: (election.countryId ?? "US") as CountryId,
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
      await finaliseManifestosAtElectionCall(db, {
        countryId: "UK",
        electionId,
        parties: manifestoParties,
        now,
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
    if (election.electionType !== "president" && election.seatId) {
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
      const presidentialTally =
        election.electionType === "president"
          ? presidentialTallyMap.get(electionId.toString())
          : null;
      const partyDelegates = presidentialTally?.primaryDelegates?.[partyId];
      const usePresidentialDelegatePath =
        election.electionType === "president" &&
        partyDelegates &&
        Object.values(partyDelegates).some((v) => v > 0);

      let scored: { candidateId: string; characterName: string; score: number }[];

      // Vote fallback: stagger ran and recorded per-state votes but no delegates
      // crossed zero yet (e.g. admin-forced resolution mid-stagger). Rank by the
      // national sum of real per-state votes so the winner still matches the
      // vote engine rather than the ideology score (#3022).
      const partyStateVotes =
        election.electionType === "president"
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
        election.electionType === "president" &&
        Object.values(partyNationalVotes).some((v) => v > 0);

      // Down-ballot: cumulative primary ballots accrued turn by turn, when the
      // race has any. Null keeps the legacy score path.
      const downBallotBallots =
        election.electionType !== "president"
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
            let score: number;
            if (election.electionType === "president") {
              // Party influence (candidate's own party clout), NPPs have none. See #934.
              // No chair multiplier — the chair primary boost was removed (#3019);
              // effectivePartyInfluenceForPresidentialPrimary is an inert passthrough.
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
              const nationalOrPol = c.isNPP
                ? ec.politicalInfluence
                : (charMap.get(c.characterId.toString())?.nationalInfluence ??
                  ec.politicalInfluence);
              score = calcPresidentPrimaryScore(
                ec.charEP,
                ec.charSP,
                partyEP,
                partySP,
                ec.favorability,
                nationalOrPol,
                partyInfluence,
                ec.infamy
              );
            } else {
              score = calcPrimaryScore(
                ec.charEP,
                ec.charSP,
                partyEP,
                partySP,
                ec.favorability,
                ec.politicalInfluence,
                ec.infamy,
                raceStateEconLean,
                raceStateSocialLean
              );
            }
            /*
             * NPPs are penalised in primary scoring when a player character runs in
             * the same party. This models the structural disadvantage NPPs face from
             * lower voter name recognition and fewer campaign resources compared to
             * active player-driven characters. Without this handicap, high-favorability
             * NPPs would frequently outcompete players in their own party primaries,
             * undermining player agency. See NPP_PRIMARY_SCORE_MULTIPLIER in constants.ts.
             */
            if (c.isNPP && hasPlayerInParty) score *= NPP_PRIMARY_SCORE_MULTIPLIER;
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
        if (!isLoser && election.electionType === "president") {
          achievementPromises.push(
            import("@/lib/achievements")
              .then(async ({ awardAchievement, resolveUserIdFromCharacter }) => {
                const cUserId = await resolveUserIdFromCharacter(c.characterId);
                if (cUserId) await awardAchievement(cUserId, "presidential_nominee", c.characterId);
              })
              .catch((e) => console.error("Achievement check failed:", e))
          );
        }
      }
      await Promise.all([createNotifications(notificationInputs), ...achievementPromises]);
    }

    // Clear primary-phase campaigning state for every candidate in this election —
    // the primary is over, so the badge and ticks should reset before general-phase
    // travel takes over. Only affects presidential (state primaries don't set these).
    if (election.electionType === "president") {
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
    const generalCandidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId, status: "active" })
      .toArray();
    if (election.electionType === "president") {
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
  }

  if (totalEliminated > 0)
    console.log(`[Turn] Primaries resolved: ${totalEliminated} candidate(s) eliminated`);
}

/**
 * For each player presidential nominee without a runningMateId, tentatively
 * assign the highest-favorability same-party character in the same country
 * who is not themselves a candidate or the incumbent president. Sends a
 * notification so the nominee knows and can override via the running-mate UI.
 */
async function autoAssignTentativeRunningMates(
  db: Awaited<ReturnType<typeof getDb>>,
  nominees: ElectionCandidate[],
  countryId: CountryId
): Promise<void> {
  const needsVp = nominees.filter((c) => !c.isNPP && !c.runningMateId && c.characterId != null);
  if (needsVp.length === 0) return;

  // Incumbent president is disqualified from being a running mate
  const incumbent = await db
    .collection("electedOfficials")
    .findOne(getExecutiveOfficialFilter(countryId, "president"), {
      projection: { characterId: 1 },
    });
  const incumbentId: ObjectId | null = (incumbent?.characterId as ObjectId | null) ?? null;
  const countryConfig = getCountryConfig(countryId);

  const candidateIdSet = new Set(nominees.map((c) => c.characterId?.toString()).filter(Boolean));

  // Group nominees by party so we run one query per party instead of one per nominee
  const nomineesByParty = new Map<string, typeof needsVp>();
  for (const n of needsVp) {
    const list = nomineesByParty.get(n.party) ?? [];
    list.push(n);
    nomineesByParty.set(n.party, list);
  }

  const partyQueries = [...nomineesByParty.keys()].map((party) =>
    db
      .collection<Character>("characters")
      .find({
        countryId,
        party,
        _id: { $nin: needsVp.map((n) => n.characterId) },
      })
      .sort({ favorability: -1 })
      .limit(10)
      .toArray()
  );
  const partyCandidatesArrays = await Promise.all(partyQueries);
  const candidatesByParty = new Map<string, Character[]>();
  let idx = 0;
  for (const party of nomineesByParty.keys()) {
    candidatesByParty.set(party, partyCandidatesArrays[idx++]);
  }

  // Batch-fetch nominee characters for notifications in one query
  const nomineeChars = await db
    .collection<Character>("characters")
    .find(
      { _id: { $in: needsVp.map((n) => n.characterId) } },
      { projection: { _id: 1, userId: 1 } }
    )
    .toArray();
  const nomineeCharMap = new Map(nomineeChars.map((c) => [c._id.toString(), c]));

  for (const nominee of needsVp) {
    const candidates = candidatesByParty.get(nominee.party) ?? [];

    const pick = candidates.find(
      (c) =>
        !candidateIdSet.has(c._id.toString()) &&
        (!incumbentId || !c._id.equals(incumbentId)) &&
        !(
          countryConfig.executiveTermLimit?.blocksRunningMateSelection &&
          hasReachedExecutiveTermLimit(c, countryId)
        )
    );

    if (!pick) continue;

    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateOne(
        { _id: nominee._id },
        { $set: { runningMateId: pick._id, updatedAt: new Date() } }
      );

    const nomineeChar = nomineeCharMap.get(nominee.characterId.toString());
    if (nomineeChar?.userId) {
      await createNotifications([
        {
          userId: nomineeChar.userId,
          type: "general_win",
          title: "Running mate tentatively assigned",
          message: `Since you didn't pick a running mate before the primary ended, ${pick.name} has been assigned as your tentative VP. You can change them from the election page.`,
          metadata: {
            electionId: nominee.electionId.toString(),
            tentativeVpId: pick._id.toString(),
          },
        },
      ]);
    }
  }
}

/**
 * Record a primary standings snapshot for every election currently in primary phase.
 * Called each turn so the hourly trend graph stays populated.
 */
export async function recordPrimarySnapshots(
  now: Date,
  currentTurn: number,
  scope?: ElectionSweepScope
): Promise<number> {
  const db = await getDb();

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
  const hasPresident = activeElections.some((e) => e.electionType === "president");

  // Region IDs for state-level alignment lookups (skip presidential).
  const snapshotRegionLookups = activeElections
    .filter((e) => e.electionType !== "president" && e.seatId)
    .map((e) => ({
      regionId: parseSeatId(e.seatId as string).localRegionId,
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
              return { _id: regionId, countryId: countryId as CountryId };
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
      ? db.collection<DemographicCategory>("demographicCategories").find({}).toArray()
      : Promise.resolve([] as DemographicCategory[]),
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } })
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

  const allCharacterIds = [
    ...new Set(allCandidates.filter((c) => !c.isNPP).map((c) => c.characterId)),
  ];
  const allNppIds = [
    ...new Set(allCandidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!)),
  ];

  const [characters, npps] = await Promise.all([
    allCharacterIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: allCharacterIds } })
          .toArray()
      : Promise.resolve([] as Character[]),
    allNppIds.length > 0
      ? db
          .collection<NPP>("npps")
          .find(
            { _id: { $in: allNppIds } },
            {
              projection: {
                "policies.economic": 1,
                "policies.social": 1,
                favorability: 1,
                politicalInfluence: 1,
                homeState: 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([] as NPP[]),
  ]);
  const charMap = new Map(characters.map((c) => [c._id.toString(), c]));
  const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));

  // Presidential-only: compute per-state projections FIRST (also writes the
  // per-state polling history to the tally). The returned projections drive a
  // delegate-consistent national standing on the primarySnapshots doc below, so
  // the persisted standing (read by wiki/discord/trend) matches the delegate
  // winner instead of the old calcPresidentPrimaryScore ranking (#3022).
  const presProjections = await recordPresidentialStatePollingSnapshots(
    db,
    activeElections.filter((e) => e.electionType === "president"),
    candidatesByElection,
    charMap,
    nppMap,
    partyMap,
    statePartyOrgs,
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
  const primaryVotesByElection = new Map<string, Record<string, number>>();
  for (const t of existingPrimaryTallies) {
    if (t.primaryVotes) primaryVotesByElection.set(t.electionId.toString(), t.primaryVotes);
  }
  const ballotTallyOps: AnyBulkWriteOperation<ElectionVoteTally>[] = [];
  // Per-turn idempotency: a turn whose later phase stalled (a stuck
  // corporationTurn lock, cleared and re-run) runs this phase again under the
  // SAME turn number. Live turn 460 ran three times and every open general
  // banked three slices; the primary accrual would do the same. An election
  // already snapshotted for this turn is skipped outright.
  const alreadyRecorded = new Set(
    (
      await db
        .collection<PrimarySnapshot>("primarySnapshots")
        .find({
          electionId: { $in: activeElections.map((e) => e._id as ObjectId) },
          turn: currentTurn,
        })
        .toArray()
    ).map((s) => s.electionId.toString())
  );

  const snapshots: PrimarySnapshot[] = [];

  for (const election of activeElections) {
    const electionObjectId = election._id as ObjectId;
    const candidates = candidatesByElection.get(electionObjectId.toString()) ?? [];

    if (candidates.length === 0) continue;
    if (alreadyRecorded.has(electionObjectId.toString())) continue;

    const isPresident = election.electionType === "president";

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

      // President with a live projection → delegate-consistent standing (#3022).
      const presStanding = isPresident ? presStandingByCandidate.get(c._id.toString()) : undefined;
      const usePresProjection = isPresident && presPartiesWithProjection.has(c.party);
      let primaryScore = usePresProjection
        ? (presStanding?.standing ?? 0)
        : isPresident
          ? (() => {
              // Pre-projection fallback (no per-state votes yet this cycle).
              // Party influence (candidate's own party clout), NPPs have none (#934).
              // No chair multiplier — chair primary boost removed (#3019).
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
      const partyCandidates = candidates.filter((x) => x.party === c.party);
      const hasPlayerInParty = partyCandidates.some((x) => !x.isNPP);
      // Same handicap as in resolvePrimariesIfNeeded — see NPP_PRIMARY_SCORE_MULTIPLIER.
      // Skipped on the projection path: the NPP penalty is already baked into the
      // per-state vote engine, so re-applying it would double-count.
      if (c.isNPP && hasPlayerInParty && !usePresProjection)
        primaryScore *= NPP_PRIMARY_SCORE_MULTIPLIER;
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
    if (!isPresident && election.seatId && ballotWindow?.open) {
      const accrualRegionId = parseSeatId(election.seatId).localRegionId;
      const regionKey = `${election.countryId ?? "US"}:${accrualRegionId}`;
      const totalPool = accrualRegionId ? turnoutPoolByRegionKey.get(regionKey) : undefined;
      const registration = accrualRegionId ? registrationByRegion.get(accrualRegionId) : undefined;
      if (accrualRegionId && totalPool && registration) {
        const pools = partyPrimaryPools(totalPool, Object.keys(byParty), registration);
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

    snapshots.push({
      _id: new ObjectId(),
      electionId: electionObjectId,
      recordedAt: now,
      turn: currentTurn,
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
  now: Date
): Promise<PresProjectionByElection> {
  const projectionsByElection: PresProjectionByElection = new Map();
  if (presElections.length === 0) return projectionsByElection;

  const { projectPrimaryByState } = await import("@/lib/primaryProjection");
  const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
  const { loadRegionalBonusMaps } = await import("@/lib/primaryRegionalBonusLoader");
  const { ELECTORAL_VOTE_UNITS } = await import("@/lib/constants/states");
  const stateIds = [...new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId))];

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
  scope?: ElectionSweepScope
): Promise<void> {
  const db = await getDb();

  // Run presidential primary stagger waves first (before general accumulation).
  // Affects only presidential elections in primary phase within 6h of ending.
  try {
    await processPrimaryStaggerWaves(db, now, turn, scope?.electionIds);
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

  const stateElections = generalElections.filter((e) => e.electionType !== "president");
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
    const nationwideCountries = [
      ...new Set(
        stateElections
          .filter((election) => {
            const countryId = (election.countryId ?? "US") as CountryId;
            return isNationwideDirectExecutiveElection(
              election.electionType,
              election.state,
              countryId
            );
          })
          .map((election) => (election.countryId ?? "US") as CountryId)
      ),
    ];
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
          db
            .collection<{
              _id: string;
              preset?: string;
              currentYear?: number;
              currentTurn?: number;
              startingYear?: number;
              eraSystemEnabled?: boolean;
            }>("gameState")
            .findOne(
              { _id: "current" },
              {
                projection: {
                  preset: 1,
                  currentYear: 1,
                  currentTurn: 1,
                  startingYear: 1,
                  eraSystemEnabled: 1,
                },
              }
            ),
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
          governingPartyIdsByCountry: new Map(governingPartyEntries),
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
  const candidatesByElection = new Map<string, ElectionCandidate[]>();
  for (const c of allActiveCandidates) {
    const eid = c.electionId.toString();
    const list = candidatesByElection.get(eid) ?? [];
    list.push(c);
    candidatesByElection.set(eid, list);
  }

  // A3 — process presidential races BEFORE down-ballot races so the
  // coattails driver reads the freshly-accumulated presidential margin
  // for this turn. Without this ordering, MongoDB's default iteration
  // would let a down-ballot tally see last turn's presidential data
  // (or none on the first turn), suppressing coattails.
  const presidentialElections = generalElections.filter((e) => e.electionType === "president");
  const downBallotElections = generalElections.filter((e) => e.electionType !== "president");
  const orderedElections = [...presidentialElections, ...downBallotElections];

  for (const election of orderedElections) {
    try {
      const existing = tallyByElection.get(election._id.toString());
      const activeCandidates = candidatesByElection.get(election._id.toString()) ?? [];

      if (election.electionType === "president") {
        if (!existing && activeCandidates.length > 0) {
          await initPresidentVoteTally(election._id, activeCandidates);
        }
        // Per-country accumulation: US electoral college vs NG/bespoke per-zone.
        if (
          election.countryId != null &&
          COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS.has(election.countryId)
        ) {
          await accumulateNGPresidentVoteTurn(db, election._id, now, turn);
        } else {
          await accumulatePresidentVoteTurn(election._id, turn, now);
        }
      } else {
        if (!existing && activeCandidates.length > 0) {
          await initElectionVoteTally(election._id, activeCandidates, election.state as string);
        }
        await accumulateVoteTurn(election._id, turn, now, { approvalMap, preload });
      }
    } catch (err) {
      logger.error("Turn", `Error accumulating votes for election ${election._id}`, err);
    }
  }
}
