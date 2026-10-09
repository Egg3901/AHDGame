/**
 * Election vote tally accumulation and initialization.
 */

import { isHu1991AssemblyCampaign } from "@/lib/countries/hu/rules/assemblyCampaign1991";
import { russianDumaVoteTotals } from "@/lib/countries/ru/rules/assemblyVoteIncrement";
import { russianCouncilVoteTotals } from "@/lib/countries/ru/rules/councilVoteTotals";
import { resolveRussianCouncilBallot } from "@/lib/countries/ru/rules/councilResult";
import { russianPresidentialVoteIncrement } from "@/lib/countries/ru/rules/presidentialVoteIncrement";
import { campaignStrengthLookupKey } from "@/lib/campaigns/suspendEndorseLifecycle";
import {
  loadRaceCampaignMultiplier,
  type RaceCampaignEffectsMemo,
} from "@/lib/campaigns/raceCampaignEffects";
import { getStateLean } from "@/lib/utils/demographics";
import { applyNationalAds } from "@/lib/campaignTargeting/nationalAds";
import { turnoutForElection } from "@/lib/campaignTargeting/rules";

import { getDb } from "@/lib/mongodb";
import type {
  Election,
  Campaign,
  ElectionCandidate,
  ElectionVoteTally,
  PrimaryResults,
  State,
  StateDemographics,
  GameState,
  VoteTurnSnapshot,
} from "@/lib/db/types";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { getStateApprovalForElection } from "@/lib/utils/getStateApprovalForElection";
import type {
  StatePartyOrg,
  StateDemographicTurnout,
  StateRegistrationPool,
  ExecutiveEndorsement,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getPartyStrengthWeight, getRegionalExecutiveOfficeKey } from "@/lib/constants/countries";
import {
  isCoattailEligibleRace,
  isOwnRegionalExecutiveRace,
  buildGovModifierByParty,
  resolveGovExecutiveApproval,
} from "./govCoattail";
import { officeKeyForElectionType } from "@/lib/utils/electionLabels";
import { allocateSeats, isMultiSeatElection } from "@/lib/turn/election/seatAllocation";
import { turnVoteWeight, resolveTurnWindow } from "./voteCalculations";
import { distributeVotesByGroupLevelAllocation } from "./voteDistribution";
import { distributeVotesBySwingFlow } from "./voteDistributionSwingFlow";
import { getIncumbentSeatShareByParty } from "./incumbentSeatShare";
import {
  resolveSingleSeatLegislativeIncumbent,
  resolveHouseIncumbentTenures,
} from "./singleSeatIncumbency";
import { getFundsByPartyForElection } from "./fundsByParty";
import { TALLY_WITH_SNAPSHOT_TURNS_ONLY } from "./tallyProjections";
import { planTurnSlice, sameTurnSliceParts } from "./rules/turnSlice";
import { accumulateHuBallots } from "@/lib/countries/hu/rules/accumulateBallots2014";
import { allocateHuListTurnVotes } from "@/lib/countries/hu/rules/listBallots2014";
import {
  accumulateJapanBallots,
  allocateJapanListTurnVotes,
} from "@/lib/countries/jp/rules/shugiinBallotMath";
import {
  isHeadOfGovernmentRace,
  resolvePresidentApproval,
  buildPresidentialModifierByParty,
} from "./presidentialCoattail";
import { computeMedianVoter } from "./medianVoter";
import {
  fetchEnrichedCandidates,
  type CandidateEnrichmentPreload,
  type EnrichmentParty,
} from "./candidateEnrichment";
import type { AccumulateVoteTurnPreload } from "./types";
import { loadPartyGroupFavorability } from "@/lib/governorOffice/address/partyGroupFavorabilityLoader";
import {
  buildGranularElectorateSubstrate,
  campaignContactByBucket,
} from "@/lib/demographics/granularElectorate";
import type { ParticipationSummary } from "@/lib/demographics/v2/rules";
import { eraYearContextFromGameState } from "@/lib/era/context";
import {
  resolveTurnout,
  scalePoolToRegistered,
  capTurnSliceToElectorate,
  capTurnSliceToRemainingElectorate,
} from "./resolvedTurnout";
import { isPrimaryEnded } from "@/lib/elections/phases";
import type { GameTimeContext } from "@/lib/time/gameTime";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import type { RegionDemographics } from "@/lib/db/types/regionDemographics";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import { resolveVotingAgeEligible } from "@/lib/constants/votingAge";
import { loadElectionRegionDemographicsV2 } from "./demographicsV2Preload";
import {
  buildMidtermOppositionModifierByParty,
  isMidtermOppositionBoostEligible,
} from "./midtermOppositionBoost";
import { resolveGoverningPartyIds } from "@/lib/government/governingPartyIds";
import {
  resolveElectionManifestoMultipliers,
  deriveGroupLeans,
} from "@/lib/uk/manifesto/electionManifestoResolver";
import { buildCurrentRegistrationBaseline } from "./electionFormulaFactors";
import {
  castRankedBallots,
  mergeRankedBallots,
  countPrStv,
  validateRankedBallots,
} from "@/lib/turn/election/rules/prStv";

// ─── Accumulate one turn of votes into a tally ───────────────────────────────

/**
 * Per-turn memo for the lookups whose inputs repeat across a turn's elections.
 * Promises, not values, so concurrent callers share one in-flight read.
 */
export interface VoteTurnMemo extends RaceCampaignEffectsMemo {
  presidentByCountry: Map<string, Promise<Awaited<ReturnType<typeof resolvePresidentApproval>>>>;
  govExecutiveByState: Map<
    string,
    Promise<Awaited<ReturnType<typeof resolveGovExecutiveApproval>>>
  >;
  partiesByCountry: Map<string, Promise<EnrichmentParty[]>>;
  partyGroupFavorabilityByCountryTurn: Map<string, Promise<Map<string, number>>>;
  candidatePreload?: CandidateEnrichmentPreload;
  executiveEndorsedCandidateIdsByElection?: Map<string, Set<string>>;
}

export function createVoteTurnMemo(): VoteTurnMemo {
  return {
    presidentByCountry: new Map(),
    govExecutiveByState: new Map(),
    partiesByCountry: new Map(),
    partyGroupFavorabilityByCountryTurn: new Map(),
  };
}

function memoized<T>(
  map: Map<string, Promise<T>> | undefined,
  key: string,
  load: () => Promise<T>
): Promise<T> {
  if (!map) return load();
  let pending = map.get(key);
  if (!pending) {
    pending = load();
    map.set(key, pending);
  }
  return pending;
}

export async function accumulateVoteTurn(
  electionId: ObjectId,
  turnNumber: number,
  now: Date,
  options?: {
    /**
     * When present, the tally update is appended here instead of written, so
     * the caller can flush every race's update in one bulk write (#2695).
     */
    tallyWrites?: AnyBulkWriteOperation<ElectionVoteTally>[];
    approvalMap?: Map<string, number>;
    preload?: AccumulateVoteTurnPreload;
    /** The election document, when the caller already holds it; saves a read per election. */
    election?: Election;
    /** The election's tally, when the caller already loaded it this turn. */
    tally?: ElectionVoteTally;
    /** The election's active candidates, when the caller already loaded them this turn. */
    candidates?: ElectionCandidate[];
    /**
     * "early": the half-hour results tick. Release half of this turn's slice
     * ahead of the turn; the turn itself then releases the other half. Totals,
     * the closing surge and every deadline are unchanged.
     */
    slice?: "early";
  }
): Promise<void> {
  const db = options?.preload?.db ?? (await getDb());
  const memo = options?.preload?.turnMemo;

  const [tally, candidates]: [ElectionVoteTally | null, ElectionCandidate[]] = await Promise.all([
    options?.tally ??
      db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .findOne({ electionId }, { projection: TALLY_WITH_SNAPSHOT_TURNS_ONLY }),
    options?.candidates ??
      db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId, status: "active" })
        .toArray(),
  ]);

  if (!tally || candidates.length === 0) return;
  // Per-turn idempotency: a turn whose later phase stalled (a stuck
  // corporationTurn lock, cleared and re-run) runs this phase again under the
  // SAME turn number. Live turn 460 ran three times on 2026-08-28 and every
  // open general banked three slices of that turn. A tally that already holds
  // this turn's snapshot has already been counted.
  //
  // A turn may be split in two: the half-hour results tick banks an "early"
  // half ahead of the turn, and the turn then banks the "rest". Each half is
  // counted once; a whole or "rest" snapshot means the turn is fully counted.
  const slicePlan = planTurnSlice(
    sameTurnSliceParts(tally.turnSnapshots, turnNumber),
    options?.slice
  );
  if (!slicePlan) return;
  const { slicePart, fraction: sliceFraction } = slicePlan;

  const election =
    options?.election ?? (await db.collection<Election>("elections").findOne({ _id: electionId }));
  if (!election || !election.endTime) return;
  // Ranked ballots split cleanly: each half casts its own first-preference
  // increments, and identical rankings merge by adding weights.
  const isPrStv = tally.countingMethod === "pr_stv";
  if (isPrStv) {
    if (election.countryId !== "IE" || !["dail", "localCouncil"].includes(election.electionType))
      throw new Error("Ranked PR-STV is supported only for Irish Dail and local council races");
    validateRankedBallots(tally.rankedBallots, tally.totalVotes);
  }

  const stateId = election.state as string;
  let state: State | null;
  let demographics: StateDemographics | null;
  let categories: import("@/lib/db/types").DemographicCategory[];
  let statePartyOrgs: StatePartyOrg[];
  let turnoutDoc: StateDemographicTurnout | null;
  let registrationPool: StateRegistrationPool | null = null;
  let preset: string | undefined;
  let eraYear: { year: number | null; startingYear: number | null };
  let regionDemographics: RegionDemographics | null = null;
  let demographicsV2Active = false;
  let votingAge = 18;

  if (options?.preload) {
    state = options.preload.stateMap.get(stateId) ?? null;
    demographics = options.preload.demographicsMap.get(stateId) ?? null;
    categories = options.preload.categories;
    statePartyOrgs = options.preload.statePartyOrgsByState.get(stateId) ?? [];
    turnoutDoc = options.preload.turnoutByState.get(stateId) ?? null;
    registrationPool = options.preload.registrationPoolByState?.get(stateId) ?? null;
    preset = options.preload.preset;
    eraYear = eraYearContextFromGameState({
      currentYear: options.preload.currentYear,
      startingYear: options.preload.startingYear,
      eraSystemEnabled: options.preload.eraSystemEnabled,
    });
    regionDemographics = options.preload.regionDemographicsByState?.get(stateId) ?? null;
    demographicsV2Active =
      options.preload.demographicsV2Countries?.has(election.countryId ?? "US") === true;
    votingAge = options.preload.votingAgeByCountry?.get(election.countryId ?? "US") ?? 18;
  } else {
    const [s, d, c, spo, t, rp, gs] = await Promise.all([
      db.collection<State>("states").findOne({ _id: stateId, countryId: election.countryId }),
      db
        .collection<StateDemographics>("stateDemographics")
        .findOne({ _id: stateId, countryId: election.countryId }),
      db
        .collection<import("@/lib/db/types").DemographicCategory>("demographicCategories")
        .find({})
        .toArray(),
      db
        .collection<StatePartyOrg>("statePartyOrg")
        .find({ stateId, countryId: election.countryId })
        .toArray(),
      db
        .collection<StateDemographicTurnout>("stateDemographicTurnout")
        .findOne({ _id: stateId, countryId: election.countryId }),
      db
        .collection<StateRegistrationPool>("stateRegistrationPool")
        .findOne({ stateId, countryId: election.countryId }),
      db.collection<GameState>("gameState").findOne(
        { _id: "current" },
        {
          projection: {
            preset: 1,
            currentYear: 1,
            currentTurn: 1,
            startingYear: 1,
            eraSystemEnabled: 1,
            votingAgeEligible: 1,
            votingAgeEligibleByCountry: 1,
            resetWorldId: 1,
            resetVersionSeeds: 1,
            demographicsSystemVersion: 1,
          },
        }
      ),
    ]);
    state = s;
    demographics = d;
    categories = c;
    statePartyOrgs = spo;
    turnoutDoc = t;
    registrationPool = rp;
    preset = gs?.preset;
    eraYear = eraYearContextFromGameState(gs);
    demographicsV2Active =
      resetSystemVersionsForCountry(gs, RESET_V2_READY, election.countryId ?? "US").demographics ===
      "v2";
    votingAge = resolveVotingAgeEligible(gs ?? undefined, eraYear.year, election.countryId ?? "US");
    regionDemographics = await loadElectionRegionDemographicsV2({
      db,
      countryId: election.countryId ?? "US",
      stateId,
      gameState: gs,
    });
  }

  if (!state || !demographics) return;

  const partyOrgByParty = new Map(statePartyOrgs.map((po) => [po.partyId, po.organization]));
  // Phase 5a: Reg as persuasion-resistance multiplier in general-election
  // distribution. Rows whose `registration` field is undefined (pre-seed)
  // simply aren't added to the map → `regResistanceMultiplier(undefined)`
  // returns the neutral 1.0× downstream. Rows seeded with a real value
  // contribute the entrenchment tilt per `electionFormulaFactors.ts`.
  const regByParty = new Map<string, number>();
  for (const po of statePartyOrgs) {
    if (typeof po.registration === "number") regByParty.set(po.partyId, po.registration);
  }
  // UK general elections use current Reg as their structural party baseline.
  // Other countries keep the lane disabled so their existing Reg resistance
  // and peel behavior is unchanged. If an old UK world has no current Reg data
  // at all, the helper also disables the lane rather than flooring every party.
  const regBaselineByParty = buildCurrentRegistrationBaseline(statePartyOrgs, election.countryId);

  // Turn-first surge window (drift-immune) with a Date fallback for legacy docs.
  // Keying the closing surge off turn numbers makes the final-turn band coincide
  // with the race's actual last turns instead of a stale `endTime` projection
  // that the drifting game clock no longer matches.
  //
  // Anchor the window at the GENERAL-election start (`primaryEndTurn`), NOT the
  // overall `startTurn`: general votes only accrue after the primary, so spanning
  // the primary period smears the early-vote share across turns that cast no
  // general votes and inflates the final turns to ~66% of the vote (ticket #955).
  // `?? startTurn` preserves prior behavior for races with no primary window.
  const { totalTurns, turnIndex } = resolveTurnWindow({
    startTurn: election.primaryEndTurn ?? election.startTurn,
    endTurn: election.endTurn,
    startTime: election.primaryEndTime ?? election.startTime,
    endTime: election.endTime,
    createdAt: tally.createdAt,
    currentTurn: turnNumber,
    now,
    // The turn that reaches endTurn still counts (timers complete the race
    // AFTER this phase), so the window is inclusive: endTurn - start + 1 slices.
    inclusiveEnd: true,
  });

  // Age-aware electorate (P1b-1b): the vote pool is the live voting-age population
  // (Σ ages ≥ votingAgeEligible), written each turn by the demographic phase, so
  // the electorate tracks kids aging past 18 and deaths removing voters. Falls
  // back to total population on worlds not yet seeded with cohort vectors — vote
  // SHARES are invariant to this basis (the F-4 guarantee), only magnitude differs.
  const electorate = state.votingEligiblePopulation ?? state.population;

  const campaignContact = demographicsV2Active
    ? campaignContactByBucket(turnoutDoc, election.countryId ?? "US")
    : {};
  turnoutDoc = turnoutForElection(turnoutDoc, election) ?? null;
  // GOTV/canvassing/suppression from turnoutDoc overlay the static demographic turnouts.
  const { totalPool: resolvedTotalPool, byGroup: liveTurnouts } = resolveTurnout(
    electorate,
    demographics,
    categories,
    turnoutDoc,
    { preset, year: eraYear.year, startingYear: eraYear.startingYear }
  );

  const turnPool = turnVoteWeight(totalTurns, turnIndex, resolvedTotalPool);

  // Party strength: state government approval times office strength. Scales the vote pool.
  // Approval is centered at 50% (no boost) and swings +/-10% at the 0%/100% extremes
  // via (1 + (approvalDecimal - 0.5) * 0.2), so it cannot dominate the pool.
  const electionCountryId = (election.countryId ?? "US") as CountryId;

  // These three reads are mutually independent: state approval keys off the
  // region, candidate enrichment off `candidates`, party-group favorability off
  // the country + turn. One parallel round-trip instead of three serial ones —
  // this path runs for every active election on every turn.
  //
  // enriched: candidates enriched for group-level competitive allocation.
  // State/Senate/House races put politicalInfluence in reach only, not appeal.
  //
  // partyGroupFavorabilityByKey: Address-sourced per-group appeal boosts for the
  // leader's party. Country-scoped, keyed `${partyId}:${groupId}` for O(1)
  // lookup in the vote-distribution inner loop.
  const preloadedApproval = options?.approvalMap?.get(election.state.toUpperCase());
  const [approvalPct, enriched, partyGroupFavorabilityByKey] = await Promise.all([
    preloadedApproval ?? getStateApprovalForElection(election.state),
    fetchEnrichedCandidates(candidates, {
      countryId: electionCountryId,
      partiesCache: memo?.partiesByCountry,
      preload: memo?.candidatePreload,
      countryConfig: options?.preload?.enrichmentCountryConfigByElection?.get(
        electionId.toString()
      ),
      db: options?.preload?.db,
    }),
    memoized(memo?.partyGroupFavorabilityByCountryTurn, `${electionCountryId}:${turnNumber}`, () =>
      loadPartyGroupFavorability(db, electionCountryId, turnNumber)
    ),
  ]);
  const approvalDecimal = approvalPct / 100;
  // Normalize snap_* → regular for office-strength lookup (snap_commons uses the
  // same party-strength weight as commons — same constituency, same office).
  const officeStrength = getPartyStrengthWeight(
    electionCountryId,
    officeKeyForElectionType(election.electionType as string, electionCountryId)
  );
  const strengthMultiplier = (1 + (approvalDecimal - 0.5) * 0.2) * officeStrength;
  const effectiveTurnPool = turnPool * strengthMultiplier;

  // ── Granular-cell electorate substrate ─────────────────────────────────────
  // The electorate is Layer-1 cells. Same engines, same appeal formula.
  // A null substrate means this state has no census row yet (newly admitted,
  // mid-migration): a data-integrity fallback, not an engine selection.
  let effDemographics = demographics;
  let effCategories = categories;
  let effLiveTurnouts = liveTurnouts;
  let effTotalPool = resolvedTotalPool;
  let effEffectiveTurnPool = effectiveTurnPool;
  let effEnriched = enriched;
  let effPartyGroupFavorabilityByKey = partyGroupFavorabilityByKey;
  let participationSummary: ParticipationSummary | undefined;
  {
    // Seeded snapshot for the legislation lean-drift fold. Preloaded on the
    // batched general path; a single extra read on the standalone path (only
    // ever paid when the flag is on).
    const demographicDefaults =
      options?.preload?.demographicDefaultsByState?.get(stateId) ??
      (options?.preload
        ? null
        : await db
            .collection<StateDemographics>("demographicDefaults")
            .findOne({ _id: stateId, countryId: election.countryId }));
    const substrate = buildGranularElectorateSubstrate({
      campaignRulesVersion: election.campaignRulesVersion,
      currentTurn: turnNumber,
      countryId: electionCountryId,
      stateId,
      preset,
      turnoutDoc,
      statePopulation: electorate,
      demographics,
      categories,
      liveTurnouts,
      enriched,
      partyGroupFavorabilityByKey,
      demographicDefaults,
      year: eraYear.year,
      startingYear: eraYear.startingYear,
      ...(demographicsV2Active && regionDemographics
        ? {
            v2: {
              regionAges: regionDemographics.ages,
              votingAge,
              registeredShare:
                typeof registrationPool?.unregistered === "number" &&
                Number.isFinite(registrationPool.unregistered)
                  ? 1 - Math.max(0, Math.min(100, registrationPool.unregistered)) / 100
                  : 1,
              contactByBucket: campaignContact,
            },
          }
        : {}),
    });
    if (substrate) {
      effDemographics = substrate.demographics;
      effCategories = substrate.categories;
      effLiveTurnouts = substrate.liveTurnouts;
      effTotalPool = substrate.totalPool;
      effEffectiveTurnPool =
        turnVoteWeight(totalTurns, turnIndex, substrate.totalPool) * strengthMultiplier;
      effEnriched = substrate.enriched;
      effPartyGroupFavorabilityByKey =
        substrate.partyGroupFavorabilityByKey ?? partyGroupFavorabilityByKey;
      participationSummary = substrate.participationSummary;
    } else if (stateId === electionCountryId) {
      effEnriched = await applyNationalAds(
        db,
        electionCountryId,
        turnNumber,
        enriched,
        Object.keys(demographics.groups),
        options?.preload?.stateMap,
        election.campaignRulesVersion ?? 0
      );
    }
  }
  // ── Physical electorate ceiling ────────────────────────────────────────────
  // The resolved turnout pool can exceed the people who exist: the granular
  // substrate aggregates turnout over overlapping demographic dimensions, and
  // on era worlds the 1956 general certified 333% of the voting-eligible
  // population (the audited engine defect behind 378.8M ballots from 204.9M
  // residents). A state cannot cast more ballots than it has eligible voters,
  // so the per-turn slice is rescaled to the electorate's share. Vote SHARES
  // are invariant to the pool basis (the F-4 guarantee above), so this changes
  // reported magnitudes only.
  //
  // The cap scales ONLY the released turn slice, deliberately leaving
  // `effTotalPool` as the truthful normalisation base. The earlier form also
  // reassigned `effTotalPool = electorate`, and that made the cap a no-op on
  // actual ballots: the distributors normalise each group's contribution by
  // `totalPool` before multiplying by the slice, so shrinking both cancels to
  // the ballot — the same algebra that made the registered-voter gate below a
  // live-verified no-op on its first placement.
  // Half-hour split: each half carries half of the turn's slice, before the
  // electorate caps, so the caps still bound the whole turn.
  effEffectiveTurnPool *= sliceFraction;
  effEffectiveTurnPool = capTurnSliceToElectorate(effEffectiveTurnPool, effTotalPool, electorate);
  // ── Registered-voter gate ──────────────────────────────────────────────────
  // The unregistered slice of the registration pool cannot cast a ballot, so
  // this turn's released pool shrinks to the registered share. Same F-4 note
  // as the ceiling above: shares, seats and winners are invariant — only
  // reported magnitudes and turnout percentages change.
  //
  // Scale ONLY the turn pool, never `effTotalPool`: the distributors normalise
  // each group as `contribution / totalPool` and then multiply by the turn
  // pool, so scaling both cancels to the ballot and the gate would be a no-op
  // (verified live before this comment existed).
  if (!participationSummary) {
    effEffectiveTurnPool = scalePoolToRegistered(
      effEffectiveTurnPool,
      registrationPool?.unregistered
    );
  }
  // ── Cumulative ceiling ────────────────────────────────────────────────────
  // The strength multiplier above sits outside both caps, so the closing
  // surge could still carry the race past the registered electorate. Ballots
  // already on the board (active candidates only, matching `newTotals`) plus
  // this slice may never exceed it. Bound Duma ballots also retain votes cast
  // before a nominee withdrew.
  const isBgOrdinary =
    preset === "1991-default" &&
    election.countryId === "BG" &&
    election.electionType === "nationalAssembly" &&
    election.cycle >= 1;
  const isHuBound =
    isHu1991AssemblyCampaign(election) ||
    (preset === "1991-default" &&
      election.countryId === "HU" &&
      (election.hungarianModernByElection != null || election.hungarianModernAssembly != null));
  const isJapanMixed =
    preset === "1991-default" &&
    election.countryId === "JP" &&
    (election.electionType === "shugiin" || election.electionType === "snap_shugiin") &&
    election.japanShugiinRules?.ruleVersion === "mixed-1994-v1";
  const isBgFounding =
    election.countryId === "BG" &&
    election.electionType === "nationalAssembly" &&
    election.bulgarianFoundingRound?.ruleVersion === "parallel-1990-v1";
  const huRegisteredVoters =
    election.bulgarianFoundingRound?.registeredVoters ??
    election.hungarianModernByElection?.registeredVoters ??
    election.hungarianModernAssembly?.registeredVoters ??
    election.hungarianAssemblyRound?.registeredVoters ??
    Math.max(
      Math.floor(scalePoolToRegistered(electorate, registrationPool?.unregistered)),
      Object.values(tally.totalVotes).reduce((sum, votes) => sum + votes, 0)
    );
  const isBoundDuma =
    election.countryId === "RU" &&
    election.electionType === "dumaDeputy" &&
    election.russianDumaRound != null;
  const isBoundCouncil =
    election.countryId === "RU" &&
    election.electionType === "federationCouncilMember" &&
    election.russianCouncilRound != null;
  // Bespoke national ballot systems split like the rest: every per-slice
  // clamp below is against the cumulative register (so two halves clamp to
  // the same total as one slice), and their per-district, list and ledger
  // maps add each half's increments.
  const alreadyCast = isPrStv
    ? Object.values(tally.totalVotes).reduce((sum, votes) => sum + votes, 0)
    : isBoundCouncil
      ? (tally.russianCouncilBallot?.validBallots ?? 0)
      : isBoundDuma
        ? Object.values(tally.totalVotes).reduce((sum, count) => sum + count, 0) +
          (tally.russianDumaBallot?.againstAllVotes ?? 0)
        : isHuBound || isBgFounding
          ? Object.values(tally.totalVotes).reduce((sum, count) => sum + count, 0)
          : candidates.reduce((sum, c) => sum + (tally.totalVotes[c._id.toString()] ?? 0), 0);
  effEffectiveTurnPool = capTurnSliceToRemainingElectorate(
    effEffectiveTurnPool,
    alreadyCast,
    isHuBound || isBgFounding
      ? huRegisteredVoters!
      : scalePoolToRegistered(electorate, registrationPool?.unregistered)
  );
  // Determine if we are in the general election phase (after primary end).
  // Turn-first (drift-immune, freezes on pause); falls back to the Date for
  // elections not yet backfilled. `now` is the game-time of this turn, so it
  // doubles as effectiveNow for the fallback path.
  const phaseGameTime: GameTimeContext = {
    currentTurn: turnNumber,
    lastTurnProcessed: now,
    isActive: true,
    pausedAt: null,
    effectiveNow: now,
    // Inert here — isPrimaryEnded only reads effectiveNow for the Date fallback.
    startingYear: STARTING_YEAR,
  };
  const isGeneralElection = isPrimaryEnded(election, turnNumber, phaseGameTime);
  // NPP weight penalty only applies in the general phase (not primaries, which use score-based handicap).
  const hasPlayerInRace = isGeneralElection && enriched.some((c) => !c.isNPP);
  // General elections use the §7.3.2 swing-flow engine. Primaries keep the
  // legacy allocator; §7.3.2 is general-only and primaryResolution.ts has its
  // own formula.
  // Per-candidate margin vs the legacy engine is pinned at +/-10pt by
  // voteDistributionSwingFlowDiff.test.ts. Race-family coverage is in
  // voteDistributionSwingFlowFamilies.test.ts.
  const distributeFn = isGeneralElection
    ? distributeVotesBySwingFlow
    : distributeVotesByGroupLevelAllocation;

  const isOwnHeadOfGovernmentRace = isHeadOfGovernmentRace(
    election.electionType as string,
    electionCountryId
  );
  // Coattail gating uses the parties actually fielding candidates in THIS
  // race (matches the display path in enrichElection.ts), not the state's
  // StatePartyOrg rows: a party can hold an org row without a candidate in
  // the race (engine applied a coattail the display never showed) or field
  // a candidate without an org row (coattail wrongly suppressed).
  const partyIdsInRace = new Set(enriched.map((ec) => ec.party));
  const regionalExecOfficeType = getRegionalExecutiveOfficeKey(electionCountryId);
  const wantsMidtermOppositionBoost =
    isGeneralElection && isMidtermOppositionBoostEligible(election);

  // Every gate below is pure (derived from `election`, `candidates` and
  // `enriched`, all already resolved), so the five driver lookups they guard
  // are decided up front and issued as ONE parallel round-trip. They were five
  // sequential awaits, paid on every active election every turn.
  //
  // The two governor-approval consumers share a single fetch: the coattail gate
  // and the own-race gate are mutually exclusive by construction
  // (`isCoattailEligibleRace` returns false exactly when the race IS the
  // regional executive's own seat), so at most one consumes it — but resolving
  // it once keeps that invariant from costing a second round-trip if the
  // predicates ever widen.
  const wantsGovCoattail = isCoattailEligibleRace({
    isGeneralElection,
    electionType: election.electionType as string,
    regionalExecOfficeType,
    isOwnHeadOfGovernmentRace,
  });
  const wantsOwnExecIncumbency =
    Boolean(stateId) &&
    isOwnRegionalExecutiveRace({
      isGeneralElection,
      electionType: election.electionType as string,
      regionalExecOfficeType,
      hasState: Boolean(stateId),
    });
  const runningIdentities = new Set(
    candidates
      .map((c) => (c.characterId ?? c.nppId)?.toString())
      .filter((id): id is string => Boolean(id))
  );

  const [
    incumbentSeatShareByParty,
    fundsByParty,
    president,
    govExecutive,
    legInc,
    governingPartyIds,
  ] = await Promise.all([
    // A1 — share-weighted incumbency. Prior-cycle vote-share for this seat so
    // the swing-flow engine's incumbency driver can scale lift / drag by how
    // much each party was defending. Empty Map when no prior cycle exists
    // (driver returns 0, matching open-seat semantics). General elections
    // only — primaries don't route through the swing-flow engine. Races with
    // an officeholder incumbency path (US Senate, and single-winner executives
    // such as governor / president) are excluded by `usesSeatShareIncumbency`
    // inside the resolver: they use the flat-shield / approval-curve paths
    // below, never the raw-vote-share fallback, which would price a meaningless
    // margin for a single winner — and on a VACANT seat would hand out an
    // incumbency bonus with no incumbent behind it.
    isGeneralElection
      ? (options?.preload?.incumbentSeatShareByElection?.get(electionId.toString()) ??
        getIncumbentSeatShareByParty(election, db))
      : undefined,
    // Money driver. Aggregate per-party recent spend across all campaigns
    // in the race (carried stock plus this turn's accumulator). Reads
    // spend persistence, not treasury balance; the `campaignSpendReset`
    // phase folds the accumulator into the decaying stock after this
    // accumulator runs.
    isGeneralElection
      ? options?.preload?.fundsByPartyByElection
        ? (options.preload.fundsByPartyByElection.get(electionId.toString()) ??
          new Map<string, number>())
        : getFundsByPartyForElection(electionId, db)
      : undefined,
    // Presidential coattail: the sitting President's party gets an
    // approval-driven nominal-share nudge in every down-ballot general
    // nationwide (US only). Excludes the presidential race itself. A vacant
    // presidency or a party not present in this race no-ops to neutral.
    isGeneralElection && !isOwnHeadOfGovernmentRace
      ? memoized(memo?.presidentByCountry, electionCountryId, () =>
          resolvePresidentApproval(db, electionCountryId)
        )
      : undefined,
    // Governor coattail (§7.3.2 govModifier) — the sitting regional
    // executive's party gets a small nominal-share bonus in its own state's
    // down-ballot generals, and the own-race path feeds the same approval
    // into the incumbency driver.
    wantsGovCoattail || wantsOwnExecIncumbency
      ? memoized(memo?.govExecutiveByState, `${electionCountryId}:${stateId}`, () =>
          resolveGovExecutiveApproval(db, electionCountryId, stateId)
        )
      : undefined,
    // Single-seat legislative own-race (US Senate): flat incumbency shield
    // keyed to the sitting senator, decaying with tenure to a +1 floor. Null
    // (skipped) for open seats / incumbent not running / non-senate races.
    isGeneralElection
      ? options?.preload?.legislativeIncumbentByElection
        ? options.preload.legislativeIncumbentByElection.get(electionId.toString())
        : resolveSingleSeatLegislativeIncumbent(election, runningIdentities, db)
      : undefined,
    wantsMidtermOppositionBoost
      ? (options?.preload?.governingPartyIdsByCountry?.get(electionCountryId) ??
        resolveGoverningPartyIds(db, electionCountryId))
      : undefined,
  ]);

  const presidentialModifierByParty =
    isGeneralElection && !isOwnHeadOfGovernmentRace
      ? buildPresidentialModifierByParty(president ?? null, partyIdsInRace)
      : undefined;

  // A stale `electedOfficials.party` value that doesn't match a party actually
  // in the race silently no-ops (empty map → neutral 1.0×).
  const govModifierByParty = wantsGovCoattail
    ? buildGovModifierByParty(govExecutive ?? null, partyIdsInRace)
    : undefined;

  const midtermOppositionModifierByParty = wantsMidtermOppositionBoost
    ? buildMidtermOppositionModifierByParty(governingPartyIds ?? new Set(), partyIdsInRace)
    : undefined;

  // Approval-modulated incumbency (own regional-executive race only). The
  // governor coattail deliberately skips the executive's own seat; this fills
  // that gap by feeding the sitting governor's approval into the incumbency
  // driver — a shield when popular, a drag when unpopular. The presidential
  // race is excluded: that engine already folds approval into a dedicated
  // `strengthMultiplier`, so routing it here would double-count.
  const incumbentPartyId =
    wantsOwnExecIncumbency && govExecutive ? govExecutive.partyId : undefined;
  const incumbentApproval =
    wantsOwnExecIncumbency && govExecutive ? govExecutive.approval : undefined;

  const legislativeIncumbentPartyId = legInc ? legInc.incumbentPartyId : undefined;
  const legislativeIncumbentTenureTerms = legInc ? legInc.tenureTerms : undefined;

  // M3 — per-state median voter for the policy-distance driver.
  // Computed from already-loaded demographics + categories so no extra
  // DB hit. GOTV / suppression effects shift the median via liveTurnouts.
  const medianVoter = isGeneralElection
    ? computeMedianVoter(effDemographics, effCategories, effLiveTurnouts)
    : undefined;

  // Multi-seat legislative own-race (US House): per-candidate consecutive-term
  // fatigue — a state's House delegation can have several simultaneous
  // incumbents at once (one per party's returning nominee), so this is a map
  // rather than the Senate's single flat-shield party+terms pair. See
  // `resolveHouseIncumbentTenures`'s doc comment in singleSeatIncumbency.ts
  // for why the House needs this different shape.
  let houseIncumbentTenureTermsByCandidateId: Map<string, number> | undefined;
  if (isGeneralElection && election.electionType === "house") {
    if (options?.preload?.houseIncumbentTenuresByElection) {
      houseIncumbentTenureTermsByCandidateId =
        options.preload.houseIncumbentTenuresByElection.get(electionId.toString()) ?? new Map();
    } else {
      const runningIdentityToCandidateId = new Map<string, string>();
      for (const c of candidates) {
        const identity = (c.characterId ?? c.nppId)?.toString();
        if (identity) runningIdentityToCandidateId.set(identity, c._id.toString());
      }
      houseIncumbentTenureTermsByCandidateId = await resolveHouseIncumbentTenures(
        election,
        runningIdentityToCandidateId,
        db
      );
    }
  }

  // UK manifesto policy-popularity map (epic #856). Off by default: the
  // resolver short-circuits to undefined unless UK_MANIFESTO_VOTE_EFFECT=1 and
  // this is a UK general election with locked manifestos — so no DB read and no
  // behaviour change in prod until the coefficient is worldsim-calibrated.
  const manifestoMultipliers = await resolveElectionManifestoMultipliers(db, {
    countryId: electionCountryId,
    electionId,
    isGeneralElection,
    groups: deriveGroupLeans(effCategories, effDemographics),
  });

  const { votesPerCandidate, sharesPct } = distributeFn(
    effEnriched,
    effEffectiveTurnPool,
    effTotalPool,
    electorate,
    effDemographics,
    effCategories,
    partyOrgByParty,
    {
      includeInfluenceInAppeal: false,
      useNationalInfluenceForReach: false,
      votingSystem: state.votingSystem ?? "fptp",
      isGeneralElection,
      countryId: electionCountryId,
      currentStateId: stateId,
      parentRegionId: state.parentRegionId,
      manifestoMultipliers,
      liveTurnouts: effLiveTurnouts, // Pass resolved turnout to vote distribution
      hasPlayerInRace,
      partyGroupFavorabilityByKey: effPartyGroupFavorabilityByKey,
      // Phase 5a — entrenched-Reg multiplier; consumed only in general
      // elections. Empty / partial maps fall through to the neutral 1.0×
      // per `regResistanceMultiplier`'s undefined branch.
      regByParty,
      // Current-registration baseline. Undefined disables the lane.
      regBaselineByParty,
      // Governor coattail (§7.3.2 govModifier) — in-state down-ballot only.
      govModifierByParty,
      // A1 — per-party prior seat-share for the incumbency driver.
      incumbentSeatShareByParty,
      // Approval-scaled directional incumbency for the executive's own race.
      incumbentPartyId,
      incumbentApproval,
      // Flat single-seat legislative (US Senate) incumbency shield.
      legislativeIncumbentPartyId,
      legislativeIncumbentTenureTerms,
      // Per-candidate multi-seat legislative (US House) tenure fatigue.
      houseIncumbentTenureTermsByCandidateId,
      // A2 — per-party spend-this-turn for the money driver.
      fundsByParty,
      // Presidential coattail — sitting President's nominal-share multiplier.
      presidentialModifierByParty,
      midtermOppositionModifierByParty,
      // M3 — per-state median voter for the policy-distance driver.
      medianVoter,
    }
  );

  // Executive-leader endorsements: when the sitting head of government has
  // endorsed a candidate in this race, apply a +1.5% multiplier to that
  // candidate's per-turn vote increment. Mirrors the governor→presidential
  // bonus in presidentialElectionEngine. Cross-race bleed isn't a concern
  // because each `Election` is state-scoped (one race per AZ House district,
  // one race for AZ Senate Class 1, etc.) so the multiplier only touches
  // votes in this specific race's tally.
  const executiveEndorsedCandidateIds =
    memo?.executiveEndorsedCandidateIdsByElection?.get(electionId.toString()) ??
    new Set(
      (
        await db
          .collection<ExecutiveEndorsement>("executiveEndorsements")
          .find({ electionId, isActive: true })
          .project<{ candidateId: ObjectId }>({ candidateId: 1 })
          .toArray()
      ).map((e) => e.candidateId.toString())
    );
  const EXECUTIVE_ENDORSEMENT_VOTE_BONUS = 1.015;

  // Campaign Ground Game and field offices in this race's region. Keyed by
  // the campaign's candidate (character or NPP id), not the filing row.
  const campaignKeyByCandidateId = new Map(
    candidates.map((c) => [c._id.toString(), campaignStrengthLookupKey(c)])
  );
  const campaignMultiplier = await loadRaceCampaignMultiplier(db, {
    electionId,
    countryId: electionCountryId,
    regionId: stateId,
    currentTurn: turnNumber,
    isSwingRegion: Math.abs(getStateLean(state, stateId)) < 0.5,
    memo,
  });

  // Start with active increments. Bound Duma ballots then restore counted
  // withdrawals, which remain part of participation and certification.
  const activeCandidateIds = new Set(enriched.map((ec) => ec.candidateId));
  let newTotals: Record<string, number> = isPrStv ? { ...tally.totalVotes } : {};
  const increments: Record<string, number> = {};
  for (const ec of enriched) {
    const raw = votesPerCandidate[ec.candidateId] ?? 0;
    const campaignKey = campaignKeyByCandidateId.get(ec.candidateId);
    const multiplier =
      (executiveEndorsedCandidateIds.has(ec.candidateId) ? EXECUTIVE_ENDORSEMENT_VOTE_BONUS : 1.0) *
      (campaignMultiplier && campaignKey ? campaignMultiplier(campaignKey) : 1.0);
    increments[ec.candidateId] = Math.round(raw * multiplier);
    newTotals[ec.candidateId] =
      (tally.totalVotes[ec.candidateId] ?? 0) + increments[ec.candidateId];
  }

  const rankedBallots = isPrStv
    ? mergeRankedBallots(tally.rankedBallots!, castRankedBallots(enriched, increments))
    : undefined;
  if (isPrStv) validateRankedBallots(rankedBallots, newTotals);

  if (election.countryId === "RU" && election.russianPresidentialRound) {
    const campaigns = await db
      .collection<Campaign>("campaigns")
      .find({ electionId }, { projection: { candidateId: 1, campaignStrength: 1 } })
      .toArray();
    const strengths = new Map(
      campaigns.map((campaign) => [campaign.candidateId.toString(), campaign.campaignStrength ?? 0])
    );
    const rawVotes = Object.fromEntries(
      enriched.map((candidate) => [
        candidate.candidateId,
        newTotals[candidate.candidateId] - (tally.totalVotes[candidate.candidateId] ?? 0),
      ])
    );
    const campaignStrength = Object.fromEntries(
      candidates.map((candidate) => [
        candidate._id.toString(),
        strengths.get(campaignStrengthLookupKey(candidate)) ?? 0,
      ])
    );
    const increments = russianPresidentialVoteIncrement({
      registeredVoters: election.russianPresidentialRound.registeredVoters,
      priorVotes: tally.totalVotes,
      rawVotes,
      campaignStrength,
    });
    for (const candidate of enriched)
      newTotals[candidate.candidateId] =
        (tally.totalVotes[candidate.candidateId] ?? 0) + (increments[candidate.candidateId] ?? 0);
  }

  if (isBgOrdinary || isHuBound || isBgFounding || isJapanMixed)
    for (const [id, votes] of Object.entries(tally.totalVotes)) {
      if (!activeCandidateIds.has(id)) newTotals[id] = votes;
    }
  if (isBoundDuma) {
    newTotals = russianDumaVoteTotals({
      registeredVoters: election.russianDumaRound!.registeredVoters,
      againstAllVotes: tally.russianDumaBallot?.againstAllVotes,
      priorVotes: tally.totalVotes,
      rawVotes: Object.fromEntries(
        enriched.map((candidate) => [
          candidate.candidateId,
          newTotals[candidate.candidateId] - (tally.totalVotes[candidate.candidateId] ?? 0),
        ])
      ),
    });
  }

  if (isHuBound || isBgFounding) {
    // The shared vote-ledger arithmetic preserves historical cast marks and
    // clamps only the new slice to the frozen registered electorate.
    newTotals = russianDumaVoteTotals({
      registeredVoters: huRegisteredVoters!,
      priorVotes: tally.totalVotes,
      rawVotes: Object.fromEntries(
        enriched.map((candidate) => [
          candidate.candidateId,
          newTotals[candidate.candidateId] - (tally.totalVotes[candidate.candidateId] ?? 0),
        ])
      ),
    });
  }
  const filingByCandidateId = new Map(
    candidates.map((candidate) => [candidate._id.toString(), candidate])
  );
  const statePartyOrgByParty = new Map(statePartyOrgs.map((row) => [row.partyId, row]));
  const huBallots =
    electionCountryId === "HU" &&
    election.electionType === "nationalAssembly" &&
    election.hungarianModernAssembly?.ruleVersion === "mixed-2011-v1" &&
    preset === "1991-default"
      ? accumulateHuBallots(
          stateId,
          enriched.map((ec) => {
            const filing = filingByCandidateId.get(ec.candidateId);
            return {
              candidateId: ec.candidateId,
              partyId: ec.party,
              constituencyId: filing?.constituencyId,
              isNPP: filing?.isNPP,
              votes: Math.max(
                0,
                newTotals[ec.candidateId] - (tally.totalVotes[ec.candidateId] ?? 0)
              ),
            };
          }),
          allocateHuListTurnVotes(
            Math.round(effEffectiveTurnPool),
            [...new Set(enriched.map((ec) => ec.party))]
              .filter((partyId) => partyId !== "independent")
              .map((partyId) => {
                const org = statePartyOrgByParty.get(partyId);
                return {
                  partyId,
                  registration: org?.registration,
                  organization: org?.organization,
                };
              })
          ),
          tally.huConstituencyVotes,
          tally.huListVotes
        )
      : null;
  const japanMixedBallots =
    electionCountryId === "JP" &&
    (election.electionType === "shugiin" || election.electionType === "snap_shugiin") &&
    election.japanShugiinRules?.ruleVersion === "mixed-1994-v1" &&
    preset === "1991-default"
      ? accumulateJapanBallots({
          regionId: stateId,
          candidates: enriched.map((candidate) => {
            const filing = filingByCandidateId.get(candidate.candidateId);
            return {
              candidateId: candidate.candidateId,
              partyId: candidate.party,
              constituencyId: filing?.constituencyId,
              isNPP: filing?.isNPP,
              votes: Math.max(
                0,
                newTotals[candidate.candidateId] - (tally.totalVotes[candidate.candidateId] ?? 0)
              ),
            };
          }),
          listVoteIncrements: allocateJapanListTurnVotes(
            Math.round(effEffectiveTurnPool),
            [...new Set(enriched.map((candidate) => candidate.party))]
              .filter((partyId) => partyId !== "independent")
              .map((partyId) => {
                const org = statePartyOrgByParty.get(partyId);
                return {
                  partyId,
                  registration: org?.registration,
                  organization: org?.organization,
                };
              })
          ),
          previousDistricts: tally.japanShugiinConstituencyVotes,
          previousLists: tally.japanShugiinListVotes,
        })
      : null;
  let councilTotals: ReturnType<typeof russianCouncilVoteTotals> | null = null;
  if (isBoundCouncil) {
    const rawVotes = Object.fromEntries(
      enriched.map((candidate) => [
        candidate.candidateId,
        newTotals[candidate.candidateId] - (tally.totalVotes[candidate.candidateId] ?? 0),
      ])
    );
    const nominationById = new Map(
      candidates.map((candidate) => [
        candidate._id.toHexString(),
        candidate.russianCouncilNomination,
      ])
    );
    councilTotals = russianCouncilVoteTotals({
      registeredVoters: election.russianCouncilRound!.registeredVoters,
      priorVotes: tally.totalVotes,
      ledger: tally.russianCouncilBallot,
      rawVotes,
      rawAgainstAllVotes: Object.values(rawVotes).every((count) => count === 0)
        ? Math.max(0, Math.floor(effEffectiveTurnPool))
        : 0,
      nominees: enriched.map((candidate) => {
        const nomination = nominationById.get(candidate.candidateId);
        if (!nomination) throw new Error("Council voting needs each nominee's frozen registration");
        return {
          id: candidate.candidateId,
          registrationOrder: nomination.registrationOrder,
          economicLean: candidate.charEP,
          socialLean: candidate.charSP,
          favorability: candidate.favorability,
        };
      }),
    });
    newTotals = councilTotals.votes;
  }

  // Project seats with the same allocator used by final resolution.
  const seatsEstimate: Record<string, number> | undefined = (() => {
    if (isBgOrdinary || isHuBound || isBgFounding || isJapanMixed) return undefined;
    if (councilTotals) {
      const result = resolveRussianCouncilBallot({
        ...councilTotals.ballot,
        invalidated: tally.russianCouncilBallot?.invalidated,
      });
      const winners =
        result.outcome === "elected" && result.winnerIds.every((id) => activeCandidateIds.has(id))
          ? new Set(result.winnerIds)
          : new Set<string>();
      return Object.fromEntries(
        enriched.map((row) => [row.candidateId, winners.has(row.candidateId) ? 1 : 0])
      );
    }
    const electionType = election.electionType as string;
    const totalSeats = election.totalSeats as number | undefined;
    if (!totalSeats || !isMultiSeatElection(electionType, totalSeats)) return undefined;
    if (isPrStv) {
      if (rankedBallots!.length === 0) return undefined;
      return countPrStv(
        enriched.map((c) => c.candidateId),
        totalSeats,
        rankedBallots!
      ).seats;
    }
    const totalVotesCast = enriched.reduce((s, ec) => s + (newTotals[ec.candidateId] ?? 0), 0);
    if (totalVotesCast === 0) return undefined;
    const ranked = enriched
      .map((candidate) => ({
        id: candidate.candidateId,
        votes: newTotals[candidate.candidateId] ?? 0,
        party: candidate.party,
        isNPP: candidate.isNPP,
      }))
      .sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id));
    const stateId = election.state;
    return allocateSeats(
      electionType,
      stateId,
      totalSeats,
      ranked,
      totalVotesCast,
      stateId ? { [stateId]: totalSeats } : {},
      undefined,
      stateId ? { [stateId]: totalSeats } : {},
      election.countryId ?? "US",
      election.allocationMethod
    ).seatsEstimate;
  })();

  const nativeRussianTotal = councilTotals
    ? councilTotals.ledger.validBallots
    : (election.countryId === "RU" && election.russianPresidentialRound) || isBoundDuma
      ? Object.values(newTotals).reduce((sum, count) => sum + count, 0) +
        (isBoundDuma ? (tally.russianDumaBallot?.againstAllVotes ?? 0) : 0)
      : null;
  const snapshot: VoteTurnSnapshot = {
    turn: turnNumber,
    ...(slicePart ? { slicePart } : {}),
    recordedAt: now,
    cumulativeVotes: { ...newTotals },
    sharesPct:
      nativeRussianTotal == null
        ? sharesPct
        : Object.fromEntries(
            Object.entries(newTotals).map(([id, count]) => [
              id,
              nativeRussianTotal ? (count / nativeRussianTotal) * 100 : 0,
            ])
          ),
    ...(seatsEstimate ? { seatsEstimate } : {}),
    ...(participationSummary ? { participation: participationSummary } : {}),
    ...(councilTotals
      ? {
          russianCouncilBallot: {
            registeredVoters: councilTotals.ledger.registeredVoters,
            validBallots: councilTotals.ledger.validBallots,
            againstAllVotes: councilTotals.ledger.againstAllVotes,
          },
        }
      : {}),
  };

  // Sync nominee labels, retaining counted Duma withdrawals for certification.
  const cleanedNames = { ...tally.candidateNames };
  const cleanedParties = { ...tally.candidateParties };
  for (const key of Object.keys(tally.totalVotes)) {
    if (
      !activeCandidateIds.has(key) &&
      !isBoundDuma &&
      !isBoundCouncil &&
      !isBgOrdinary &&
      !isHuBound &&
      !isJapanMixed &&
      !isBgFounding
    ) {
      delete cleanedNames[key];
      delete cleanedParties[key];
    }
  }
  for (const ec of enriched) {
    if (!cleanedNames[ec.candidateId]) {
      cleanedNames[ec.candidateId] = ec.characterName;
      cleanedParties[ec.candidateId] = ec.party;
    }
  }

  const tallyUpdate = {
    ...(isBgOrdinary || isHuBound || isBgFounding || isJapanMixed
      ? { $unset: { seatsEstimate: "" as const } }
      : {}),
    $set: {
      ...(isBgOrdinary ? { bgOrdinaryBallot: true as const } : {}),
      ...(isHuBound ? { hungarianAssemblyBallot: true as const } : {}),
      ...(isBgFounding ? { bulgarianFoundingBallot: true as const } : {}),
      totalVotes: newTotals,
      ...(huBallots
        ? {
            huConstituencyVotes: huBallots.constituencyVotes,
            huListVotes: huBallots.listVotes,
            huDistrictSlate: huBallots.districtSlate,
          }
        : {}),
      ...(japanMixedBallots
        ? {
            japanShugiinConstituencyVotes: japanMixedBallots.constituencyVotes,
            japanShugiinListVotes: japanMixedBallots.listVotes,
          }
        : {}),
      candidateNames: cleanedNames,
      candidateParties: cleanedParties,
      ...(election.allocationMethod === "sntv"
        ? {
            candidateIsNPP: Object.fromEntries(
              enriched.map((ec) => [ec.candidateId, Boolean(ec.isNPP)])
            ),
          }
        : {}),
      ...(councilTotals
        ? { russianCouncilBallot: { ...tally.russianCouncilBallot, ...councilTotals.ledger } }
        : {}),
      ...(isBoundDuma
        ? {
            russianDumaBallot: {
              ...tally.russianDumaBallot,
              againstAllVotes: tally.russianDumaBallot?.againstAllVotes ?? 0,
            },
          }
        : {}),
      ...(seatsEstimate ? { seatsEstimate } : {}),
      ...(isPrStv
        ? { rankedBallots, rankedPreferenceModel: "same_party_then_policy_distance_v1" as const }
        : {}),
      updatedAt: now,
    },
    $push: { turnSnapshots: snapshot } as never,
  };
  // STV totals and original ballots must commit together, and a concurrent
  // replay must not overwrite another turn's ballot receipt. The rest of a
  // split turn lands only beside that turn's early half.
  const tallyFilter = isPrStv
    ? slicePart === "rest"
      ? {
          electionId,
          finalized: false,
          turnSnapshots: {
            $size: tally.turnSnapshots.length,
            $not: { $elemMatch: { turn: turnNumber, slicePart: { $ne: "early" } } },
          },
        }
      : {
          electionId,
          finalized: false,
          "turnSnapshots.turn": { $ne: turnNumber },
          turnSnapshots: { $size: tally.turnSnapshots.length },
        }
    : { electionId };
  if (options?.tallyWrites) {
    options.tallyWrites.push({ updateOne: { filter: tallyFilter, update: tallyUpdate } });
    return;
  }
  const write = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .updateOne(tallyFilter, tallyUpdate);
  if (isPrStv && write.matchedCount !== 1)
    throw new Error("PR-STV accumulation lost its tally revision; retry from persisted ballots");
}

// ─── Initialize a blank tally for an election ────────────────────────────────

export async function initElectionVoteTally(
  electionId: ObjectId,
  candidates: ElectionCandidate[],
  state: string,
  primaryResults?: PrimaryResults,
  options?: { countingMethod: "pr_stv" }
): Promise<void> {
  const db = await getDb();
  const now = new Date();

  const totalVotes: Record<string, number> = {};
  const candidateNames: Record<string, string> = {};
  const candidateParties: Record<string, string> = {};

  for (const c of candidates) {
    totalVotes[c._id.toString()] = 0;
    candidateNames[c._id.toString()] = c.characterName;
    candidateParties[c._id.toString()] = c.party;
  }

  // Primary ballots accrued during the primary window live on the same doc,
  // and this init runs replaceOne — carry them across or the general-phase
  // re-init silently erases the primary's entire count.
  const existing = await db.collection<ElectionVoteTally>("electionVoteTallies").findOne(
    { electionId },
    {
      projection: {
        primaryVotes: 1,
        hungarianAssemblyBallot: 1,
        bulgarianFoundingBallot: 1,
        countingMethod: 1,
        rankedBallots: 1,
        finalized: 1,
        updatedAt: 1,
        totalVotes: 1,
        "turnSnapshots.turn": 1,
      },
    }
  );
  const countingMethod = options?.countingMethod ?? existing?.countingMethod;
  if (countingMethod === "pr_stv") {
    if (
      existing?.finalized ||
      existing?.rankedBallots?.length ||
      existing?.turnSnapshots?.length ||
      Object.values(existing?.totalVotes ?? {}).some((votes) => votes > 0)
    )
      throw new Error("Cannot reinitialize a PR-STV tally after ballots were cast");
    const election = await db.collection<Election>("elections").findOne({ _id: electionId });
    if (election?.countryId !== "IE" || !["dail", "localCouncil"].includes(election.electionType))
      throw new Error("Ranked PR-STV is supported only for Irish Dail and local council races");
  }

  const doc: ElectionVoteTally = {
    // Preserve the matched doc's _id: legacy tallies carry an auto-generated
    // ObjectId, and replaceOne rejects a replacement whose _id differs from
    // the matched document's (immutable-field MongoServerError).
    _id: existing?._id ?? electionId,
    electionId,
    state,
    totalVotes,
    ...(countingMethod ? { countingMethod, rankedBallots: [] } : {}),
    candidateNames,
    candidateParties,
    turnSnapshots: [],
    finalized: false,
    ...(primaryResults && { primaryResults }),
    ...(existing?.primaryVotes && { primaryVotes: existing.primaryVotes }),
    ...(existing?.hungarianAssemblyBallot && { hungarianAssemblyBallot: true }),
    ...(existing?.bulgarianFoundingBallot && { bulgarianFoundingBallot: true }),
    createdAt: now,
    updatedAt: now,
  };

  if (countingMethod === "pr_stv") {
    if (!existing) {
      // A concurrent initializer can create or accrue the tally while this
      // call validates the race. Never replace the document it produced.
      await db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .updateOne({ electionId }, { $setOnInsert: doc }, { upsert: true });
      return;
    }
    const replaced = await db.collection<ElectionVoteTally>("electionVoteTallies").replaceOne(
      {
        electionId,
        finalized: false,
        turnSnapshots: { $size: 0 },
        updatedAt: existing.updatedAt,
      },
      doc
    );
    if (replaced.matchedCount !== 1)
      throw new Error("Cannot reinitialize a PR-STV tally after its revision changed");
    return;
  }
  await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .replaceOne({ electionId }, doc, { upsert: true });
}
