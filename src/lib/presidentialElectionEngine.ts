/**
 * Presidential election vote accumulation and tally initialization.
 * Per-state (and ME/NE district) vote accumulation; Electoral College resolution.
 */

import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  Campaign,
  DemographicCategory,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PrimaryResults,
  State,
  StateDemographics,
  VoteTurnSnapshot,
} from "@/lib/db/types";
import { ELECTORAL_VOTE_UNITS, UNIT_LEAN } from "@/lib/constants/states";
import { loadApportionment } from "@/lib/elections/apportionment";
import {
  fetchEnrichedCandidates,
  turnVoteWeight,
  resolveTurnWindow,
  PARTY_STRENGTH_BY_OFFICE,
} from "@/lib/electionEngine";
import { distributeVotesBySwingFlow } from "@/lib/electionEngine/voteDistributionSwingFlow";
import { PRESIDENTIAL_SPOILER_RATE } from "@/lib/electionEngine/constants";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";
import { getAllStateApprovalsForElection } from "@/lib/utils/getStateApprovalForElection";
import { resolvePresidentApproval } from "@/lib/electionEngine/presidentialCoattail";
import { partyTenureFatiguePenalty } from "@/lib/electionEngine/partyTenureFatigue";
import {
  applyReferendumShift,
  computeEconomicReferendum,
  type ReferendumResult,
} from "@/lib/electionEngine/economicReferendum";
import { loadReferendumInputs } from "@/lib/elections/referendumInputs";
import { getPresidentialConsecutiveTerms } from "@/lib/turn/election/presidentialTenureLedger";
import type { GameState } from "@/lib/db/types/gameState";
import { BASE_APPROVAL } from "@/lib/utils/governmentApproval";
import { getStateLean } from "@/lib/utils/demographics";
import type { StatePartyOrg, StateDemographicTurnout, GovernorEndorsement } from "@/lib/db/types";
import { resolveTurnout } from "@/lib/electionEngine/resolvedTurnout";
import { campaignStrengthVoteMultiplier } from "@/lib/campaigns/campaignStrength";
import { getGroundGameSwingBonus, getGroundGameGotvBonus } from "@/lib/campaigns/opsEffects";
import { loadPartyGroupFavorability } from "@/lib/governorOffice/address/partyGroupFavorabilityLoader";
import { buildGranularElectorateSubstrate } from "@/lib/demographics/granularElectorate";
import { eraYearContextFromGameState } from "@/lib/era/context";
import { loadRegionalBonusMapsWithLookup } from "@/lib/primaryRegionalBonusLoader";
import { campaignStrengthLookupKey } from "@/lib/campaigns/suspendEndorseLifecycle";

/** Vote multiplier applied in a state when its sitting governor has endorsed
 *  the candidate. Half of the VP-home-state effect — a real in-state lift
 *  without overwhelming demographics + lean + ground game contributions.
 *  Multiple co-state endorsements (rare) stack multiplicatively at the same
 *  rate, which is acceptable since governors are single-seat. */
const GOVERNOR_ENDORSEMENT_STATE_BONUS = 1.015;

/** Independent candidate vote penalty (0.3 = 70% reduction). */
export const INDEPENDENT_VOTE_PENALTY = 0.3;

/** Per-point lean coefficient for full states (#3243 — was 0.25). */
export const STATE_LEAN_STRENGTH = 0.1;
/** Per-point lean coefficient for ME/NE congressional districts (their
 *  UNIT_LEAN values span only ±0.25, so the effect is already ≤ ±7.5%). */
export const DISTRICT_LEAN_STRENGTH = 0.3;
/** Clamp band for the lean multiplier — at most a 1.5:1 two-party swing. */
export const LEAN_MULT_MIN = 0.8;
export const LEAN_MULT_MAX = 1.2;

/**
 * State/district partisan-lean vote multiplier for the presidential general.
 *
 * #3243: state lean is already priced into appeal — the swing-flow engine
 * computes support from the same substrate leans that produce the state's
 * display lean, so this multiplier double-counts partisanship. It is kept
 * (winner-take-all state geography is real: a deep-red state should not read
 * as a national tossup when a large field fragments the vote) but demoted to
 * tiebreaker scale. The old shape (coefficient 0.25, floor 0.5, no ceiling)
 * turned a lean −2 state into a Dem×1.5 / Rep×0.5 = 3:1 hammer; the new shape
 * (coefficient 0.10, clamped to [0.8, 1.2]) caps the same state at 1.5:1.
 * House/Senate races apply no such multiplier at all.
 *
 * @param lean display lean of the unit (≈ −2.5..+2.5 for US states)
 * @param epSign sign of the candidate's economic/social position (+1 right, −1 left)
 * @param isDistrict true for ME/NE congressional-district units (UNIT_LEAN)
 */
export function leanVoteMultiplier(lean: number, epSign: number, isDistrict: boolean): number {
  const strength = isDistrict ? DISTRICT_LEAN_STRENGTH : STATE_LEAN_STRENGTH;
  const leanMult = 1 + lean * epSign * strength;
  return Math.min(LEAN_MULT_MAX, Math.max(LEAN_MULT_MIN, leanMult));
}

const PRESIDENTIAL_FALLBACK_STATES: Record<string, State> = {
  DC: {
    _id: "DC",
    countryId: "US",
    regionType: "state",
    name: "District of Columbia",
    population: 689_545,
    gdp: 0,
    houseDistricts: 0,
    stateSenateSeats: 0,
    region: "Northeast",
  },
};

/**
 * Get the state ID to use for demographics for a given electoral unit.
 * Regular states: use stateId. ME/NE districts: use parent state (ME or NE).
 */
function getDemographicsStateId(unit: { unitId: string; stateId: string }): string {
  return unit.stateId;
}

function resolveElectoralUnitState(
  stateMap: Map<string, State>,
  stateId: string
): State | undefined {
  return stateMap.get(stateId) ?? PRESIDENTIAL_FALLBACK_STATES[stateId];
}

/**
 * Initialize a presidential election vote tally with per-unit structure.
 */
export async function initPresidentVoteTally(
  electionId: ObjectId,
  candidates: ElectionCandidate[],
  primaryResults?: PrimaryResults,
  dbOverride?: Db
): Promise<void> {
  const db = dbOverride ?? (await getDb());
  const now = new Date();

  // Unit keys must match where the accumulator for this election's country
  // writes (#2829). US apportionment units are US-only — seeding them into a
  // non-US tally leaves 56 phantom zero-vote unit keys alongside the real
  // regional keys.
  const election = await db
    .collection<Election>("elections")
    .findOne({ _id: electionId }, { projection: { countryId: 1 } });
  const countryId = election?.countryId ?? "US";

  let unitIds: string[];
  if (countryId === COUNTRY_CONFIGS.US.id) {
    // Live (census-updated) EV units; equals the seed until a census reapportions
    // (P1d-2). Must match the unit set accumulatePresidentVoteTurn uses.
    const gsDoc = await db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" });
    const { electoralVoteUnits } = await loadApportionment(db, gsDoc?.preset);
    unitIds = electoralVoteUnits.map((u) => u.unitId);
  } else {
    // Non-US presidential races accumulate per region/zone keyed by the
    // country's own `states` doc ids (see accumulateNGPresidentVoteTurn).
    const countryStates = await db
      .collection<State>("states")
      .find({ countryId }, { projection: { _id: 1 } })
      .toArray();
    unitIds = countryStates.map((s) => s._id as string);
  }

  const totalVotes: Record<string, number> = {};
  const totalVotesByUnit: Record<string, Record<string, number>> = {};
  const candidateNames: Record<string, string> = {};
  const candidateParties: Record<string, string> = {};

  for (const c of candidates) {
    const cid = c._id.toString();
    totalVotes[cid] = 0;
    candidateNames[cid] = c.characterName;
    candidateParties[cid] = c.party;
  }

  for (const unitId of unitIds) {
    totalVotesByUnit[unitId] = {};
    for (const c of candidates) {
      totalVotesByUnit[unitId][c._id.toString()] = 0;
    }
  }

  // Preserve primary-phase fields across the primary→general tally reset so
  // the historical primary map and delegate tally remain visible after the
  // general phase begins. Only the general-phase counters are zeroed.
  const existing = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId });

  const doc: ElectionVoteTally = {
    _id: electionId,
    electionId,
    state: "US",
    totalVotes,
    candidateNames,
    candidateParties,
    turnSnapshots: [],
    finalized: false,
    totalVotesByUnit,
    unitTurnSnapshots: {},
    ...(primaryResults && { primaryResults }),
    ...(existing?.primaryStateVotes && { primaryStateVotes: existing.primaryStateVotes }),
    ...(existing?.primaryDelegates && { primaryDelegates: existing.primaryDelegates }),
    ...(existing?.primaryDelegatesByState && {
      primaryDelegatesByState: existing.primaryDelegatesByState,
    }),
    ...(existing?.primaryAllocationByState && {
      primaryAllocationByState: existing.primaryAllocationByState,
    }),
    ...(existing?.primaryWaveHistory && { primaryWaveHistory: existing.primaryWaveHistory }),
    // Keep the wave counter aligned with the preserved history. If the
    // existing tally already advanced the atomic counter, preserve it here
    // too so the "counter == history.length" invariant survives the
    // primary→general re-init and the divergence-warning in
    // `runPrimaryStaggerWaveIfDue` never fires on a clean transition.
    ...(existing?.primaryStaggerWavesRun !== undefined && {
      primaryStaggerWavesRun: existing.primaryStaggerWavesRun,
    }),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .replaceOne({ electionId }, doc, { upsert: true });
}

/**
 * Accumulate one turn of presidential votes across all electoral units.
 */
/**
 * Calibration hooks for {@link accumulatePresidentVoteTurn}. Production passes
 * nothing and behaves exactly as before; the replay harness
 * (`scripts/sim/incumbency-approval-replay.ts`) uses these to run the real
 * engine twice over identical inputs and diff the result.
 */
export interface PresidentVoteTurnCalibration {
  /** Compute everything, persist nothing, and return the payload. */
  dryRun?: boolean;
  /**
   * Which approval feeds the directional incumbency driver.
   *   "national" — legacy: one stored national approval, identical in every unit.
   *   "state"    — the approval of the state the votes are being cast in.
   * Defaults to "national" so production is unchanged.
   */
  incumbentApprovalSource?: "national" | "state";
  /** Override `INCUMBENCY_APPROVAL_PIVOT` for this run. */
  incumbencyApprovalPivot?: number;
  /**
   * Force a candidate's favorability to a given value, keyed by candidateId,
   * applied after enrichment. Used to measure what a coordinated
   * support/attack campaign is actually worth in votes, since favorability is
   * a straight multiplier on the whole vote via `approvalScalar`.
   */
  favorabilityOverride?: Record<string, number>;
  /**
   * Scale on the economic-referendum share shift. 1 = production, 0 disables
   * the channel entirely. Used by `scripts/sim/economic-referendum-replay.ts`
   * to A/B the channel against the identical live inputs.
   */
  referendumScale?: number;
}

/** What a dry run hands back: enough to score winners and measure share deltas. */
export interface PresidentVoteTurnDryRun {
  totalVotes: Record<string, number>;
  totalVotesByUnit: Record<string, Record<string, number>>;
  candidateIds: string[];
  /** The referendum reading used this turn, when the channel was active. */
  referendum?: ReferendumResult;
}

export async function accumulatePresidentVoteTurn(
  electionId: ObjectId,
  turnNumber: number,
  now: Date,
  calibration?: PresidentVoteTurnCalibration
): Promise<PresidentVoteTurnDryRun | void> {
  const db = await getDb();

  const [tally, candidates, election] = await Promise.all([
    db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ electionId }),
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId, status: "active" })
      .toArray(),
    db.collection<Election>("elections").findOne({ _id: electionId }),
  ]);

  if (!tally || !tally.totalVotesByUnit || candidates.length === 0 || !election?.endTime) return;

  const uniqueStateIds = [...new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId))];

  // Live (census-updated) EV units for per-unit accumulation; must match the unit
  // set initPresidentVoteTally bucketed (P1d-2). The state SET above is invariant
  // under census (no states added/removed), so it stays on the static constant.
  const gsDoc = await db
    .collection<{
      _id: string;
      preset?: string;
      currentYear?: number;
      currentTurn?: number;
      startingYear?: number;
      eraSystemEnabled?: boolean;
      presidentialTenureByCountry?: GameState["presidentialTenureByCountry"];
    }>("gameState")
    .findOne({ _id: "current" });
  const { electoralVoteUnits } = await loadApportionment(db, gsDoc?.preset);
  // Granular-cell electorate engine (fail-closed): swap the archetype
  // substrate for Layer-1 cells in the per-state distribution loop below.
  // Live era clock (null while `eraSystemEnabled` is off — legacy behavior).
  const eraYear = eraYearContextFromGameState(gsDoc);

  const [categories, states, demographics, statePartyOrgs, turnoutDocs, approvalMap] =
    await Promise.all([
      loadDemographicCategories(db),
      db
        .collection<State>("states")
        .find({ _id: { $in: uniqueStateIds } })
        .toArray(),
      db
        .collection<StateDemographics>("stateDemographics")
        .find({ _id: { $in: uniqueStateIds } })
        .toArray(),
      db
        .collection<StatePartyOrg>("statePartyOrg")
        .find({ stateId: { $in: uniqueStateIds } })
        .toArray(),
      db
        .collection<StateDemographicTurnout>("stateDemographicTurnout")
        .find({ _id: { $in: uniqueStateIds } })
        .toArray(),
      getAllStateApprovalsForElection(),
    ]);

  // Seeded snapshots for the granular substrate's legislation lean-drift fold.
  const demographicDefaultsByState = new Map(
    (
      await db
        .collection<StateDemographics>("demographicDefaults")
        .find({ _id: { $in: uniqueStateIds } })
        .toArray()
    ).map((d) => [d._id as string, d])
  );

  const stateMap = new Map(states.map((s) => [s._id as string, s]));
  const demographicsMap = new Map(demographics.map((d) => [d._id as string, d]));
  const turnoutMap = new Map(turnoutDocs.map((t) => [t._id as string, t]));
  const statePartyOrgsByState = new Map<string, StatePartyOrg[]>();
  for (const po of statePartyOrgs) {
    const list = statePartyOrgsByState.get(po.stateId) ?? [];
    list.push(po);
    statePartyOrgsByState.set(po.stateId, list);
  }

  // Turn-first surge window (drift-immune) with a Date fallback for legacy docs.
  // Anchor at the GENERAL-election start (`primaryEndTurn`), NOT the overall
  // `startTurn`: presidential general votes only accrue after the primary, so
  // spanning the primary period smears the early-vote share across turns that
  // cast no general votes and inflates the final turns to ~66% of the vote
  // (ticket #955). `?? startTurn` preserves behavior for races with no primary.
  const { totalTurns, turnIndex } = resolveTurnWindow({
    startTurn: election.primaryEndTurn ?? election.startTurn,
    endTurn: election.endTurn,
    startTime: election.primaryEndTime ?? election.startTime,
    endTime: election.endTime,
    createdAt: tally.createdAt,
    currentTurn: turnNumber,
    now,
  });

  // Scope the party lookup by countryId so sequentialId collisions across
  // countries cannot invert candidate party positions.
  const enriched = await fetchEnrichedCandidates(candidates, {
    includePartyPositions: true,
    countryId: (election.countryId ?? "US") as CountryId,
  });

  // Calibration-only: force favorability post-enrichment so a harness can price
  // a coordinated support/attack campaign. No-op in production.
  if (calibration?.favorabilityOverride) {
    for (const ec of enriched) {
      const forced = calibration.favorabilityOverride[ec.candidateId];
      if (typeof forced === "number") ec.favorability = forced;
    }
  }

  // Fetch campaign ground-game bonuses. Strategic Operations v2 splits this into
  // two channels: `swing` (+% in swing states, from starter + Field Offices) and
  // `gotv` (+% in ALL areas, from the Get-Out-The-Vote branch). Legacy rows fall
  // back to the old `groundGameLevel * 0.03` swing-only bonus (gotv = 0).
  const campaigns = await db.collection<Campaign>("campaigns").find({ electionId }).toArray();
  const groundGameByCandidate = new Map<string, { swing: number; gotv: number }>();
  for (const c of campaigns) {
    groundGameByCandidate.set(c.candidateId.toString(), {
      swing: getGroundGameSwingBonus(c.groundGameTree, c.groundGameLevel ?? 0),
      gotv: getGroundGameGotvBonus(c.groundGameTree),
    });
  }

  const campaignStrengthByCandidate = new Map<string, number>();
  for (const c of campaigns) {
    campaignStrengthByCandidate.set(c.candidateId.toString(), c.campaignStrength ?? 0);
  }
  const campaignStrengthKeyByElectionCandidateId = new Map(
    candidates.map((c) => [c._id.toString(), campaignStrengthLookupKey(c)])
  );
  const suspendedElectionCandidateIds = new Set(
    candidates.filter((c) => c.campaignSuspended).map((c) => c._id.toString())
  );

  // VP home-state map: each nominee's running mate's home state grants a +3% vote
  // bump in that state, modeling the real-world "VP home-state effect" (a running
  // mate gives measurable boost in the state they represent). Null-safe when no VP set.
  const vpCharIds = candidates
    .map((c) => c.runningMateId)
    .filter((id): id is ObjectId => id != null);
  const vpChars =
    vpCharIds.length > 0
      ? await db
          .collection<import("@/lib/db/types").Character>("characters")
          .find({ _id: { $in: vpCharIds } }, { projection: { _id: 1, homeState: 1 } })
          .toArray()
      : [];
  const vpHomeStateByVpId = new Map<string, string>();
  for (const vp of vpChars) {
    if (vp.homeState) vpHomeStateByVpId.set(vp._id.toString(), vp.homeState);
  }
  const vpHomeStateByCandidate = new Map<string, string>();
  for (const c of candidates) {
    if (c.runningMateId) {
      const hs = vpHomeStateByVpId.get(c.runningMateId.toString());
      if (hs) vpHomeStateByCandidate.set(c._id.toString(), hs);
    }
  }

  // Regional bases — carry primary-cycle state-org investment + home-state
  // bump into the general at the reduced general-path caps. Helper queries
  // characterStateOrg for the candidates and looks up character/NPP home
  // states; the engine selects MAX_STATE_ORG_BONUS_GENERAL /
  // HOME_STATE_BONUS_GENERAL via the `isGeneralElection: true` option set
  // in the per-state distribution call below.
  const regionalBonuses = await loadRegionalBonusMapsWithLookup(db, candidates);

  // Endorsement org boost: when a suspended candidate has endorsed another,
  // 25% of the suspender's per-state character org adds to the endorsed
  // candidate's effective org for vote distribution. No org is debited — it's
  // a passive multiplier from the suspender's existing ground organization.
  const suspendToEndorse = new Map<string, string>();
  for (const c of candidates) {
    if (c.campaignSuspended && c.endorsedElectionCandidateId) {
      suspendToEndorse.set(c._id.toString(), c.endorsedElectionCandidateId.toString());
    }
  }
  if (suspendToEndorse.size > 0) {
    for (const [, stateMap] of regionalBonuses.stateOrgByStateAndCandidate) {
      for (const [suspenderId, endorsedId] of suspendToEndorse) {
        const suspenderOrg = stateMap.get(suspenderId);
        if (suspenderOrg && suspenderOrg > 0) {
          const boost = Math.floor(suspenderOrg * 0.25);
          if (boost > 0) {
            stateMap.set(endorsedId, (stateMap.get(endorsedId) ?? 0) + boost);
          }
        }
      }
    }
  }

  // Governor endorsements for this presidential election, indexed by the
  // endorsing governor's state. Each entry grants the candidate a state-
  // scoped vote bonus only in that state — see GOVERNOR_ENDORSEMENT_STATE_BONUS.
  // Cross-state bleed is prevented at campaignTurn (the national action boost
  // is suppressed there for presidential); this is the in-state half of the
  // contract.
  const governorEndorsements = await db
    .collection<GovernorEndorsement>("governorEndorsements")
    .find({ electionId, isActive: true })
    .toArray();
  const governorEndorsedCandidatesByState = new Map<string, Set<string>>();
  for (const e of governorEndorsements) {
    const stateKey = (e.stateId ?? "").toUpperCase();
    if (!stateKey) continue;
    const candidateId = e.candidateId.toString();
    const set = governorEndorsedCandidatesByState.get(stateKey) ?? new Set<string>();
    set.add(candidateId);
    governorEndorsedCandidatesByState.set(stateKey, set);
  }

  // Per-party demographic favorability — single fetch for the whole loop
  // since the rows are country-scoped, not state-scoped.
  const electionCountryId = (election.countryId ?? "US") as CountryId;
  const partyGroupFavorabilityByKey = await loadPartyGroupFavorability(
    db,
    electionCountryId,
    turnNumber
  );

  // Pre-resolve runtime governmentType so the per-state distribute calls
  // below see a single cached value. A post-Stage-4 conversion would flip
  // this without affecting the (compile-time) COUNTRY_CONFIGS read.
  const electionCountryState = await getCountryState(db, electionCountryId);
  const isOnePartyState = electionCountryState.governmentType === "onePartyState";

  // Approval-scaled directional incumbency for the President's OWN race —
  // mirrors the governor's own-race shield in tallyManagement.ts (which uses
  // state approval; the President uses stored national approval). The sitting
  // President's party gets an approval-scaled shield/drag via the incumbency
  // driver in the swing-flow, so a popular incumbent (VP rides the same ticket)
  // defends better and an unpopular one bleeds. This replaces the old
  // `strengthMultiplier` comment's false claim of an incumbency boost — that
  // scalar only reweights turnout magnitude and is share-invariant. Null when
  // the presidency is vacant / has no party → driver degrades to neutral.
  const incumbentExec = await resolvePresidentApproval(db, electionCountryId);

  // Party-tenure voter fatigue: a party seeking a 3rd+ consecutive term takes a
  // drag (−3.5pp per term beyond the second) subtracted post-cap from the
  // incumbency shield, so even a popular long-tenured party faces a "time for a
  // change" slog. Folded into the incumbency driver — no separate row.
  const incumbentConsecutiveTerms = getPresidentialConsecutiveTerms(
    gsDoc,
    electionCountryId,
    incumbentExec?.partyId
  );
  const incumbentTenurePenalty = partyTenureFatiguePenalty(incumbentConsecutiveTerms);

  // Economic referendum: the "are you better off than four years ago" channel.
  // Priced ONCE per accumulation turn from national misery + the incumbent
  // party's consecutive-term count, then applied party-level to each unit's
  // share combination below. It must never be re-applied at resolution or in
  // the live-results drip. `calibration.referendumScale` (0 = off) lets the
  // replay harness A/B it; production leaves it at 1.
  const referendumScale = calibration?.referendumScale ?? 1;
  const referendumIncumbentCandidateIds =
    incumbentExec?.partyId != null
      ? enriched.filter((ec) => ec.party === incumbentExec.partyId).map((ec) => ec.candidateId)
      : [];
  let referendum: ReferendumResult | undefined;
  if (referendumScale !== 0 && referendumIncumbentCandidateIds.length > 0) {
    const miseryInputs = await loadReferendumInputs(db, electionCountryId);
    referendum = computeEconomicReferendum(miseryInputs, incumbentConsecutiveTerms, gsDoc?.preset);
  }
  const referendumSharePts = referendum ? referendum.sharePts * referendumScale : 0;

  const newTotalVotesByUnit = { ...tally.totalVotesByUnit };
  const newTotalVotes: Record<string, number> = { ...tally.totalVotes };

  for (const unit of electoralVoteUnits) {
    const stateId = getDemographicsStateId(unit);
    const state = resolveElectoralUnitState(stateMap, stateId);
    const demographics = demographicsMap.get(stateId);
    const turnoutDoc = turnoutMap.get(stateId);
    const statePartyOrgs = statePartyOrgsByState.get(stateId) ?? [];

    if (!state || !demographics) continue;

    const partyOrgByParty = new Map(statePartyOrgs.map((po) => [po.partyId, po.organization]));
    // Reg as persuasion-resistance multiplier in general-election distribution
    // — same wiring as `tallyManagement.ts`. Rows whose `registration` is
    // undefined (e.g. third parties pre-seed) simply aren't added → the engine's
    // `regResistanceMultiplier(undefined)` returns the neutral 1.0× downstream.
    // Without this map the presidential race ignored Reg% entirely while every
    // down-ballot race already applied the entrenchment tilt.
    const regByParty = new Map<string, number>();
    for (const po of statePartyOrgs) {
      if (typeof po.registration === "number") regByParty.set(po.partyId, po.registration);
    }

    // Use resolved turnout with GOTV/canvassing/suppression modifiers applied
    const { totalPool: resolvedTotalPool, byGroup: liveTurnouts } = resolveTurnout(
      state.population,
      demographics,
      categories,
      turnoutDoc,
      { preset: gsDoc?.preset, year: eraYear.year, startingYear: eraYear.startingYear }
    );

    // Granular-cell electorate substrate — same
    // swap as tallyManagement: cells replace archetypes as the iterated
    // electorate; archetype-keyed approvals/favorability remap onto cells.
    // Null substrate (no Layer-1 census) → legacy path. Flag OFF: eff* are
    // the legacy values, byte-identical behavior.
    let effDemographics = demographics;
    let effCategories = categories;
    let effLiveTurnouts = liveTurnouts;
    let effTotalPool = resolvedTotalPool;
    let effEnriched = enriched;
    let effPartyGroupFavorabilityByKey = partyGroupFavorabilityByKey;
    {
      const substrate = buildGranularElectorateSubstrate({
        countryId: electionCountryId,
        stateId,
        preset: gsDoc?.preset,
        year: eraYear.year,
        startingYear: eraYear.startingYear,
        turnoutDoc,
        statePopulation: state.population,
        demographics,
        categories,
        liveTurnouts,
        enriched,
        partyGroupFavorabilityByKey,
        demographicDefaults: demographicDefaultsByState?.get(stateId) ?? null,
      });
      if (substrate) {
        effDemographics = substrate.demographics;
        effCategories = substrate.categories;
        effLiveTurnouts = substrate.liveTurnouts;
        effTotalPool = substrate.totalPool;
        effEnriched = substrate.enriched;
        effPartyGroupFavorabilityByKey =
          substrate.partyGroupFavorabilityByKey ?? partyGroupFavorabilityByKey;
      }
    }

    const turnPool = turnVoteWeight(totalTurns, turnIndex, effTotalPool);

    const approvalPct = approvalMap.get(stateId.toUpperCase()) ?? BASE_APPROVAL;
    const approvalDecimal = approvalPct / 100;
    const officeStrength = PARTY_STRENGTH_BY_OFFICE.president ?? 1;
    // State-performance approval reweights this state's turnout MAGNITUDE
    // (±25% across 0-100%). Note this is share-invariant — it does not tilt the
    // result toward any party (see the homogeneity of distributeVotesBySwingFlow);
    // the incumbent's directional advantage comes from the approval-scaled
    // incumbency driver wired via `incumbentPartyId`/`incumbentApproval` below.
    const strengthMultiplier = (1 + (approvalDecimal - 0.5) * 0.5) * officeStrength;
    const effectiveTurnPool = turnPool * strengthMultiplier;

    const { votesPerCandidate: rawVotesPerCandidate } = distributeVotesBySwingFlow(
      effEnriched,
      effectiveTurnPool,
      effTotalPool,
      state.population,
      effDemographics,
      effCategories,
      partyOrgByParty,
      {
        useAveragedPositions: true,
        partyPositionWeight: 1 / 3, // 75% candidate, 25% party
        includeInfluenceInAppeal: false, // Fix: Removed influence double-counting (was true)
        useNationalInfluenceForReach: true,
        liveTurnouts: effLiveTurnouts, // Pass resolved turnout to vote distribution
        hasPlayerInRace: enriched.some((c) => !c.isNPP),
        // Half-rate FPTP spoiler for presidential — prevents fragmented fields
        // from producing EC landslides via winner-take-all aggregation. Without
        // this, a 19%-plurality in a 7-way race sweeps all EVs in that state.
        isGeneralElection: true,
        // §7.3.2 swing-flow now drives the presidential race (D2, 2026-06-18) —
        // same engine as every other general election. Reg enters as the
        // transferable/persuasion-resistance peel model (not the old 1.0–1.3×
        // tilt); Support + policy-distance act as persuasion drivers. Partial
        // Reg maps (third parties absent) degrade to the no-Reg baseline.
        regByParty,
        // Approval-scaled directional incumbency for the President's own race.
        // Calibration: "state" swaps the single national number for this
        // state's own government approval, so the incumbent is rewarded and
        // punished where he actually governed well or badly. Production
        // default stays "national" until the replay harness clears it.
        incumbentPartyId: incumbentExec?.partyId,
        incumbentApproval:
          calibration?.incumbentApprovalSource === "state" ? approvalPct : incumbentExec?.approval,
        incumbencyApprovalPivot: calibration?.incumbencyApprovalPivot,
        incumbentTenurePenalty,
        incumbentConsecutiveTerms,
        votingSystem: "fptp",
        spoilerRate: PRESIDENTIAL_SPOILER_RATE,
        useOrgAwareSpoiler: true,
        countryId: electionCountryId,
        isOnePartyState,
        partyGroupFavorabilityByKey: effPartyGroupFavorabilityByKey,
        // Regional bases L1+C — same maps the primary stagger threads. The
        // swing-flow kernel consumes them in appealWeight with the general-path
        // caps selected via isGeneralElection: true (ported from the legacy
        // engine 2026-07-09; previously these options were silently ignored).
        currentStateId: stateId,
        stateOrgByCandidate: regionalBonuses.stateOrgByStateAndCandidate.get(stateId),
        homeStateByCandidate: regionalBonuses.homeStateByCandidate,
      }
    );

    // Share-combination step: the referendum shift moves `referendumSharePts`
    // of this unit's pool from the rest of the field to the incumbent party
    // (or the reverse when negative), with the mirror split in proportion to
    // each other candidate's pre-shift share. Vote total is conserved.
    const votesPerCandidate = applyReferendumShift(
      rawVotesPerCandidate,
      referendumIncumbentCandidateIds,
      referendumSharePts
    );

    const unitTotals = { ...(tally.totalVotesByUnit[unit.unitId] ?? {}) };
    const districtLean = UNIT_LEAN[unit.unitId];
    const stateLean = getStateLean(state, stateId);
    // Use full state lean so state partisanship remains visible. The prior
    // half-strength setup made mild red states behave like national tossups
    // once a large field fragmented the vote.
    const lean = districtLean ?? stateLean;

    // Swing-state detection compares against the display lean so the threshold
    // matches real-world political terminology. The same state/district lean
    // also drives the vote multiplier.
    const swingReferenceLean = districtLean ?? stateLean;
    const isSwingState = Math.abs(swingReferenceLean) < 0.5;

    for (const ec of enriched) {
      const isSuspended = suspendedElectionCandidateIds.has(ec.candidateId);
      // Suspended candidates no longer accumulate votes — zero their turn tally.
      // They stay on the ballot in name only. Previously earned votes are preserved.
      let votes = isSuspended ? 0 : Math.round(votesPerCandidate[ec.candidateId] ?? 0);
      if (ec.party === "independent") {
        votes = Math.round(votes * INDEPENDENT_VOTE_PENALTY);
      }
      if (lean !== 0) {
        const posForLean =
          ec.partyEcon != null && ec.partySocial != null
            ? (ec.partyEcon + ec.partySocial) / 2
            : ec.charEP;
        const epSign = posForLean > 0 ? 1 : posForLean < 0 ? -1 : 0;
        // #3243: tiebreaker-scale lean multiplier, clamped to [0.8, 1.2].
        votes = Math.round(votes * leanVoteMultiplier(lean, epSign, districtLean !== undefined));
        votes = Math.max(0, votes);
      }

      // Ground game (suspended campaigns forfeit): Field Offices boost swing
      // areas only; Get-Out-The-Vote boosts turnout in EVERY area. Both stack.
      if (!isSuspended) {
        const csKey =
          campaignStrengthKeyByElectionCandidateId.get(ec.candidateId) ?? ec.characterId;
        const gg = groundGameByCandidate.get(csKey);
        if (gg) {
          const swingBonus = isSwingState ? gg.swing : 0;
          const multiplier = 1 + swingBonus + gg.gotv;
          if (multiplier !== 1) {
            votes = Math.round(votes * multiplier);
          }
        }
      }

      // VP home-state effect: +3% if this candidate's running mate hails from
      // the current state. Suspended nominees forfeit passive campaign bonuses.
      const vpHomeState = vpHomeStateByCandidate.get(ec.candidateId);
      if (!isSuspended && vpHomeState && vpHomeState === stateId) {
        votes = Math.round(votes * 1.03);
      }

      // Governor endorsement: +3% in this candidate's tally for this specific
      // state only when the state's sitting governor has endorsed them.
      // Strictly in-state — does not bleed into national totals.
      const stateGovEndorsed = governorEndorsedCandidatesByState.get(stateId.toUpperCase());
      if (stateGovEndorsed && stateGovEndorsed.has(ec.candidateId)) {
        votes = Math.round(votes * GOVERNOR_ENDORSEMENT_STATE_BONUS);
      }

      // Campaign strength: multiplicative reach boost from player contributions.
      // Shared curve preserves early gains while soft-capping high spend.
      const csKey = campaignStrengthKeyByElectionCandidateId.get(ec.candidateId) ?? ec.characterId;
      const cs = campaignStrengthByCandidate.get(csKey) ?? 0;
      if (cs > 0) {
        votes = Math.round(votes * campaignStrengthVoteMultiplier(cs));
      }

      unitTotals[ec.candidateId] = (unitTotals[ec.candidateId] ?? 0) + votes;
      newTotalVotes[ec.candidateId] = (newTotalVotes[ec.candidateId] ?? 0) + votes;
    }
    newTotalVotesByUnit[unit.unitId] = unitTotals;
  }

  const unitTurnSnapshots = { ...(tally.unitTurnSnapshots ?? {}) };
  for (const unit of ELECTORAL_VOTE_UNITS) {
    const unitTotals = newTotalVotesByUnit[unit.unitId] ?? {};
    const existing = unitTurnSnapshots[unit.unitId] ?? [];
    unitTurnSnapshots[unit.unitId] = [
      ...existing.slice(-95),
      {
        turn: turnNumber,
        recordedAt: now,
        cumulativeVotes: { ...unitTotals },
        sharesPct: (() => {
          const total = Object.values(unitTotals).reduce((s, v) => s + v, 0);
          const out: Record<string, number> = {};
          for (const ec of enriched) {
            const v = unitTotals[ec.candidateId] ?? 0;
            out[ec.candidateId] = total > 0 ? Math.round((v / total) * 1000) / 10 : 0;
          }
          return out;
        })(),
      },
    ];
  }

  const snapshot: VoteTurnSnapshot = {
    turn: turnNumber,
    recordedAt: now,
    cumulativeVotes: { ...newTotalVotes },
    sharesPct: Object.fromEntries(
      enriched.map((ec) => {
        const total = Object.values(newTotalVotes).reduce((s, v) => s + v, 0);
        const votes = newTotalVotes[ec.candidateId] ?? 0;
        return [ec.candidateId, total > 0 ? Math.round((votes / total) * 1000) / 10 : 0];
      })
    ),
  };

  if (calibration?.dryRun) {
    return {
      totalVotes: newTotalVotes,
      totalVotesByUnit: newTotalVotesByUnit,
      candidateIds: enriched.map((ec) => ec.candidateId),
      ...(referendum && { referendum }),
    };
  }

  await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
    { electionId },
    {
      $set: {
        totalVotes: newTotalVotes,
        totalVotesByUnit: newTotalVotesByUnit,
        unitTurnSnapshots,
        updatedAt: now,
        // Additive, optional: the UI gauge reads the referendum reading the
        // engine actually used instead of recomputing it. Purely descriptive —
        // nothing downstream applies it a second time.
        ...(referendum && {
          economicReferendum: {
            miseryIndex: referendum.miseryIndex,
            sharePts: referendumSharePts,
            components: referendum.components,
            fatigueMultiplier: referendum.fatigueMultiplier,
            incumbentPartyId: incumbentExec?.partyId,
            recordedTurn: turnNumber,
          },
        }),
      },
      $push: { turnSnapshots: snapshot } as never,
    }
  );
}
