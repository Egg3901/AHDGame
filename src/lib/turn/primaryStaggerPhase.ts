/**
 * Presidential primary stagger phase.
 *
 * During the final 6 turns of a presidential primary, states vote in waves
 * modeled on the real 2020 calendar (see `primaryCalendar.ts`). Each turn
 * inside the window unlocks one more wave, and missed turns catch up every
 * outstanding wave in-order on the next successful pass.
 *
 * For every party running in the primary, the wave's states accumulate
 * intra-party votes (filtered to that party's candidates), delegates are
 * allocated per the state party chair's choice (or family default), and
 * momentum fav bumps are applied to wave winners.
 *
 * Called from `primaryResolution.ts` before the existing primary-end check.
 */

import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  Character,
  CharacterStateOrg,
  DemographicCategory,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  NPP,
  PoliticalParty,
  State,
  StateDemographics,
  StatePartyOrg,
  StateDemographicTurnout,
} from "@/lib/db/types";
import {
  getPrimaryWaveSchedule,
  startedScheduleForFirstOffset,
  STAGGER_WINDOW_TURNS_STRETCHED,
  resolvePartyFamily,
  getDelegatesForState,
  getDefaultPrimaryAllocation,
  type PrimaryCalendarFamily,
  type PrimaryWaveSchedule,
} from "@/lib/constants/primaryCalendar";
import {
  presidentialRulesetFor,
  type PresidentialRuleset,
} from "@/lib/elections/presidentialRuleset";
import { initPresidentVoteTally } from "@/lib/presidentialElectionEngine";
import { fetchEnrichedCandidates } from "@/lib/electionEngine/candidateEnrichment";
import { loadLiveStateActions } from "@/lib/elections/primaryStateActions";
import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import { supportMoodMultiplier } from "@/lib/electionEngine/electionFormulaFactors";
import { resolveTurnout } from "@/lib/electionEngine/resolvedTurnout";
import { buildGranularElectorateSubstrate } from "@/lib/demographics/granularElectorate";
import { eraYearContextFromGameState } from "@/lib/era/context";
import {
  applyPrimaryTurnoutRetention,
  computeTurnoutPoolFromRates,
  shiftDemographicsForPrimary,
} from "@/lib/campaigns/shiftPrimaryElectorate";
import {
  PRIMARY_CAMPAIGN_STAGGER_TICK_RATE,
  homeStateSurgeMultiplier,
  stateAttackMultiplier,
  PRIMARY_MOMENTUM_WIN_BONUS,
  PRIMARY_MOMENTUM_UPSET_BONUS,
  NPP_STAGGER_EXTRA_MULTIPLIER,
} from "@/lib/electionEngine/constants";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Fraction of full state turnout that participates in a party primary.
 * Real-world Dem/GOP primaries draw ~12–18% of general turnout; 0.13 matches
 * 2020 actuals (e.g. CA Dem primary ~5.8M of ~17M). Delegate allocation is
 * share-based so this factor only affects displayed vote magnitudes.
 */
const PRIMARY_TURNOUT_FACTOR = 0.13;
import { allocateDelegates, type AllocationMethod } from "@/lib/primaryDelegateAllocation";
import { projectPrimaryByState } from "@/lib/primaryProjection";
import { logger } from "../observability/logger";
import { emitPrimaryTierWire } from "@/lib/elections/raceWireEmit";

const MS_PER_HOUR = 3_600_000;

function buildClampedFavorabilityUpdate(amount: number) {
  return [
    {
      $set: {
        favorability: {
          $min: [100, { $max: [0, { $add: [{ $ifNull: ["$favorability", 0] }, amount] }] }],
        },
      },
    },
  ];
}

export interface StaggerPhaseResult {
  electionId: ObjectId;
  waveIndex: number;
  wavesRun: number;
  statesProcessed: string[];
  delegatesAwarded: number;
  momentumBumps: number;
}

export function getDuePrimaryWaveCount(turnsToEnd: number, schedule: PrimaryWaveSchedule): number {
  if (turnsToEnd < 0 || turnsToEnd > schedule.windowTurns - 1) return 0;
  return schedule.waves.filter((wave) => turnsToEnd <= wave.turnsRemaining).length;
}

/** Clamp a number to [lo, hi]. */
function clampTo(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Expectation-beating momentum, concept #2 (the vote-share carry).
 *
 * Two distinct "momentum" ideas live in this file and must not be conflated:
 *   1. Favorability-bump momentum — the PRIMARY_MOMENTUM_WIN_BONUS /
 *      PRIMARY_MOMENTUM_UPSET_BONUS fav points applied to the wave winner's
 *      character/npp. Orthogonal, untouched by this subsystem.
 *   2. Vote-share momentum (this) — a candidate that beats its projected
 *      national share in a wave accumulates decayed points that multiply its
 *      vote in LATER waves.
 *
 * `momentumMultiplier` maps a candidate's carried momentum points into a vote
 * multiplier for the current wave. At cap 0 (the ship value) it returns exactly
 * 1, so the vote path is byte-identical to the no-momentum engine until the cap
 * is calibrated at t384.
 */
export function momentumMultiplier(priorPoints: number, cap: number): number {
  if (cap <= 0) return 1;
  const bounded = clampTo(priorPoints, -cap, cap);
  return 1 + bounded / 100;
}

/**
 * Whether vote-share momentum computes and persists for a race. Coupled to the
 * stretched calendar (the subsystem shipped together): compressed races (v1/v2,
 * including the live 1960 race) never touch `primaryMomentum` at all. This is
 * the gate that keeps v1 byte-identical while v3 persists momentum (zeros at
 * cap 0) for later calibration.
 */
export function momentumEnabledForRuleset(
  ruleset: Pick<PresidentialRuleset, "primaryCalendar">
): boolean {
  return ruleset.primaryCalendar === "stretched";
}

/** This wave's expectation beat/miss for a candidate (national share points), clamped to +-cap. */
export function waveMomentumPoints(
  expectedShare: number,
  actualShare: number,
  cap: number
): number {
  return clampTo(actualShare - expectedShare, -cap, cap);
}

/** Decay the carried momentum then add this wave's beat/miss, clamped to +-cap. */
export function accumulateMomentum(
  prior: number,
  momentumC: number,
  decay: number,
  cap: number
): number {
  return clampTo(prior * decay + momentumC, -cap, cap);
}

/**
 * Run one stagger-phase wave for a presidential primary if this turn falls
 * inside the 6-turn stagger window and a wave is still outstanding.
 *
 * Returns null when:
 *   - election is not in the stagger window
 *   - all 6 waves have already been processed this cycle
 *   - election is not presidential
 */
export async function runPrimaryStaggerWaveIfDue(
  db: Db,
  election: Election,
  now: Date,
  currentTurn: number
): Promise<StaggerPhaseResult | null> {
  if (election.electionType !== "president") return null;

  // Rules-freeze seam: the calendar spacing (compressed vs stretched) and the
  // momentum knobs are read from the race's stamped ruleset, so a live race
  // keeps the schedule it opened under. Unstamped races (the 1960 race) resolve
  // to v1 = compressed with momentum off.
  const ruleset = presidentialRulesetFor(election);
  const momentumCap = ruleset.primaryMomentumCapPoints;
  const momentumDecay = ruleset.primaryMomentumDecay;

  // Turns remaining until the primary closes — turn-first so the stagger window
  // tracks game turns rather than wall-clock, freezing on pause. Falls back to
  // the Date for primaries not yet backfilled (retained as a safety net).
  let turnsToEnd: number;
  if (typeof election.primaryEndTurn === "number") {
    turnsToEnd = election.primaryEndTurn - currentTurn;
  } else if (election.primaryEndTime) {
    turnsToEnd = (election.primaryEndTime.getTime() - now.getTime()) / MS_PER_HOUR;
  } else {
    return null;
  }
  // Cheap early bail: outside the widest possible stagger window no wave can be
  // due, so return before loading (and bootstrapping) the tally for a race that
  // is nowhere near its primary. The precise, schedule-aware gate runs after the
  // tally load below.
  if (turnsToEnd < 0 || turnsToEnd > STAGGER_WINDOW_TURNS_STRETCHED - 1) return null;

  // Active preset drives per-state delegate rescaling (delegates track each
  // state's EV weight, which is 1990-census in a 1991 game).
  const gsForDelegates = await db
    .collection<{
      _id: string;
      preset?: string;
      currentYear?: number;
      currentTurn?: number;
      startingYear?: number;
      eraSystemEnabled?: boolean;
      granularElectorateEnabled?: boolean;
    }>("gameState")
    .findOne({ _id: "current" });
  const delegatePreset = gsForDelegates?.preset;
  // Live era clock (null while `eraSystemEnabled` is off — legacy behavior).
  const eraYear = eraYearContextFromGameState(gsForDelegates);
  // Granular-cell electorate engine (fail-closed): swap the archetype
  // substrate for Layer-1 cells in the per-state primary distribution below.
  const granularElectorateEnabled = gsForDelegates?.granularElectorateEnabled === true;

  // Bootstrapping the tally at stagger start is load-bearing: wave history,
  // per-state primary votes, and delegates all persist on electionVoteTallies.
  // Without this, primaries can enter the calendar window with no tally doc and
  // silently skip every state because the stagger phase has nowhere to record them.
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ electionId: election._id, status: "active" })
    .toArray();
  if (candidates.length === 0) return null;

  let tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId: election._id });
  if (!tally) {
    await initPresidentVoteTally(election._id, candidates, undefined, db);
    tally = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .findOne({ electionId: election._id });
    if (!tally) return null;
  }

  // Schedule stickiness: once a primary has begun, it keeps the wave cadence it
  // opened on, even if the race is later re-stamped to a ruleset with a
  // different calendar. Retrofitting the stretched schedule onto a primary that
  // already ran waves on the compressed cadence would drop every remaining wave
  // at once (the 40-turn lead is gone), so a mid-flight primary is locked to the
  // schedule its first recorded wave used; only a primary that has not started
  // yet takes the ruleset schedule.
  const schedule =
    startedScheduleForFirstOffset(tally.primaryWaveHistory?.[0]?.turnsRemaining) ??
    getPrimaryWaveSchedule(ruleset);
  // Momentum is a stretched-calendar-subsystem feature: it computes and persists
  // only for races on the stretched calendar (v3+). Compressed races (v1/v2,
  // including the live 1960 race) never touch `primaryMomentum` — byte-identical
  // to the pre-subsystem engine. Keyed on the EFFECTIVE (started) schedule, so a
  // compressed-in-flight primary re-stamped to v3 still never accrues momentum.
  const momentumEnabled = momentumEnabledForRuleset(ruleset) && schedule.kind === "stretched";
  // Precise, schedule-aware due-wave count: this bounds the per-turn catch-up
  // (`wavesRun >= dueWaveCount` below), so it must use the sticky schedule to
  // avoid dumping every remaining wave when a compressed-in-flight primary was
  // re-stamped to a stretched ruleset.
  const dueWaveCount = getDuePrimaryWaveCount(turnsToEnd, schedule);
  if (dueWaveCount === 0) return null;

  // Source of truth for control flow: the atomic counter, if present. Falls
  // back to `primaryWaveHistory.length` for legacy tallies that pre-date the
  // counter. When the two disagree (display-array tampering, partial-write
  // corruption, etc.) trust the counter — it is `$inc`d atomically with each
  // wave's `$push` — and surface the divergence for triage.
  const historyWavesRun = tally.primaryWaveHistory?.length ?? 0;
  const counterWavesRun = tally.primaryStaggerWavesRun;
  let wavesRun =
    counterWavesRun !== undefined && counterWavesRun !== null ? counterWavesRun : historyWavesRun;
  if (counterWavesRun !== undefined && counterWavesRun !== historyWavesRun) {
    console.warn(
      `[Primary Stagger] Election ${election._id}: primaryStaggerWavesRun (${counterWavesRun}) disagrees with primaryWaveHistory.length (${historyWavesRun}) — trusting counter`
    );
  }
  // Clamp under both bounds so a corrupted counter never indexes
  // `PRIMARY_WAVES[wavesRun]` out of range. Negative counters are also clamped.
  if (wavesRun < 0) {
    console.warn(
      `[Primary Stagger] Election ${election._id}: wavesRun (${wavesRun}) < 0 — clamping to 0`
    );
    wavesRun = 0;
  }
  if (wavesRun > schedule.waves.length) {
    console.warn(
      `[Primary Stagger] Election ${election._id}: wavesRun (${wavesRun}) exceeds wave count (${schedule.waves.length}) — clamping`
    );
    wavesRun = schedule.waves.length;
  }
  if (wavesRun >= schedule.waves.length) return null;
  if (wavesRun >= dueWaveCount) return null;

  const wave = schedule.waves[wavesRun];

  const uniquePartyIds = [...new Set(candidates.map((c) => c.party))];
  // Candidates store `party` as the sequentialId stringified (per codebase convention).
  const partyNumericIds = uniquePartyIds.map((s) => Number(s)).filter((n) => !isNaN(n));
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({
      countryId: election.countryId,
      sequentialId: { $in: partyNumericIds },
    })
    .toArray();
  const partyMap = new Map<string, PoliticalParty>();
  for (const p of parties) {
    partyMap.set(p.sequentialId.toString(), p);
  }

  const waveStates = wave.states;
  const [categories, states, demographics, partyOrgs, turnoutDocs] = await Promise.all([
    loadDemographicCategories(db),
    db
      .collection<State>("states")
      .find({ _id: { $in: waveStates } })
      .toArray(),
    db
      .collection<StateDemographics>("stateDemographics")
      .find({ _id: { $in: waveStates } })
      .toArray(),
    db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ stateId: { $in: waveStates } })
      .toArray(),
    db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .find({ _id: { $in: waveStates } })
      .toArray(),
  ]);

  const stateMap = new Map(states.map((s) => [s._id as string, s]));
  const demographicsMap = new Map(demographics.map((d) => [d._id as string, d]));
  const turnoutMap = new Map(turnoutDocs.map((t) => [t._id as string, t]));

  // Live state actions for this race, read once for the wave rather than per
  // state. Only `voteSuppression` rows are read below; `localFavorability` is
  // applied by campaignTurn against favourability, not here.
  const liveStateActions = await loadLiveStateActions(db, {
    electionId: election._id,
    currentTurn,
  });

  // Seeded snapshots for the granular substrate's legislation lean-drift fold.
  // Only fetched when the flag is on so the legacy path pays no extra read.
  const demographicDefaultsByState = granularElectorateEnabled
    ? new Map(
        (
          await db
            .collection<StateDemographics>("demographicDefaults")
            .find({ _id: { $in: waveStates } })
            .toArray()
        ).map((d) => [d._id as string, d])
      )
    : undefined;
  const partyOrgByStateParty = new Map<string, StatePartyOrg>();
  for (const po of partyOrgs) {
    partyOrgByStateParty.set(`${po.stateId}_${po.partyId}`, po);
  }

  // Scope the party lookup by countryId so sequentialId collisions across
  // countries cannot invert candidate party positions.
  const enriched = await fetchEnrichedCandidates(candidates, {
    includePartyPositions: true,
    countryId: (election.countryId ?? "US") as CountryId,
  });

  // Primary vote accumulation uses national NPI through the presidential-primary
  // diminishing reach curve (`presidentialPrimaryNationalReach`). Party influence
  // also multiplies per-candidate weight on this path (see
  // `MAX_PARTY_INFLUENCE_BONUS_PRIMARY`). NPPs use the PI→NPI proxy;
  // NPP_STAGGER_EXTRA_MULTIPLIER (0.6) stacks on NPP_GENERAL (0.8).

  // Pre-wave per-state candidate meta (home state, campaigning state, ticks) —
  // resolved from the raw candidate + character/npp docs for the projection call.
  const [characters, npps] = await Promise.all([
    db
      .collection<Character>("characters")
      .find({
        _id: { $in: candidates.filter((candidate) => !candidate.isNPP).map((c) => c.characterId) },
      })
      .project({ _id: 1, homeState: 1 })
      .toArray(),
    db
      .collection<NPP>("npps")
      .find({
        _id: {
          $in: candidates
            .filter((candidate) => candidate.isNPP && candidate.nppId)
            .map((c) => c.nppId!),
        },
      })
      .project({ _id: 1, homeState: 1 })
      .toArray(),
  ]);
  const homeStateByCharacterId = new Map(
    characters.map((character) => [character._id.toString(), character.homeState ?? null])
  );
  const homeStateByNppId = new Map(npps.map((npp) => [npp._id.toString(), npp.homeState ?? null]));
  const candidateMetaForProjection = enriched.map((ec) => {
    const raw = candidates.find((c) => c._id.toString() === ec.candidateId);
    const homeState = raw?.isNPP
      ? raw.nppId
        ? (homeStateByNppId.get(raw.nppId.toString()) ?? null)
        : null
      : (homeStateByCharacterId.get(raw?.characterId.toString() ?? "") ?? null);
    return {
      candidateId: ec.candidateId,
      isNPP: ec.isNPP,
      homeState,
      primaryCampaignState: raw?.primaryCampaignState ?? null,
      primaryCampaignTicks: raw?.primaryCampaignTicks ?? 0,
      primarySurgeUsed: raw?.primarySurgeUsed ?? false,
      primarySurgeBoost: raw?.primarySurgeBoost,
      support: raw?.support,
    };
  });

  // Regional bases L1 — load characterStateOrg rows for the candidates and
  // wave states. NPPs cannot invest in state org (no actions / barred from
  // president), so only player-character rows are queried. The result is
  // keyed by stateId → (candidateId → level), threaded into the per-state
  // distribution call below and into the projection call further down so
  // both engines agree.
  const characterIdsForStateOrg = candidates
    .filter((c) => !c.isNPP && c.characterId)
    .map((c) => c.characterId);
  const stateOrgRows = characterIdsForStateOrg.length
    ? await db
        .collection<CharacterStateOrg>("characterStateOrg")
        .find({
          characterId: { $in: characterIdsForStateOrg },
          stateId: { $in: waveStates },
          level: { $gt: 0 },
        })
        .toArray()
    : [];
  const characterIdToCandidateId = new Map<string, string>();
  for (const c of candidates) {
    if (!c.isNPP && c.characterId) {
      characterIdToCandidateId.set(c.characterId.toString(), c._id.toString());
    }
  }
  const stateOrgByStateAndCandidate = new Map<string, Map<string, number>>();
  for (const row of stateOrgRows) {
    const candidateId = characterIdToCandidateId.get(row.characterId.toString());
    if (!candidateId) continue;
    let stateMap = stateOrgByStateAndCandidate.get(row.stateId);
    if (!stateMap) {
      stateMap = new Map<string, number>();
      stateOrgByStateAndCandidate.set(row.stateId, stateMap);
    }
    stateMap.set(candidateId, row.level);
  }

  // Regional bases C — per-candidate home state. Built on top of the maps
  // already loaded above; NPP candidates use their nppId path. Threaded
  // through DistributeVotesOptions to fire only when currentStateId matches.
  const homeStateByCandidate = new Map<string, string>();
  for (const c of candidates) {
    if (c.isNPP && c.nppId) {
      const home = homeStateByNppId.get(c.nppId.toString());
      if (home) homeStateByCandidate.set(c._id.toString(), home);
    } else if (!c.isNPP && c.characterId) {
      const home = homeStateByCharacterId.get(c.characterId.toString());
      if (home) homeStateByCandidate.set(c._id.toString(), home);
    }
  }

  const orgMap = new Map<string, number>();
  for (const [key, po] of partyOrgByStateParty.entries()) {
    orgMap.set(key, po.organization + (po.primarySurge ?? 0));
  }

  // Build per-party projections (intra-party leader per state entering this wave)
  // using the SAME GE-style demographic allocation that the stagger uses — so
  // "projected winner" and "actual winner" disagree only when random demographic
  // variance flips the result (i.e., a real upset).
  const projectionByParty = new Map<string, Record<string, string | null>>();
  // Projected per-candidate votes per state per party — the EXPECTED-share
  // source for momentum. Same GE-style demographic allocation the stagger uses,
  // so expected-vs-actual diverges only on a real demographic-variance upset.
  const projectionVotesByParty = new Map<string, Record<string, Record<string, number>>>();
  for (const partyId of uniquePartyIds) {
    const party = partyMap.get(partyId);
    const partyCandidates = enriched.filter((c) => c.party === partyId);
    if (partyCandidates.length === 0) continue;
    const metaForParty = candidateMetaForProjection.filter((m) =>
      partyCandidates.some((c) => c.candidateId === m.candidateId)
    );
    const { stateWinners, byState } = projectPrimaryByState({
      // Suppression is applied to the EXPECTED share as well as to the result.
      // Without this the target would be punished twice: fewer votes on the
      // night, and a momentum penalty for "missing" an expectation that never
      // accounted for the attack. One purchase, one effect.
      stateActions: liveStateActions,
      currentTurn,
      candidates: partyCandidates,
      candidateMeta: metaForParty,
      stateIds: waveStates,
      stateMap,
      demographicsMap,
      categories,
      statePartyOrgs: orgMap,
      partyPosition: {
        economicPosition: party?.economicPosition ?? 0,
        socialPosition: party?.socialPosition ?? 0,
      },
      // Regional bases L1+C — mirror live-stagger wiring so projection and
      // actual results converge. Without this, every party-aligned-but-
      // regionally-funded win counts as an "upset" and inflates momentum.
      stateOrgByStateAndCandidate,
      homeStateByCandidate,
      countryId: (election.countryId ?? "US") as CountryId,
    });
    projectionByParty.set(partyId, stateWinners);
    projectionVotesByParty.set(partyId, byState);
  }

  // ── Per-party, per-state vote accumulation ──────────────────────────────────
  const primaryStateVotes: Record<
    string,
    Record<string, Record<string, number>>
  > = structuredCloneOr(tally.primaryStateVotes ?? {});
  const primaryDelegates: Record<string, Record<string, number>> = structuredCloneOr(
    tally.primaryDelegates ?? {}
  );
  const primaryDelegatesByState: Record<
    string,
    Record<string, Record<string, number>>
  > = structuredCloneOr(tally.primaryDelegatesByState ?? {});
  const primaryAllocationByState: Record<
    string,
    Record<string, AllocationMethod>
  > = structuredCloneOr(tally.primaryAllocationByState ?? {});

  // Vote-share momentum carried INTO this wave (accumulated from prior waves).
  // Read-only here; the new accumulated value is computed after the wave votes.
  // partyId -> candidateId -> points.
  const priorMomentum: Record<string, Record<string, number>> = momentumEnabled
    ? structuredCloneOr(tally.primaryMomentum ?? {})
    : {};

  const momentumOps: {
    characterId: ObjectId;
    amount: number;
  }[] = [];

  let totalDelegatesAwarded = 0;
  let totalMomentumBumps = 0;

  // Only players can receive momentum bumps via character favorability; NPP momentum applied to npps collection separately.
  const nppMomentumOps: { nppId: ObjectId; amount: number }[] = [];

  for (const partyId of uniquePartyIds) {
    const partyCandidates = enriched.filter((ec) => ec.party === partyId);
    if (partyCandidates.length < 2) {
      // Single-candidate party primary — award delegates to sole candidate without running distribution.
      const sole = partyCandidates[0];
      if (sole) {
        primaryDelegates[partyId] = primaryDelegates[partyId] ?? {};
        primaryDelegatesByState[partyId] = primaryDelegatesByState[partyId] ?? {};
        const party = partyMap.get(partyId);
        const family: PrimaryCalendarFamily = resolvePartyFamily(partyId, {
          primaryCalendar: party?.primaryCalendar ?? null,
          economicPosition: party?.economicPosition,
        });
        for (const stateId of waveStates) {
          const delegates = getDelegatesForState(stateId, family, delegatePreset);
          if (delegates > 0) {
            primaryDelegates[partyId][sole.candidateId] =
              (primaryDelegates[partyId][sole.candidateId] ?? 0) + delegates;
            primaryDelegatesByState[partyId][stateId] = {
              [sole.candidateId]: delegates,
            };
            totalDelegatesAwarded += delegates;
          }
        }
      }
      continue;
    }

    const party = partyMap.get(partyId);
    const family: PrimaryCalendarFamily = resolvePartyFamily(partyId, {
      primaryCalendar: party?.primaryCalendar ?? null,
      economicPosition: party?.economicPosition,
    });

    const partyPosition = {
      economicPosition: party?.economicPosition ?? 0,
      socialPosition: party?.socialPosition ?? 0,
    };

    for (const stateId of waveStates) {
      const state = stateMap.get(stateId);
      const rawDemographicsDoc = demographicsMap.get(stateId);
      if (!state || !rawDemographicsDoc) continue;

      // Primary electorate: resolve GOTV/Layer-1 turnouts on the GENERAL
      // demographics first, then apply the same directional-alignment retention
      // `projectPrimaryByState` uses via `shiftDemographicsForPrimary`.
      //
      // Critical ordering: US `resolveTurnout` rebuilds archetype rates from
      // Layer-1 census baselines and ignores any turnout already written onto
      // demographics.groups. If we shift first and then pass those Layer-1
      // liveTurnouts into distribution, the primary electorate is wiped and
      // every state can flip vs projection (general-electorate winners vs
      // primary-base winners). Retention must land on the live map itself.
      const { byGroup: generalTurnouts } = resolveTurnout(
        state.population,
        rawDemographicsDoc,
        categories,
        turnoutMap.get(stateId),
        { preset: delegatePreset, year: eraYear.year, startingYear: eraYear.startingYear }
      );

      // Granular-cell electorate substrate (granularElectorateEnabled) — swap
      // the archetype substrate for Layer-1 cells BEFORE the primary
      // retention/shift steps: those helpers are generic over group ids, so
      // the directional-alignment retention applies to cells unchanged. Null
      // substrate (no Layer-1 census) → legacy path. Flag OFF: eff* variables
      // are the legacy values — byte-identical behavior.
      let effBaseDemographics = rawDemographicsDoc;
      let effCategories = categories;
      let effGeneralTurnouts = generalTurnouts;
      let effPartyCandidates = partyCandidates;
      if (granularElectorateEnabled) {
        const substrate = buildGranularElectorateSubstrate({
          countryId: (election.countryId ?? "US") as CountryId,
          stateId,
          preset: delegatePreset,
          year: eraYear.year,
          startingYear: eraYear.startingYear,
          turnoutDoc: turnoutMap.get(stateId),
          statePopulation: state.population,
          demographics: rawDemographicsDoc,
          categories,
          liveTurnouts: generalTurnouts,
          enriched: partyCandidates,
          demographicDefaults: demographicDefaultsByState?.get(stateId) ?? null,
        });
        if (substrate) {
          effBaseDemographics = substrate.demographics;
          effCategories = substrate.categories;
          effGeneralTurnouts = substrate.liveTurnouts;
          effPartyCandidates = substrate.enriched;
        }
      }

      const liveTurnouts = applyPrimaryTurnoutRetention(
        effGeneralTurnouts,
        effBaseDemographics,
        partyPosition
      );
      const resolvedTotalPool = computeTurnoutPoolFromRates(
        state.population,
        effBaseDemographics,
        effCategories,
        liveTurnouts
      );
      // Ideology leans are unchanged by the primary shift — only turnout is.
      // Keep a shifted demographics doc for any path that reads group.turnout
      // directly (and for symmetry with projection / polls).
      const demographicsDoc = shiftDemographicsForPrimary(effBaseDemographics, partyPosition);
      // Each state votes once in its wave using a party-primary share of the
      // general-turnout pool. No time-based weighting — earlier waves and
      // later waves are equally weighted within their own state's population.
      const turnPool = resolvedTotalPool * PRIMARY_TURNOUT_FACTOR;

      const partyOrgForState = new Map<string, number>();
      for (const [key, po] of partyOrgByStateParty.entries()) {
        if (key.startsWith(`${stateId}_`)) {
          // Any statePartyOrg.primarySurge bump on top of permanent org. The
          // player's home-state surge does NOT arrive here: it is per-candidate
          // and applied below, so it advantages the candidate who paid for it
          // rather than every co-partisan in the state.
          partyOrgForState.set(po.partyId, po.organization + (po.primarySurge ?? 0));
        }
      }

      const { votesPerCandidate } = distributeVotesByGroupLevelAllocation(
        effPartyCandidates,
        turnPool,
        resolvedTotalPool,
        state.population,
        demographicsDoc,
        effCategories,
        partyOrgForState,
        {
          // Intra-party primary: averaging the (shared) party position into
          // each candidate's effective ideology only compresses the
          // candidate-vs-candidate spread. Use raw character ideology —
          // that's the only thing that actually differs between rivals here.
          // Mirrors `projectPrimaryByState` so projection and live stagger
          // see the same ideology math.
          useAveragedPositions: false,
          usePresidentialPartyOrg: true,
          includeInfluenceInAppeal: false,
          useNationalInfluenceForReach: true,
          presidentialPrimaryNationalReach: true,
          applyPartyFit: true, // L1 — primary-only party-fit penalty
          // Regional bases L1+C — per-candidate state-org level for this
          // state, plus per-candidate home state. Both gated on the
          // primary path via applyPartyFit. Missing entries → no bonus.
          currentStateId: stateId,
          countryId: (election.countryId ?? "US") as CountryId,
          stateOrgByCandidate: stateOrgByStateAndCandidate.get(stateId),
          homeStateByCandidate,
          liveTurnouts,
          hasPlayerInRace: partyCandidates.some((c) => !c.isNPP),
        }
      );

      // Apply primaryCampaignTicks as a multiplicative in-state bump: +5% per
      // tick (cap +25%) for the candidate camped in this state. Sized so
      // sustained in-state campaigning meaningfully shifts a competitive state
      // without overriding demographic/ideology alignment.
      for (const ec of partyCandidates) {
        const rawCandidate = candidates.find((c) => c._id.toString() === ec.candidateId);
        if (
          rawCandidate?.primaryCampaignState === stateId &&
          (rawCandidate.primaryCampaignTicks ?? 0) > 0
        ) {
          const ticks = Math.min(rawCandidate.primaryCampaignTicks ?? 0, 5);
          const multiplier = 1 + ticks * PRIMARY_CAMPAIGN_STAGGER_TICK_RATE;
          votesPerCandidate[ec.candidateId] = Math.round(
            (votesPerCandidate[ec.candidateId] ?? 0) * multiplier
          );
        }
      }

      // Home-state surge: the one-off paid boost in the candidate's own home
      // state, in the same multiplicative shape as the tick bump above.
      //
      // The action wrote `primarySurgeBoost` on the candidate and nothing ever
      // read it, so a player paid funds and actions for no change to any vote.
      // Gated on `primarySurgeUsed` because that is the field primary
      // resolution clears at the end of the cycle; the stored rate is left
      // behind, so keying off the rate alone would boost for ever. The rate
      // comes from the row rather than the constant so a surge already bought
      // keeps the price it was bought at.
      for (const ec of partyCandidates) {
        const rawCandidate = candidates.find((c) => c._id.toString() === ec.candidateId);
        const multiplier = homeStateSurgeMultiplier({
          surgeUsed: rawCandidate?.primarySurgeUsed,
          surgeBoostPct: rawCandidate?.primarySurgeBoost,
          homeState: homeStateByCandidate.get(ec.candidateId),
          stateId,
        });
        if (multiplier === 1) continue;
        votesPerCandidate[ec.candidateId] = Math.round(
          (votesPerCandidate[ec.candidateId] ?? 0) * multiplier
        );
      }

      // Vote suppression: rivals paying to remove a slice of this candidate's
      // vote in this state. Same multiplicative shape as the surge above, and
      // the same helper the projection runs, so the board and the wave cannot
      // disagree. Exactly 1 for anyone not under attack, so this block is a
      // strict no-op for every race with no live rows.
      for (const ec of partyCandidates) {
        const multiplier = stateAttackMultiplier({
          actions: liveStateActions,
          candidateId: ec.candidateId,
          stateId,
          currentTurn,
        });
        if (multiplier === 1) continue;
        votesPerCandidate[ec.candidateId] = Math.round(
          (votesPerCandidate[ec.candidateId] ?? 0) * multiplier
        );
      }

      // Rally support now counts in the primary too. Previously only the
      // general election read supportMoodMultiplier (voteDistribution.ts), so a
      // whole primary season of rallies / rally-tour moved zero votes. Mirror
      // the general's mood application here: support 50 → 1.0×, ranging
      // 0.6×–1.4× at the extremes. Undefined support degrades to 1.0×.
      for (const ec of partyCandidates) {
        const rawCandidate = candidates.find((c) => c._id.toString() === ec.candidateId);
        const mood = supportMoodMultiplier(rawCandidate?.support);
        if (mood !== 1) {
          votesPerCandidate[ec.candidateId] = Math.round(
            (votesPerCandidate[ec.candidateId] ?? 0) * mood
          );
        }
      }

      // Vote-share momentum carry: a candidate that beat expectations in
      // EARLIER waves carries decayed momentum points that multiply this wave's
      // vote (concept #2 — see momentumMultiplier). At cap 0 the multiplier is
      // exactly 1 and this block is a strict no-op, so the vote path is
      // byte-identical to the no-momentum engine. Only runs on stretched races.
      if (momentumEnabled) {
        const priorForParty = priorMomentum[partyId] ?? {};
        for (const ec of partyCandidates) {
          const mult = momentumMultiplier(priorForParty[ec.candidateId] ?? 0, momentumCap);
          if (mult !== 1) {
            votesPerCandidate[ec.candidateId] = Math.round(
              (votesPerCandidate[ec.candidateId] ?? 0) * mult
            );
          }
        }
      }

      // Extra NPP-in-primary penalty when a player is also running in this
      // party's primary. Stacks on top of NPP_GENERAL_WEIGHT_MULTIPLIER (0.8)
      // already applied inside distribution → combined 0.48× for NPPs.
      const hasPlayerInPartyPrimary = partyCandidates.some((c) => !c.isNPP);
      if (hasPlayerInPartyPrimary) {
        for (const ec of partyCandidates) {
          if (ec.isNPP) {
            votesPerCandidate[ec.candidateId] = Math.round(
              (votesPerCandidate[ec.candidateId] ?? 0) * NPP_STAGGER_EXTRA_MULTIPLIER
            );
          }
        }
      }

      // Merge this state's votes into the tally's primaryStateVotes (accumulative —
      // in case a wave spans multiple turns via edge cases, addition is safe).
      primaryStateVotes[partyId] = primaryStateVotes[partyId] ?? {};
      primaryStateVotes[partyId][stateId] = primaryStateVotes[partyId][stateId] ?? {};
      for (const [cid, v] of Object.entries(votesPerCandidate)) {
        primaryStateVotes[partyId][stateId][cid] =
          (primaryStateVotes[partyId][stateId][cid] ?? 0) + Math.round(v);
      }

      // Allocate delegates: chair override wins, otherwise fall back to the
      // real-world per-state default (Dem = PR everywhere; GOP = state-by-state
      // 2024 rules with hybrid CDs collapsed to PR).
      const chairPo = partyOrgByStateParty.get(`${stateId}_${partyId}`);
      const method: AllocationMethod =
        chairPo?.primaryAllocation ?? getDefaultPrimaryAllocation(stateId, family);
      primaryAllocationByState[partyId] = primaryAllocationByState[partyId] ?? {};
      primaryAllocationByState[partyId][stateId] = method;

      const delegatesAvailable = getDelegatesForState(stateId, family, delegatePreset);
      if (delegatesAvailable > 0) {
        // WTA tiebreak priority: cumulative votes this candidate has amassed
        // across ALL states so far in the primary. Breaks deadlocks by
        // overall race performance, not alphabetical candidateId.
        const tiebreakPriority: Record<string, number> = {};
        for (const cid of Object.keys(primaryStateVotes[partyId][stateId])) {
          let cumulative = 0;
          for (const s of Object.keys(primaryStateVotes[partyId] ?? {})) {
            cumulative += primaryStateVotes[partyId][s][cid] ?? 0;
          }
          tiebreakPriority[cid] = cumulative;
        }
        const allocation = allocateDelegates(
          method,
          primaryStateVotes[partyId][stateId],
          delegatesAvailable,
          tiebreakPriority
        );

        primaryDelegates[partyId] = primaryDelegates[partyId] ?? {};
        primaryDelegatesByState[partyId] = primaryDelegatesByState[partyId] ?? {};
        primaryDelegatesByState[partyId][stateId] = allocation.byCandidate;
        for (const [cid, d] of Object.entries(allocation.byCandidate)) {
          primaryDelegates[partyId][cid] = (primaryDelegates[partyId][cid] ?? 0) + d;
          totalDelegatesAwarded += d;
        }
      }

      // Determine winner + apply momentum
      const ranked = Object.entries(primaryStateVotes[partyId][stateId])
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a);
      const winnerId = ranked[0]?.[0];
      if (!winnerId) continue;

      const projectedWinner = projectionByParty.get(partyId)?.[stateId] ?? null;
      const isUpset = projectedWinner !== null && projectedWinner !== winnerId;
      const momentumBonus =
        PRIMARY_MOMENTUM_WIN_BONUS + (isUpset ? PRIMARY_MOMENTUM_UPSET_BONUS : 0);

      const winnerCandidate = candidates.find((c) => c._id.toString() === winnerId);
      if (!winnerCandidate) continue;
      if (winnerCandidate.isNPP && winnerCandidate.nppId) {
        nppMomentumOps.push({ nppId: winnerCandidate.nppId, amount: momentumBonus });
      } else if (winnerCandidate.characterId) {
        momentumOps.push({ characterId: winnerCandidate.characterId, amount: momentumBonus });
      }
      totalMomentumBumps++;
    }
  }

  // Aggregate momentum ops per target, capped at one bump per wave per candidate.
  // Sweeping Super Tuesday (14 states) must not yield +28/+56 fav in a single turn —
  // we keep only the best outcome (highest upset bonus wins, otherwise +2) per
  // candidate per wave. This preserves the upset signal without runaway snowball.
  const charMomentumMap = new Map<string, number>();
  for (const op of momentumOps) {
    const key = op.characterId.toString();
    const existing = charMomentumMap.get(key) ?? 0;
    if (op.amount > existing) charMomentumMap.set(key, op.amount);
  }
  const nppMomentumMap = new Map<string, number>();
  for (const op of nppMomentumOps) {
    const key = op.nppId.toString();
    const existing = nppMomentumMap.get(key) ?? 0;
    if (op.amount > existing) nppMomentumMap.set(key, op.amount);
  }

  if (charMomentumMap.size > 0) {
    const ops = [...charMomentumMap.entries()].map(([id, amount]) => ({
      updateOne: {
        filter: { _id: new ObjectId(id) },
        update: buildClampedFavorabilityUpdate(amount),
      },
    }));
    await db.collection("characters").bulkWrite(ops);
  }
  if (nppMomentumMap.size > 0) {
    const ops = [...nppMomentumMap.entries()].map(([id, amount]) => ({
      updateOne: {
        filter: { _id: new ObjectId(id) },
        update: buildClampedFavorabilityUpdate(amount),
      },
    }));
    await db.collection("npps").bulkWrite(ops);
  }

  // ── Vote-share momentum accumulation (stretched races only) ────────────────
  // Compare each candidate's EXPECTED national share (aggregated from the
  // projection across this wave's states) to its ACTUAL share (aggregated from
  // the votes just recorded), clamp the beat/miss to +-cap, then decay-and-add
  // to the carried total. At cap 0 every momentum_c is 0 and every accumulated
  // value stays 0 — persisted as zeros so the field exists for later
  // calibration, with no effect on votes.
  const newMomentum: Record<string, Record<string, number>> = momentumEnabled
    ? structuredCloneOr(tally.primaryMomentum ?? {})
    : {};
  const momentumByPartyThisWave: Record<string, Record<string, number>> = {};
  if (momentumEnabled) {
    for (const partyId of uniquePartyIds) {
      const partyCandidates = enriched.filter((ec) => ec.party === partyId);
      // Uncontested primaries (0 or 1 candidate) have no expectation to beat.
      if (partyCandidates.length < 2) continue;
      const projByState = projectionVotesByParty.get(partyId) ?? {};
      const actualByState = primaryStateVotes[partyId] ?? {};

      let expectedTotal = 0;
      let actualTotal = 0;
      const expectedByCandidate: Record<string, number> = {};
      const actualByCandidate: Record<string, number> = {};
      for (const ec of partyCandidates) {
        let expected = 0;
        let actual = 0;
        for (const stateId of waveStates) {
          expected += projByState[stateId]?.[ec.candidateId] ?? 0;
          actual += actualByState[stateId]?.[ec.candidateId] ?? 0;
        }
        expectedByCandidate[ec.candidateId] = expected;
        actualByCandidate[ec.candidateId] = actual;
        expectedTotal += expected;
        actualTotal += actual;
      }

      const priorForParty = priorMomentum[partyId] ?? {};
      const nextForParty: Record<string, number> = {};
      for (const ec of partyCandidates) {
        const expectedShare =
          expectedTotal > 0 ? (expectedByCandidate[ec.candidateId] / expectedTotal) * 100 : 0;
        const actualShare =
          actualTotal > 0 ? (actualByCandidate[ec.candidateId] / actualTotal) * 100 : 0;
        const momentumC = waveMomentumPoints(expectedShare, actualShare, momentumCap);
        const prior = priorForParty[ec.candidateId] ?? 0;
        const next = accumulateMomentum(prior, momentumC, momentumDecay, momentumCap);
        nextForParty[ec.candidateId] = next;
      }
      newMomentum[partyId] = { ...(newMomentum[partyId] ?? {}), ...nextForParty };
      momentumByPartyThisWave[partyId] = nextForParty;
    }
  }

  // Persist tally updates + wave-history entry. The atomic `$inc` on the
  // counter is the runtime source of truth; the `$push` to the history array
  // is for display only. Keeping them in a single updateOne ensures they
  // advance together — concurrent stagger runs cannot double-increment without
  // also double-pushing (and vice versa). Momentum ($set primaryMomentum +
  // $push primaryMomentumByWave) rides the same single write so the carry and
  // the wave counter can never diverge.
  await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
    { electionId: election._id },
    {
      $set: {
        primaryStateVotes,
        primaryDelegates,
        primaryDelegatesByState,
        primaryAllocationByState,
        ...(momentumEnabled ? { primaryMomentum: newMomentum } : {}),
        updatedAt: now,
      },
      $inc: { primaryStaggerWavesRun: 1 },
      $push: {
        primaryWaveHistory: {
          wave: wavesRun,
          turnsRemaining: wave.turnsRemaining,
          statesVoted: wave.states,
          recordedAt: now,
        },
        ...(momentumEnabled
          ? {
              primaryMomentumByWave: {
                wave: wavesRun,
                byParty: momentumByPartyThisWave,
                recordedAt: now,
              },
            }
          : {}),
      } as never,
    }
  );

  console.log(
    `[Primary Stagger] Election ${election._id} wave ${wavesRun + 1}/${schedule.waves.length} (${wave.label}) — ${wave.states.join(", ")}; delegates awarded: ${totalDelegatesAwarded}; momentum bumps: ${totalMomentumBumps}`
  );

  // Per-race wire: the wave that just closed and what it awarded. Fire-and-
  // forget after the tally write has committed, so it can never fail the wave.
  void emitPrimaryTierWire(election._id, wavesRun + 1, totalDelegatesAwarded);

  return {
    electionId: election._id,
    waveIndex: wavesRun,
    wavesRun: wavesRun + 1,
    statesProcessed: wave.states,
    delegatesAwarded: totalDelegatesAwarded,
    momentumBumps: totalMomentumBumps,
  };
}

/** Deep-clone an object — falls back to JSON clone if structuredClone unavailable. */
function structuredCloneOr<T>(obj: T): T {
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Run stagger waves for all presidential primaries in the window this turn.
 * Called from primaryResolution before the primary-end check.
 */
export async function processPrimaryStaggerWaves(
  db: Db,
  now: Date,
  turnNumber: number,
  /** Optional harness restriction to specific elections; absent = all. */
  onlyElectionIds?: ObjectId[]
): Promise<void> {
  // Scan all active presidential primaries (typically just one) and let the
  // per-election turn-based due-check gate the stagger window. A Date-range
  // pre-filter on primaryEndTime would drift against the game clock across
  // pauses and could wrongly exclude an in-window primary — the in-memory
  // check in runPrimaryStaggerWaveIfDue is the source of truth.
  const presElections = await db
    .collection<Election>("elections")
    .find({
      ...(onlyElectionIds ? { _id: { $in: onlyElectionIds } } : {}),
      status: "active",
      electionType: "president",
    })
    .toArray();

  for (const election of presElections) {
    try {
      // Upper bound on catch-up waves in a single turn = the race's wave count.
      // Both schedules have six waves; resolve per election to stay schedule-agnostic.
      const maxWaves = getPrimaryWaveSchedule(presidentialRulesetFor(election)).waves.length;
      for (let i = 0; i < maxWaves; i++) {
        const result = await runPrimaryStaggerWaveIfDue(db, election, now, turnNumber);
        if (!result) break;
      }
    } catch (err) {
      logger.error("Primary Stagger", `Error running wave for election ${election._id}`, err);
    }
  }
}
