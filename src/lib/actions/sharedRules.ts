/**
 * Versioned, host-independent entry point for the authoritative player-action
 * rules (issue #1724). AHDGame owns these rules; the Game server, AHDClient
 * local SP and AHDNative local SP consume this module instead of carrying
 * their own cost, eligibility and effect formulas.
 *
 * One function, {@link quoteAction}, prices every action in the catalog from
 * plain inputs: AP cost, fund cost, effect deltas and a typed rejection. The
 * UI display and the execution shell both call it (directly, or through the
 * per-action quote it dispatches to), so a displayed quote and the actual
 * debit cannot drift. No Mongo, ObjectId, clock, RNG, network or environment
 * access: the resolved era price level, the world preset and every raw stat
 * are explicit inputs. Atomic resource checks, persistence, currency
 * conversion, audit and notifications stay with the host shell.
 *
 * Versioning contract. `RULES_VERSION` is the formula/API version of this
 * entry point, independent of the content revision (authored data) and the
 * save schema. Bump the major for a breaking input/output shape change, the
 * minor for a balance or formula change or a new action, and the patch for a
 * behavior-neutral fix. Consumers pin an exact version and the cross-host
 * drift check compares it. Existing SP saves keep their stored values; a new
 * ruleset only prices actions taken after the host adopts it.
 */
import {
  quoteAdvertiseAction,
  quoteBuildDonorBaseAction,
  quoteCampaignAction,
  quoteConvertCashAction,
  quoteDebatePrepAction,
  quoteFundraiseAction,
  quotePollAction,
  quoteRestAction,
  getAdvertiseActionCost,
  getBuildDonorBaseActionCost,
  getCampaignActionCost,
  getPollActionCost,
  FUNDRAISE_ACTION_COST,
  REST_ACTION_COST,
  CONVERT_CASH_ACTION_COST,
  DEBATE_PREP_ACTION_COST,
} from "./rules";

/** Formula/API version of the shared action rules. See the header contract. */
export const RULES_VERSION = "1.0.0";

/** Every action the shared rules price. A new catalog action must be added here. */
export const SHARED_ACTION_TYPES = [
  "fundraise",
  "campaign",
  "advertise",
  "buildDonorBase",
  "poll",
  "pollLarge",
  "convertCash",
  "rest",
  "debatePrep",
] as const;

export type SharedActionType = (typeof SHARED_ACTION_TYPES)[number];

/** Raw actor inputs, as stored. Missing values reject or keep the historical neutral fallback per action. */
export interface SharedActionActor {
  donorBaseLevel?: number | null;
  politicalInfluence?: number | null;
  favorability?: number | null;
  /** Raw stat block values; absent for characters that predate the stat system. */
  stats?: {
    fundraising?: number | null;
    charisma?: number | null;
    intellect?: number | null;
    debate?: number | null;
  } | null;
}

/** Raw home-state economics for GDP-scaled actions, plus the world preset. */
export interface SharedActionTarget {
  gdpMillions?: number | null;
  population?: number | null;
  countryId?: string | null;
  preset?: string | null;
}

export interface SharedActionContext {
  /** Resolved between-era price level from the host (1 = modern). */
  priceLevel?: number;
  /** ConvertCash only: amount of personal cash in LOCAL home currency. */
  convertAmount?: number | null;
  /** DebatePrep only: whether the stat system is enabled in this world. */
  rpgStatsEnabled?: boolean;
}

export interface SharedActionQuoteInput {
  actionType: SharedActionType;
  actor: SharedActionActor;
  target?: SharedActionTarget | null;
  context?: SharedActionContext;
}

/** Effect deltas the action applies. Anchor-unit funds; convertCash legs are LOCAL currency. */
export interface SharedActionEffect {
  /** Signed campaign-fund change in ANCHOR units (negative = spend). */
  fundsChangeAnchor: number;
  politicalInfluenceChange?: number;
  favorabilityChange?: number;
  donorBaseLevelChange?: number;
  infamyChange?: number;
  /** ConvertCash: personal cash debited, LOCAL currency. */
  cashDebitLocal?: number;
  /** ConvertCash: campaign funds credited, LOCAL currency (replaces fundsChangeAnchor). */
  campaignCreditLocal?: number;
  /** DebatePrep: chance the roll lands, and the Debate gain on success. */
  debateSuccessChance?: number;
  debateGain?: number;
  debateCapped?: boolean;
}

export type SharedActionQuote =
  | {
      ok: true;
      actionType: SharedActionType;
      rulesVersion: string;
      apCost: number;
      /** Fund cost in ANCHOR units; 0 when the action is free or has no fund leg. */
      fundCostAnchor: number;
      effect: SharedActionEffect;
    }
  | { ok: false; actionType: SharedActionType; rulesVersion: string; error: string };

function reject(actionType: SharedActionType, error: string): SharedActionQuote {
  return { ok: false, actionType, rulesVersion: RULES_VERSION, error };
}

function accept(
  actionType: SharedActionType,
  apCost: number,
  fundCostAnchor: number,
  effect: SharedActionEffect
): SharedActionQuote {
  return { ok: true, actionType, rulesVersion: RULES_VERSION, apCost, fundCostAnchor, effect };
}

/**
 * The single authoritative quote for any action: AP cost, fund cost, effect
 * and eligibility. Execution and display both resolve through this.
 */
export function quoteAction(input: SharedActionQuoteInput): SharedActionQuote {
  const { actionType, actor, target } = input;
  const priceLevel = input.context?.priceLevel;
  const stats = actor.stats ?? undefined;
  switch (actionType) {
    case "fundraise": {
      const q = quoteFundraiseAction(
        {
          donorBaseLevel: actor.donorBaseLevel,
          politicalInfluence: actor.politicalInfluence,
          fundraising: stats?.fundraising,
        },
        priceLevel
      );
      if (!q.ok) return reject(actionType, q.error);
      return accept(actionType, q.apCost, 0, { fundsChangeAnchor: q.yieldAnchor });
    }
    case "campaign": {
      const q = quoteCampaignAction(
        {
          politicalInfluence: actor.politicalInfluence,
          charisma: stats?.charisma,
          intellect: stats?.intellect,
        },
        target,
        priceLevel
      );
      if (!q.ok) return reject(actionType, q.error);
      return accept(actionType, q.apCost, q.fundCostAnchor, {
        fundsChangeAnchor: -q.fundCostAnchor,
        politicalInfluenceChange: q.influenceGain,
      });
    }
    case "advertise": {
      const q = quoteAdvertiseAction(
        { favorability: actor.favorability, charisma: stats?.charisma },
        target,
        priceLevel
      );
      if (!q.ok) return reject(actionType, q.error);
      return accept(actionType, q.apCost, q.fundCostAnchor, {
        fundsChangeAnchor: -q.fundCostAnchor,
        favorabilityChange: q.favorabilityGain,
      });
    }
    case "buildDonorBase": {
      const q = quoteBuildDonorBaseAction(
        { donorBaseLevel: actor.donorBaseLevel, fundraising: stats?.fundraising },
        target,
        priceLevel
      );
      if (!q.ok) return reject(actionType, q.error);
      return accept(actionType, q.apCost, q.fundCostAnchor, {
        fundsChangeAnchor: -q.fundCostAnchor,
        donorBaseLevelChange: q.donorGain,
      });
    }
    case "poll":
    case "pollLarge": {
      const q = quotePollAction(
        { intellect: stats?.intellect },
        actionType === "poll" ? "small" : "large",
        priceLevel
      );
      if (!q.ok) return reject(actionType, q.error);
      return accept(actionType, q.apCost, q.fundCostAnchor, {
        fundsChangeAnchor: -q.fundCostAnchor,
      });
    }
    case "convertCash": {
      const q = quoteConvertCashAction({ amount: input.context?.convertAmount });
      if (!q.ok) return reject(actionType, q.error);
      return accept(actionType, q.apCost, 0, {
        fundsChangeAnchor: 0,
        cashDebitLocal: q.cashDebitLocal,
        campaignCreditLocal: q.convertedLocal,
        infamyChange: q.infamy,
      });
    }
    case "rest": {
      const q = quoteRestAction();
      if (!q.ok) return reject(actionType, q.error);
      return accept(actionType, q.apCost, q.fundCostAnchor, { fundsChangeAnchor: 0 });
    }
    case "debatePrep": {
      const q = quoteDebatePrepAction(
        {
          hasStats: stats != null && typeof stats.debate === "number",
          debate: stats?.debate ?? undefined,
        },
        { rpgStatsEnabled: input.context?.rpgStatsEnabled }
      );
      if (!q.ok) return reject(actionType, q.error);
      return accept(actionType, q.apCost, 0, {
        fundsChangeAnchor: 0,
        debateSuccessChance: q.successChance,
        debateGain: q.debateGain,
        debateCapped: q.capped,
      });
    }
  }
}

/**
 * AP-only cost for hosts that price the action bar without stat or target
 * context. Same numbers as the apCost on {@link quoteAction}; flat actions
 * ignore the actor, tiered actions read the one stat that tiers them.
 */
export function getSharedActionPointCost(
  actionType: SharedActionType,
  actor: Pick<SharedActionActor, "donorBaseLevel" | "politicalInfluence" | "favorability">
): number {
  switch (actionType) {
    case "fundraise":
      return FUNDRAISE_ACTION_COST;
    case "campaign":
      return getCampaignActionCost(actor.politicalInfluence ?? 0);
    case "advertise":
      return getAdvertiseActionCost(actor.favorability ?? 0);
    case "buildDonorBase":
      return getBuildDonorBaseActionCost(actor.donorBaseLevel ?? 0);
    case "poll":
      return getPollActionCost("small");
    case "pollLarge":
      return getPollActionCost("large");
    case "convertCash":
      return CONVERT_CASH_ACTION_COST;
    case "rest":
      return REST_ACTION_COST;
    case "debatePrep":
      return DEBATE_PREP_ACTION_COST;
  }
}

/** True when the string names an action the shared rules price. */
export function isSharedActionType(value: string): value is SharedActionType {
  return (SHARED_ACTION_TYPES as readonly string[]).includes(value);
}
