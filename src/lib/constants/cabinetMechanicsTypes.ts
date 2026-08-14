/**
 * Shared type definitions for cabinet position mechanics.
 * Country-specific configs (ukCabinetMechanics.ts, usCabinetMechanics.ts)
 * import these types and define their position data.
 */

// ── Metric format types ──────────────────────────────────────────────────────

export type MetricFormat = "percent" | "index" | "rate" | "number" | "currency";

/**
 * Where a national metric value is sourced from.
 *
 * Most metrics live in the per-region `stateMetrics` collection (the default).
 * A few macro indicators are maintained canonically elsewhere and are NOT kept
 * in `stateMetrics`, so they must be read from their own home:
 *   - `budget`      → `federalBudget.economicFactors.*` (e.g. inflationRate)
 *   - `centralBank` → the `centralBanks` document (e.g. primeRate)
 */
export type MetricSource = "stateMetrics" | "budget" | "centralBank";

export interface MetricConfig {
  category: string;
  metricId: string;
  label: string;
  format: MetricFormat;
  higherIsBetter: boolean;
  /** Collection the value is read from. Defaults to `stateMetrics`. */
  source?: MetricSource;
}

// ── Tier setting interfaces ──────────────────────────────────────────────────

export interface TierOption {
  id: string;
  label: string;
  description: string;
  effects: Record<string, number>;
}

export interface TierSettingConfig {
  /**
   * Stable identifier, required only when a seat carries more than one tier
   * (see CabinetPositionMechanics.tierSettings). The primary `tierSetting`
   * omits it and persists to the legacy `currentSettings.tierSetting` string;
   * extra tiers persist to `currentSettings.tierSettings[key]`.
   */
  key?: string;
  name: string;
  description: string;
  options: TierOption[];
  defaultTier: string;
}

// ── Regional target interface ────────────────────────────────────────────────

export interface RegionalTargetConfig {
  name: string;
  description: string;
  effects: Record<string, number>;
  nonTargetEffects?: Record<string, number>;
}

// ── Allocation interface ─────────────────────────────────────────────────────

export interface AllocationConfig {
  name: string;
  description: string;
  poolLabel: string;
}

// ── Advocacy interface ───────────────────────────────────────────────────────

export interface AdvocacyConfig {
  name: string;
  description: string;
  regionId: string;
  effects: Record<string, number>;
}

// ── Emergency mechanic interface ─────────────────────────────────────────────

export interface EmergencyMechanicConfig {
  name: string;
  description: string;
  /** Always 1 ministerial action */
  cost: 1;
  duration: number;
  effects: Record<string, number>;
  regionMetricThreshold?: {
    metric: string;
    above: number;
  };
  sideEffects?: Record<string, number>;
}

// ── Top-level position mechanics ─────────────────────────────────────────────

export interface CabinetPositionMechanics {
  positionId: string;
  department: string;
  /**
   * Era department labels (same band semantics as CabinetPositionDef.namesByYear:
   * last band with from <= year wins; fallback `department`). Resolve via
   * rosterEra.resolveDepartment().
   */
  departmentByYear?: ReadonlyArray<{ from: number; name: string }>;
  sealImage?: string;
  nationalMetrics: MetricConfig[];
  regionalMetrics: MetricConfig[];
  tierSetting?: TierSettingConfig;
  /**
   * Additional policy levers beyond the primary `tierSetting`, for seats that
   * hold more than one portfolio (e.g. HEW = health + education + welfare).
   * Each entry MUST set a stable `key`; its selection persists to
   * `currentSettings.tierSettings[key]` and its effects apply alongside the
   * primary tier. Omit for single-portfolio seats.
   */
  tierSettings?: TierSettingConfig[];
  regionalTarget?: RegionalTargetConfig;
  allocation?: AllocationConfig;
  advocacy?: AdvocacyConfig;
  emergency?: EmergencyMechanicConfig;
  /** Territorial secretaries: only shows a single region's full dashboard */
  singleRegionFocus?: string;
  /** Positions where mechanics UI shows a "coming soon" notice */
  comingSoon?: boolean;
  /**
   * Sovereign bond maturity profile control for finance ministers.
   * When present, the cabinet office renders a panel letting the holder
   * set the fractional split of quarterly sovereign issuance across
   * 1-year (48t), 2-year (96t), and 5-year (240t) maturities.
   */
  bondProfile?: {
    name: string;
    description: string;
  };
  /**
   * Policy domains this position can legislate on via Cabinet bills.
   * Use when the position's authority doesn't line up 1:1 with its tracked metric
   * categories — e.g. a Foreign Minister tracks `economic`/`governance` metrics but
   * legislates on `foreign_policy`. When omitted, the cabinet route falls back to
   * the unique set of `nationalMetrics[].category` values.
   */
  legislativeDomains?: string[];
}

// ── Ministerial order interfaces ─────────────────────────────────────────────

export interface MinisterialOrderEffect {
  metric: string;
  modifier: number;
  scope: "national" | "regional";
}

export interface MinisterialOrderConfig {
  id: string;
  name: string;
  description: string;
  duration: number;
  effects: MinisterialOrderEffect[];
}

// ── Action economy constants (shared across all countries) ───────────────────

/** Maximum ministerial actions a position can hold. */
export const MINISTERIAL_ACTION_CAP = 4;

/** @deprecated Turn-based regen replaced by daily midnight Eastern refill. */
export const MINISTERIAL_ACTION_REGEN_INTERVAL = 24;

/** Default order duration in turns (one game half-year). */
export const DEFAULT_ORDER_DURATION = 24;
