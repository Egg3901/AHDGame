/**
 * Population flows advance age and sex cohorts, then conserve modeled bilateral migration.
 * runDemographicFlows freezes final vectors, regional totals and population readouts
 * before writing them, so the same world turn resumes without aging or moving people twice.
 */
import { loadPandemicSignal } from "@/lib/livingConflict/pandemicSignal";
import { loadPendingRefugeeReceptions } from "@/lib/livingConflict/refugeeReception";
import { loadPendingConflictCivilianLosses } from "@/lib/livingConflict/civilianLoss";
import { planConflictCivilianLosses } from "@/lib/livingConflict/rules/civilianLoss";
import {
  planRefugeeReceptions,
  servingCohortsForReception,
} from "@/lib/livingConflict/rules/refugeeReception";
import { pandemicMortality } from "@/lib/livingConflict/rules/pandemic";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { RegionDemographics } from "@/lib/db/types/regionDemographics";
import {
  freezeAndApplyDemographicFlowPlan,
  resumeDemographicFlowReceipt,
  type DemographicFlowRegionProjection,
} from "./flowJournal";
import { ensureDemographicWorldEpoch } from "./worldEpoch";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import {
  resetSystemVersionsForCountry,
  type ResetV2Readiness,
  type ResetVersionState,
} from "@/lib/resetVersions/rules";
import { dependencyBurden15To64 } from "@/lib/resetMetrics/rules/cohortOpening";
import { realizedTfrFromBirths } from "@/lib/resetMetrics/rules/realizedFertility";
import { periodLifeExpectancy } from "@/lib/resetMetrics/rules/periodLifeExpectancy";
import type { ResetMetricSnapshot } from "@/lib/resetMetrics/rules/snapshot";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { resolveVotingAgeEligible } from "@/lib/constants/votingAge";
import { resolveGameYear } from "@/lib/era/era";
import { resolveWorkingAgeEligible, resolveRetirementAgeEligible } from "@/lib/constants/laborAge";
import {
  totalPopulation,
  votingAgePopulation,
  workingAgePopulation,
  type AgeSexVector,
} from "./cohortVector";
import { advanceCohort, type CohortInputs, type CohortFlowTallies } from "./cohortFlows";
import { derivePopulationMetrics } from "./populationMetrics";
import {
  migrantAgeSexProfile,
  MAX_NET_MIGRATION_PCT_PER_YEAR,
  economicPullFactor,
  applyEconomicPull,
  capNetMigrants,
  worldMigrationScale,
  ECON_PULL_NEUTRAL,
  labourShortageMigrationBonusPct,
} from "./flows/internationalMigration";
import { planBilateralMigration, transferBilateralCohorts } from "./flows/rules/bilateralMigration";
import { getLabourSystemMode, labourAtLeast } from "@/lib/labour/featureFlag";
import { labourMigrationWageFactor } from "@/lib/labour/laborCost";
import { LIFE_EXPECTANCY_MID, PREVENTABLE_MORTALITY_MID } from "./flows/mortality";
import { loadPoliticalMacroInputs } from "@/lib/politicalLegislation/politicalMacroInputs";
import { modulateByPoliticalScore } from "@/lib/politicalLegislation/legacyUnitBands";
import {
  regionAttractiveness,
  computeInternalNetTargets,
  applyInternalMigration,
} from "./flows/internalMigration";
import {
  resolveConscriptionPolicy,
  estimateConscriptionEffects,
  type ConscriptionPolicy,
} from "./conscription";

/** Per-region net internal-migration change capped per turn (circuit-breaker). */
const MAX_INTERNAL_CHANGE_FRACTION = 0.05;

/**
 * Replacement TFR anchoring the index→TFR map (from the Task-6 stationarity
 * calibration). Index 50 (neutral `birthRate`) → this TFR → flat population.
 * MUST stay in sync with `cohortFlows.sim.test.ts`'s REPLACEMENT_TFR.
 */
const REPLACEMENT_TFR = 2.06;

type ResetOpeningSeed = typeof import("@/lib/resetMetrics/openingSeed1991");
let resetCohortOpeningCache: {
  life: ReturnType<ResetOpeningSeed["openingLifeCalibration1991"]>;
  fertility: ReturnType<ResetOpeningSeed["openingFertilityPolicyInputs1991"]>;
  migration: ReturnType<ResetOpeningSeed["openingMigrationPolicyInputs1991"]>;
} | null = null;

async function resetCohortOpeningCalibration() {
  if (resetCohortOpeningCache) return resetCohortOpeningCache;
  const {
    openingLifeCalibration1991,
    openingFertilityPolicyInputs1991,
    openingMigrationPolicyInputs1991,
  } = await import("@/lib/resetMetrics/openingSeed1991");
  return (resetCohortOpeningCache ??= {
    life: openingLifeCalibration1991(),
    fertility: openingFertilityPolicyInputs1991(),
    migration: openingMigrationPolicyInputs1991(),
  });
}

interface MetricsDoc {
  _id: string;
  population?: { birthRate?: { value?: number }; migrationRate?: { value?: number } };
  healthcare?: { lifeExpectancy?: { value?: number }; preventableMortality?: { value?: number } };
  economic?: {
    gdpGrowth?: { value?: number };
    unemploymentRate?: { value?: number };
    potentialGrowth?: { value?: number };
    medianIncome?: { value?: number };
    costOfLiving?: { value?: number };
    labourWageIndex?: { value?: number };
    labourTightness?: { value?: number };
  };
}

/** Per-region work carried from the local-flow stage into the internal-migration stage. */
interface RegionWork {
  id: string;
  countryId: string;
  before: AgeSexVector;
  vector: AgeSexVector; // intermediate (post-local) → final (post-internal)
  flows: CohortFlowTallies;
  m: MetricsDoc | undefined;
  militaryServicePop: number; // active conscription withdrawal (§4.5)
  servingMaleByAge: readonly number[];
  servingFemaleByAge: readonly number[];
  realizedTfr: number | null;
  periodLifeExpectancy: number | null;
}

const val = (x: { value?: number } | undefined, dflt: number): number =>
  typeof x?.value === "number" && Number.isFinite(x.value) ? (x.value as number) : dflt;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Surfaced-metric display bounds (mirror of `metricDefinitions.ts` population
 * category). The STOCK (`state.population`) is driven by the UN-clamped flow;
 * only the surfaced metric VALUE is clamped here so a rare >±bound region
 * saturates the readout rather than feeding an out-of-range value into approval
 * scoring (design audit-7). `medianAge` (years) has no fixed bound.
 *
 * The policy `migrationRate` is deliberately NOT overwritten: this phase READS
 * it as the policy input for the international flow, so writing the realized rate
 * back onto it would (a) slowly erode the immigration-policy signal each turn
 * (realized = input × popNow/popAfter < input while the population grows) and
 * (b) feed a clamp back into the stock input — both forbidden by audit-7.
 * Instead the realized rate is surfaced as a SEPARATE readout,
 * `population.realizedMigrationRate` (§8.2 coexistence wiring): same flow value
 * the migration step actually moved, written alongside (never onto) the policy
 * input so the UI can show realized-vs-policy without eroding the signal. It is
 * excluded from approval scoring (a derived readout, like the others).
 */
const METRIC_BOUNDS = {
  populationGrowth: [-3, 5],
  sexRatio: [0, 100],
  dependencyRatio: [0, 3],
  demographicDecline: [0, 100],
  // Realized net migration (annualized %); a few % in normal play, bounded so a
  // rare surge saturates the readout rather than dominating a UI axis.
  realizedMigrationRate: [-10, 10],
} as const;

/**
 * Demographic-flows turn phase (design §4.2/§4.3). Runs AFTER `metricEngine`
 * (reads the `birthRate` / healthcare / `migrationRate` metrics it produces).
 * Advances each region's age×sex vector one turn and persists into three collections:
 *   - the vector            → `regionDemographics`
 *   - `states`: `population` = Σ (SSOT level) + `votingEligiblePopulation` (Σ ages
 *     ≥ votingAgeEligible, the electorate) + `workingAgePopulation` (labor force L)
 *   - the dynamic metrics    → `macroMetrics.population.*` (SP5 re-home)
 * Skips NATIONAL_SCOPE synthetic docs. Two-stage: (1) per-region LOCAL flows
 * (aging/mortality/fertility/international, from `advanceCohort`), then (2) a
 * per-country INTERNAL migration pass (cross-region, zero-sum, N1/F-B/circuit-
 * breaker — design §4.4) over the intermediate vectors; readouts are derived from
 * the FINAL vectors. International net is per-region from its own `migrationRate`
 * metric; gateway-weighted NATIONAL international allocation remains a later
 * refinement. Current EU membership pairs origin and destination demand through
 * conserved age×sex transfers; unmatched demand keeps the rest-of-world cap.
 * Returns the region count + internal-migration circuit-breaker trips.
 */
export async function runDemographicFlows(
  db: Db,
  turn: number,
  suppliedWorldEpochId?: string,
  v2Ready: ResetV2Readiness = RESET_V2_READY
): Promise<{ regionsProcessed: number; circuitBreakerTrips: number }> {
  const worldEpochId = suppliedWorldEpochId ?? (await ensureDemographicWorldEpoch(db));
  const prior = await resumeDemographicFlowReceipt(db, worldEpochId, turn);
  if (prior) return prior;
  // A missing receipt is safe to replan only when this marker proves the
  // interrupted phase used freeze-before-write rather than the legacy path.
  const attempt = await db
    .collection<GameState>("gameState")
    .updateOne(
      { _id: "current", worldEpochId },
      { $set: { demographicFlowAttempt: { worldEpochId, turn } } }
    );
  if (attempt.matchedCount !== 1)
    throw new Error("Population world identity changed before planning");
  // SP5: population/economic inputs live on macroMetrics; the healthcare
  // inputs (lifeExpectancy/preventableMortality) stay political — present for
  // non-playables on stateMetrics, absent for playables, which now resolve them
  // from the political board instead of falling to the neutral constants
  // (Bridge A, below). Both halves are projected identically and merged.
  const METRICS_PROJECTION = {
    "population.birthRate.value": 1,
    "population.migrationRate.value": 1,
    "healthcare.lifeExpectancy.value": 1,
    "healthcare.preventableMortality.value": 1,
    "economic.gdpGrowth.value": 1,
    "economic.unemploymentRate.value": 1,
    "economic.potentialGrowth.value": 1,
    "economic.medianIncome.value": 1,
    "economic.costOfLiving.value": 1,
    "economic.labourWageIndex.value": 1,
    "economic.labourTightness.value": 1,
  } as Record<string, 1>;
  const [demos, states, macroMetrics, gameState, labourConfig, politicalInputs, euMemberships] =
    await Promise.all([
      db.collection<RegionDemographics>("regionDemographics").find({}).toArray(),
      db.collection<State>("states").find({}).toArray(),
      db.collection("macroMetrics").find({}).project<MetricsDoc>(METRICS_PROJECTION).toArray(),
      db.collection("gameState").findOne<
        {
          votingAgeEligible?: number;
          votingAgeEligibleByCountry?: Partial<Record<string, number>>;
          workingAgeEligible?: number;
          retirementAgeEligible?: number;
          currentYear?: number;
          currentTurn?: number;
          startingYear?: number;
          conscription?: Record<string, Partial<ConscriptionPolicy>>;
          livingConflictsEnabled?: boolean;
        } & ResetVersionState
      >({}),
      // v2: read the labour mode via the SAME db (so tests' mock db is honored) and
      // feed it as preloaded — never let getLabourSystemMode hit its own getDb.
      db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { labourSystemMode: 1 } })
        .catch(() => null),
      // Bridge A supplies the healthcare.* mortality inputs. The macro read
      // above carries no political values, so without this every region would
      // share one mortality curve.
      loadPoliticalMacroInputs(db),
      db
        .collection<OrganizationMembership>("organizationMemberships")
        .find({ organizationId: "EU" }, { projection: { countryId: 1, status: 1 } })
        .toArray(),
    ]);

  const pandemic = await loadPandemicSignal(db, gameState?.livingConflictsEnabled === true);
  const [receptionOrders, civilianLossOrders] = await Promise.all([
    loadPendingRefugeeReceptions(
      db,
      worldEpochId,
      turn,
      gameState?.livingConflictsEnabled === true
    ),
    loadPendingConflictCivilianLosses(
      db,
      worldEpochId,
      turn,
      gameState?.livingConflictsEnabled === true
    ),
  ]);

  // Configurable age thresholds (defaults 18 / 18 / 64; future laws write gameState).
  // Voting age is resolved per country because electoral-law enactment writes the
  // country map. Countries without a law still use the year fallback: 21 before
  // the 26th Amendment, 18 afterward.
  const gameYear = gameState ? resolveGameYear(gameState) : null;
  const votingAgeFor = (countryId: string) =>
    resolveVotingAgeEligible(gameState ?? undefined, gameYear, countryId);
  const workLo = resolveWorkingAgeEligible(gameState ?? undefined);
  const workHi = resolveRetirementAgeEligible(gameState ?? undefined);
  const stateById = new Map(states.map((s) => [s._id, s]));
  const v2Countries = new Set(
    (["US", "UK", "JP"] as const).filter(
      (countryId) => resetSystemVersionsForCountry(gameState, v2Ready, countryId).metrics === "v2"
    )
  );
  // Building the historical crosswalk is relatively expensive. V1 worlds
  // must not pay for it on every turn or merely by importing this phase.
  const v2Opening = v2Countries.size > 0 ? await resetCohortOpeningCalibration() : null;
  const metricsById = new Map<string, MetricsDoc>(macroMetrics.map((m) => [m._id, m]));
  const real = demos.filter((d) => !NATIONAL_SCOPE_IDS.has(d._id));
  if (real.length === 0) return { regionsProcessed: 0, circuitBreakerTrips: 0 };

  const v2HealthByRegion = new Map<string, ResetMetricSnapshot>();
  if (v2Countries.size > 0) {
    if (!gameState?.resetWorldId) throw new Error("V2 cohorts lack their reset world identity");
    const healthBoards = await db
      .collection<ResetMetricSnapshot>("resetMetricSnapshots")
      .find(
        {
          worldId: gameState.resetWorldId,
          scope: "regional",
          countryId: { $in: [...v2Countries] },
        },
        {
          projection: {
            _id: 1,
            worldId: 1,
            countryId: 1,
            regionId: 1,
            asOfTurn: 1,
            "observations.19.value": 1,
          },
        }
      )
      .toArray();
    for (const board of healthBoards) {
      if (v2HealthByRegion.has(board._id))
        throw new Error(`Duplicate v2 health board ${board._id}`);
      v2HealthByRegion.set(board._id, board);
    }
    for (const demo of real) {
      if (!v2Countries.has(demo.countryId as "US" | "UK" | "JP")) continue;
      const board = v2HealthByRegion.get(`${demo.countryId}:${demo._id}`);
      const preventable = board?.observations?.["19"]?.value;
      if (
        board?.countryId !== demo.countryId ||
        board.regionId !== demo._id ||
        board.worldId !== gameState.resetWorldId ||
        board.asOfTurn !== turn - 1 ||
        typeof preventable !== "number" ||
        !Number.isFinite(preventable) ||
        !v2Opening!.life[demo.countryId as "US" | "UK" | "JP"][demo._id]
      ) {
        throw new Error(`V2 cohorts lack current health inputs for ${demo.countryId}:${demo._id}`);
      }
    }
  }

  // v2: labour→macro coupling is active only at labourSystemMode ≥ "macro".
  const labourMacroEnabled = labourAtLeast(
    await getLabourSystemMode(labourConfig ?? null),
    "macro"
  );

  // ── Stage 1: per-region LOCAL flows (aging/mortality/fertility/international) ──
  // Pass 1a: compute each region's net international migration (policy %, economic
  // pull, then per-region cap) and gather inputs. We need every region's net before
  // advancing any cohort so the global conservation bound (1b) can see the whole bloc.
  interface RegionPrep {
    demo: (typeof real)[number];
    before: AgeSexVector;
    m: ReturnType<typeof metricsById.get>;
    countryId: string;
    cappedNet: number;
    conscription: ReturnType<typeof estimateConscriptionEffects>;
    conscriptionPolicy: ConscriptionPolicy;
  }
  const preps: RegionPrep[] = [];
  let blocPop = 0;
  for (const demo of real) {
    const before = demo.ages as AgeSexVector;
    const state = stateById.get(demo._id);
    const m = metricsById.get(demo._id);
    const popNow = state?.population ?? totalPopulation(before);
    blocPop += popNow;

    // Per-region international net from its migrationRate metric (annual % → per-turn migrants),
    // then scaled by ECONOMIC PULL (design 2026-06-15): a stronger regional economy attracts
    // more foreign migrants (and a weaker one sheds more). Sign-aware + policy-gated; a neutral
    // economy / missing metrics → ×1.0 (parity). Capped per-region at ±MAX%/yr (design
    // 2026-06-16) AFTER the pull so a high-growth boom can't push net past the ceiling.
    // Bridge A — same shape as birthRate: the seeded rate is authored per
    // region, but no law moves it for playables. society.integration shifts it
    // ±1.5 annual percentage points at the board extremes, unchanged at 50.
    const useResetMetrics = v2Countries.has(demo.countryId as "US" | "UK" | "JP");
    const seededMigrationPct = useResetMetrics
      ? v2Opening!.migration[demo.countryId as "US" | "UK" | "JP"][demo._id]
      : val(m?.population?.migrationRate, 0);
    if (seededMigrationPct === undefined) {
      throw new Error(
        `V2 cohorts lack a 1991 migration policy input for ${demo.countryId}:${demo._id}`
      );
    }
    const integrationScore = useResetMetrics
      ? null
      : politicalInputs.score(demo._id, "society.integration");
    const migrationRatePct =
      integrationScore == null
        ? seededMigrationPct
        : modulateByPoliticalScore(seededMigrationPct, integrationScore, 1.5);
    const labourMigrationBonusPct = labourMacroEnabled
      ? labourShortageMigrationBonusPct(
          val(m?.economic?.labourTightness, 0),
          val(m?.economic?.labourWageIndex, 1)
        )
      : 0;
    const policyGatedLabourMigrationBonusPct = migrationRatePct > 0 ? labourMigrationBonusPct : 0;
    const baseNet =
      (((migrationRatePct + policyGatedLabourMigrationBonusPct) / 100) * popNow) / TURNS_PER_YEAR;
    const gdpGrowthVal = val(m?.economic?.gdpGrowth, ECON_PULL_NEUTRAL.gdpGrowth);
    let econPull = economicPullFactor({
      gdpGrowth: gdpGrowthVal,
      unemployment: val(m?.economic?.unemploymentRate, ECON_PULL_NEUTRAL.unemployment),
      // v0 fix: pull on the output gap (gdpGrowth − own potential), so a region at
      // its potential is migration-neutral. If potentialGrowth is missing, fall back
      // to THIS region's gdpGrowth → gap 0 → pull 1 (parity), not the legacy
      // 2.5-anchored pull.
      potential: val(m?.economic?.potentialGrowth, gdpGrowthVal),
    });
    // v2 labour→macro (gated on labourSystemMode ≥ "macro"): a region whose labour
    // system pushed wages above baseline attracts more migrants; below, fewer.
    // Bounded so it modulates — not dominates — the output-gap pull. Index 1.0
    // (or labour off) ⇒ ×1.0 (parity).
    if (labourMacroEnabled) {
      const wageFactor = labourMigrationWageFactor(val(m?.economic?.labourWageIndex, 1));
      econPull = Math.max(0.5, Math.min(1.5, econPull * wageFactor));
    }
    const cappedNet = capNetMigrants(applyEconomicPull(baseNet, econPull), popNow, TURNS_PER_YEAR);

    // Conscription (§4.5): resolve the country's policy and withdraw the serving
    // slice — serving women leave the childbearing pool (fertility ↓); the total
    // is exposed as militaryServicePopulation for the P1c labor subtraction.
    const policy = resolveConscriptionPolicy(
      demo.countryId,
      gameState?.conscription?.[demo.countryId]
    );
    const conscription = estimateConscriptionEffects(policy, before);

    preps.push({
      demo,
      before,
      m,
      countryId: demo.countryId,
      cappedNet,
      conscription,
      conscriptionPolicy: policy,
    });
  }

  // Member free movement pairs a modeled origin with a modeled destination.
  // Residual net demand retains the existing rest-of-world circuit breaker.
  const memberIds = new Set(
    euMemberships
      .filter((member) => member.status === "active" || member.status === "founding")
      .map((member) => member.countryId)
  );
  const memberPopulation = new Map<string, number>();
  for (const prep of preps) {
    if (!memberIds.has(prep.countryId)) continue;
    memberPopulation.set(
      prep.countryId,
      (memberPopulation.get(prep.countryId) ?? 0) +
        (stateById.get(prep.demo._id)?.population ?? totalPopulation(prep.before))
    );
  }
  const memberCountries = [...memberPopulation.keys()].sort();
  const migrationPlan = planBilateralMigration(
    preps.map((prep) => ({
      regionId: prep.demo._id,
      countryId: prep.countryId,
      netPeople: prep.cappedNet,
    })),
    memberCountries.flatMap((originCountryId) =>
      memberCountries
        .filter((destinationCountryId) => destinationCountryId !== originCountryId)
        .map((destinationCountryId) => ({
          originCountryId,
          destinationCountryId,
          capacityPeople:
            (Math.min(
              memberPopulation.get(originCountryId)!,
              memberPopulation.get(destinationCountryId)!
            ) *
              MAX_NET_MIGRATION_PCT_PER_YEAR) /
            (100 * TURNS_PER_YEAR),
        }))
    )
  );
  const migrationScale = worldMigrationScale(
    Object.values(migrationPlan.unmatchedByRegion),
    blocPop,
    TURNS_PER_YEAR
  );

  // Pass 1c: advance each cohort with the bounded net.
  const works: RegionWork[] = [];
  for (const p of preps) {
    const unmatched = migrationPlan.unmatchedByRegion[p.demo._id] ?? p.cappedNet;
    const netInternationalMigrants = unmatched >= 0 ? unmatched * migrationScale : unmatched;
    // Bridge A — mortality is SUBSTITUTED: healthcare.* is absent for playable
    // regions, so without this every playable country shares one curve.
    const politicalLife = politicalInputs.legacyUnit(p.demo._id, "healthcare.lifeExpectancy");
    const politicalPrev = politicalInputs.legacyUnit(p.demo._id, "healthcare.preventableMortality");
    // Fertility is MODULATED, not substituted: population.birthRate EXISTS on
    // macroMetrics with an authored regional seed, but no law moves it for
    // playables. Keep the seed as the base so authored regional character
    // survives; ±25 index points at the board extremes, unchanged at 50.
    const useResetMetrics = v2Countries.has(p.countryId as "US" | "UK" | "JP");
    const seededBirthRate = useResetMetrics
      ? v2Opening!.fertility[p.countryId as "US" | "UK" | "JP"][p.demo._id]
      : val(p.m?.population?.birthRate, 50);
    if (seededBirthRate === undefined) {
      throw new Error(
        `V2 cohorts lack a 1991 fertility policy input for ${p.countryId}:${p.demo._id}`
      );
    }
    const demographyScore = useResetMetrics
      ? null
      : politicalInputs.score(p.demo._id, "society.demography");
    const birthRateIndex =
      demographyScore == null
        ? seededBirthRate
        : modulateByPoliticalScore(seededBirthRate, demographyScore, 25);

    const inputs: CohortInputs = {
      replacementTFR: REPLACEMENT_TFR,
      excessMortalityAnnual: pandemicMortality(pandemic, p.countryId),
      birthRateIndex,
      healthcare: useResetMetrics
        ? {
            lifeExpectancy:
              v2Opening!.life[p.countryId as "US" | "UK" | "JP"][p.demo._id]!.openingYears,
            preventableMortality: v2HealthByRegion.get(`${p.countryId}:${p.demo._id}`)!
              .observations["19"]!.value!,
          }
        : {
            // Real-unit neutral defaults (years / per-100k) — the 0-100/centered-50
            // defaults mis-fed healthcareMortalityModifier (P2b Task 0a).
            lifeExpectancy:
              politicalLife ?? val(p.m?.healthcare?.lifeExpectancy, LIFE_EXPECTANCY_MID),
            preventableMortality:
              politicalPrev ??
              val(p.m?.healthcare?.preventableMortality, PREVENTABLE_MORTALITY_MID),
          },
      netInternationalMigrants,
      migrantShareMale: 0.5,
      servingFemaleByAge: p.conscription.servingFemaleByAge,
    };

    const { vector, flows } = advanceCohort(p.before, inputs, turn, TURNS_PER_YEAR);
    const serving =
      receptionOrders.length || civilianLossOrders.length
        ? servingCohortsForReception(
            vector,
            p.conscriptionPolicy.eligibleBand,
            p.conscription.servingMale,
            p.conscription.servingFemale
          )
        : { male: [], female: [] };
    works.push({
      id: p.demo._id,
      countryId: p.countryId,
      before: p.before,
      vector,
      flows,
      m: p.m,
      militaryServicePop: p.conscription.activeServingPop,
      servingMaleByAge: serving.male,
      servingFemaleByAge: serving.female,
      realizedTfr: v2Countries.has(p.countryId as "US" | "UK" | "JP")
        ? realizedTfrFromBirths(p.before, flows.births, TURNS_PER_YEAR)
        : null,
      periodLifeExpectancy: v2Countries.has(p.countryId as "US" | "UK" | "JP")
        ? periodLifeExpectancy(inputs.healthcare)
        : null,
    });
  }

  // Paired country flows transfer identical age and sex cells, preserving modeled population.
  const profile = migrantAgeSexProfile(0.5);
  const workById = new Map(works.map((work) => [work.id, work]));
  for (const route of migrationPlan.routes) {
    const origin = workById.get(route.originRegionId);
    const destination = workById.get(route.destinationRegionId);
    if (!origin || !destination) continue;
    const moved = transferBilateralCohorts(
      origin.vector,
      destination.vector,
      route.people,
      profile
    );
    origin.vector = moved.origin;
    destination.vector = moved.destination;
    origin.flows.netMigration -= moved.moved;
    destination.flows.netMigration += moved.moved;
  }

  const civilianLosses: ReturnType<typeof planConflictCivilianLosses> = civilianLossOrders.length
    ? planConflictCivilianLosses(
        civilianLossOrders,
        works.map((work) => ({
          regionId: work.id,
          countryId: stateById.get(work.id)?.countryId ?? work.countryId,
          vector: work.vector,
          servingMaleByAge: work.servingMaleByAge,
          servingFemaleByAge: work.servingFemaleByAge,
        })),
        turn,
        worldEpochId
      )
    : { regions: [], results: [], deathsByRegion: {} };
  for (const region of civilianLosses.regions) {
    const work = workById.get(region.regionId)!;
    work.vector = region.vector;
    work.flows.deaths += civilianLosses.deathsByRegion[region.regionId] ?? 0;
  }

  const receptions: ReturnType<typeof planRefugeeReceptions> = receptionOrders.length
    ? planRefugeeReceptions(
        receptionOrders,
        works.map((work) => ({
          regionId: work.id,
          countryId: stateById.get(work.id)?.countryId ?? work.countryId,
          vector: work.vector,
          remainingMigrationCapacity: Math.max(
            0,
            capNetMigrants(Number.MAX_VALUE, totalPopulation(work.before), TURNS_PER_YEAR) -
              Math.abs(work.flows.netMigration)
          ),
          servingMaleByAge: work.servingMaleByAge,
          servingFemaleByAge: work.servingFemaleByAge,
        })),
        turn,
        worldEpochId
      )
    : { regions: [], results: [], netByRegion: {} };
  for (const region of receptions.regions) {
    const work = workById.get(region.regionId)!;
    work.vector = region.vector;
    work.flows.netMigration += receptions.netByRegion[region.regionId] ?? 0;
  }

  // ── Stage 2: per-country INTERNAL migration (cross-region, zero-sum, N1/F-B) ──
  let circuitBreakerTrips = 0;
  const byCountry = new Map<string, RegionWork[]>();
  for (const w of works) {
    const list = byCountry.get(w.countryId) ?? [];
    list.push(w);
    byCountry.set(w.countryId, list);
  }
  for (const countryWorks of byCountry.values()) {
    if (countryWorks.length < 2) continue; // no peers to reallocate between
    const incomes = countryWorks.map((w) => val(w.m?.economic?.medianIncome, 50000));
    const avgIncome = incomes.reduce((s, x) => s + x, 0) / incomes.length;
    const attract = new Map(
      countryWorks.map((w) => [
        w.id,
        regionAttractiveness(
          {
            gdpGrowth: val(w.m?.economic?.gdpGrowth, 2.5),
            unemployment: val(w.m?.economic?.unemploymentRate, 5),
            medianIncome: val(w.m?.economic?.medianIncome, 50000),
            costOfLiving: val(w.m?.economic?.costOfLiving, 100),
            labourTightness: labourMacroEnabled ? val(w.m?.economic?.labourTightness, 0) : 0,
            labourWageIndex: labourMacroEnabled ? val(w.m?.economic?.labourWageIndex, 1) : 1,
          },
          avgIncome
        ),
      ])
    );
    const pop = new Map(countryWorks.map((w) => [w.id, totalPopulation(w.vector)]));
    const targets = computeInternalNetTargets(attract, pop, TURNS_PER_YEAR);
    const vectorsMap = new Map(countryWorks.map((w) => [w.id, w.vector]));
    const preInternalPopulation = new Map(
      countryWorks.map((w) => [w.id, totalPopulation(w.vector)])
    );
    const { vectors: finalVectors, circuitBreakerTrips: trips } = applyInternalMigration(
      vectorsMap,
      targets,
      profile,
      MAX_INTERNAL_CHANGE_FRACTION
    );
    circuitBreakerTrips += trips;
    for (const w of countryWorks) {
      const finalVector = finalVectors.get(w.id) ?? w.vector;
      w.flows.netMigration += totalPopulation(finalVector) - (preInternalPopulation.get(w.id) ?? 0);
      w.vector = finalVector;
    }
  }

  // ── Stage 3: derive readouts from the FINAL vectors and persist ──
  const regions: DemographicFlowRegionProjection[] = [];

  for (const {
    id: regionId,
    countryId,
    before,
    vector,
    flows,
    militaryServicePop,
    realizedTfr,
    periodLifeExpectancy: lifeYears,
  } of works) {
    const newPop = Math.max(1, totalPopulation(vector));
    const eligible = Math.round(votingAgePopulation(vector, votingAgeFor(countryId)));
    const working = Math.round(workingAgePopulation(vector, workLo, workHi));
    // populationGrowth spans the FULL turn: pre-local `before` → post-internal `vector`.
    const pm = derivePopulationMetrics(before, vector, flows, TURNS_PER_YEAR);

    regions.push({
      regionId,
      agesAfter: vector,
      stateAfter: {
        population: Math.round(newPop),
        votingEligiblePopulation: eligible,
        workingAgePopulation: working,
        militaryServicePopulation: Math.round(militaryServicePop),
      },
      metricsAfter: {
        // Keep the enacted migrationRate input separate from realized flows.
        realizedMigrationRate: clamp(pm.migrationRate, ...METRIC_BOUNDS.realizedMigrationRate),
        populationGrowth: clamp(pm.populationGrowth, ...METRIC_BOUNDS.populationGrowth),
        medianAge: pm.medianAge,
        sexRatio: clamp(pm.sexRatio, ...METRIC_BOUNDS.sexRatio),
        dependencyRatio: clamp(pm.dependencyRatio, ...METRIC_BOUNDS.dependencyRatio),
        demographicDecline: clamp(pm.demographicDecline, ...METRIC_BOUNDS.demographicDecline),
      },
      ...(v2Countries.has(countryId as "US" | "UK" | "JP")
        ? {
            resetCohortReadingAfter: {
              asOfTurn: turn,
              populationGrowthAnnualized: pm.populationGrowth,
              realizedTfr,
              periodLifeExpectancy: lifeYears,
              dependencyBurden15To64: dependencyBurden15To64(vector),
            },
          }
        : {}),
    });
  }

  return freezeAndApplyDemographicFlowPlan(db, {
    worldEpochId,
    turn,
    regions,
    stats: { regionsProcessed: real.length, circuitBreakerTrips },
    refugeeReceptions: receptions.results,
    civilianLosses: civilianLosses.results,
  });
}
