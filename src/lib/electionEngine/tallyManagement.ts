/**
 * Election vote tally accumulation and initialization.
 */

import { getDb } from "@/lib/mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PrimaryResults,
  State,
  StateDemographics,
  VoteTurnSnapshot,
} from "@/lib/db/types";
import { ObjectId } from "mongodb";
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
import { MULTI_SEAT_TYPES, officeKeyForElectionType } from "@/lib/utils/electionLabels";
import {
  applyMajoritarianBonus,
  getMajoritarianBonus,
  getMultiSeatMinShare,
} from "@/lib/turn/election/seatAllocation";
import { rankPartiesByOrganization } from "@/lib/turn/election/commonsOrgRanking";
import { turnVoteWeight, resolveTurnWindow } from "./voteCalculations";
import { distributeVotesByGroupLevelAllocation } from "./voteDistribution";
import { distributeVotesBySwingFlow } from "./voteDistributionSwingFlow";
import { getIncumbentSeatShareByParty } from "./incumbentSeatShare";
import {
  resolveSingleSeatLegislativeIncumbent,
  isSingleSeatLegislativeRace,
  resolveHouseIncumbentTenures,
} from "./singleSeatIncumbency";
import { getFundsByPartyForElection } from "./fundsByParty";
import {
  isHeadOfGovernmentRace,
  resolvePresidentApproval,
  buildPresidentialModifierByParty,
} from "./presidentialCoattail";
import { computeMedianVoter } from "./medianVoter";
import { fetchEnrichedCandidates } from "./candidateEnrichment";
import type { AccumulateVoteTurnPreload } from "./types";
import { loadPartyGroupFavorability } from "@/lib/governorOffice/address/partyGroupFavorabilityLoader";
import { buildGranularElectorateSubstrate } from "@/lib/demographics/granularElectorate";
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
import {
  buildMidtermOppositionModifierByParty,
  isMidtermOppositionBoostEligible,
} from "./midtermOppositionBoost";
import { resolveGoverningPartyIds } from "@/lib/government/governingPartyIds";
import {
  resolveElectionManifestoMultipliers,
  deriveGroupLeans,
} from "@/lib/uk/manifesto/electionManifestoResolver";

// ─── Accumulate one turn of votes into a tally ───────────────────────────────

export async function accumulateVoteTurn(
  electionId: ObjectId,
  turnNumber: number,
  now: Date,
  options?: { approvalMap?: Map<string, number>; preload?: AccumulateVoteTurnPreload }
): Promise<void> {
  const db = await getDb();

  const [tally, candidates] = await Promise.all([
    db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ electionId }),
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
  if (tally.turnSnapshots?.some((s) => s.turn === turnNumber)) return;

  const election = await db.collection<Election>("elections").findOne({ _id: electionId });
  if (!election || !election.endTime) return;

  const stateId = election.state as string;
  let state: State | null;
  let demographics: StateDemographics | null;
  let categories: import("@/lib/db/types").DemographicCategory[];
  let statePartyOrgs: StatePartyOrg[];
  let turnoutDoc: StateDemographicTurnout | null;
  let registrationPool: StateRegistrationPool | null = null;
  let preset: string | undefined;
  let currentYear: number | undefined;
  let eraYear: { year: number | null; startingYear: number | null };

  if (options?.preload) {
    state = options.preload.stateMap.get(stateId) ?? null;
    demographics = options.preload.demographicsMap.get(stateId) ?? null;
    categories = options.preload.categories;
    statePartyOrgs = options.preload.statePartyOrgsByState.get(stateId) ?? [];
    turnoutDoc = options.preload.turnoutByState.get(stateId) ?? null;
    registrationPool = options.preload.registrationPoolByState?.get(stateId) ?? null;
    preset = options.preload.preset;
    currentYear = options.preload.currentYear;
    eraYear = eraYearContextFromGameState({
      currentYear: options.preload.currentYear,
      startingYear: options.preload.startingYear,
      eraSystemEnabled: options.preload.eraSystemEnabled,
    });
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
    ]);
    state = s;
    demographics = d;
    categories = c;
    statePartyOrgs = spo;
    turnoutDoc = t;
    registrationPool = rp;
    preset = gs?.preset;
    currentYear = gs?.currentYear;
    eraYear = eraYearContextFromGameState(gs);
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
  // Seeded party-baseline share (0-100) for `regBaselineMultiplier`. Only
  // written by seeds that author regional partisan baselines (UK era polling
  // via ukStatePartyOrgCalculations). Absent everywhere else → empty map →
  // exactly 1.0× downstream (byte-identical for worlds without the field;
  // never double-counts the US `registration` resistance/peel lane).
  const regShareByParty = new Map<string, number>();
  for (const po of statePartyOrgs) {
    if (typeof po.registrationShare === "number") {
      regShareByParty.set(po.partyId, po.registrationShare);
    }
  }

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
    fetchEnrichedCandidates(candidates, { countryId: electionCountryId }),
    loadPartyGroupFavorability(db, electionCountryId, turnNumber),
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
  effEffectiveTurnPool = scalePoolToRegistered(
    effEffectiveTurnPool,
    registrationPool?.unregistered
  );
  // ── Cumulative ceiling ────────────────────────────────────────────────────
  // The strength multiplier above sits outside both caps, so the closing
  // surge could still carry the race past the registered electorate. Ballots
  // already on the board (active candidates only, matching `newTotals`) plus
  // this slice may never exceed it.
  const alreadyCast = candidates.reduce(
    (sum, c) => sum + (tally.totalVotes[c._id.toString()] ?? 0),
    0
  );
  effEffectiveTurnPool = capTurnSliceToRemainingElectorate(
    effEffectiveTurnPool,
    alreadyCast,
    scalePoolToRegistered(electorate, registrationPool?.unregistered)
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
  // own formula. The true below is hardcoded: accumulateVoteTurn does not
  // accept a useSwingFlowModel option.
  //
  // Per-candidate margin vs the legacy engine is pinned at +/-10pt by
  // voteDistributionSwingFlowDiff.test.ts. Race-family coverage is in
  // voteDistributionSwingFlowFamilies.test.ts.
  const useSwingFlowModel = true;
  const distributeFn =
    isGeneralElection && useSwingFlowModel
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
    // only — primaries don't route through the swing-flow engine. Single-seat
    // legislative races (US Senate) use the dedicated flat-shield path below,
    // not the raw-vote-share fallback (which would produce a meaningless
    // margin-scaled value for a single winner).
    isGeneralElection && !isSingleSeatLegislativeRace(election)
      ? getIncumbentSeatShareByParty(election, db)
      : undefined,
    // Money driver. Aggregate per-party recent spend across all campaigns
    // in the race (carried stock plus this turn's accumulator). Reads
    // spend persistence, not treasury balance; the `campaignSpendReset`
    // phase folds the accumulator into the decaying stock after this
    // accumulator runs.
    isGeneralElection ? getFundsByPartyForElection(electionId, db) : undefined,
    // Presidential coattail: the sitting President's party gets an
    // approval-driven nominal-share nudge in every down-ballot general
    // nationwide (US only). Excludes the presidential race itself. A vacant
    // presidency or a party not present in this race no-ops to neutral.
    isGeneralElection && !isOwnHeadOfGovernmentRace
      ? resolvePresidentApproval(db, electionCountryId)
      : undefined,
    // Governor coattail (§7.3.2 govModifier) — the sitting regional
    // executive's party gets a small nominal-share bonus in its own state's
    // down-ballot generals, and the own-race path feeds the same approval
    // into the incumbency driver.
    wantsGovCoattail || wantsOwnExecIncumbency
      ? resolveGovExecutiveApproval(db, electionCountryId, stateId)
      : undefined,
    // Single-seat legislative own-race (US Senate): flat incumbency shield
    // keyed to the sitting senator, decaying with tenure to a +1 floor. Null
    // (skipped) for open seats / incumbent not running / non-senate races.
    isGeneralElection
      ? resolveSingleSeatLegislativeIncumbent(election, runningIdentities, db)
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
      // Seeded party-baseline share — 1.0× wherever the field was never
      // seeded (see regBaselineMultiplier's compatibility contract).
      regShareByParty,
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
      useSwingFlowModel,
    }
  );

  // Executive-leader endorsements: when the sitting head of government has
  // endorsed a candidate in this race, apply a +1.5% multiplier to that
  // candidate's per-turn vote increment. Mirrors the governor→presidential
  // bonus in presidentialElectionEngine. Cross-race bleed isn't a concern
  // because each `Election` is state-scoped (one race per AZ House district,
  // one race for AZ Senate Class 1, etc.) so the multiplier only touches
  // votes in this specific race's tally.
  const executiveEndorsements = await db
    .collection<ExecutiveEndorsement>("executiveEndorsements")
    .find({ electionId, isActive: true })
    .project<{ candidateId: ObjectId }>({ candidateId: 1 })
    .toArray();
  const executiveEndorsedCandidateIds = new Set(
    executiveEndorsements.map((e) => e.candidateId.toString())
  );
  const EXECUTIVE_ENDORSEMENT_VOTE_BONUS = 1.015;

  // Build new totals using ONLY active candidates — withdrawn candidates'
  // historical votes are excluded so vote share and seat projections are correct.
  const activeCandidateIds = new Set(enriched.map((ec) => ec.candidateId));
  const newTotals: Record<string, number> = {};
  for (const ec of enriched) {
    const raw = votesPerCandidate[ec.candidateId] ?? 0;
    const multiplier = executiveEndorsedCandidateIds.has(ec.candidateId)
      ? EXECUTIVE_ENDORSEMENT_VOTE_BONUS
      : 1.0;
    newTotals[ec.candidateId] =
      (tally.totalVotes[ec.candidateId] ?? 0) + Math.round(raw * multiplier);
  }

  // For house/stateSenate races, compute per-candidate seat estimates
  // Uses largest-remainder method (Hamilton method) to ensure total seats = totalSeats exactly
  // Applies minimum vote share threshold to match election resolution logic
  const seatsEstimate: Record<string, number> | undefined = (() => {
    const electionType = election.electionType as string;
    const totalSeats = election.totalSeats as number | undefined;
    if (!totalSeats || !MULTI_SEAT_TYPES.has(electionType)) return undefined;
    // Only count active candidates' votes for seat allocation
    const totalVotesCast = enriched.reduce((s, ec) => s + (newTotals[ec.candidateId] ?? 0), 0);
    if (totalVotesCast === 0) return undefined;

    // Filter to candidates whose PARTY aggregate share meets the minimum
    // threshold (mirrors allocateSeats). Per-candidate thresholds punished
    // parties that split their vote across multiple candidates, and the old
    // "re-admit everyone when eligible < min(seats, candidates)" fallback let
    // sub-1% candidates collect largest-remainder seats in any race with more
    // seats than candidates (e.g. 12 candidates vs 27-90 UK Commons seats).
    const minShare = getMultiSeatMinShare(electionType, {
      majoritarian: getMajoritarianBonus(electionType, currentYear) !== undefined,
    });
    const groupKey = (ec: (typeof enriched)[number]) =>
      ec.party && ec.party !== "independent" ? `party:${ec.party}` : `cand:${ec.candidateId}`;
    const votesByGroup = new Map<string, number>();
    for (const ec of enriched) {
      const k = groupKey(ec);
      votesByGroup.set(k, (votesByGroup.get(k) ?? 0) + (newTotals[ec.candidateId] ?? 0));
    }
    const eligible = enriched.filter(
      (ec) => (votesByGroup.get(groupKey(ec)) ?? 0) / totalVotesCast >= minShare
    );

    // Degenerate fallback ONLY when nobody clears the threshold: fill from the
    // top vote-getters in ranked order. Sub-threshold candidates are never
    // re-admitted alongside eligible ones.
    const pool =
      eligible.length > 0
        ? eligible
        : [...enriched]
            .sort((a, b) => (newTotals[b.candidateId] ?? 0) - (newTotals[a.candidateId] ?? 0))
            .slice(0, Math.min(totalSeats, enriched.length));
    const poolVotes = pool.reduce((s, ec) => s + (newTotals[ec.candidateId] ?? 0), 0);
    if (poolVotes === 0) return undefined;

    // Initialize all candidates to 0 seats
    const seats: Record<string, number> = {};
    for (const ec of enriched) seats[ec.candidateId] = 0;

    // FPTP winner's bonus (#3244): mirror the resolver's cube-law re-split of
    // the top-two party groups so live seat projections match what resolution
    // will actually seat. Gated on the CURRENT in-game year exactly like the
    // resolver — undefined (proportional, byte-identical estimate) once the
    // world's clock reaches 1999, or when no year is available.
    const baseBonus = getMajoritarianBonus(electionType, currentYear);
    // Ticket #1032: the boost belongs to the two best-organized parties in
    // the state; statePartyOrgs is already loaded for this state above.
    const majoritarianBonus = baseBonus
      ? { ...baseBonus, orgRanking: rankPartiesByOrganization(statePartyOrgs) }
      : undefined;
    const effectiveVotes =
      majoritarianBonus && pool.length > 1
        ? applyMajoritarianBonus(
            pool.map((ec) => ({
              id: ec.candidateId,
              votes: newTotals[ec.candidateId] ?? 0,
              group: groupKey(ec),
            })),
            majoritarianBonus
          )
        : undefined;

    // Calculate proportional seats with remainders for pool candidates
    const allocations = pool.map((ec) => {
      const votes = effectiveVotes?.get(ec.candidateId) ?? newTotals[ec.candidateId] ?? 0;
      const exactSeats = (votes / poolVotes) * totalSeats;
      return {
        candidateId: ec.candidateId,
        floor: Math.floor(exactSeats),
        remainder: exactSeats - Math.floor(exactSeats),
      };
    });

    // Give everyone their floor allocation first
    let allocated = 0;
    for (const a of allocations) {
      seats[a.candidateId] = a.floor;
      allocated += a.floor;
    }

    // Distribute remaining seats to candidates with largest remainders
    const remaining = totalSeats - allocated;
    if (remaining > 0) {
      const sorted = [...allocations].sort((a, b) => b.remainder - a.remainder);
      for (let i = 0; i < remaining && i < sorted.length; i++) {
        seats[sorted[i].candidateId]++;
      }
    }

    return seats;
  })();

  const snapshot: VoteTurnSnapshot = {
    turn: turnNumber,
    recordedAt: now,
    cumulativeVotes: { ...newTotals },
    sharesPct,
    ...(seatsEstimate ? { seatsEstimate } : {}),
  };

  // Sync candidateNames/candidateParties: remove withdrawn, add any who joined after tally init
  const cleanedNames = { ...tally.candidateNames };
  const cleanedParties = { ...tally.candidateParties };
  for (const key of Object.keys(tally.totalVotes)) {
    if (!activeCandidateIds.has(key)) {
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

  await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
    { electionId },
    {
      $set: {
        totalVotes: newTotals,
        candidateNames: cleanedNames,
        candidateParties: cleanedParties,
        ...(seatsEstimate ? { seatsEstimate } : {}),
        updatedAt: now,
      },
      $push: { turnSnapshots: snapshot } as never,
    }
  );
}

// ─── Initialize a blank tally for an election ────────────────────────────────

export async function initElectionVoteTally(
  electionId: ObjectId,
  candidates: ElectionCandidate[],
  state: string,
  primaryResults?: PrimaryResults
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
  const existing = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId }, { projection: { primaryVotes: 1 } });

  const doc: ElectionVoteTally = {
    // Preserve the matched doc's _id: legacy tallies carry an auto-generated
    // ObjectId, and replaceOne rejects a replacement whose _id differs from
    // the matched document's (immutable-field MongoServerError).
    _id: existing?._id ?? electionId,
    electionId,
    state,
    totalVotes,
    candidateNames,
    candidateParties,
    turnSnapshots: [],
    finalized: false,
    ...(primaryResults && { primaryResults }),
    ...(existing?.primaryVotes && { primaryVotes: existing.primaryVotes }),
    createdAt: now,
    updatedAt: now,
  };

  await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .replaceOne({ electionId }, doc, { upsert: true });
}
