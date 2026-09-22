/**
 * Portable rules core for durable long-horizon telemetry (issues #2099, #2100).
 *
 * Pure data in, plain data out: no database, no wall clock, no randomness, no
 * environment, no network. The turn phase (shell) loads the game clock, the
 * run manifest and the scored values, calls these builders, and writes the
 * results back. Time arrives as an explicit in-game year, never as `new Date`.
 *
 * Why this exists: the operational histories are bounded projections for fast
 * game-page reads (`governmentApprovals` / `stateApprovalHistory` keep 20
 * turns, `macroMetricsHistory` keeps 96). A 480-turn sandbox therefore loses
 * 95.8% of its approval samples and 80% of its macro samples. The durable
 * series defined here keeps every turn under the explicit `world-raw-full`
 * retention policy below, so reports can consume full campaigns.
 */
/** Shape version of the telemetry point documents. Bump on field changes. */
export const LONG_HORIZON_TELEMETRY_SCHEMA_VERSION = 1;

/**
 * Calculation version behind approval telemetry points. Must bump whenever
 * the approval snapshot math (`snapshotApprovalHistory`) changes what a
 * stored rating means, so a series spanning the change stays interpretable.
 */
export const LONG_HORIZON_APPROVAL_CALC_VERSION = 1;

/**
 * Calculation version behind macro telemetry points. Must bump whenever the
 * metric-engine meaning of a covered path changes.
 */
export const LONG_HORIZON_MACRO_CALC_VERSION = 1;

/**
 * Explicit deterministic retention policy for both durable series.
 *
 * `world-raw-full`: every turn is retained raw, scoped to the world that
 * produced it, with no truncation and no downsampling. A 480-turn sandbox
 * run holds ~400k small points (tens of MB) — bounded per world, and wiped
 * with the world on reset (both collections are `runtime` in the seed
 * manifest). Multiplayer growth is linear in turns; the per-point size is
 * fixed, so storage is predictable, not silent.
 */
export const LONG_HORIZON_RETENTION_POLICY_ID = "world-raw-full";
export const LONG_HORIZON_RETENTION_POLICY_VERSION = 1;

/**
 * Provenance label carried on the retention field of points mapped from the
 * legacy bounded arrays (report fallback path). Marks that the point came
 * from a truncated operational projection, not the durable series.
 */
export const LONG_HORIZON_BOUNDED_FALLBACK_POLICY_ID = "operational-bounded";

/** Where a telemetry point was recorded. Sandbox, multiplayer and opt-in
 * single-player worlds stay separate and labeled; never mixed. */
export type LongHorizonSourceClass = "sandbox" | "multiplayer" | "singleplayer";

/** GDP + population metric paths covered by the durable macro series. */
export interface LongHorizonMacroPath {
  path: string;
  units: string;
}

export const LONG_HORIZON_MACRO_PATHS: readonly LongHorizonMacroPath[] = [
  { path: "economic.gdp", units: "local-currency millions" },
  { path: "population.population", units: "people" },
];

export interface WorldIdentityInput {
  preset?: string | null;
  iterationType?: string | null;
  iterationNumber?: number | null;
}

/**
 * Stable world identity for provenance: the reset preset plus the game
 * iteration stamped at reset (e.g. `1991-default:Beta-3`). The gameState
 * singleton id (`current`) is constant across worlds, so it cannot serve.
 * Degrades deterministically when fields are absent; never throws.
 */
export function buildWorldId(input: WorldIdentityInput): string {
  const preset = input.preset ?? "unknown";
  const type = input.iterationType ?? "unknown";
  const number = input.iterationNumber ?? 0;
  return `${preset}:${type}-${number}`;
}

/**
 * Resolve the source class without touching gameplay state. Sandbox
 * databases carry the `ahd_sim_` prefix (see `SIM_SANDBOX_DB_PREFIX`); a
 * world with a singleplayer config is single-player and therefore opt-in;
 * everything else is multiplayer.
 */
export function resolveSourceClass(input: {
  dbName: string;
  hasSingleplayerConfig: boolean;
}): LongHorizonSourceClass {
  if (input.dbName.startsWith("ahd_sim_")) return "sandbox";
  if (input.hasSingleplayerConfig) return "singleplayer";
  return "multiplayer";
}

/** Pre-iteration clock fields, read off gameState as plain data. */
export interface FoundingClock {
  preIterationActive?: boolean;
  preIterationTurns?: number;
}

/**
 * Whether a raw turn falls in the founding-election interval, so those turns
 * stay distinguishable in every durable series. While the founding phase is
 * active every turn so far is founding; after completion the stamped offset
 * (`completedTurn - 1`) marks which raw turns were founding.
 */
export function isFoundingTurn(rawTurn: number, clock: FoundingClock): boolean {
  if (clock.preIterationActive) return true;
  const offset = clock.preIterationTurns ?? 0;
  return offset > 0 && rawTurn <= offset;
}

/** Governing actor behind an approval point, when one could be resolved. */
export interface TelemetryGoverningActor {
  officeType?: string;
  party?: string;
  characterId?: string;
  /** Autonomous politician identity, distinct from a player character. */
  nppId?: string;
}

export interface TelemetryEffectiveManifest {
  capturedAtTurn: number;
  gameState: Record<string, boolean | number | string | null>;
  gameConfig: Record<string, boolean | number | string | null>;
}

export interface TelemetryActorConfiguration {
  mode?: string;
  autonomyLevel?: string;
  difficulty?: string;
  coverageRegistryVersion?: number;
}

interface TelemetryPointBase {
  worldId: string;
  sourceClass: LongHorizonSourceClass;
  /** Run manifest id (`simRuns`) when the world was produced by a sim run. */
  runId?: string;
  /** RNG seed of the producing run, when known. */
  seed?: string;
  /** Executed source revision, when the run manifest records one. */
  codeVersion?: string;
  /** Effective scalar run configuration captured by the simulation harness. */
  effectiveManifest?: TelemetryEffectiveManifest;
  /** Compact actor-mode provenance; coverage details remain on the run manifest. */
  actorConfiguration?: TelemetryActorConfiguration;
  country: string;
  /** Null for national aggregates, the state/region id otherwise. */
  region: string | null;
  turn: number;
  year: number;
  /** True for turns inside the founding-election interval. */
  foundingTurn: boolean;
  schemaVersion: number;
  retentionPolicy: string;
  retentionVersion: number;
}

/** One durable national or regional approval sample (#2099). */
export interface ApprovalTelemetryPoint extends TelemetryPointBase {
  approval: number;
  netApproval: number;
  calcVersion: number;
  governingOffice?: string;
  governingParty?: string;
  governingCharacter?: string;
  governingNpp?: string;
}

/** One durable GDP/population sample (#2100). */
export interface MacroTelemetryPoint extends TelemetryPointBase {
  metric: string;
  value: number;
  units: string;
  calcVersion: number;
}

export interface ApprovalPointInput extends Omit<
  TelemetryPointBase,
  "schemaVersion" | "retentionPolicy" | "retentionVersion"
> {
  approval: number;
  net: number;
  calcVersion?: number;
  schemaVersion?: number;
  retentionPolicy?: string;
  retentionVersion?: number;
  governingActor?: TelemetryGoverningActor;
}

export function buildApprovalPoint(input: ApprovalPointInput): ApprovalTelemetryPoint {
  const actor = input.governingActor;
  return {
    worldId: input.worldId,
    sourceClass: input.sourceClass,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.codeVersion !== undefined ? { codeVersion: input.codeVersion } : {}),
    ...(input.effectiveManifest !== undefined
      ? { effectiveManifest: input.effectiveManifest }
      : {}),
    ...(input.actorConfiguration !== undefined
      ? { actorConfiguration: input.actorConfiguration }
      : {}),
    country: input.country,
    region: input.region,
    turn: input.turn,
    year: input.year,
    foundingTurn: input.foundingTurn,
    approval: input.approval,
    netApproval: input.net,
    schemaVersion: input.schemaVersion ?? LONG_HORIZON_TELEMETRY_SCHEMA_VERSION,
    calcVersion: input.calcVersion ?? LONG_HORIZON_APPROVAL_CALC_VERSION,
    retentionPolicy: input.retentionPolicy ?? LONG_HORIZON_RETENTION_POLICY_ID,
    retentionVersion: input.retentionVersion ?? LONG_HORIZON_RETENTION_POLICY_VERSION,
    ...(actor?.officeType !== undefined ? { governingOffice: actor.officeType } : {}),
    ...(actor?.party !== undefined ? { governingParty: actor.party } : {}),
    ...(actor?.characterId !== undefined ? { governingCharacter: actor.characterId } : {}),
    ...(actor?.nppId !== undefined ? { governingNpp: actor.nppId } : {}),
  };
}

export interface MacroPointInput extends Omit<
  TelemetryPointBase,
  "schemaVersion" | "retentionPolicy" | "retentionVersion"
> {
  metric: string;
  value: number;
  units: string;
  calcVersion?: number;
  schemaVersion?: number;
  retentionPolicy?: string;
  retentionVersion?: number;
}

/**
 * Build one durable macro point. Returns null for non-finite values: a
 * missing historical point stays missing downstream and is never inferred
 * as zero (a zero GDP-growth read would mean stagnation, not absence).
 */
export function buildMacroPoint(input: MacroPointInput): MacroTelemetryPoint | null {
  if (!Number.isFinite(input.value)) return null;
  return {
    worldId: input.worldId,
    sourceClass: input.sourceClass,
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.codeVersion !== undefined ? { codeVersion: input.codeVersion } : {}),
    ...(input.effectiveManifest !== undefined
      ? { effectiveManifest: input.effectiveManifest }
      : {}),
    ...(input.actorConfiguration !== undefined
      ? { actorConfiguration: input.actorConfiguration }
      : {}),
    country: input.country,
    region: input.region,
    turn: input.turn,
    year: input.year,
    foundingTurn: input.foundingTurn,
    metric: input.metric,
    value: input.value,
    units: input.units,
    schemaVersion: input.schemaVersion ?? LONG_HORIZON_TELEMETRY_SCHEMA_VERSION,
    calcVersion: input.calcVersion ?? LONG_HORIZON_MACRO_CALC_VERSION,
    retentionPolicy: input.retentionPolicy ?? LONG_HORIZON_RETENTION_POLICY_ID,
    retentionVersion: input.retentionVersion ?? LONG_HORIZON_RETENTION_POLICY_VERSION,
  };
}

/** A series entry with explicit missingness for report consumption. */
export interface MarkedSeriesPoint {
  turn: number;
  value: number | null;
  missing: boolean;
}

/**
 * Align a sparse series to an explicit turn range. Present turns keep their
 * values; absent turns are marked missing with a null value, never zero.
 */
export function markMissing<T extends { turn: number; value: number }>(
  points: readonly T[],
  fromTurn: number,
  toTurn: number
): MarkedSeriesPoint[] {
  const byTurn = new Map(points.map((p) => [p.turn, p.value]));
  const out: MarkedSeriesPoint[] = [];
  for (let turn = fromTurn; turn <= toTurn; turn++) {
    if (byTurn.has(turn)) {
      out.push({ turn, value: byTurn.get(turn) as number, missing: false });
    } else {
      out.push({ turn, value: null, missing: true });
    }
  }
  return out;
}

/** The first collected turn is the turn after the run's captured baseline. */
export function longHorizonReportTurnRange(
  capturedAtTurn: number,
  completedTurn: number
): { from: number; to: number } | null {
  if (!Number.isInteger(capturedAtTurn) || !Number.isInteger(completedTurn)) return null;
  const from = capturedAtTurn + 1;
  if (from > completedTurn) return null;
  return { from, to: completedTurn };
}
