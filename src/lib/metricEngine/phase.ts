import { sumObservedOutput, outputHistorySpanTurns } from "./rules/outputVolume";
import type { Db } from "mongodb";
import type { StateMetrics, GameConfig } from "@/lib/db/types";
import type { State } from "@/lib/db/types/state";
import { isLabourMacroEnabled } from "@/lib/labour/featureFlag";
import { getEraEnvelope } from "@/lib/era/metricCatalog";
import { resolveGameYear } from "@/lib/era/era";
import { NATIONAL_SCOPE_IDS, getNationalDocId } from "@/lib/constants/nationalScope";
import { synergyNudges, applySpendingEfficiency } from "@/lib/economicModels/effects";
import { loadActiveDirectiveNudgesByCountry } from "@/lib/internationalOrganizations/directives";
import { loadActivePostureNudgesByCountry } from "@/lib/internationalOrganizations/posture";
import { loadActiveAgencyNudgesByCountry } from "@/lib/internationalOrganizations/agency";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getCountryConfig } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import {
  advanceRevenueEma,
  getNeutralFederalSalesTaxRate,
  getNeutralStateSalesTaxRate,
  selectRevenueTrendBaseline,
  sumHostRealizedRevenue,
  sumRealizedRevenue,
  updateRevenueSnapshots,
  type RevenueSnapshot,
} from "@/lib/turn/gdpGrowth";
import { evaluateRegistry } from "./evaluate";
import { compoundGdpLevel } from "./gdpLevel";
import { advanceCapitalStock, seedCapitalStock } from "./capitalStock";
import { combineAdditionalCapitalInvestment } from "./publicCapital";
import {
  computeLaborForce,
  annualizedGrowthRate,
  potentialGrowth,
  tfpBasket,
  NEUTRAL_LABOR_PARTICIPATION,
} from "./potentialGrowth";
import { advanceOutputGap } from "./outputGap";
import { applySectorBlend, convergenceBonus } from "./convergence";
import {
  buildMacroGrowthInputs,
  type CountryMacroRaw,
  type MacroGrowthInputs,
} from "./macroGrowthInputs";
import { loadValuationFxRates } from "@/lib/currency/corporationCapital";
import { getEraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import { nextLabourParticipationBonus } from "@/lib/labour/labourMarket";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import {
  governmentApprovalProvider,
  sectorRevenueTaxProvider,
  fiscalRatiosProvider,
  fiscalTradeInputsProvider,
  warDamageProvider,
} from "./providers";
import { fiscalMirrorFields, FISCAL_MIRROR_METRICS } from "./fiscalMirror";
import { isMacroMetricPath, MACRO_CATEGORIES } from "@/lib/macroMetrics/paths";
import { spendingProvider } from "./spendingProvider";
import { METRIC_REGISTRY_SORTED } from "./registry";
import type { SectorRevenueTaxPayload } from "./registry/economic";
import type { NodeId } from "./types";
import type { EconomicModelState } from "@/lib/constants/economicModels";
import { loadPoliticalMacroInputs } from "@/lib/politicalLegislation/politicalMacroInputs";

/** Default unemployment when a state has no prior reading (matches gdpGrowth.ts `?? 4.5`). */
const DEFAULT_UNEMPLOYMENT = 4.5;

// ── Generic node wiring (P2+) ────────────────────────────────────────────────
// The three P0/P1c economic nodes keep their bespoke wiring below (sector-signal
// fallback chain, Okun, stock writes). Every OTHER registry node is wired
// GENERICALLY from its declared inputs: prev value/simBaseline projected +
// fed per node, bare-string non-registry inputs fed as seedCurrent (their
// policy-adjusted stored value), {lagged} non-registry inputs fed as prev.
// Adding a category = registering its nodes; no phase edits (spec P0 promise).

const BESPOKE_NODE_IDS = new Set([
  "economic.sectorGrowth",
  "economic.gdpGrowth",
  "economic.unemploymentRate",
]);

/**
 * The engine animates the MACRO categories only.
 *
 * Its political nodes still exist and are still modelled — they just no longer
 * own a stored value. They are evaluated by `processPoliticalMetricsDynamics`
 * as pure target functions and folded into the board through the engine term
 * (see politicalMetrics/engineNodes.ts). Persisting them here as well would
 * write a legacy political value nothing reads, into a store being retired.
 *
 * Filtering a topologically sorted list keeps it topologically sorted, so the
 * remaining nodes' same-turn dependencies still resolve in order.
 */
const MACRO_NODES = METRIC_REGISTRY_SORTED.filter((n) => MACRO_CATEGORIES.has(n.categoryId));

const GENERIC_NODES = MACRO_NODES.filter((n) => !BESPOKE_NODE_IDS.has(n.id));
const REGISTRY_IDS = new Set(MACRO_NODES.map((n) => n.id));

/**
 * Political metrics that MACRO nodes read (workforce skill, grid reliability,
 * crime, inequality...). They were registry nodes evaluated in the same pass;
 * now they are external inputs like any other, resolved from the region's
 * political board and fed through `seedCurrent`.
 *
 * Derived from the nodes' own declared inputs rather than hand-listed, so
 * adding an edge to a political metric cannot silently leave it undefined.
 */
const POLITICAL_INPUT_IDS: string[] = [
  ...new Set(
    MACRO_NODES.flatMap((n) =>
      n.inputs.map((i) => (typeof i === "string" ? i : "lagged" in i ? i.lagged : null))
    )
      .filter((id): id is string => id != null)
      .filter((id) => !MACRO_CATEGORIES.has(id.split(".")[0]))
  ),
];

// §6.3 (P7b): resolve a bare metricId (e.g. "militaryReadiness") to its node id
// (e.g. "governance.militaryReadiness") for synergy nudges. Root-only synergy
// targets (no node) are absent here and silently skipped — they are not engine-
// animated, so they receive no nudge until a root-animation pass lands.
const nodeIdByMetricId = new Map<string, NodeId>();
for (const n of METRIC_REGISTRY_SORTED) nodeIdByMetricId.set(n.metricId, n.id);

const genericSeedIds = new Set<string>();
const genericLaggedIds = new Set<string>();
for (const n of GENERIC_NODES) {
  for (const input of n.inputs) {
    if (typeof input === "string") {
      if (!REGISTRY_IDS.has(input)) genericSeedIds.add(input);
    } else if ("lagged" in input && !REGISTRY_IDS.has(input.lagged)) {
      genericLaggedIds.add(input.lagged);
    }
  }
}
const GENERIC_SEED_IDS = [...genericSeedIds];
const GENERIC_LAGGED_IDS = [...genericLaggedIds];

/** Mongo projection for the generic nodes' prevs + their external reads. */
const GENERIC_PROJECTION: Record<string, 1> = {};
for (const n of GENERIC_NODES) {
  GENERIC_PROJECTION[`${n.id}.value`] = 1;
  GENERIC_PROJECTION[`${n.id}.simBaseline`] = 1;
}
for (const id of [...GENERIC_SEED_IDS, ...GENERIC_LAGGED_IDS]) {
  GENERIC_PROJECTION[`${id}.value`] = 1;
}
// TFP basket inputs (P2d) not already projected as nodes/inputs: rdIntensity
// (R&D policy root) + urbanizationRate. workforceSkill/transportEfficiency are
// generic nodes and already projected above.
GENERIC_PROJECTION["economic.rdIntensity.value"] = 1;
GENERIC_PROJECTION["economic.industrialPolicyExecution.value"] = 1;
GENERIC_PROJECTION["population.urbanizationRate.value"] = 1;
// v2-2/v2-3: the corp turn's Δ-passthrough signals (medianIncomeNode +
// unemploymentNode read them manually, gated on labourMacroEnabled — see
// seedCurrent below — so neither is a declared node input, the same
// treatment as potentialGrowth/outputGapPrev).
GENERIC_PROJECTION["economic.labourWageIndexDelta.value"] = 1;
// v2-3b: automation half of the jobs channel (separate signal from the wage
// index — see its corp-turn accumulation site for why).
GENERIC_PROJECTION["economic.automationIndexDelta.value"] = 1;

/** Read `doc[cat][metric][field]` (dot id), rejecting non-finite values. */
function readMetricPath(
  doc: unknown,
  id: string,
  field: "value" | "simBaseline"
): number | undefined {
  const dot = id.indexOf(".");
  if (dot < 0 || doc == null) return undefined;
  const cat = id.slice(0, dot);
  const metric = id.slice(dot + 1);
  const v = (doc as Record<string, Record<string, Record<string, unknown>> | undefined>)[cat]?.[
    metric
  ]?.[field];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

interface PrevMetricsDoc {
  _id: string;
  /** §6.1 (P7b): the region's LAGGED economic model, for sector GDP concentration. */
  economicModel?: EconomicModelState;
  economic?: {
    // The sector signal now bears the EMA + policy/tax coexistence (P1c-2). Read
    // its prev from sectorGrowth, falling back to the legacy gdpGrowth fields for
    // a seamless cutover from worlds seeded before the split.
    sectorGrowth?: { value?: number; simBaseline?: number };
    gdpGrowth?: { value?: number; simBaseline?: number; sectorBaseline?: number };
    unemploymentRate?: { value?: number };
    laborParticipation?: { value?: number };
    laborForce?: { value?: number };
  };
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Unified metric-engine turn phase. Replaces the standalone `gdpGrowth` phase:
 * runs cross-collection providers once, then evaluates the registry per real
 * state and persists with one bulkWrite. Behaviour-preserving for gdpGrowth +
 * unemployment (golden-master gated, R2). Skips NATIONAL_SCOPE synthetic docs.
 */
export async function runMetricEngine(db: Db, turn: number): Promise<number> {
  // Era envelopes: live year for the metric era catalog's engine clamps; null
  // while eraSystemEnabled is off (no clamps — byte-identical legacy).
  const eraGameState = await db.collection<import("@/lib/db/types").GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        currentYear: 1,
        currentTurn: 1,
        startingYear: 1,
        eraSystemEnabled: 1,
        macroGrowthV1: 1,
        preset: 1,
      },
    }
  );
  const eraYear = eraGameState?.eraSystemEnabled ? resolveGameYear(eraGameState) : null;
  // Macro-growth v1 (design §4): O2 convergence + O3 sector blend on potential.
  const macroGrowthEnabled = eraGameState?.macroGrowthV1 === true;

  // SP5: prev values live in TWO stores post-split — macroMetrics carries
  // economic/population (+ economicModel) for every country; stateMetrics
  // carries the political categories for non-playables. Both are projected
  // with the same field list (absent fields project to nothing) and merged
  // per region below, so every downstream read keeps its single-doc shape.
  const PREV_PROJECTION = {
    economicModel: 1,
    "economic.sectorGrowth.value": 1,
    "economic.sectorGrowth.simBaseline": 1,
    "economic.gdpGrowth.value": 1,
    "economic.gdpGrowth.simBaseline": 1,
    "economic.gdpGrowth.sectorBaseline": 1,
    "economic.unemploymentRate.value": 1,
    "economic.laborParticipation.value": 1,
    "economic.laborForce.value": 1,
    "economic.labourTightness.value": 1,
    "economic.labourParticipationDemandBonus.value": 1,
    // Generic nodes (P2+): prev value/simBaseline + external seed/lagged reads,
    // derived from the registry at module load.
    ...GENERIC_PROJECTION,
    // 📊 budget-sync: project the mirror metrics' value so the persist gate
    // (presence check) can scope which regions get the live ratio.
    ...Object.fromEntries(FISCAL_MIRROR_METRICS.map((m) => [`${m.id}.value`, 1] as const)),
  } as Record<string, 1>;

  const [
    allStates,
    prevMetrics,
    sectorTax,
    centralBanks,
    spendingRollup,
    approvalByCountry,
    fiscalRatiosByCountry,
    fiscalTradeInputsByCountry,
    labourConfig,
    politicalInputs,
    countryGameStates,
    warDamageByCountryId,
  ] = await Promise.all([
    db.collection<State>("states").find({}).toArray(),
    db
      .collection<StateMetrics>("macroMetrics")
      .find({})
      .project<PrevMetricsDoc>(PREV_PROJECTION)
      .toArray(),
    sectorRevenueTaxProvider(db, turn),
    // Per-country prime rate drives capital investment (P1c-0). Batched here so
    // there is no per-region round trip.
    db.collection<{ _id: string; primeRate?: number }>("centralBanks").find({}).toArray(),
    // Per-region per-capita budget spend by category (P2 spending backbone). One
    // batched provider read; nodes consume it via {spending} inputs.
    spendingProvider(db),
    // P4: last turn's stored national approval per country (the approval phase
    // writes AFTER the engine — the lag that keeps the trust loop damped).
    governmentApprovalProvider(db),
    // 📊 budget-sync: per-country real fiscal ratios for the exact-mirror metrics.
    fiscalRatiosProvider(db),
    // Dynamic fiscal-growth: per-country trade inputs (tariff/foreign-tax/forex/
    // FTA/bloc) + lagged inflation, consumed by the wageGrowth/tradeGrowth nodes.
    fiscalTradeInputsProvider(db),
    // v2-2: read the labour mode via the SAME db (mock-db safe — see the
    // demographics-phase gotcha) so labourWageIndexDelta only feeds
    // medianIncome at labourSystemMode ≥ "macro".
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { labourSystemMode: 1 } })
      .catch(() => null),
    // Bridge A: 4 of the 6 TFP basket inputs live on demolished stateMetrics
    // categories, so playable regions resolved them all to TFP_REFERENCE_INPUTS
    // and their potential growth was near-uniform. Non-playable regions are
    // absent from this map and keep the legacy read untouched.
    loadPoliticalMacroInputs(db),
    db
      .collection<{ _id: string; status?: string }>("countryGameStates")
      .find({ status: "active" })
      .project<{ _id: string }>({ _id: 1 })
      .toArray(),
    // A war is fought on somebody's ground, and that ground's roads should show it.
    // One small read of the live conflicts; countries at peace are absent from the map.
    warDamageProvider(db),
  ]);

  const labourMacroEnabled = await isLabourMacroEnabled(labourConfig ?? null);

  // Resolve a country's prime rate: live central-bank doc → config default.
  const primeRateByBankId = new Map<string, number>();
  for (const b of centralBanks) {
    if (typeof b.primeRate === "number" && Number.isFinite(b.primeRate)) {
      primeRateByBankId.set(b._id, b.primeRate);
    }
  }
  const primeRateFor = (countryId: State["countryId"]): number =>
    primeRateByBankId.get(getBankId(countryId)) ??
    getCountryConfig(countryId).centralBank.defaultPrimeRate;

  // Per-state prev lookups. Non-finite values are rejected (typeof NaN ===
  // "number") so a corrupted prior never poisons the EMA.
  // P1c-2: the sector node bears the EMA + policy delta, so its prev keys off
  // economic.sectorGrowth (legacy economic.gdpGrowth as cutover fallback).
  const prevSectorValue = new Map<string, number>();
  const prevSectorBaseline = new Map<string, number>();
  const prevUnemployment = new Map<string, number>();
  // P1c-1: prior labor force (for g_L) and current laborParticipation (for L).
  const prevLaborForce = new Map<string, number>();
  const laborParticipationByState = new Map<string, number>();
  for (const m of prevMetrics) {
    const g = finite(m.economic?.sectorGrowth?.value) ?? finite(m.economic?.gdpGrowth?.value);
    if (g !== undefined) prevSectorValue.set(m._id, g);
    const b =
      finite(m.economic?.sectorGrowth?.simBaseline) ??
      finite(m.economic?.gdpGrowth?.simBaseline) ??
      finite(m.economic?.gdpGrowth?.sectorBaseline);
    if (b !== undefined) prevSectorBaseline.set(m._id, b);
    const u = finite(m.economic?.unemploymentRate?.value);
    if (u !== undefined) prevUnemployment.set(m._id, u);
    const lf = finite(m.economic?.laborForce?.value);
    if (lf !== undefined) prevLaborForce.set(m._id, lf);
    const lp = finite(m.economic?.laborParticipation?.value);
    if (lp !== undefined) laborParticipationByState.set(m._id, lp);
  }

  // Raw prev docs by state for the generic-node reads (the typed maps above
  // cover only the bespoke economic fields).
  const prevDocById = new Map<string, PrevMetricsDoc>(prevMetrics.map((m) => [m._id, m]));

  const realStates = allStates.filter((s) => !NATIONAL_SCOPE_IDS.has(s._id));
  if (realStates.length === 0) return 0;

  const now = new Date();
  const macroOps: Array<{
    updateOne: { filter: { _id: string }; update: { $set: Record<string, number | Date> } };
  }> = [];
  // GDP-level stock writes to the `states` collection (SSOT — design §5.4). The
  // engine compounds state.gdp each turn by the region's freshly-computed
  // gdpGrowth, so the GDP LEVEL (not just the rate) moves over time.
  const stateOps: Array<{
    updateOne: {
      filter: { _id: string };
      update: {
        $set: Record<string, number | string | RevenueSnapshot[]>;
        $unset?: Record<string, "">;
      };
    };
  }> = [];

  // Active organization directives nudge a curated metric across every member
  // state (Phase 2A-ii). Loaded once here, then merged into each member's
  // `targetNudges` below. Empty map when no directives are active → the merge is
  // a no-op (parity / golden-master fast path).
  // Security-alliance alert posture and funded agency programmes apply the same
  // kind of member-wide nudge (Phase 2B). The three loads are independent, so
  // they run as one parallel round-trip instead of three serial ones.
  const [directiveNudgesByCountry, postureNudgesByCountry, agencyNudgesByCountry] =
    await Promise.all([
      loadActiveDirectiveNudgesByCountry(db),
      loadActivePostureNudgesByCountry(db),
      loadActiveAgencyNudgesByCountry(db, turn),
    ]);

  // ── Macro-growth v1 (design §4): per-country convergence + openness inputs ──
  // Computed once per turn, applied to every region's potential in the loop.
  // Empty/inert when the flag is off (byte-identical legacy).
  let macroInputs: MacroGrowthInputs = { byCountry: new Map(), frontierPcAnchor: 0 };
  // Shared by O2 (per-capita anchor normalization) and O1c (₳→local corp
  // investment). Empty when the flag is off (the loop guards on macroGrowthEnabled).
  let fxByCurrency = new Map<import("@/lib/constants/currencies").CurrencyCode, number>();
  if (macroGrowthEnabled) {
    fxByCurrency = await loadValuationFxRates(db);
    // National state-ownership concentration (SOCI) per country — lagged command signal.
    const sociByCountry = new Map<string, number>();
    const budgets = await db
      .collection<{ _id: string; countryId?: string; stateOwnershipConcentration?: number }>(
        "federalBudget"
      )
      .find({}, { projection: { countryId: 1, stateOwnershipConcentration: 1 } })
      .toArray();
    for (const b of budgets) {
      const cid = b.countryId || (b._id === "federal" ? "US" : b._id);
      if (typeof b.stateOwnershipConcentration === "number") {
        sociByCountry.set(cid, b.stateOwnershipConcentration);
      }
    }
    // Σ GDP + population per country from the states already loaded.
    const gdpByCountry = new Map<string, number>();
    const popByCountry = new Map<string, number>();
    for (const s of realStates) {
      gdpByCountry.set(s.countryId, (gdpByCountry.get(s.countryId) ?? 0) + (s.gdp ?? 0));
      popByCountry.set(s.countryId, (popByCountry.get(s.countryId) ?? 0) + (s.population ?? 0));
    }
    const rows: CountryMacroRaw[] = [];
    const activeCountryIds = new Set(countryGameStates.map((row) => row._id));
    const developmentTotals = new Map<
      string,
      Record<"industrialPolicyExecution" | "workforceSkill" | "transportEfficiency", number>
    >();
    const developmentCounts = new Map<
      string,
      Record<"industrialPolicyExecution" | "workforceSkill" | "transportEfficiency", number>
    >();
    const developmentPaths = {
      industrialPolicyExecution: "economic.industrialPolicyExecution",
      workforceSkill: "education.workforceSkill",
      transportEfficiency: "infrastructure.transportEfficiency",
    } as const;
    const publicCapitalByCountry = new Map<string, number>();
    for (const state of realStates) {
      const totals = developmentTotals.get(state.countryId) ?? {
        industrialPolicyExecution: 0,
        workforceSkill: 0,
        transportEfficiency: 0,
      };
      const counts = developmentCounts.get(state.countryId) ?? {
        industrialPolicyExecution: 0,
        workforceSkill: 0,
        transportEfficiency: 0,
      };
      const prevDoc = prevDocById.get(state._id);
      for (const [key, path] of Object.entries(developmentPaths) as Array<
        [keyof typeof developmentPaths, string]
      >) {
        const value =
          politicalInputs.legacyUnit(state._id, path) ?? readMetricPath(prevDoc, path, "value");
        if (value === undefined) continue;
        totals[key] += value;
        counts[key] += 1;
      }
      developmentTotals.set(state.countryId, totals);
      developmentCounts.set(state.countryId, counts);
      publicCapitalByCountry.set(
        state.countryId,
        (publicCapitalByCountry.get(state.countryId) ?? 0) +
          (spendingRollup.publicCapitalAnnualLocalMillionsByRegion.get(state._id) ?? 0)
      );
    }
    for (const countryId of gdpByCountry.keys()) {
      const nationalDocId = getNationalDocId(countryId as CountryId);
      // The active-country filter is applied by the pure precompute below.
      // Older worlds with an empty registry retain the national-doc fallback.
      if (!nationalDocId) continue;
      const natDoc = prevDocById.get(nationalDocId);
      const totals = developmentTotals.get(countryId);
      const counts = developmentCounts.get(countryId);
      const average = (key: keyof typeof developmentPaths): number | undefined =>
        totals && counts && counts[key] > 0 ? totals[key] / counts[key] : undefined;
      rows.push({
        countryId,
        gdpLocalMillions: gdpByCountry.get(countryId) ?? 0,
        population: popByCountry.get(countryId) ?? 0,
        soci: sociByCountry.get(countryId),
        // Lagged national gate metrics (prev-turn national doc — the C3 lag).
        tradeGrowth: readMetricPath(natDoc, "economic.tradeGrowth", "value"),
        economicFreedom: readMetricPath(natDoc, "economic.economicFreedom", "value"),
        industrialPolicyExecution: average("industrialPolicyExecution"),
        workforceSkill: average("workforceSkill"),
        transportEfficiency: average("transportEfficiency"),
        publicInvestmentEffort: Math.min(
          1,
          (publicCapitalByCountry.get(countryId) ?? 0) /
            Math.max(1, (gdpByCountry.get(countryId) ?? 0) * 0.05)
        ),
      });
    }
    macroInputs = buildMacroGrowthInputs(rows, eraGameState?.preset, activeCountryIds);
  }

  // Per-country memos: synergy nudges and era envelopes depend only on the
  // country (model, directives, era year), not the state, so compute each
  // country's set once instead of once per state.
  const targetNudgesByCountry = new Map<string, Record<NodeId, number>>();
  const envelopesByCountry = new Map<string, Record<string, { limit: number; kind: "ceiling" }>>();

  for (const state of realStates) {
    const countryId = state.countryId;
    const countryMacro = macroInputs.byCountry.get(countryId);
    const ownedForState = sectorTax.ownedByState.get(state._id) ?? [];
    // P2/D7: prior realized-revenue baseline + how many turns ago it was taken.
    // Only meaningful under plants; the node ignores both fields otherwise.
    // Ticket #1084: once the snapshot is tagged `host`, compare host-currency
    // sums so FX restatement cannot annualize into a per-turn GDP jig. Untagged
    // (legacy ₳) snapshots keep the ₳ path for one turn, then we rewrite as host.
    const prevRealized = finite(state.sectorRealizedRevenue);
    const prevRealizedTurn = finite(state.sectorRealizedRevenueTurn);
    const useHostRealized = state.sectorRealizedRevenueUnit === "host";
    const nowHost = sumHostRealizedRevenue(ownedForState);
    const nowAnchor = sumRealizedRevenue(ownedForState, sectorTax.plantsEnabled);
    // Trailing revenue trend (host currency only, so FX cannot leak into it —
    // same rule as the one-turn snapshot, ticket #1084). On the legacy→host
    // flip turn the EMA seeds fresh from this turn's host sum and the snapshot
    // log restarts; until a snapshot matures past the minimum span the node
    // keeps using the one-turn fallback.
    const startsHostTrend = sectorTax.plantsEnabled && !useHostRealized;
    const trendActive = sectorTax.plantsEnabled;
    const revenueEmaNow = trendActive
      ? advanceRevenueEma(startsHostTrend ? undefined : finite(state.sectorRevenueEma), nowHost)
      : undefined;
    const priorSnapshots =
      trendActive && !startsHostTrend ? state.sectorRevenueSnapshots : undefined;
    const revenueTrendBaseline = trendActive
      ? selectRevenueTrendBaseline(priorSnapshots, turn)
      : null;
    const nextSnapshots =
      trendActive && revenueEmaNow !== undefined
        ? updateRevenueSnapshots(priorSnapshots, turn, revenueEmaNow)
        : undefined;
    // Keep physical history separate: comparing a new volume level with an old
    // money snapshot would create an artificial recession or boom at migration.
    const outputNow = trendActive ? sumObservedOutput(ownedForState) : null;
    const outputEmaNow =
      outputNow !== null ? advanceRevenueEma(finite(state.sectorOutputEma), outputNow) : undefined;
    const outputTrendBaseline =
      outputEmaNow !== undefined
        ? selectRevenueTrendBaseline(state.sectorOutputSnapshots, turn)
        : null;
    const outputSnapshots =
      outputEmaNow !== undefined
        ? updateRevenueSnapshots(state.sectorOutputSnapshots, turn, outputEmaNow)
        : undefined;
    const payload: SectorRevenueTaxPayload = {
      owned: ownedForState,
      plantsEnabled: sectorTax.plantsEnabled,
      realizedRevenueNow: useHostRealized ? nowHost : nowAnchor,
      realizedRevenuePrev: prevRealized,
      turnsSincePrev: prevRealizedTurn !== undefined ? turn - prevRealizedTurn : undefined,
      revenueEmaNow,
      revenueTrendBaseline,
      outputEmaNow,
      outputTrendBaseline,
      outputHistorySpanTurns: outputHistorySpanTurns(state.sectorOutputSnapshots, turn),
      unowned: sectorTax.unownedByState.get(state._id) ?? [],
      federalSalesTax:
        sectorTax.federalSalesTaxByCountry.get(countryId) ??
        getNeutralFederalSalesTaxRate(countryId),
      stateSalesTax:
        sectorTax.stateSalesTaxByState.get(state._id) ?? getNeutralStateSalesTaxRate(countryId),
      countryId,
      // §6.1 (P7b): the country's LAGGED NATIONAL model (economic models are national
      // only — every region inherits its nation's model). This turn's classification
      // runs AFTER the engine, so the stored value is last turn's — the §7 lag.
      model: prevDocById.get(getNationalDocId(countryId) ?? "")?.economicModel,
    };

    // Advance the Solow capital stock off THIS turn's output level (pre-compound
    // state.gdp, millions — same unit as K). Cold-start seeds K ≈ 3×gdp (P1c-0).
    const output = state.gdp ?? 0;
    const capital = state.capitalStock ?? seedCapitalStock(output);
    // O1c (design §5): fold THIS turn's paid corp growth cost into investment,
    // capped at 5% of region GDP/yr. Only when the flag is on AND the write is
    // from this turn (fresh-or-zero). ₳ → local-millions via the country's FX.
    let corpInvestPerTurn = 0;
    if (macroGrowthEnabled && state.corpGrowthInvestmentTurn === turn) {
      const anchor = state.corpGrowthInvestmentAnchor ?? 0;
      const currency = COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP];
      const fx = currency ? (fxByCurrency.get(currency) ?? 1) : 1;
      const localMillions = (anchor * fx) / 1_000_000;
      corpInvestPerTurn = Math.max(0, localMillions);
    }
    const additionalCapitalPerTurn = macroGrowthEnabled
      ? combineAdditionalCapitalInvestment({
          outputAnnualLocalMillions: output,
          publicCapitalBudgetAnnualLocalMillions: countryMacro
            ? (spendingRollup.publicCapitalAnnualLocalMillionsByRegion.get(state._id) ?? 0)
            : 0,
          corporateInvestmentPerTurnLocalMillions: corpInvestPerTurn,
          ownPcAnchor: countryMacro?.ownPcAnchor ?? 0,
          frontierPcAnchor: macroInputs.frontierPcAnchor,
          turnsPerYear: TURNS_PER_YEAR,
        })
      : 0;
    const capStep = advanceCapitalStock(
      capital,
      output,
      primeRateFor(countryId),
      TURNS_PER_YEAR,
      additionalCapitalPerTurn,
      // The country's OWN neutral rate, so "tight money" is judged relative to
      // that economy rather than a global 3. Administered-rate economies sit
      // structurally above 3 and were otherwise scored as permanently tight,
      // depreciating their capital stock every turn.
      getEraMonetaryBaseline(countryId as CountryId, eraYear)?.neutralPrimeRate
    );

    // Supply-side POTENTIAL growth (§5.1): αL·g_L + αK·g_K + TFP. Computed BEFORE
    // the registry so it can be threaded to the gdpGrowth/unemployment nodes.
    const priorMetricDoc = prevDocById.get(state._id);
    const participationDemandBonus = labourMacroEnabled
      ? nextLabourParticipationBonus(
          readMetricPath(priorMetricDoc, "economic.labourTightness", "value"),
          readMetricPath(priorMetricDoc, "economic.labourParticipationDemandBonus", "value")
        )
      : 0;
    const effectiveLaborParticipation = Math.min(
      100,
      (laborParticipationByState.get(state._id) ?? NEUTRAL_LABOR_PARTICIPATION) +
        participationDemandBonus
    );
    const laborForce = computeLaborForce(
      state.workingAgePopulation ?? 0,
      state.militaryServicePopulation ?? 0,
      effectiveLaborParticipation
    );
    const gL = annualizedGrowthRate(
      laborForce,
      prevLaborForce.get(state._id) ?? laborForce,
      TURNS_PER_YEAR
    );
    // Living TFP (P2d): R&D + skill + transport + saturating agglomeration from
    // the PREV turn's metrics (the C3 lag). Missing inputs → reference (1.2).
    const prevDocForTfp = prevDocById.get(state._id);
    // Bridge A: these four paths are demolished for playable regions, so resolve
    // them from the political board first. `?? undefined` is required, not
    // cosmetic — legacyUnit returns `number | null` while TfpBasketInputs fields
    // are `number | undefined`, and a null would bypass the basket's own orRef()
    // reference fallback. economic.rdIntensity and population.urbanizationRate
    // are macroMetrics survivors present for every country, so they stay on the
    // direct read.
    const tfpPath = (path: string): number | undefined =>
      politicalInputs.legacyUnit(state._id, path) ??
      readMetricPath(prevDocForTfp, path, "value") ??
      undefined;
    const tfp = tfpBasket({
      rdIntensity: readMetricPath(prevDocForTfp, "economic.rdIntensity", "value"),
      workforceSkill: tfpPath("education.workforceSkill"),
      transportEfficiency: tfpPath("infrastructure.transportEfficiency"),
      broadbandAccess: tfpPath("infrastructure.broadbandAccess"),
      powerGridReliability: tfpPath("infrastructure.powerGridReliability"),
      urbanizationRate: readMetricPath(prevDocForTfp, "population.urbanizationRate", "value"),
    });
    const basePotential = potentialGrowth(gL, capStep.annualizedGrowth, tfp);
    // Macro-growth v1 (design §4): add the convergence bonus (O2) OUTSIDE the TFP
    // clamp, then blend the LAGGED sector signal (O3). Flag off ⇒ potential ===
    // basePotential (byte-identical). frontierPc = live max across countries.
    let potential = basePotential;
    if (macroGrowthEnabled) {
      // Playable economies only (cm present ⇒ has a national doc + gdp/pop). O2
      // then O3, both scoped the same way so a latent region gets neither.
      if (countryMacro) {
        potential =
          basePotential +
          convergenceBonus(
            countryMacro.ownPcAnchor,
            macroInputs.frontierPcAnchor,
            countryMacro.openness
          );
        const sectorLagged = prevSectorValue.get(state._id);
        if (sectorLagged !== undefined) {
          potential = applySectorBlend(potential, sectorLagged);
        }
      }
    }
    const prevGap = state.outputGap ?? 0;

    // Prev feeds the SECTOR node's EMA + policy delta (P1c-2). `potential` and the
    // prior output gap are threaded to the gdpGrowth/unemployment nodes via
    // seedCurrent (they are not registry nodes).
    const prevValue: Record<NodeId, number> = {};
    const prevSimBaseline: Record<NodeId, number> = {};
    const policyValues: Record<NodeId, number> = {};

    const sectorVal = prevSectorValue.get(state._id);
    if (sectorVal !== undefined) {
      prevValue["economic.sectorGrowth"] = sectorVal;
      policyValues["economic.sectorGrowth"] = sectorVal; // delta numerator
    }
    const sectorBase = prevSectorBaseline.get(state._id);
    if (sectorBase !== undefined) prevSimBaseline["economic.sectorGrowth"] = sectorBase;

    // Unemployment is a value-EMA: feed the prior VALUE (defaulted to 4.5) as its
    // simBaseline; used for BOTH the Okun target and the EMA blend.
    const unempVal = prevUnemployment.get(state._id) ?? DEFAULT_UNEMPLOYMENT;
    prevSimBaseline["economic.unemploymentRate"] = unempVal;
    prevValue["economic.unemploymentRate"] = unempVal;

    // Generic nodes (P2+): registry-derived wiring. The stored value is BOTH the
    // prev and the policyValue (processStateMetrics already ran this turn);
    // simBaseline comes from the node's own prior write. Missing either →
    // evalNode's cold-start fallbacks make the first live turn write back the
    // stored value exactly (parity by construction).
    const prevDoc = prevDocById.get(state._id);
    const seedCurrent: Record<NodeId, number> = {
      "economic.potentialGrowth": potential,
      "economic.outputGapPrev": prevGap,
    };
    for (const n of GENERIC_NODES) {
      const v = readMetricPath(prevDoc, n.id, "value");
      if (v !== undefined) {
        prevValue[n.id] = v;
        policyValues[n.id] = v;
      }
      const b = readMetricPath(prevDoc, n.id, "simBaseline");
      if (b !== undefined) prevSimBaseline[n.id] = b;
    }
    for (const id of GENERIC_LAGGED_IDS) {
      const v = readMetricPath(prevDoc, id, "value");
      if (v !== undefined) prevValue[id] = v;
    }
    for (const id of GENERIC_SEED_IDS) {
      const v = readMetricPath(prevDoc, id, "value");
      if (v !== undefined) seedCurrent[id] = v;
    }
    // Political inputs come from the BOARD now, in legacy units. `legacyUnit`
    // first because Bridge A's bands are derived from each consuming engine's
    // own neutral, so a score of 50 reproduces that engine's prior behaviour
    // exactly; `legacyValue` is the generic inverse of the derivation and
    // covers the paths Bridge A has no authored band for. A path resolving to
    // neither is left absent, and the node's own `??` fallback applies — the
    // same treatment a missing stored value always got.
    for (const id of POLITICAL_INPUT_IDS) {
      const v =
        politicalInputs.legacyUnit(state._id, id) ?? politicalInputs.legacyValue(state._id, id);
      if (v != null && Number.isFinite(v)) seedCurrent[id] = v;
    }
    // v2-2/v2-3: labour wage-index Δ → medianIncome + unemployment, gated on
    // labourSystemMode ≥ "macro" (the corp turn writes the fields whenever
    // wages are enabled, a lower tier — so the gate has to live here, not at
    // the write side).
    if (labourMacroEnabled) {
      const wageDelta = readMetricPath(prevDoc, "economic.labourWageIndexDelta", "value");
      if (wageDelta !== undefined) seedCurrent["economic.labourWageIndexDelta"] = wageDelta;
      // v2-3b: automation half of the jobs channel — unemploymentNode only.
      const automationDelta = readMetricPath(prevDoc, "economic.automationIndexDelta", "value");
      if (automationDelta !== undefined) {
        seedCurrent["economic.automationIndexDelta"] = automationDelta;
      }
    }

    // §6.3 (P7b): the country's LAGGED economic model nudges its synergy metrics'
    // targets (node targets only; resolved to node ids). Parity-neutral when no
    // named model / mixed (empty map → all nudges default to 0 in evalNode).
    const nationalDocId = getNationalDocId(countryId);
    const countryModel = nationalDocId ? prevDocById.get(nationalDocId)?.economicModel : undefined;
    let cachedNudges = targetNudgesByCountry.get(countryId);
    if (!cachedNudges) {
      cachedNudges = {};
      for (const [metricId, nudge] of synergyNudges(countryModel)) {
        const nodeId = nodeIdByMetricId.get(metricId);
        if (nodeId) cachedNudges[nodeId] = nudge;
      }
      // Fold in active org-directive + alliance-posture nudges for this state's
      // country (added to any economic-model synergy already targeting the node).
      for (const byCountry of [
        directiveNudgesByCountry,
        postureNudgesByCountry,
        agencyNudgesByCountry,
      ]) {
        const nudges = byCountry.get(countryId);
        if (!nudges) continue;
        for (const [metricId, delta] of nudges) {
          const nodeId = nodeIdByMetricId.get(metricId);
          if (nodeId) cachedNudges[nodeId] = (cachedNudges[nodeId] ?? 0) + delta;
        }
      }
      targetNudgesByCountry.set(countryId, cachedNudges);
    }
    // Fresh copy per state: downstream consumers must not share mutable state.
    const targetNudges: Record<NodeId, number> = { ...cachedNudges };

    // §6.4 (P7b): coherent (signature-category) spending goes further under a
    // held model. Scale the per-capita rollup before nodes consume it via
    // {spending}. Parity-neutral when no named model / mixed (returns the same map).
    const spending = applySpendingEfficiency(
      spendingRollup.perCapitaByRegion.get(state._id) ?? {},
      countryModel
    );

    // Era envelopes per node for this state's country (null year ⇒ empty map ⇒
    // no clamps). Only enveloped catalog metrics get an entry.
    let cachedEnvelopes = envelopesByCountry.get(countryId);
    if (!cachedEnvelopes) {
      cachedEnvelopes = {};
      if (eraYear != null) {
        for (const n of MACRO_NODES) {
          const env = getEraEnvelope(n.metricId, countryId, eraYear);
          if (env) cachedEnvelopes[n.id] = env;
        }
      }
      envelopesByCountry.set(countryId, cachedEnvelopes);
    }
    const envelopes = { ...cachedEnvelopes };

    const results = evaluateRegistry(MACRO_NODES, {
      stateId: state._id,
      countryId,
      prev: prevValue,
      prevSimBaseline,
      providers: {
        sectorRevenueTax: payload,
        // National approval applied to every state of the country (a regional
        // approval variant is a named future refinement). Missing doc → 45.
        governmentApproval: approvalByCountry.get(countryId) ?? 45,
        // Dynamic fiscal-growth inputs for wageGrowth/tradeGrowth (per country;
        // the nodes' own ?? fallbacks cover a missing budget doc).
        fiscalTradeInputs: fiscalTradeInputsByCountry.get(countryId),
        // Undefined for a country at peace; the consuming nodes read that as zero.
        warDamage: warDamageByCountryId.get(countryId),
      },
      spending,
      policyValues,
      seedCurrent,
      targetNudges,
      envelopes,
    });

    const sectorSignal = results["economic.sectorGrowth"].value;
    const integratedGdp = results["economic.gdpGrowth"].value;
    // The gdpGrowth node returns the integrated RATE; recompute the gap STOCK from
    // the same inputs (deterministic → consistent) to persist state.outputGap.
    const gapStep = advanceOutputGap(prevGap, sectorSignal, potential, TURNS_PER_YEAR);

    // Integrated rate = potential + cyclical (output gap, P1c-2). gdpGrowth
    // keeps its approval term + metricDefinitions entry; the sector signal
    // is a surfaced intermediate (excluded from approval). potentialGrowth +
    // laborForce surfaced (P1c-1), also approval-excluded.
    const setFields: Record<string, number | Date> = {
      "economic.gdpGrowth.value": integratedGdp,
      "economic.sectorGrowth.value": sectorSignal,
      "economic.sectorGrowth.simBaseline": results["economic.sectorGrowth"].simBaseline,
      "economic.unemploymentRate.value": results["economic.unemploymentRate"].value,
      "economic.potentialGrowth.value": potential,
      "economic.laborForce.value": laborForce,
      "economic.labourParticipationDemandBonus.value": participationDemandBonus,
      lastUpdated: now,
    };
    // Generic nodes (P2+): persist value + simBaseline per node — but ONLY for
    // metrics the region already stores. Approval scores every metric PRESENT
    // (audit-5), so persisting a node a region never had (e.g. UK-only
    // gcseAttainment on a US doc) would INTRODUCE a new approval term and
    // shift approval. Country scoping falls out of seed presence naturally.
    for (const n of GENERIC_NODES) {
      const r = results[n.id];
      if (!r) continue;
      const prevVal = readMetricPath(prevDoc, n.id, "value");
      if (prevVal === undefined) continue;
      setFields[`${n.id}.value`] = r.value;
      setFields[`${n.id}.simBaseline`] = r.simBaseline;
      // #909: persist the per-turn delta so the UI's rate-of-change / TrendChip
      // has data for every engine-animated metric. Previously only
      // independenceDesire wrote a `trend`, so every other metric rendered
      // "flat" regardless of actual movement (the reported "rate of change is
      // not shown"). Convention matches independenceDesireDrift: raw value delta.
      setFields[`${n.id}.trend`] = r.value - prevVal;
    }

    // 📊 budget-sync (exact mirror): fiscal-readout metrics equal the real ratio
    // this turn, scoped by the persist gate — only where the region already stores
    // them (keeps schuldenbremse to 2019-era presets, ratios to budgeted
    // countries). No simBaseline: these are not coexistence nodes.
    Object.assign(
      setFields,
      fiscalMirrorFields(
        fiscalRatiosByCountry.get(countryId),
        (id) => readMetricPath(prevDoc, id, "value") !== undefined
      )
    );

    // Macro only. Every node evaluated above is a macro node, so the filter is
    // a guard rather than a router: a political path reaching it would mean
    // something is trying to persist a board metric into the macro doc.
    const macroSet: Record<string, number | Date> = {};
    for (const [key, value] of Object.entries(setFields)) {
      if (key === "lastUpdated") continue;
      if (isMacroMetricPath(key)) macroSet[key] = value;
    }
    if (Object.keys(macroSet).length > 0) {
      macroSet.lastUpdated = now;
      macroOps.push({ updateOne: { filter: { _id: state._id }, update: { $set: macroSet } } });
    }

    // Compound the region's GDP LEVEL by the INTEGRATED gdpGrowth this turn (exact
    // per-turn form). state.gdp is the SSOT (millions); national GDP = Σ state.gdp.
    const newGdp = compoundGdpLevel(state.gdp ?? 0, integratedGdp, TURNS_PER_YEAR);
    stateOps.push({
      updateOne: {
        filter: { _id: state._id },
        update: {
          $set: {
            gdp: newGdp,
            capitalStock: capStep.capital,
            outputGap: gapStep.gap,
            // P2/D7: snapshot THIS turn's realized owned-sector revenue as the
            // next turn's baseline. Written in every mode (not just plants) so a
            // flip to plants already has a one-turn-old baseline and does not
            // spend a turn on the legacy fallback. The BASIS is still plants-
            // gated: below plants this stays the nameplate sum it has always
            // been, so non-plants worlds see no level shift.
            // Under plants the snapshot is HOST currency (ticket #1084) so the
            // next turn's ratio is FX-invariant.
            sectorRealizedRevenue: sectorTax.plantsEnabled
              ? nowHost
              : sumRealizedRevenue(ownedForState, false),
            sectorRealizedRevenueTurn: turn,
            ...(sectorTax.plantsEnabled ? { sectorRealizedRevenueUnit: "host" as const } : {}),
            // Trailing-trend state (host-tagged plants worlds only). The first
            // plants turn is unit-untagged, so this starts one turn later with
            // a clean host-only series.
            ...(outputEmaNow !== undefined ? { sectorOutputEma: outputEmaNow } : {}),
            ...(outputSnapshots !== undefined ? { sectorOutputSnapshots: outputSnapshots } : {}),
            ...(revenueEmaNow !== undefined ? { sectorRevenueEma: revenueEmaNow } : {}),
            ...(nextSnapshots !== undefined ? { sectorRevenueSnapshots: nextSnapshots } : {}),
          },
          // Dropping below plants returns the stored one-turn baseline to the
          // legacy unit. Remove the host tag and trend state so a later flip
          // starts a fresh host-only EMA and snapshot log on that exact turn.
          ...(!sectorTax.plantsEnabled || outputEmaNow === undefined
            ? {
                $unset: {
                  sectorOutputEma: "" as const,
                  sectorOutputSnapshots: "" as const,
                  ...(!sectorTax.plantsEnabled
                    ? {
                        sectorRealizedRevenueUnit: "" as const,
                        sectorRevenueEma: "" as const,
                        sectorRevenueSnapshots: "" as const,
                      }
                    : {}),
                },
              }
            : {}),
        },
      },
    });
  }

  if (macroOps.length > 0) {
    await db.collection<StateMetrics>("macroMetrics").bulkWrite(macroOps);
  }
  if (stateOps.length > 0) {
    await db.collection<State>("states").bulkWrite(stateOps);
  }
  return realStates.length;
}
