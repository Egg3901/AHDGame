import type { Db, AnyBulkWriteOperation } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { RegionDemographics } from "@/lib/db/types/regionDemographics";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
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
  economicPullFactor,
  applyEconomicPull,
  capNetMigrants,
  worldMigrationScale,
  ECON_PULL_NEUTRAL,
  labourShortageMigrationBonusPct,
} from "./flows/internationalMigration";
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
 * refinement. Returns the region count + the internal-migration circuit-breaker
 * trip count (surfaced in the turn log).
 */
export async function runDemographicFlows(
  db: Db,
  turn: number
): Promise<{ regionsProcessed: number; circuitBreakerTrips: number }> {
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
  const [demos, states, macroMetrics, gameState, labourConfig, politicalInputs] = await Promise.all(
    [
      db.collection<RegionDemographics>("regionDemographics").find({}).toArray(),
      db.collection<State>("states").find({}).toArray(),
      db.collection("macroMetrics").find({}).project<MetricsDoc>(METRICS_PROJECTION).toArray(),
      db.collection("gameState").findOne<{
        votingAgeEligible?: number;
        workingAgeEligible?: number;
        retirementAgeEligible?: number;
        currentYear?: number;
        currentTurn?: number;
        startingYear?: number;
        conscription?: Record<string, Partial<ConscriptionPolicy>>;
      }>({}),
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
    ]
  );

  // Configurable age thresholds (defaults 18 / 18 / 64; future laws write gameState).
  // The voting age additionally falls back to the YEAR when no law has set it —
  // 21 before the 26th Amendment. Uses `resolveGameYear` rather than the era
  // flag: the franchise is a fact about the world's date, not an opt-in
  // simulation feature, and a world with neither year nor turn keeps the flat 18.
  const votingAge = resolveVotingAgeEligible(
    gameState ?? undefined,
    gameState ? resolveGameYear(gameState) : null
  );
  const workLo = resolveWorkingAgeEligible(gameState ?? undefined);
  const workHi = resolveRetirementAgeEligible(gameState ?? undefined);
  const stateById = new Map(states.map((s) => [s._id, s]));
  const metricsById = new Map<string, MetricsDoc>(macroMetrics.map((m) => [m._id, m]));
  const real = demos.filter((d) => !NATIONAL_SCOPE_IDS.has(d._id));
  if (real.length === 0) return { regionsProcessed: 0, circuitBreakerTrips: 0 };

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
    const seededMigrationPct = val(m?.population?.migrationRate, 0);
    const integrationScore = politicalInputs.score(demo._id, "society.integration");
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
    const conscription = estimateConscriptionEffects(
      resolveConscriptionPolicy(demo.countryId, gameState?.conscription?.[demo.countryId]),
      before
    );

    preps.push({ demo, before, m, countryId: demo.countryId, cappedNet, conscription });
  }

  // Pass 1b: global conservation (design 2026-06-16). The modeled bloc is a subset of
  // the real world, so a small net inflow from the unmodeled rest-of-world is legitimate
  // — but every region adding net inflow independently would inflate world population.
  // Scale POSITIVE nets so the bloc nets at most WORLD_NET_MIGRATION_PCT_PER_YEAR; outflows
  // and a net-emigrating bloc are untouched.
  const migrationScale = worldMigrationScale(
    preps.map((p) => p.cappedNet),
    blocPop,
    TURNS_PER_YEAR
  );

  // Pass 1c: advance each cohort with the bounded net.
  const works: RegionWork[] = [];
  for (const p of preps) {
    const netInternationalMigrants = p.cappedNet >= 0 ? p.cappedNet * migrationScale : p.cappedNet;
    // Bridge A — mortality is SUBSTITUTED: healthcare.* is absent for playable
    // regions, so without this every playable country shares one curve.
    const politicalLife = politicalInputs.legacyUnit(p.demo._id, "healthcare.lifeExpectancy");
    const politicalPrev = politicalInputs.legacyUnit(p.demo._id, "healthcare.preventableMortality");
    // Fertility is MODULATED, not substituted: population.birthRate EXISTS on
    // macroMetrics with an authored regional seed, but no law moves it for
    // playables. Keep the seed as the base so authored regional character
    // survives; ±25 index points at the board extremes, unchanged at 50.
    const seededBirthRate = val(p.m?.population?.birthRate, 50);
    const demographyScore = politicalInputs.score(p.demo._id, "society.demography");
    const birthRateIndex =
      demographyScore == null
        ? seededBirthRate
        : modulateByPoliticalScore(seededBirthRate, demographyScore, 25);

    const inputs: CohortInputs = {
      replacementTFR: REPLACEMENT_TFR,
      birthRateIndex,
      healthcare: {
        // Real-unit neutral defaults (years / per-100k) — the 0-100/centered-50
        // defaults mis-fed healthcareMortalityModifier (P2b Task 0a).
        lifeExpectancy: politicalLife ?? val(p.m?.healthcare?.lifeExpectancy, LIFE_EXPECTANCY_MID),
        preventableMortality:
          politicalPrev ?? val(p.m?.healthcare?.preventableMortality, PREVENTABLE_MORTALITY_MID),
      },
      netInternationalMigrants,
      migrantShareMale: 0.5,
      servingFemaleByAge: p.conscription.servingFemaleByAge,
    };

    const { vector, flows } = advanceCohort(p.before, inputs, turn, TURNS_PER_YEAR);
    works.push({
      id: p.demo._id,
      countryId: p.countryId,
      before: p.before,
      vector,
      flows,
      m: p.m,
      militaryServicePop: p.conscription.activeServingPop,
    });
  }

  // ── Stage 2: per-country INTERNAL migration (cross-region, zero-sum, N1/F-B) ──
  const profile = migrantAgeSexProfile(0.5);
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
  const now = new Date();
  const demoOps: AnyBulkWriteOperation<RegionDemographics>[] = [];
  const stateOps: AnyBulkWriteOperation<State>[] = [];
  const metricOps: AnyBulkWriteOperation<StateMetrics>[] = [];

  for (const { id: regionId, before, vector, flows, militaryServicePop } of works) {
    const newPop = Math.max(1, totalPopulation(vector));
    const eligible = Math.round(votingAgePopulation(vector, votingAge));
    const working = Math.round(workingAgePopulation(vector, workLo, workHi));
    // populationGrowth spans the FULL turn: pre-local `before` → post-internal `vector`.
    const pm = derivePopulationMetrics(before, vector, flows, TURNS_PER_YEAR);

    demoOps.push({
      updateOne: {
        filter: { _id: regionId },
        update: { $set: { ages: vector, lastUpdated: now } },
      },
    });
    stateOps.push({
      updateOne: {
        filter: { _id: regionId },
        update: {
          $set: {
            population: Math.round(newPop),
            votingEligiblePopulation: eligible,
            workingAgePopulation: working,
            militaryServicePopulation: Math.round(militaryServicePop),
          },
        },
      },
    });
    metricOps.push({
      updateOne: {
        filter: { _id: regionId },
        update: {
          $set: {
            // The policy migrationRate is NOT written here — it is the INPUT this
            // phase reads (see METRIC_BOUNDS note). The realized rate the migration
            // step actually moved is surfaced as a SEPARATE coexistence readout
            // (§8.2), written alongside (never onto) the policy input.
            "population.realizedMigrationRate.value": clamp(
              pm.migrationRate,
              ...METRIC_BOUNDS.realizedMigrationRate
            ),
            "population.populationGrowth.value": clamp(
              pm.populationGrowth,
              ...METRIC_BOUNDS.populationGrowth
            ),
            "population.medianAge.value": pm.medianAge,
            "population.sexRatio.value": clamp(pm.sexRatio, ...METRIC_BOUNDS.sexRatio),
            "population.dependencyRatio.value": clamp(
              pm.dependencyRatio,
              ...METRIC_BOUNDS.dependencyRatio
            ),
            "population.demographicDecline.value": clamp(
              pm.demographicDecline,
              ...METRIC_BOUNDS.demographicDecline
            ),
            lastUpdated: now,
          },
        },
      },
    });
  }

  if (demoOps.length)
    await db.collection<RegionDemographics>("regionDemographics").bulkWrite(demoOps);
  if (stateOps.length) await db.collection<State>("states").bulkWrite(stateOps);
  // SP5: population.* re-homed to macroMetrics.
  if (metricOps.length) await db.collection<StateMetrics>("macroMetrics").bulkWrite(metricOps);
  return { regionsProcessed: real.length, circuitBreakerTrips };
}
