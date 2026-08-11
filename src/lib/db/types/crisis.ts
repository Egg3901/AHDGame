import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

export interface CrisisEffect {
  effectType: "flat" | "tick" | "decay";
  /**
   * `gdpLoss` is a one-time, real output hit: `value` is the FRACTION of the
   * affected region's GDP destroyed (e.g. 0.03 = 3%), applied once at startTurn
   * as a multiplicative reduction to `state.gdp`. Distinct from `metric` →
   * `economic.gdpGrowth`, which is an ongoing drag on the growth RATE. Use
   * `gdpLoss` for physical-destruction disasters, the growth-rate path for
   * persistent economic crises.
   */
  targetType: "metric" | "approval" | "profitMargin" | "inflation" | "gdpLoss" | "stat";
  /** For stat effects: which stat key to target (charisma, debate, energy, etc.) */
  statKey?: string;
  metricCategory: string | null;
  metricField: string | null;
  sectorType: string | null;
  strategyId: string | null;
  value: number;
  label: string;
  /**
   * P3.5 — how a `profitMargin` effect bites under the plants market tier.
   *
   * - `"physical"`: the event stops or slows real output (blackout, port
   *   shutdown, plant halt, input shortage). Under plants the `value` (in
   *   margin percentage points) is re-read as a production haircut:
   *   `productionFactor *= 1 - |value|/100`, so the sector ships less tonnage
   *   instead of shipping full tonnage at a thinner margin.
   * - `"financial"`: the event is a price/credit/sentiment shock (recession,
   *   banking freeze, cost inflation). It stays a margin/financial-leg hit and
   *   tonnage is unchanged.
   *
   * Absent = `"financial"`. That default is deliberate and load-bearing:
   * crisis effects are snapshotted onto the crisis document at spawn, so every
   * crisis already live in a world carries no `physicality` and must keep its
   * existing margin-only behaviour. Ignored entirely below the plants tier —
   * non-plants worlds are byte-identical.
   */
  physicality?: "physical" | "financial";
}

export interface CrisisDecisionOption {
  optionId: string;
  label: string;
  description: string;
  effects: CrisisEffect[];
  nextNodeId: string | null;
  requiredBudget?: number;
  requiredApproval?: number;
  collectiveContribution?: number;
}

export interface CrisisDecisionNode {
  nodeId: string;
  // Decisions are always made by selecting a predefined option (multiple choice).
  // Free-text input is intentionally not supported.
  type: "choice" | "collective" | "terminal" | "aid";
  title: string;
  description: string;
  options?: CrisisDecisionOption[];
  collectiveTarget?: number;
  collectiveCurrency?: string;
  /** Aid nodes only: slider cap as a fraction of the sender's GDP (default AID_MAX_PCT_GDP). */
  aidMaxPctGdp?: number;
  /** Aid nodes only: slider default as a fraction of the sender's GDP (default AID_DEFAULT_PCT_GDP). */
  aidDefaultPctGdp?: number;
  nextNodeId?: string;
  outcomeEffects?: CrisisEffect[];
  outcomeMessage?: string;
  requiredRoles: ("headOfState" | "cabinet" | "stateGovernor" | "any")[];
  timeLimitMinutes: number | null;
}

/** One head of state's response to a multi-responder (global) crisis. Each
 *  affected country's leader may record exactly one, and the chosen option's
 *  effects are applied scoped to that leader's own country. */
export interface CrisisLeaderResponse {
  countryId: string;
  characterId: ObjectId;
  characterName: string;
  /** The decision node answered (multi-responder crises stay on one node). */
  nodeId: string;
  optionId: string;
  /** Denormalized option label so the display needs no tree lookup. */
  optionLabel: string;
  respondedAt: Date;
}

export interface CrisisInteraction {
  _id: ObjectId;
  crisisId: ObjectId;
  decisionTree: CrisisDecisionNode[];
  currentNodeId: string | null;
  collectiveTarget: number | null;
  collectiveCurrent: number;
  contributors: Array<{
    countryId: string;
    amount: number;
    characterId: ObjectId;
    contributedAt: Date;
  }>;
  /**
   * Multi-responder (global) crises only: one entry per country whose leader has
   * responded. Each leader picks for their own nation, so the interaction stays
   * open on its single choice node collecting responses rather than resolving on
   * the first decision. Absent/empty for single-responder (country/region)
   * crises, which still resolve on the first leader's choice.
   */
  leaderResponses?: CrisisLeaderResponse[];
  decisionDeadline: Date | null;
  autoResolveOnExpiry: boolean;
  resolvedAt: Date | null;
  resolutionPath: string[];
  resolutionOutcome: "success" | "partial" | "failure" | "auto" | "completed" | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Crisis {
  _id: ObjectId;
  name: string;
  description: string;
  /** Unique hero image URL for this crisis (copied from template at creation time). */
  heroImage?: string;
  scope: "global" | "country" | "region";
  countryIds: string[];
  regionIds: string[];
  status: "active" | "resolved";
  startTurn: number;
  endTurn: number | null;
  durationTurns: number | null;
  effects: CrisisEffect[];
  wireMessageOnStart: string;
  wireMessageOnEnd: string | null;
  createdBy: ObjectId | null;
  createdAt: Date;
  resolvedAt: Date | null;
  /** True when generated by any automatic spawner (disaster or economic/political). */
  autoGenerated?: boolean;
  /** Which automatic spawner produced this crisis, so the disaster and
   *  economic/political systems don't block each other's "one active" guards.
   *  Absent on manually-created crises. */
  autoSource?: "disaster" | "condition" | "random";
  // NEW: interaction definition
  interactionDefinition?: {
    decisionTree: CrisisDecisionNode[];
    autoResolveOnExpiry: boolean;
  };
}

/** One row per (auto-crisis template, scope key) tracking the last turn it
 *  spawned, so the spawner can enforce per-template cooldowns. `scopeKey` is a
 *  countryId for national/regional crises or "GLOBAL" for world-scoped ones. */
export interface CrisisAutoCooldown {
  _id: string; // `${templateKey}:${scopeKey}`
  templateKey: string;
  scopeKey: string;
  lastSpawnTurn: number;
  updatedAt: Date;
}

/** Geographic hazard categories used to gate regional disasters realistically
 *  (no hurricanes in landlocked regions, tornadoes only on plains, etc.). A
 *  region's tags are curated in `src/lib/crises/regionHazards.ts`. */
export type HazardTag =
  "coastal" | "seismic" | "tornado" | "volcanic" | "flood" | "wintry" | "wildfire" | "arid";

/** Geographic eligibility for an auto-spawned crisis. */
export interface CrisisGeo {
  /** Allow-list of countries. Undefined = every enabled country. */
  countries?: CountryId[];
  /** Deny-list, applied after the allow-list. */
  excludeCountries?: CountryId[];
  /** Region must carry ALL of these hazard tags (regional disasters only). */
  requiresRegionTags?: HazardTag[];
}

/** National metrics the condition-trigger engine can read. */
export type TriggerMetric =
  | "gdpGrowth"
  | "inflationRate"
  | "unemploymentRate"
  | "approval"
  | "powerGridReliability"
  | "fxDepreciation";

export interface TriggerClause {
  metric: TriggerMetric;
  op: "lt" | "gt";
  threshold: number;
  /** Require the clause to hold for N consecutive turns (history-based). */
  consecutiveTurns?: number;
  /** For `fxDepreciation`: percentage drop measured over this many turns. */
  windowTurns?: number;
}

/** Declarative trigger condition: every clause must hold (logical AND). */
export interface TriggerCondition {
  all: TriggerClause[];
}

/** Automatic trigger configuration for economic/political crises.
 *  - `condition`: country-scoped, fires when national metrics cross thresholds.
 *  - `random`: country- or world-scoped, fires on a deterministic per-turn roll. */
export type CrisisAutoTrigger =
  | { kind: "condition"; cooldownTurns: number; condition: TriggerCondition }
  | { kind: "random"; cooldownTurns: number; scope: "country" | "global"; spawnChance: number };

/** Crisis template metadata. Templates may specify a different default duration
 *  for each scope they can target. The runtime Crisis document still stores a
 *  single `durationTurns`; the template's scope-aware default is resolved at
 *  creation time. */
export interface CrisisTemplate extends Omit<
  Crisis,
  "_id" | "createdBy" | "createdAt" | "resolvedAt" | "startTurn" | "endTurn" | "status"
> {
  /** Per-scope default durations. When a scope is absent, callers fall back to
   *  `durationTurns`. */
  durationByScope?: Partial<Record<Crisis["scope"], number>>;
  /** Eligible for the regional auto-disaster spawn pool. Despite the name this
   *  also covers infrastructure disasters (bridge collapse, port closure) that
   *  spawn region-scoped alongside natural disasters. */
  naturalDisaster?: boolean;
  /** Geographic eligibility for auto-spawning (region tags + country gating). */
  geo?: CrisisGeo;
  /** Automatic economic/political trigger (Tiers A/B/C). Mutually exclusive with
   *  `naturalDisaster` in practice — disasters use the regional spawner instead. */
  autoTrigger?: CrisisAutoTrigger;
  /** Per-template cooldown (turns) for the regional disaster pool, so the same
   *  disaster type does not repeat in a country too soon. Defaults applied by the
   *  spawner when absent. */
  disasterCooldownTurns?: number;
  /**
   * First in-game year this template may auto-spawn, inclusive. Absent means
   * "always has existed".
   *
   * Replaces the previous `notForEras: string[]`, which listed seed PRESETS.
   * A preset never changes, so that gate was permanent: a 1991-seeded world
   * that had advanced to 2008 still blocked the cyber, tech-bubble and
   * disinformation templates forever, decades after they became apt. Resolving
   * against `gameState.currentYear` instead makes the window open as the world
   * reaches it — the whole point of the era program.
   *
   * Admin can still create any template manually; this only gates auto-spawn.
   */
  fromYear?: number;
  /**
   * Last in-game year this template may auto-spawn, inclusive. Absent means
   * "still current". For framings that stop applying rather than start.
   */
  untilYear?: number;
}
