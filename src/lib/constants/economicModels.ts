import type { CorporationType } from "./corporations";

/**
 * Economic-model classification (P7). Each country and region develops a named
 * economic identity that emerges from its sector mix, spending priorities, and
 * flagship laws (see docs/superpowers/specs/2026-06-09-economic-models-design.md).
 * P7a (this module + the classification engine + UI) is DESCRIPTIVE only; the four
 * effect channels (GDP concentration, corp bonuses, metric synergies, spending
 * efficiency) land in P7b and read `metricSynergies`/`spendingSignature` from here.
 */
export type EconomicModelId =
  | "militaryIndustrial"
  | "techInnovation"
  | "financialized"
  | "industrialPowerhouse"
  | "resourceExtraction"
  | "agrarian"
  | "serviceConsumer"
  | "socialMarket"
  | "stateCapitalist"
  | "mixed";

export const ECONOMIC_MODEL_IDS: readonly EconomicModelId[] = [
  "militaryIndustrial",
  "techInnovation",
  "financialized",
  "industrialPowerhouse",
  "resourceExtraction",
  "agrarian",
  "serviceConsumer",
  "socialMarket",
  "stateCapitalist",
  "mixed",
] as const;

export interface EconomicModelArchetype {
  id: EconomicModelId;
  /** Player-facing, English. */
  name: string;
  /** null only for "mixed" (the structureless residual). */
  primarySector: CorporationType | null;
  /** 2–3 for named models; empty for "mixed". */
  secondarySectors: CorporationType[];
  /** Budget categories this model leans on, weighted 0–1 (Spending signal). String
   *  keys = real `spending.byCategory` keys (no SpendingCategory union exists). */
  spendingSignature: Record<string, number>;
  /** Flagship-law intent tags that pull toward this model (Law signal). First-pass;
   *  matched best-effort against enacted-law identifiers until a law taxonomy lands. */
  lawSignature: string[];
  /** Per-turn signed target nudges applied while this model is held, scaled by
   *  intensity (P7b). Magnitude ≈ ±10 at full intensity. */
  metricSynergies: Array<{ metricId: string; maxNudge: number }>;
}

/** Start-date eras with their own historically-grounded seed identities. */
export type EconomicModelEra = "1991" | "2019";

/** Per-era seed economic model for a country (set in country config). */
export type EraSeedModels = Partial<Record<EconomicModelEra, EconomicModelId>>;

/** Which era a game's starting year falls into (pre-2005 → the 1991 preset). */
export function economicModelEra(startingYear: number | undefined): EconomicModelEra {
  return startingYear !== undefined && startingYear < 2005 ? "1991" : "2019";
}

/** Resolve a country's seed model for an era, falling back across eras if unset. */
export function resolveSeedEconomicModel(
  seed: EraSeedModels | undefined,
  era: EconomicModelEra
): EconomicModelId | undefined {
  return seed?.[era] ?? seed?.["2019"] ?? seed?.["1991"];
}

/** Stored on `stateMetrics` docs (regional + national-scope) by the P7 phase. */
export interface EconomicModelState {
  /** The named model shown to players. */
  current: EconomicModelId;
  /** 0–100; scales ALL effects (P7b). */
  intensity: number;
  /** Slow-drifting per-archetype scores (0–100). */
  scores: Record<EconomicModelId, number>;
  /** The current model's signal split this turn (the "what's driving this" UI). */
  drivers?: { sector: number; spend: number; law: number };
  /** Hysteresis tracker for a non-incumbent leader. */
  challenger?: { modelId: EconomicModelId; turnsLeading: number };
  lastUpdated: Date;
}

// ── Tuning constants (first-pass; balanced in P7b playtest) ───────────────────
export const PRIMARY_WEIGHT = 3;
export const SECONDARY_WEIGHT = 1;
export const AFFINITY_WEIGHTS = { sector: 0.4, spend: 0.4, law: 0.2 } as const;
export const SCORE_INERTIA = 0.9; // shares the metric-engine simBaseline smoothing semantics
export const DOMINANCE_FLOOR = 30; // below this, model = "mixed"
export const SWITCH_MARGIN = 5; // lead over incumbent needed to ACCRUE hysteresis progress
export const SWITCH_TURNS = 48; // net sustained lead to flip (1 year)
export const GRACE_DECAY = 1; // turns of progress lost per sub-margin turn (decay, not reset)

/**
 * State-Capitalist activation lever: a command economy is defined by STATE OWNERSHIP,
 * not sector mix. When National Corporations own ≥ this share of ALL the economy's
 * sectors (corporate-owned + unowned) in a country (or region), State-Capitalist's
 * affinity is driven by that share (overriding its weak energy-sector signal), so it
 * activates. Below the threshold it falls back to the generic signal.
 * (`computeWeightedGrowthRate`/effects still use the archetype's
 * energy/telecom/construction/extraction sectors when it is active.)
 */
export const STATE_CAPITALIST_OWNERSHIP_THRESHOLD = 0.67;

/** Qualitative intensity bands for the UI (so a bare "58" is legible). */
export const INTENSITY_BANDS = [
  { min: 75, label: "Dominant" },
  { min: 55, label: "Established" },
  { min: DOMINANCE_FLOOR, label: "Emerging" },
  { min: 0, label: "Mixed" },
] as const;

/** Band label for an intensity; "mixed" model is always "Mixed" regardless of score. */
export function intensityBand(current: EconomicModelId, intensity: number): string {
  if (current === "mixed") return "Mixed";
  return INTENSITY_BANDS.find((b) => intensity >= b.min)?.label ?? "Mixed";
}

/** Real `spending.byCategory` keys (from the budget seed taxonomy) — the Spending
 *  signal + the registry coverage test validate against these. */
export const KNOWN_SPENDING_CATEGORIES = new Set<string>([
  "agriculture",
  "defense",
  "education",
  "environment",
  "healthcare",
  "housing",
  "infrastructure",
  "other",
  "pensions",
  "publicSafety",
  "socialSecurity",
  "transportation",
  "welfare",
]);

/** Synergy metric ids not yet registered in metricDefinitions (so coverage tests
 *  acknowledge them rather than silently no-op). Empty today — all targets exist. */
export const PENDING_SYNERGY_METRICS = new Set<string>([]);

export const MODEL_ARCHETYPES: Record<EconomicModelId, EconomicModelArchetype> = {
  militaryIndustrial: {
    id: "militaryIndustrial",
    name: "Military-Industrial Complex",
    primarySector: "defense",
    secondarySectors: ["manufacturing", "technology", "chemical_industries"],
    spendingSignature: { defense: 1 },
    lawSignature: ["defense_buildup", "military_procurement"],
    metricSynergies: [
      { metricId: "militaryReadiness", maxNudge: 10 },
      { metricId: "civilLiberties", maxNudge: -8 },
    ],
  },
  techInnovation: {
    id: "techInnovation",
    name: "Tech-Innovation Economy",
    primarySector: "technology",
    secondarySectors: ["telecommunications", "media", "entertainment"],
    spendingSignature: { education: 1 },
    lawSignature: ["rd_investment", "tech_subsidy"],
    metricSynergies: [
      { metricId: "productivityGrowth", maxNudge: 8 },
      { metricId: "rdIntensity", maxNudge: 10 },
    ],
  },
  financialized: {
    id: "financialized",
    name: "Financialized Economy",
    primarySector: "financial",
    secondarySectors: ["real_estate", "construction", "technology"],
    spendingSignature: {}, // deregulation / low corporate tax — no spending lean
    lawSignature: ["financial_deregulation", "low_corporate_tax"],
    metricSynergies: [
      { metricId: "propertyValueIndex", maxNudge: 8 },
      { metricId: "incomeInequality", maxNudge: 8 },
    ],
  },
  industrialPowerhouse: {
    id: "industrialPowerhouse",
    name: "Industrial Powerhouse",
    primarySector: "manufacturing",
    secondarySectors: ["automobiles", "chemical_industries", "logistics"],
    spendingSignature: { infrastructure: 1 },
    lawSignature: ["industrial_policy", "export_promotion"],
    metricSynergies: [
      { metricId: "manufacturingCompetitiveness", maxNudge: 10 },
      { metricId: "tradeBalance", maxNudge: 8 },
    ],
  },
  resourceExtraction: {
    id: "resourceExtraction",
    name: "Resource / Extraction State",
    primarySector: "extraction",
    secondarySectors: ["energy", "logistics", "construction"],
    spendingSignature: {}, // export/resource-led — no spending lean
    lawSignature: ["resource_export", "mining_expansion"],
    metricSynergies: [
      { metricId: "exportDependency", maxNudge: 10 },
      { metricId: "carbonEmissions", maxNudge: 8 },
    ],
  },
  agrarian: {
    id: "agrarian",
    name: "Agrarian Economy",
    primarySector: "agriculture",
    // chemical_industries = fertilizer/agrochemical inputs; logistics + retail =
    // farm-to-market. (Extraction/mining was anti-agrarian — moved out.)
    secondarySectors: ["chemical_industries", "logistics", "retail"],
    spendingSignature: { agriculture: 1 },
    lawSignature: ["agricultural_subsidy", "rural_development"],
    metricSynergies: [
      { metricId: "foodSecurity", maxNudge: 10 },
      { metricId: "ruralRevitalization", maxNudge: 8 },
    ],
  },
  serviceConsumer: {
    id: "serviceConsumer",
    name: "Service / Consumer Economy",
    primarySector: "retail",
    secondarySectors: ["entertainment", "media", "real_estate"],
    spendingSignature: {}, // consumer/light — no spending lean
    lawSignature: ["consumer_protection", "small_business_support"],
    metricSynergies: [
      { metricId: "smallBusinessFormation", maxNudge: 8 },
      { metricId: "costOfLiving", maxNudge: 6 },
    ],
  },
  socialMarket: {
    id: "socialMarket",
    name: "Social-Market / Welfare State",
    primarySector: "healthcare",
    secondarySectors: ["retail", "construction", "energy"],
    spendingSignature: { healthcare: 0.5, welfare: 0.3, socialSecurity: 0.2 },
    lawSignature: ["universal_healthcare", "welfare_expansion"],
    metricSynergies: [
      { metricId: "incomeInequality", maxNudge: -8 },
      { metricId: "socialCohesion", maxNudge: 8 },
    ],
  },
  stateCapitalist: {
    id: "stateCapitalist",
    name: "State-Capitalist / Command Economy",
    primarySector: "energy",
    secondarySectors: ["telecommunications", "construction", "extraction"],
    spendingSignature: {}, // state planning / nationalization — law-driven, not a spending category
    lawSignature: ["nationalization", "five_year_plan"],
    metricSynergies: [
      { metricId: "industrialPolicyExecution", maxNudge: 10 },
      { metricId: "civilLiberties", maxNudge: -8 },
    ],
  },
  mixed: {
    id: "mixed",
    name: "Mixed / Balanced Economy",
    primarySector: null,
    secondarySectors: [],
    spendingSignature: {},
    lawSignature: [],
    metricSynergies: [],
  },
};
