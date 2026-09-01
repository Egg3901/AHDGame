import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  CampaignCapabilitySnapshot,
  CampaignCommitment,
  CampaignConsequencesDelta,
  CampaignRequirement,
  CampaignResponseVisibility,
  CampaignStage,
  CampaignWindowSnapshot,
} from "./livingConflictCampaign";

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

/**
 * A real-subsystem action a crisis decision option can invoke, in addition to
 * its flat `effects`. Where `effects` only nudge metrics/approval, an `action`
 * reaches into an actual game subsystem — files a bill, issues a taking, spawns
 * a court case — so a crisis choice has genuine, contestable consequences that
 * tie into the rest of the mechanics (ROTDM).
 *
 * Handlers live in `src/lib/crises/optionActions.ts` and are dispatched by
 * `submitCrisisDecision` AFTER the option's `effects` apply and BEFORE the tree
 * navigates. A handler that throws does not roll back already-applied effects;
 * keep handlers side-effect-safe and idempotent where practical. This is the
 * reusable hook every future crisis builds on — add a new `kind` + handler, not
 * a new bespoke crisis engine.
 */
export type CrisisOptionAction =
  /** Head of government seizes the target sector by emergency executive taking
   *  (the `method: "executive"` nationalize path). Solvent player corps are
   *  rejected upstream, which is what forces the court fight or the bill. */
  | { kind: "executiveNationalize"; sectorType: string }
  /** Spawn a Supreme Court docket case reviewing an executive taking. If the
   *  sitting bench's economic lean diverges from the taking, the ruling reverts
   *  it. This is the bridge that makes an executive order contestable. */
  | { kind: "scotusChallenge"; axis: "economic" | "social"; revertLabel: string }
  /** Introduce an emergency nationalization bill straight into active voting
   *  (the crisis-aid fast path: no NPI/action cost, short window). Passage is
   *  the authorization — fair-value taking, no court risk, but needs the votes. */
  | { kind: "emergencyNationalizeBill"; sectorType: string; sectorCarveFraction?: number }
  /** Open (or offer) government-brokered bargaining for the struck sector.
   *  Pre-nationalization this is mediation; post-nationalization the SOE is the
   *  employer and it is a direct negotiation. */
  | { kind: "openBargaining"; sectorType: string }
  /** Settle the dispute by conceding a wage floor across the struck sector,
   *  ending the strike immediately at an inflationary cost. */
  | { kind: "settleWageFloor"; sectorType: string }
  /** Roll a chance to spawn another crisis from a template, in a country
   *  chosen from a named pool. Used for cascades (tolerating unrest lets it
   *  spread to a neighboring Warsaw Pact satellite) and delayed backlash
   *  (a genuine reform movement provokes a hardliner crisis in the same
   *  country). `chance` is evaluated once, at option-resolution time. */
  | {
      kind: "spawnFollowUpCrisis";
      templateKey: string;
      countryPool: "warsawPactSatellites" | "sameCountry";
      /** Exclude the crisis's own country from the pool (only meaningful for
       *  "warsawPactSatellites" — a cascade should land somewhere else). */
      excludeCurrentCountry?: boolean;
      /** 0-1 probability the follow-up actually spawns. */
      chance: number;
    }
  /** Introduce a provision-less, direct-to-active concession/legislation bill
   *  (the crisis-aid fast path: no NPI/action cost, 24h window). Used for
   *  concession options — civil rights and voting protections, a draft/troop
   *  review, federal housing and jobs investment — that need a real,
   *  contestable vote in Congress rather than a flat approval nudge. */
  | { kind: "concessionBill"; title: string; summary: string; category: string }
  /** Commit money and materiel to this superpower's side of the Vietnam ladder.
   *  Spends a rung-scaled share of GDP through the aid scaling and treasury
   *  path, raises that side's committed support, and can climb a rung. The side
   *  is derived from the responding country, so one option serves both leaders. */
  | { kind: "vietnamSupport" }
  /** Pull back from the Vietnam ladder: drain this side's committed support and,
   *  once it is spent, climb down a rung. Costs approval with hawks. */
  | { kind: "vietnamDeescalate" }
  /** The executive's answer to a wildcat general strike called against an
   *  enacted union ban. Each response reaches a different subsystem: `army` and
   *  `negotiate` (on a successful roll) resolve the crisis document itself,
   *  `rideOut` rewrites the crisis's remaining effects, and `backDown` repeals
   *  the ban through the same primitive the legislature uses. `negotiate` is the
   *  one action in the game that can decline to resolve its interaction, so its
   *  option loops back to its own node for another attempt. Handlers live in
   *  `src/lib/crises/unionBanStrike.ts`. */
  | {
      kind: "unionBanStrikeResponse";
      response: "army" | "negotiate" | "rideOut" | "backDown";
    }
  /** A government's response to a recurring high-tension wartime emergency.
   *  These options alter the real mitigation, sector-demand, treasury, approval,
   *  and democratic-health systems rather than resolving as random events. */
  | {
      kind: "warEmergencyResponse";
      response:
        | "panic_ration"
        | "panic_calm"
        | "panic_release"
        | "bank_guarantee"
        | "bank_holiday"
        | "bank_stand_by"
        | "civil_defense_fund"
        | "civil_defense_drills"
        | "civil_defense_dismiss"
        | "protests_address"
        | "protests_march"
        | "protests_crackdown";
    };

export interface CrisisDecisionOption {
  optionId: string;
  label: string;
  description: string;
  /**
   * Turns cut from the crisis when this option is chosen, on top of any
   * collective-aid reduction. A decisive response ends the crisis sooner; the
   * do-nothing option carries no reduction and the crisis runs its full length.
   *
   * Several templates advertised "reduces duration by N turns" in their copy
   * for a mechanic that did not exist, so a government could spend 1.5% of GDP
   * on stimulus and watch the recession run its full term regardless (#1250).
   * Any option whose description promises a shorter crisis MUST set this.
   *
   * Applied by `calculateDecisionDurationReduction`, which reads the options
   * named in the interaction's `resolutionPath`. Reduction is floored so a
   * crisis always lasts at least one turn.
   *
   * CAUTION when adding one to a node that carries a `timeLimitMinutes`:
   * `autoResolveCrisisInteraction` falls back to the `"decline"` option, or to
   * `options[0]` when there is none, and pushes it onto the resolution path. A
   * reduction on that fallback is therefore granted to a government that never
   * answered. The templates carrying a reduction today all have
   * `timeLimitMinutes: null`, so they never auto-resolve and the question does
   * not arise; order the options so the fallback is the do-nothing one if you
   * ever give such a node a deadline.
   */
  durationReductionTurns?: number;
  effects: CrisisEffect[];
  nextNodeId: string | null;
  requiredBudget?: number;
  requiredApproval?: number;
  collectiveContribution?: number;
  /** Optional real-subsystem action fired when this option is chosen. See
   *  {@link CrisisOptionAction}. Absent = effects-only (legacy behaviour). */
  action?: CrisisOptionAction;
  /**
   * Contributions to a shared global-response tally. Axes are authored by the
   * event (for example `escalation`, `restraint`, `aid`, or `mediation`) and
   * summed once when the response window closes.
   */
  responseScores?: Record<string, number>;
  /** Spend this share of the responding country's GDP from its treasury. */
  treasuryCostPctGdp?: number;
  /** Live national capacity and campaign-stage requirements, enforced server-side. */
  campaignRequirement?: CampaignRequirement;
  /** Persistent contribution to the campaign, beyond this option's immediate effects. */
  campaignCommitment?: CampaignCommitment;
  /** Covert choices are redacted from other governments unless later exposed. */
  responseVisibility?: CampaignResponseVisibility;
}

/** A government's relationship to a shared world event. */
export type GlobalResponseRole =
  "belligerent" | "backer_a" | "backer_b" | "neighbor" | "bloc" | "bystander";

export interface CrisisDecisionNode {
  nodeId: string;
  // Decisions are always made by selecting a predefined option (multiple choice).
  // Free-text input is intentionally not supported.
  type: "choice" | "collective" | "terminal" | "aid";
  title: string;
  description: string;
  options?: CrisisDecisionOption[];
  /**
   * Role-specific choices for a global-response event. `options` remains the
   * fallback and keeps ordinary crisis nodes unchanged. The interaction route
   * exposes only the responding country's menu.
   */
  optionsByRole?: Partial<Record<GlobalResponseRole, CrisisDecisionOption[]>>;
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
  /** Relationship to the event at the time of the response. */
  responseRole?: GlobalResponseRole;
  /** Snapshots keep the public ledger legible after authoring changes. */
  effects?: CrisisEffect[];
  responseScores?: Record<string, number>;
  capabilitySnapshot?: CampaignCapabilitySnapshot;
  campaignCommitment?: CampaignCommitment;
  visibility?: CampaignResponseVisibility;
  revealedAt?: Date;
  respondedAt: Date;
}

export interface GlobalResponseOutcomeCondition {
  axis: string;
  min?: number;
  max?: number;
}

export interface GlobalResponseOutcome {
  outcomeId: string;
  label: string;
  description: string;
  /** First matching outcome wins, highest priority first. */
  priority: number;
  conditions: GlobalResponseOutcomeCondition[];
  /** Applied once to every country assigned the named role. */
  effectsByRole?: Partial<Record<GlobalResponseRole, CrisisEffect[]>>;
  /** Persistent living-conflict trajectory changes applied at resolution. */
  intensityDelta?: number;
  pressureDelta?: Partial<Record<"a" | "b", number>>;
  /** Persistent campaign damage, settlement progress, and stage transition. */
  campaignDelta?: CampaignConsequencesDelta;
  nextCampaignStage?: CampaignStage;
  /** Discrete change to the shared Cold War tension ledger. */
  tensionDelta?: number;
  wireMessage: string;
}

export interface GlobalResponseDefinition {
  conflictKey: string;
  eventKey: string;
  /** Snapshotted role map. Only listed countries may answer. */
  roleByCountry: Record<string, GlobalResponseRole>;
  /** Deterministic expiry choice for an eligible government that sends no order. */
  defaultOptionIdByRole: Partial<Record<GlobalResponseRole, string>>;
  outcomes: GlobalResponseOutcome[];
  defaultOutcomeId: string;
  campaign?: CampaignWindowSnapshot;
}

export interface ResolvedGlobalResponse {
  outcomeId: string;
  label: string;
  description: string;
  scores: Record<string, number>;
  respondedCountries: number;
  eligibleCountries: number;
  campaignStageBefore?: CampaignStage;
  campaignStageAfter?: CampaignStage;
  resolvedAt: Date;
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
  globalResponseOutcome?: ResolvedGlobalResponse;
  decisionDeadline: Date | null;
  autoResolveOnExpiry: boolean;
  resolvedAt: Date | null;
  resolutionPath: string[];
  resolutionOutcome: "success" | "partial" | "failure" | "auto" | "completed" | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Membership of a chained crisis family: several templates that are rungs of one
 * escalating event rather than independent crises.
 *
 * When a crisis carrying a chain expires, `processCrisisChain` asks the family's
 * registered level resolver where the underlying state now sits and spawns the
 * template whose `rung` matches. That indirection is the point: the chain is not
 * a fixed "A then B then C" list, so a family can climb, hold or climb back down
 * according to what players actually did, and a family that has fallen to level
 * 0 simply stops.
 */
export interface CrisisChain {
  /** Family id, e.g. "vietnam". Shared by every rung of the same event. */
  family: string;
  /** This template's position on the family's ladder. 1 = the opening event. */
  rung: number;
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
  /**
   * The `ALL_CRISIS_TEMPLATES` key this crisis was created from, when it was
   * created from a template. Crises used to be anonymous once inserted, which is
   * fine for a one-off but not for a chained family: the chain needs to know
   * which rung just ended in order to decide what follows. Absent on
   * hand-authored and pre-existing crises, which simply never chain.
   */
  templateKey?: string;
  /** Chained-family membership, copied from the template. See {@link CrisisChain}. */
  chain?: CrisisChain;
  /** Which automatic spawner produced this crisis, so the disaster and
   *  economic/political systems don't block each other's "one active" guards.
   *  Absent on manually-created crises. */
  autoSource?: "disaster" | "condition" | "random";
  // NEW: interaction definition
  interactionDefinition?: {
    decisionTree: CrisisDecisionNode[];
    autoResolveOnExpiry: boolean;
  };
  /** Shared, role-aware response and aggregate-outcome rules for this event. */
  globalResponse?: GlobalResponseDefinition;
  /** Deterministic living-conflict event id used to suppress replay duplicates. */
  livingConflictEventId?: string;
}

/** One row per (auto-crisis template, scope key) tracking the last turn it
 *  spawned, so the spawner can enforce per-template cooldowns. `scopeKey` is a
 *  countryId for national/regional crises or "GLOBAL" for world-scoped ones. */
export interface CrisisAutoCooldown {
  _id: string; // `${templateKey}:${scopeKey}`
  templateKey: string;
  scopeKey: string;
  lastSpawnTurn: number;
  /**
   * Hysteresis latch for condition-tier triggers. Set false on spawn; set true
   * again only once the trigger condition has CLEARED by its `clearMargin`. A
   * disarmed template cannot re-spawn even after its cooldown expires. Absent
   * on legacy rows, which are read as armed.
   */
  armed?: boolean;
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
  /**
   * Hysteresis band, in the clause's own units. The clause FIRES at `threshold`
   * but only RE-ARMS once the metric is back past `threshold` by this much on
   * the healthy side. Without it a crisis whose own effects depress its trigger
   * metric re-fires forever on every cooldown expiry, because the metric it
   * damaged never climbs back over the same line it fell through. Default 0
   * (no hysteresis) for clauses that do not need it.
   */
  clearMargin?: number;
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
  /** Chained-family membership. See {@link CrisisChain}. Absent = a standalone
   *  crisis that neither follows from nor leads to another. */
  chain?: CrisisChain;
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
