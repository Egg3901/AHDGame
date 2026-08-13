/**
 * Aggregates the read-only view-model for the National Corporation page (spec §17).
 * Every field traces to real engine data — sectors, per-state metrics (dynamic
 * efficiency), investor confidence, assumed bonds, the acquisition ledger. Money
 * is in the corp's local (country) currency; the page never shows ₳.
 */
import type { Db, ObjectId } from "mongodb";
import type {
  Bond,
  Character,
  Corporation,
  CorporateSector,
  GameState,
  State,
  StateMetrics,
} from "@/lib/db/types";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import {
  computeFillRate,
  fillRateBand,
  type FillRateBand,
} from "@/lib/corporations/financialFogOfWar";
import { summarizeBuildQueue, type BuildQueueSummary } from "@/lib/corporations/sectorBuildQueue";
import type { NationalizationLedgerEntry } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import { computeSoeEfficiencyBreakdown, type SoeEfficiencyBreakdown } from "./soeEfficiency";
import { politicalSoeInputs } from "@/lib/politicalLegislation/marginAdapter";
import { isPoliticalApprovalCountry } from "@/lib/politicalLegislation/politicalApprovalProvider";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { findMergedRegionMetricsManyForDisplay } from "@/lib/macroMetrics/displayMerge";
import {
  resolveSectorMandate,
  MANDATE_MAP,
  getMandateMetricPaths,
  getMandateContributions,
} from "./soeMandates";
import { getMetricDefinition, getMetricDisplayName } from "@/lib/constants/metricDefinitions";
import type { MetricCategoryId } from "@/lib/db/types/stateMetrics";
import { readInvestorConfidence } from "./investorConfidence";
import { readStateOwnershipConcentration, sociMultiplier } from "./concentration";
import {
  INVESTOR_CONFIDENCE_BASELINE,
  CONFIDENCE_RECOVERY_PER_TURN,
  MAX_PROFIT_RETENTION_PERCENT,
  DEFAULT_TREASURY_DRAW_CAP,
  CARVE_FRACTION_MAX,
  maxCarveFractionForMarketShare,
  NATCORP_RD_FULL_FUND_REVENUE_FRACTION,
} from "./constants";
import { fetchMarketSharePercentForSectors } from "@/lib/corporations/marketShare";
import { assertTreasuryAuthority } from "./authority";
import { getNationalizationLedger, getCountryNationalizationLedger } from "./ledger";
import {
  summarizeRegister,
  confidenceFeeds,
  loadRegisterStanding,
  type RegisterRow,
  type RegisterTotals,
  type RegisterStanding,
  type ConfidenceFeed,
} from "./registerView";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { getDesignatedSectorTypes } from "./strategicSectors";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";

/** Human-readable label for a `category.field` metric path (region-aware). */
function mandateMetricLabel(path: string, stateId?: string): string {
  const [category, field] = path.split(".");
  const def = getMetricDefinition(category as MetricCategoryId, field);
  return def ? getMetricDisplayName(def, stateId) : (field ?? path);
}

/** Read a `category.field` metric's current value (0–100) from a state-metrics doc. */
function readMetricValue(metrics: StateMetrics | undefined, path: string): number | null {
  const [category, field] = path.split(".");
  const cat = (metrics as unknown as Record<string, Record<string, { value?: number }>>)?.[
    category
  ];
  const v = cat?.[field]?.value;
  return typeof v === "number" ? Math.round(v) : null;
}

/** Map a raw ledger trigger token to a player-facing label (matches the Holdings design). */
const ACQUISITION_TRIGGER_LABEL: Record<string, string> = {
  distress: "Financial distress",
  strategic: "Strategic sector",
  monopoly: "Monopoly / dominance",
  supermajority: "Supermajority vote",
};

export interface NatViewSector {
  sectorId: string;
  sectorType: CorporationType;
  stateId: string;
  /** Full region name (e.g. "Dublin"), resolved from the states collection. */
  stateName: string;
  revenue: number;
  workers: number;
  profitMargin: number;
  /** CEO-set target growth rate this sector trends toward each turn (%). */
  targetGrowthRate: number;
  /** Growth rate actually applied this turn (trends toward the target). */
  currentGrowthRate: number;
  /**
   * Active production method (suggestion #91). The national CEO panel never
   * exposed this, so a state-owned sector was stuck on whatever it was seeded
   * with — even though `setSectorStrategy` has always accepted the national
   * CEO (it only checks `requireCeo`, with no state-owned exclusion).
   */
  strategyId: string;
  /**
   * Set while a retool is in flight; the strategy being moved AWAY from. The UI
   * locks the selector while this is present, matching the command, which
   * rejects a second change mid-transition.
   */
  transitionFromStrategyId?: string;
  /** CEO-set production-policy target (−25…+25); active level trends toward it 1pt/turn. */
  productionPolicy: number;
  /** Production level actually applied this turn (trends toward productionPolicy). */
  productionPolicyLevel: number;
  /** This holding's share of the whole (state, sectorType) market (0–100). Officials only. */
  marketSharePercent: number;
  /** Largest privatization carve fraction (0–1) that keeps the new corp ≤30% market share. */
  maxCarveFraction: number;
  priceControlled: boolean;
  employmentGuaranteed: boolean;
  efficiency: SoeEfficiencyBreakdown;
  /** SOE margin delta vs an unconstrained private corp (the efficiency drag, pp). */
  vsPrivateMarginDelta: number;
  /** Per-turn operating profit (local currency) after the efficiency penalty. */
  operatingProfit: number;
  /** True when this sector carries its own posture override (vs inheriting the corp default). */
  mandateIsOverride: boolean;
  /** Human-readable state-metric names this sector's mandate uplifts (region-aware). */
  mappedMetricLabels: string[];
  /** Per-turn public-value uplift to the mapped metric(s), price-control-boosted. */
  publicValuePerTurn: number;
  /** Current value (0–100) of the primary mapped metric in this region, for the metric bar. */
  sectorMetricLevel: number | null;
  /** Display label for how this holding was acquired (e.g. "Financial distress"). */
  acquisitionTrigger: string | null;
  /** Former owner's corp name the sector was absorbed from (null for founding/seeded). */
  acquisitionFrom: string | null;
  /** Turn the sector was absorbed (null when unknown / founding). */
  acquisitionTurn: number | null;

  /* ── Plants tier. Null outside plants; units are output units per DAY. ── */
  /** Nameplate productive capacity. */
  capacityUnits: number | null;
  producedUnits: number | null;
  soldUnits: number | null;
  /** Exact fill rate. The minister and the CEO both run this corp, so no banding. */
  fillRate: number | null;
  fillRateBand: FillRateBand | null;
  mothballed: boolean;
  buildQueueSummary: BuildQueueSummary | null;
}

export interface NationalCorporationViewModel {
  corporationId: string;
  countryId: CountryId;
  name: string;
  isPrimary: boolean;
  assignedSectorTypes: CorporationType[];
  ceoVacant: boolean;
  /** Treasury OR head-of-government — controls the official-view toggle. */
  viewerIsOfficial: boolean;
  /** Finance-minister-equivalent / HoG fallback — privatize, CEO, mandate, split/merge. */
  viewerHasTreasuryAuthority: boolean;
  /** Sitting head of government — nationalize + strategic-sector designation. */
  viewerIsHeadOfGovernment: boolean;
  /** The seated CEO of this corp — unlocks the Operations tab (spec P6g §3). */
  viewerIsCeo: boolean;
  /** CEO/ministry finance config surfaced to the Operations tab (spec P6g §5). */
  finance: {
    profitRetentionPercent: number; // 0–MAX_PROFIT_RETENTION_PERCENT
    treasuryDrawCap: number; // minister-set per-turn cap (local)
    liquidCapital: number; // the corp's working capital (local) — the CEO spend ceiling
    rdScore: number; // modernization momentum (0–MAX); breakthrough chance = score/MAX
    rdBudgetPerTurn: number; // CEO-set per-turn R&D spend (local); 0 ⇒ none
    rdFullFundBudget: number; // per-turn spend that sustains MAX modernization (local)
    rdSustainChancePercent: number; // breakthrough chance the current budget settles at (0–100)
  };
  /** Sector types currently designated strategic for this country (spec §6.3). */
  designatedStrategicSectorTypes: CorporationType[];
  ceo: {
    characterId: string | null;
    /** CEO character sequentialId for the profile link (falls back to characterId). */
    sequentialId: number | null;
    name: string | null;
    vacant: boolean;
    pendingName: string | null;
  };
  corpMandate: { priceControlled: boolean; employmentGuaranteed: boolean };
  currency: CurrencyCode;
  stats: {
    treasuryRemittancePerTurn: number;
    grossRevenuePerTurn: number; // sum of held-sector revenue, before margin
    mandateSubsidyPerTurn: number; // treasury cost of price-controlled margin drag (≥0)
    investorConfidence: number;
    soeEfficiencyPenalty: number; // revenue-weighted avg vs the old flat −15
    citizensServed: number;
    jobsGuaranteed: number;
    publicValueIndex: number; // # of holdings delivering a public mandate
    priceControlledSectorCount: number;
    sectorCount: number;
    regionsCovered: number; // # of distinct regions the corp holds sectors in
    confidenceBaseline: number; // heal target (0–100)
    confidenceTrendPerTurn: number; // per-turn heal toward baseline (≥0; 0 when at/above)
  };
  holdingsByRegion: Array<{ stateId: string; stateName: string; sectors: NatViewSector[] }>;
  /**
   * True under `marketSystemMode >= "plants"`. The CEO panel's growth sliders
   * are hidden there: capacity is bought per plant, so a growth target writes a
   * number nothing reads.
   */
  plantsMode: boolean;
  /** Every region of the country (alphabetical) — options for the IPO HQ selector. */
  countryRegions: Array<{ stateId: string; stateName: string }>;
  /** Public state-metrics this corp's mandates uplift, with contributing-sector counts. */
  mandateMetrics: Array<{ label: string; sectorCount: number }>;
  /** How the held sectors were acquired, grouped by trigger (acquisition register summary). */
  acquisitions: Array<{ trigger: string; label: string; sectorCount: number }>;
  assumedBonds: Array<{
    id: string;
    principal: number;
    couponRate: number;
    currencyCode: string;
    matured: boolean;
    maturityTurn: number | null;
    issuer: string | null;
    status: "Performing" | "Watch";
  }>;
  mandates: Array<{
    sectorId: string;
    sectorType: CorporationType;
    stateId: string;
    stateName: string;
    priceControlled: boolean;
    employmentGuaranteed: boolean;
    isOverride: boolean;
    /** Human-readable state-metric names this sector's mandate uplifts (country/region-aware). */
    mappedMetrics: string[];
    /** Per-turn public-value uplift to the mapped metric(s), price-control-boosted. */
    publicValuePerTurn: number;
    /** SOE efficiency penalty (pp) — the operating-margin drag, signed. */
    efficiencyPct: number;
    /** Operating profit per turn (local currency) at the current effective margin. */
    profitPerTurn: number;
  }>;
  /** This corp's own acquisition ledger (backs the Holdings "how acquired" grouping). */
  ledger: NationalizationLedgerEntry[];
  /**
   * Country-wide state-ownership history across every NatCorp (primary +
   * split-offs), newest first — the public State Ownership Register.
   */
  countryLedger: NationalizationLedgerEntry[];
  /** Display-ready register: stat-strip totals, per-taking rows, governing standing. */
  register: { rows: RegisterRow[]; totals: RegisterTotals; standing: RegisterStanding };
  /** The three live systems the investor-confidence index feeds (display tiles). */
  confidenceFeeds: ConfidenceFeed[];
  /** State Ownership Concentration Index (SOCI, 0–100) — Register tab stat. */
  stateOwnershipConcentration: number;
}

export async function buildNationalCorporationView(
  db: Db,
  corp: Corporation,
  viewerCharacterId: ObjectId | null
): Promise<NationalCorporationViewModel> {
  const countryId = (corp.countryOwnerId ?? corp.countryId) as CountryId;
  const currency = (corp.liquidCurrencyCode ??
    COUNTRY_CURRENCY_MAP[countryId] ??
    "USD") as CurrencyCode;

  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: corp._id })
    .toArray();

  const stateIds = Array.from(new Set(sectors.map((s) => s.stateId)));

  // Two different reads of the same regions, because they answer different
  // questions and must not be collapsed:
  //
  //  - `metricsById` is for DISPLAY — the mandate-metric level shown per sector.
  //    Those paths are mostly political (healthcare.physicianRate,
  //    infrastructure.roadCondition), so this needs the board projected into
  //    legacy shape. Reading the retired legacy store here meant every mandate
  //    metric rendered as no-data.
  //  - `politicalSoeById` is for the EFFICIENCY MATH — the adapter-converted
  //    corruption/transparency inputs, on the board's own scale rather than the
  //    display projection. Same inputs the turn loop (sectorTurn) uses, so the
  //    Holdings drill-down keeps matching the turn.
  const [mergedMetrics, politicalDocs] = await Promise.all([
    stateIds.length > 0
      ? findMergedRegionMetricsManyForDisplay(db, { _id: { $in: stateIds } })
      : Promise.resolve([]),
    isPoliticalApprovalCountry(countryId) && stateIds.length > 0
      ? db
          .collection<PoliticalMetricsDoc>("politicalMetrics")
          .find({ _id: { $in: stateIds } })
          .toArray()
      : Promise.resolve([]),
  ]);
  const metricsById = new Map(mergedMetrics.map((m) => [String(m._id), m]));
  const politicalSoeById = new Map(
    politicalDocs.map((doc) => [String(doc._id), politicalSoeInputs(doc.values)])
  );

  // Resolve full region names (e.g. "HD" → "Huadong") so every NatCorp surface
  // shows the proper name rather than the internal stateId abbreviation.
  const stateNameDocs =
    stateIds.length > 0
      ? await db
          .collection<State>("states")
          .find({ _id: { $in: stateIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : [];
  const stateNameById = new Map(stateNameDocs.map((s) => [String(s._id), s.name]));
  const regionName = (id: string) => stateNameById.get(id) ?? id;

  // All regions of the country (alphabetical), for the IPO headquarters selector
  // in the privatize wizard. Distinct from the held-region names above, which
  // only cover regions this corp already operates in.
  const countryRegionDocs = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, name: 1 } })
    .toArray();
  const countryRegions = countryRegionDocs
    .map((s) => ({ stateId: String(s._id), stateName: s.name }))
    .sort((a, b) => a.stateName.localeCompare(b.stateName));

  // SOCI escalation for this country's SOEs (overreach term) — read once; same
  // source the turn + budget read, so the Holdings drill-down matches the turn.
  // The raw value is also surfaced on the view-model (Register tab stat).
  const stateOwnershipConcentration = await readStateOwnershipConcentration(db, countryId);
  const soeConcentrationMultiplier = sociMultiplier(stateOwnershipConcentration);

  // Plants tier: the ministry's CEO panel swaps its growth sliders for a build
  // summary, so the view model has to carry the physical figures. Read once.
  const plantsMode = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const currentTurnForBuilds = plantsMode
    ? ((await db.collection<GameState>("gameState").findOne({ _id: "current" }))?.currentTurn ?? 0)
    : 0;

  const viewSectors: NatViewSector[] = sectors.map((s) => {
    const mandate = resolveSectorMandate(corp, s);
    const m = metricsById.get(s.stateId);
    const politicalSoe = politicalSoeById.get(s.stateId);
    const efficiency = computeSoeEfficiencyBreakdown({
      corruptionIndex:
        m?.governance?.corruptionIndex?.value ?? politicalSoe?.corruptionIndex ?? null,
      governmentTransparency:
        m?.governance?.governmentTransparency?.value ??
        politicalSoe?.governmentTransparency ??
        null,
      priceControlled: !!mandate.priceControlled,
      employmentGuaranteed: !!mandate.employmentGuaranteed,
      concentrationMultiplier: soeConcentrationMultiplier,
    });
    // Use the margin the sector actually OPERATED at last turn
    // (`effectiveProfitMargin`, written by sectorTurn) — `profitMargin` is a
    // seeded constant no turn phase updates, and it collapsed operating profit
    // (and treasury remittance / mandate subsidy) to ~0 for SOE sectors once the
    // efficiency penalty was subtracted from it (ticket #1072). effectiveProfitMargin
    // already bakes in the SOE penalty, so efficiency.total is NOT re-applied here.
    // Fall back to the old computation for sectors not yet processed by a turn.
    const effectiveMarginPct = Math.max(
      0,
      s.effectiveProfitMargin ?? s.profitMargin + efficiency.total
    );

    // Public-value uplift: the SOE-internal share of this (state, sectorType)
    // drives the per-turn mandate-metric magnitude (same as the turn loop). Sums
    // ALL the public good the sector delivers — the mapped state-metric uplift
    // (price control ×1.5) AND the employment guarantee's unemployment relief —
    // so both postures raise the number and an unmapped sector still shows the
    // relief it provides.
    let stateSectorRevenue = 0;
    for (const x of sectors) {
      if (x.stateId === s.stateId && x.sectorType === s.sectorType) {
        stateSectorRevenue += Math.max(0, x.revenue);
      }
    }
    const soeShare = stateSectorRevenue > 0 ? Math.max(0, s.revenue) / stateSectorRevenue : 0;
    const publicValuePerTurn =
      Math.round(
        getMandateContributions(countryId, { sectorType: s.sectorType }, mandate, soeShare).reduce(
          (sum, c) => sum + Math.abs(c.delta),
          0
        ) * 100
      ) / 100;
    const metricPaths = getMandateMetricPaths(countryId, s.sectorType);
    const mappedMetricLabels = metricPaths.map((p) => mandateMetricLabel(p, s.stateId));
    const sectorMetricLevel = metricPaths[0] ? readMetricValue(m, metricPaths[0]) : null;

    return {
      sectorId: String(s._id),
      sectorType: s.sectorType,
      stateId: s.stateId,
      stateName: regionName(s.stateId),
      revenue: s.revenue,
      workers: s.workers,
      profitMargin: s.profitMargin,
      targetGrowthRate: s.targetGrowthRate ?? 0,
      currentGrowthRate: s.currentGrowthRate ?? 0,
      strategyId: s.strategyId ?? "standard",
      ...(s.transitionFromStrategyId
        ? { transitionFromStrategyId: s.transitionFromStrategyId }
        : {}),
      productionPolicy: s.productionPolicy ?? 0,
      productionPolicyLevel: s.productionPolicyLevel ?? 0,
      capacityUnits:
        plantsMode && Number.isFinite(s.capitalStock) ? (s.capitalStock as number) : null,
      producedUnits:
        plantsMode && Number.isFinite(s.producedUnits) ? (s.producedUnits as number) : null,
      soldUnits: plantsMode && Number.isFinite(s.soldUnits) ? (s.soldUnits as number) : null,
      fillRate: plantsMode ? computeFillRate(s.producedUnits ?? null, s.soldUnits ?? null) : null,
      fillRateBand: plantsMode
        ? fillRateBand(computeFillRate(s.producedUnits ?? null, s.soldUnits ?? null))
        : null,
      mothballed: plantsMode ? s.mothballed === true : false,
      buildQueueSummary: plantsMode
        ? summarizeBuildQueue(s.buildQueue, currentTurnForBuilds)
        : null,
      marketSharePercent: 0,
      maxCarveFraction: CARVE_FRACTION_MAX,
      priceControlled: !!mandate.priceControlled,
      employmentGuaranteed: !!mandate.employmentGuaranteed,
      efficiency,
      vsPrivateMarginDelta: efficiency.total,
      operatingProfit: Math.round(s.revenue * (effectiveMarginPct / 100)),
      mandateIsOverride: s.soeMandate != null,
      mappedMetricLabels,
      publicValuePerTurn,
      sectorMetricLevel,
      acquisitionTrigger: null,
      acquisitionFrom: null,
      acquisitionTurn: s.absorbedAtTurn ?? null,
    };
  });

  // Group holdings by region.
  const byRegion = new Map<string, NatViewSector[]>();
  for (const vs of viewSectors) {
    byRegion.set(vs.stateId, [...(byRegion.get(vs.stateId) ?? []), vs]);
  }
  const holdingsByRegion = Array.from(byRegion.entries())
    .map(([stateId, secs]) => ({ stateId, stateName: regionName(stateId), sectors: secs }))
    .sort((a, b) => a.stateName.localeCompare(b.stateName));

  // Headline stats.
  const totalRevenue = viewSectors.reduce((acc, s) => acc + s.revenue, 0);
  const weightedPenalty =
    totalRevenue > 0
      ? viewSectors.reduce((acc, s) => acc + s.efficiency.total * s.revenue, 0) / totalRevenue
      : 0;
  const treasuryRemittancePerTurn = viewSectors.reduce((acc, s) => acc + s.operatingProfit, 0);
  const citizensServed = viewSectors.reduce((acc, s) => acc + s.workers, 0);
  const jobsGuaranteed = viewSectors
    .filter((s) => s.employmentGuaranteed)
    .reduce((acc, s) => acc + s.workers, 0);
  const publicValueIndex = viewSectors.filter((s) => MANDATE_MAP[s.sectorType] != null).length;
  const investorConfidence = await readInvestorConfidence(db, countryId);
  // Confidence heals toward baseline only while below it (a taking is the only
  // thing that pushes it down). At/above baseline the per-turn trend is 0.
  const confidenceTrendPerTurn =
    investorConfidence < INVESTOR_CONFIDENCE_BASELINE
      ? Math.round(
          (INVESTOR_CONFIDENCE_BASELINE - investorConfidence) * CONFIDENCE_RECOVERY_PER_TURN * 10
        ) / 10
      : 0;

  const bonds = await db
    .collection<Bond>("bonds")
    .find({ corporationId: corp._id, matured: false })
    .toArray();
  const assumedBonds = bonds.map((b) => ({
    id: String(b._id),
    principal: b.totalIssued ?? 0,
    couponRate: b.couponRate ?? 0,
    currencyCode: b.currencyCode ?? currency,
    matured: !!b.matured,
    maturityTurn: b.maturityTurn ?? null,
    // Original issuer is captured at assumption; absent on pre-feature rows.
    issuer: b.originalIssuerName ?? null,
    status: b.defaulted ? ("Watch" as const) : ("Performing" as const),
  }));

  // Per-corp ledger backs the Holdings "how acquired" grouping (this corp's own
  // takings). The country-wide ledger backs the public State Ownership Register.
  const corpLedger = await getNationalizationLedger(db, corp._id);
  const countryLedger = await getCountryNationalizationLedger(db, countryId);

  // Register view (stat strip + acquisition table + political ledger): convert the
  // ₳ ledger amounts to local currency, derive per-taking political impact, and
  // read the governing bloc's standing. Best-effort — never fail the page over it.
  const fxByCurrency = await loadFxRatesByCurrency(db);
  const countryFxRate = fxByCurrency.get(currency) ?? 1;
  const standing = await loadRegisterStanding(db, countryId);
  const register = summarizeRegister(countryLedger, {
    currency,
    fxRate: countryFxRate,
    ideologyMultiplier: standing.ideologyMultiplier,
  });
  const confidenceFeedTiles = confidenceFeeds(investorConfidence, INVESTOR_CONFIDENCE_BASELINE);

  // Acquisition provenance for the Holdings cards: match each holding to its
  // nationalization ledger entry by sector type + absorbed turn (the ledger has
  // no per-sector key). Founding / seeded sectors have no entry → founding charter.
  for (const vs of viewSectors) {
    const entry =
      vs.acquisitionTurn != null
        ? corpLedger.find(
            (l) => l.turn === vs.acquisitionTurn && l.sectorTypes.includes(vs.sectorType)
          )
        : undefined;
    if (entry) {
      vs.acquisitionFrom = entry.formerCorpName ?? null;
      const token = entry.triggers?.[0] ?? "";
      vs.acquisitionTrigger = ACQUISITION_TRIGGER_LABEL[token] ?? "Nationalized";
    } else {
      vs.acquisitionTrigger = "Founding charter";
    }
  }

  // Gross revenue + the treasury cost of price control (the mandate-subsidy line):
  // a price-controlled sector's `efficiency.mandate` is the margin penalty (≤0 pp),
  // so the forgone operating profit = revenue × (−mandate / 100).
  const grossRevenuePerTurn = Math.round(totalRevenue);
  const mandateSubsidyPerTurn = Math.round(
    viewSectors.reduce(
      (acc, s) => acc + (s.priceControlled ? (s.revenue * -s.efficiency.mandate) / 100 : 0),
      0
    )
  );
  const sectorCount = viewSectors.length;
  const priceControlledSectorCount = viewSectors.filter((s) => s.priceControlled).length;

  // Public-mandate scorecard: which state metrics this corp's sectors uplift, and
  // how many held sectors contribute to each (one count per sector per metric).
  const metricCounts = new Map<string, number>();
  for (const s of viewSectors) {
    const seen = new Set<string>();
    for (const path of getMandateMetricPaths(countryId, s.sectorType)) {
      const [category, field] = path.split(".");
      const label = getMetricDefinition(category as MetricCategoryId, field ?? "")?.name ?? field;
      if (!label || seen.has(label)) continue;
      seen.add(label);
      metricCounts.set(label, (metricCounts.get(label) ?? 0) + 1);
    }
  }
  const mandateMetrics = Array.from(metricCounts.entries())
    .map(([label, secs]) => ({ label, sectorCount: secs }))
    .sort((a, b) => b.sectorCount - a.sectorCount || a.label.localeCompare(b.label));

  // "How holdings were acquired": group the acquisition ledger by trigger, then
  // attribute any held sectors not traceable to a logged taking to the founding
  // charter (seeded endowment).
  const ACQUISITION_CATEGORIES: Array<{ key: string; label: string; triggers: string[] }> = [
    { key: "distress", label: "Financial distress", triggers: ["distress"] },
    { key: "monopoly", label: "Monopoly / dominance", triggers: ["monopoly"] },
    { key: "strategic", label: "Strategic sector", triggers: ["strategic"] },
    { key: "supermajority", label: "Supermajority vote", triggers: ["supermajority"] },
    { key: "public", label: "Unowned / public", triggers: ["npc", "unowned"] },
  ];
  const acqCounts = new Map<string, number>();
  let ledgerSectorTotal = 0;
  for (const entry of corpLedger) {
    const n = entry.sectorTypes?.length ?? 0;
    ledgerSectorTotal += n;
    const cat =
      ACQUISITION_CATEGORIES.find((c) => (entry.triggers ?? []).some((t) => c.triggers.includes(t)))
        ?.key ?? "other";
    acqCounts.set(cat, (acqCounts.get(cat) ?? 0) + n);
  }
  const acquisitions: Array<{ trigger: string; label: string; sectorCount: number }> = [];
  for (const c of ACQUISITION_CATEGORIES) {
    const n = acqCounts.get(c.key) ?? 0;
    if (n > 0) acquisitions.push({ trigger: c.key, label: c.label, sectorCount: n });
  }
  const otherCount = acqCounts.get("other") ?? 0;
  if (otherCount > 0)
    acquisitions.push({ trigger: "other", label: "Other acquisition", sectorCount: otherCount });
  const foundingCount = Math.max(0, sectorCount - ledgerSectorTotal);
  if (foundingCount > 0)
    acquisitions.push({
      trigger: "founding",
      label: "Founding charter",
      sectorCount: foundingCount,
    });

  const characters = db.collection<Character>("characters");
  let ceoName: string | null = null;
  let ceoSequentialId: number | null = null;
  if (!corp.ceoVacant && corp.ceoId) {
    const ceoDoc = await characters.findOne({ _id: corp.ceoId });
    ceoName = ceoDoc?.name ?? null;
    ceoSequentialId = ceoDoc?.sequentialId ?? null;
  }
  let pendingName: string | null = null;
  if (corp.pendingCeoCharacterId) {
    const pendingDoc = await characters.findOne({ _id: corp.pendingCeoCharacterId });
    pendingName = pendingDoc?.name ?? null;
  }

  const viewerHasTreasuryAuthority = viewerCharacterId
    ? await assertTreasuryAuthority(db, countryId, viewerCharacterId)
    : false;
  const viewerIsHeadOfGovernment = viewerCharacterId
    ? await isSittingLeader(db, countryId, viewerCharacterId)
    : false;
  const viewerIsOfficial = viewerHasTreasuryAuthority || viewerIsHeadOfGovernment;

  // Per-holding market share + market-aware carve cap. Computed for every viewer
  // because the Holdings tab surfaces market share to the public too (the carve
  // cap is only read by the official privatize wizard). Mutates the shared
  // viewSector objects, which holdingsByRegion already references.
  if (sectors.length > 0) {
    const shareById = await fetchMarketSharePercentForSectors(db, sectors);
    for (const vs of viewSectors) {
      const share = shareById.get(vs.sectorId) ?? 0;
      vs.marketSharePercent = Math.round(share * 10) / 10;
      vs.maxCarveFraction = maxCarveFractionForMarketShare(share);
    }
  }

  const viewerIsCeo =
    !corp.ceoVacant &&
    corp.ceoId != null &&
    viewerCharacterId != null &&
    corp.ceoId.toString() === viewerCharacterId.toString();
  const finance = {
    profitRetentionPercent: Math.min(
      MAX_PROFIT_RETENTION_PERCENT,
      Math.max(0, corp.profitRetentionPercent ?? 0)
    ),
    treasuryDrawCap: corp.treasuryDrawCap ?? DEFAULT_TREASURY_DRAW_CAP,
    liquidCapital: Math.round(corp.liquidCapital ?? 0),
    rdScore: Math.round((corp.rdScore ?? 0) * 10) / 10,
    rdBudgetPerTurn: Math.round(corp.rdBudgetPerTurn ?? 0),
    rdFullFundBudget: Math.round(totalRevenue * NATCORP_RD_FULL_FUND_REVENUE_FRACTION),
    rdSustainChancePercent:
      totalRevenue > 0
        ? Math.min(
            100,
            Math.round(
              ((corp.rdBudgetPerTurn ?? 0) /
                (totalRevenue * NATCORP_RD_FULL_FUND_REVENUE_FRACTION)) *
                100
            )
          )
        : 0,
  };
  const designatedStrategicSectorTypes = Array.from(
    await getDesignatedSectorTypes(db, countryId)
  ) as CorporationType[];

  return {
    corporationId: String(corp._id),
    countryId,
    name: corp.name,
    isPrimary: !!corp.isPrimaryNationalCorporation,
    assignedSectorTypes: corp.assignedSectorTypes ?? [],
    ceoVacant: !!corp.ceoVacant,
    viewerIsOfficial,
    viewerHasTreasuryAuthority,
    viewerIsHeadOfGovernment,
    viewerIsCeo,
    finance,
    designatedStrategicSectorTypes,
    ceo: {
      characterId: !corp.ceoVacant && corp.ceoId ? String(corp.ceoId) : null,
      sequentialId: ceoSequentialId,
      name: ceoName,
      vacant: !!corp.ceoVacant,
      pendingName,
    },
    corpMandate: {
      priceControlled: !!corp.soeMandate?.priceControlled,
      employmentGuaranteed: !!corp.soeMandate?.employmentGuaranteed,
    },
    currency,
    stats: {
      treasuryRemittancePerTurn,
      grossRevenuePerTurn,
      mandateSubsidyPerTurn,
      investorConfidence,
      soeEfficiencyPenalty: Math.round(weightedPenalty * 10) / 10,
      citizensServed,
      jobsGuaranteed,
      publicValueIndex,
      priceControlledSectorCount,
      sectorCount,
      regionsCovered: holdingsByRegion.length,
      confidenceBaseline: INVESTOR_CONFIDENCE_BASELINE,
      confidenceTrendPerTurn,
    },
    holdingsByRegion,
    plantsMode,
    countryRegions,
    mandateMetrics,
    acquisitions,
    assumedBonds,
    // Per-sector public value / mapped metrics are computed once on viewSectors.
    mandates: viewSectors.map((s) => ({
      sectorId: s.sectorId,
      sectorType: s.sectorType,
      stateId: s.stateId,
      stateName: s.stateName,
      priceControlled: s.priceControlled,
      employmentGuaranteed: s.employmentGuaranteed,
      isOverride: s.mandateIsOverride,
      mappedMetrics: s.mappedMetricLabels,
      publicValuePerTurn: s.publicValuePerTurn,
      efficiencyPct: Math.round(s.efficiency.total * 10) / 10,
      profitPerTurn: s.operatingProfit,
    })),
    ledger: corpLedger,
    countryLedger,
    register: { rows: register.rows, totals: register.totals, standing },
    confidenceFeeds: confidenceFeedTiles,
    stateOwnershipConcentration,
  };
}
