/**
 * Pure player-to-NPP action validators and effect descriptors. No DB access,
 * no randomness - these direct interactions are deterministic spend actions.
 *
 * Each action is a (cost, min-relationship, side-effect) triple. The caller
 * validates first via `validateCapitalAction`, then applies side effects by
 * interpreting the returned `CapitalActionPlan`. Persistence (relationship
 * deltas, endorsement records, threat markers, stat updates) is done in the
 * API route handler, not here.
 */

import type { CapitalActionType } from "@/lib/db/types";

export interface CapitalActionConfig {
  type: CapitalActionType;
  label: string;
  description: string;
  /** Character action cost - rejected if the player lacks enough actions. */
  actionCost: number;
  /** Campaign-fund cost - rejected if the player lacks enough funds. */
  fundCost: number;
  /** Static relationship floor; null means the route computes a hidden gate. */
  minRelationship: number | null;
  /** Static effect blurb shown in UI. */
  effectBlurb: string;
}

export const CAPITAL_ACTIONS: Record<CapitalActionType, CapitalActionConfig> = {
  request_endorsement: {
    type: "request_endorsement",
    label: "Request endorsement",
    description:
      "Ask publicly for an endorsement in your race. The NPP will publicly back you and bind themselves to that public commitment.",
    actionCost: 6,
    fundCost: 0,
    minRelationship: null,
    effectBlurb:
      "Public endorsement - current campaign only - willingness depends on relationship and policy fit",
  },
  private_meeting: {
    type: "private_meeting",
    label: "Private meeting",
    description: "Build relationship through one-on-one time. No public commitment.",
    actionCost: 3,
    fundCost: 0,
    minRelationship: -50,
    effectBlurb: "+5 relationship",
  },
  boost_favorability: {
    type: "boost_favorability",
    label: "Boost favorability",
    description:
      "Help the NPP improve their public profile with local appearances, media help, and visible support.",
    actionCost: 5,
    fundCost: 10000,
    minRelationship: null,
    effectBlurb: "+3 favorability - +2 relationship (more with high charisma)",
  },
  reduce_favorability: {
    type: "reduce_favorability",
    label: "Reduce favorability",
    description:
      "Fund quiet opposition and negative local chatter to weaken the NPP's public standing.",
    actionCost: 5,
    fundCost: 10000,
    minRelationship: -100,
    effectBlurb: "-3 favorability - -2 relationship",
  },
  boost_influence: {
    type: "boost_influence",
    label: "Boost influence",
    description:
      "Introduce the NPP to donors, organizers, and power brokers to grow their political reach.",
    actionCost: 6,
    fundCost: 20000,
    minRelationship: null,
    effectBlurb: "+2 political influence - +2 relationship",
  },
  reduce_influence: {
    type: "reduce_influence",
    label: "Reduce influence",
    description:
      "Spend political capital to cut the NPP off from local brokers, donors, and institutional support.",
    actionCost: 6,
    fundCost: 20000,
    minRelationship: -100,
    effectBlurb: "-2 political influence - -2 relationship",
  },
};

export type CapitalValidationFailure =
  | "unknown_action"
  | "insufficient_capital"
  | "insufficient_funds"
  | "relationship_too_low"
  | "missing_candidacy_context"
  | "npp_retired"
  | "target_at_cap"
  | "target_at_floor";

export interface CapitalActionContext {
  /** Current action balance for the spending character. */
  currentActions: number;
  /** Current campaign-fund balance for the spending character. */
  currentFunds: number;
  /** Current NPPRelationship.relationshipScore for (character, npp). 0 if no record exists. */
  currentRelationship: number;
  /** True if the target NPP is retired - direct interactions reject for retired NPPs. */
  isRetired: boolean;
  /**
   * Target NPP's current favorability (0-100). Used to short-circuit boost/reduce
   * when the value is already at the cap or floor — without this, players are
   * charged actions+funds for a no-op clamped write.
   */
  targetFavorability?: number;
  /** Target NPP's current political influence (0-100). Same rationale as targetFavorability. */
  targetPoliticalInfluence?: number;
  /** Action-specific context. */
  context: {
    candidacyId?: string;
  };
}

export interface CapitalValidation {
  ok: boolean;
  failure?: CapitalValidationFailure;
  message?: string;
  /** When `ok`, the resolved action config. */
  config?: CapitalActionConfig;
}

/**
 * Stateless validation. Returns a `CapitalValidation` describing whether the
 * action is allowed under the given context. No DB access - caller has already
 * loaded actions, relationship score, and NPP record.
 */
export function validateCapitalAction(
  action: CapitalActionType,
  ctx: CapitalActionContext
): CapitalValidation {
  const config = CAPITAL_ACTIONS[action];
  if (!config) {
    return { ok: false, failure: "unknown_action", message: `Unknown action: ${action}` };
  }

  if (ctx.isRetired) {
    return {
      ok: false,
      failure: "npp_retired",
      message: "Retired NPPs cannot be targeted with direct interactions.",
    };
  }

  if (ctx.currentActions < config.actionCost) {
    return {
      ok: false,
      failure: "insufficient_capital",
      message: `Need ${config.actionCost} actions - you have ${ctx.currentActions}.`,
      config,
    };
  }

  if (ctx.currentFunds < config.fundCost) {
    return {
      ok: false,
      failure: "insufficient_funds",
      message: `Need $${config.fundCost.toLocaleString()} campaign funds - you have $${ctx.currentFunds.toLocaleString()}.`,
      config,
    };
  }

  if (config.minRelationship != null && ctx.currentRelationship < config.minRelationship) {
    return {
      ok: false,
      failure: "relationship_too_low",
      message: `This action requires relationship >= ${config.minRelationship}; current is ${ctx.currentRelationship}.`,
      config,
    };
  }

  if (action === "request_endorsement" && !ctx.context.candidacyId) {
    return {
      ok: false,
      failure: "missing_candidacy_context",
      message: "Pick a candidacy for the NPP to endorse.",
      config,
    };
  }

  // Short-circuit boost/reduce when the target stat is already pinned. Without
  // this guard the action is charged but the clamped DB write is a no-op,
  // which players read as "my action did nothing." See simpleInfluence.ts for
  // the player-to-character/NPP version of this guard.
  const fav = ctx.targetFavorability ?? 50;
  const inf = ctx.targetPoliticalInfluence ?? 0;
  if (action === "boost_favorability" && fav >= 100) {
    return {
      ok: false,
      failure: "target_at_cap",
      message: "This NPP's favorability is already maxed (100%). Wait for it to decay.",
      config,
    };
  }
  if (action === "boost_influence" && inf >= 100) {
    return {
      ok: false,
      failure: "target_at_cap",
      message: "This NPP's political influence is already maxed (100%).",
      config,
    };
  }
  if (action === "reduce_favorability" && fav <= 0) {
    return {
      ok: false,
      failure: "target_at_floor",
      message: "This NPP's favorability is already at the floor (0%).",
      config,
    };
  }
  if (action === "reduce_influence" && inf <= 0) {
    return {
      ok: false,
      failure: "target_at_floor",
      message: "This NPP's political influence is already at the floor (0%).",
      config,
    };
  }

  return { ok: true, config };
}

/**
 * Plan describing what the API route should persist after a successful
 * validation. Machine-readable so the route handler can apply each side-effect
 * without re-deriving them. `relationshipDelta` is signed; `effectSummary` is
 * the human label that lands in `CapitalActionLog.effectSummary`.
 */
export interface CapitalActionPlan {
  action: CapitalActionType;
  actionCost: number;
  fundCost: number;
  relationshipDelta: number;
  sideEffects: {
    createEndorsement?: { candidacyId: string };
    favorabilityDelta?: number;
    politicalInfluenceDelta?: number;
  };
  effectSummary: string;
}

/**
 * Build the side-effect plan for a validated action. Pure - does not mutate
 * context. Caller persists the plan in the API route.
 */
export function buildCapitalActionPlan(
  action: CapitalActionType,
  ctx: CapitalActionContext
): CapitalActionPlan {
  const config = CAPITAL_ACTIONS[action];

  switch (action) {
    case "request_endorsement":
      return {
        action,
        actionCost: config.actionCost,
        fundCost: config.fundCost,
        relationshipDelta: 0,
        sideEffects: { createEndorsement: { candidacyId: ctx.context.candidacyId! } },
        effectSummary: "Public endorsement secured.",
      };
    case "private_meeting":
      return {
        action,
        actionCost: config.actionCost,
        fundCost: config.fundCost,
        relationshipDelta: +5,
        sideEffects: {},
        effectSummary: "Private meeting - relationship strengthened.",
      };
    case "boost_favorability":
      return {
        action,
        actionCost: config.actionCost,
        fundCost: config.fundCost,
        relationshipDelta: +2,
        sideEffects: { favorabilityDelta: 3 },
        effectSummary: "Favorability boosted - public profile improved.",
      };
    case "reduce_favorability":
      return {
        action,
        actionCost: config.actionCost,
        fundCost: config.fundCost,
        relationshipDelta: -2,
        sideEffects: { favorabilityDelta: -3 },
        effectSummary: "Favorability reduced - public standing weakened.",
      };
    case "boost_influence":
      return {
        action,
        actionCost: config.actionCost,
        fundCost: config.fundCost,
        relationshipDelta: +2,
        sideEffects: { politicalInfluenceDelta: 2 },
        effectSummary: "Political influence boosted - connections expanded.",
      };
    case "reduce_influence":
      return {
        action,
        actionCost: config.actionCost,
        fundCost: config.fundCost,
        relationshipDelta: -2,
        sideEffects: { politicalInfluenceDelta: -2 },
        effectSummary: "Political influence reduced - network reach disrupted.",
      };
  }
}
