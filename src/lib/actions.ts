import type { Character, State, ActionType } from "@/lib/db/types";
import { getHomeCurrency, getTotalPersonalLiquidWealth } from "@/lib/currency/characterFunds";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import { campaignAnchorToLocal } from "@/lib/campaigns/campaignCurrency";
import type { StatKey } from "@/lib/stats/statsConstants";
import {
  FUNDRAISE_ACTION_COST,
  fundraiseYieldAnchor,
  quoteFundraiseAction,
  getCampaignActionCost,
  quoteCampaignAction,
  getAdvertiseActionCost,
  quoteAdvertiseAction,
  getBuildDonorBaseActionCost,
  quoteBuildDonorBaseAction,
  CONVERT_CASH_ACTION_COST,
  calculateConvertCashInfamy,
  convertCashConversion,
  POLL_ACTION_COST,
  POLL_LARGE_ACTION_COST,
  getPollActionCost,
  quotePollAction,
  type PollTier,
  REST_ACTION_COST,
  REST_RESULT_MESSAGE,
  quoteRestAction,
  DEBATE_PREP_ACTION_COST,
  quoteDebatePrepAction,
  describeDebatePrepAction,
} from "./actions/rules";

export {
  FUNDRAISE_ACTION_COST,
  FUNDRAISE_NO_DONOR_ERROR,
  calculateFundraisingAmount,
  fundraiseYieldAnchor,
  isFundraiseEligible,
  quoteFundraiseAction,
  type FundraiseActor,
  type FundraiseQuoteActor,
  type FundraiseQuote,
  CAMPAIGN_BASE_FUND_COST,
  CAMPAIGN_MAX_INFLUENCE,
  getFundMultiplier,
  getCampaignActionCost,
  getCampaignFundCost,
  campaignInfluenceGain,
  isCampaignEligible,
  quoteCampaignAction,
  type CampaignQuoteActor,
  type CampaignQuoteTarget,
  type CampaignQuote,
  ADVERTISE_BASE_FUND_COST,
  getAdvertiseActionCost,
  getAdvertiseFundCost,
  advertiseFavorabilityGain,
  quoteAdvertiseAction,
  type AdvertiseQuoteActor,
  type AdvertiseQuoteTarget,
  type AdvertiseQuote,
  BUILD_DONOR_BASE_FUND,
  BUILD_DONOR_BASE_FUND_PER_LEVEL,
  BUILD_DONOR_BASE_LEVEL_GAIN,
  getBuildDonorBaseActionCost,
  getBuildDonorBaseFundCost,
  quoteBuildDonorBaseAction,
  type BuildDonorBaseQuoteActor,
  type BuildDonorBaseQuoteTarget,
  type BuildDonorBaseQuote,
  CONVERT_CASH_ACTION_COST,
  CONVERT_CASH_RATE,
  calculateConvertCashInfamy,
  convertCashConversion,
  quoteConvertCashAction,
  type ConvertCashQuoteActor,
  type ConvertCashQuote,
  POLL_BASE_FUND_COST,
  POLL_LARGE_BASE_FUND_COST,
  POLL_ACTION_COST,
  POLL_LARGE_ACTION_COST,
  getPollActionCost,
  getPollBaseFundCost,
  getPollFundCost,
  quotePollAction,
  type PollTier,
  type PollQuoteActor,
  type PollQuote,
  REST_ACTION_COST,
  REST_RESULT_MESSAGE,
  quoteRestAction,
  type RestQuote,
  DEBATE_PREP_ACTION_COST,
  DEBATE_PREP_SUCCESS_CHANCE,
  DEBATE_PREP_DEBATE_GAIN,
  DEBATE_PREP_DISABLED_ERROR,
  DEBATE_PREP_UNALLOCATED_ERROR,
  quoteDebatePrepAction,
  describeDebatePrepAction,
  describeDebatePrepEffect,
  type DebatePrepQuoteActor,
  type DebatePrepQuoteOptions,
  type DebatePrepQuote,
} from "./actions/rules";

/**
 * Currency context the execute route supplies so action result messages render
 * in the player's LOCAL home currency. Campaign funds are stored in local, so
 * message amounts must never show anchor (₳) — see the no-anchor-in-campaign-UI
 * convention. `effect.fundsChange` is in ANCHOR units, so `formatFunds` is
 * responsible for the anchor→local conversion and the local symbol.
 */
export interface ActionEffectContext {
  formatFunds: (anchorAmount: number) => string;
  /**
   * World reset preset selecting the GDP-baseline era for cost math.
   * The execute route passes `gameState.preset`; absent (client batch
   * previews, tests) the modern-era baseline applies.
   */
  preset?: string;
  /** Resolved between-era campaign price level; 1 preserves current behavior. */
  priceLevel?: number;
}

/**
 * Fallback fund formatter for `effect()` callers that don't render the message
 * (canPerformAction, the batch simulator). Emits a bare number — never ₳ — so
 * anchor units can't leak even on the unused path.
 */
const plainFunds: ActionEffectContext["formatFunds"] = (n) => Math.round(n).toLocaleString();

/** Format a LOCAL-currency amount with its symbol (integer, no decimals). */
export function formatLocalFunds(localAmount: number, currency: CurrencyCode): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${symbol}${Math.round(localAmount).toLocaleString()}`;
}

/**
 * Build the anchor→local message formatter the execute route passes into
 * `effect()`. When forex is enabled the anchor amount is scaled by the live
 * home FX rate; otherwise anchor == local.
 */
export function makeFundsFormatter(
  homeCurrency: CurrencyCode,
  homeFxRate: number,
  forexEnabled: boolean
): ActionEffectContext["formatFunds"] {
  return (anchorAmount) =>
    formatLocalFunds(forexEnabled ? anchorAmount * homeFxRate : anchorAmount, homeCurrency);
}

export interface ActionDefinition {
  type: ActionType;
  name: string;
  description: string;
  baseCost: number;
  requiresState?: boolean;
  effect: (character: Character, state?: State, ctx?: ActionEffectContext) => ActionResult;
}

export interface ActionResult {
  fundsChange?: number;
  politicalInfluenceChange?: number;
  favorabilityChange?: number;
  infamyChange?: number;
  donorBaseLevelChange?: number;
  cashOnHandChange?: number;
  message: string;
}

/**
 * The Fundraise yield as it will actually land in the campaign treasury, in the
 * character's LOCAL campaign currency. Mirrors executeAction exactly: campaign
 * funds convert at the FROZEN base rate (`campaignAnchorToLocal`), never the
 * live forex rate. Quoting this with a live-rate formatter is what made the card
 * advertise ~1.8M in a 1953 East Germany while the credit paid ~1.0M, because
 * the live rate differs from the world's fixed base rate.
 */
export function fundraiseYieldLocal(
  character: Character,
  forexEnabled: boolean,
  campaignRates?: import("@/lib/campaigns/rules/currency").CampaignCurrencyRates | null
): number {
  const anchor = fundraiseYieldAnchor(character);
  return forexEnabled
    ? campaignAnchorToLocal(anchor, character.countryId ?? "US", campaignRates)
    : anchor;
}

/**
 * Passive NPI (National Political Influence) accrual per turn.
 * Flat 0.5 per turn regardless of current NPI — no cap, no decay.
 * The 0.5 rate keeps national influence growth slow relative to state PI (which
 * gains 1% per Campaign action). Prevents idle characters from accumulating
 * meaningful national standing without active campaigning.
 */
export function calculateInfluenceAccrual(_currentInfluence: number): number {
  return 0.5;
}

/**
 * Action-point cost for Fundraise and BuildDonorBase actions (0–75 level range).
 *
 * Fundraise: flat 3 AP at every level — no escalating penalty for a large network.
 *
 * BuildDonorBase: power-curve from 4 AP (L0) to 20 AP (L75), notable high-end.
 *   Formula: min(20, round(4 + (level/75)^1.4 × 16))
 *   L0=4  L10=5  L25=8  L50=13  L65=17  L75=20
 */
export function getDonorActionCost(
  donorBaseLevel: number,
  action: "fundraise" | "buildDonorBase"
): number {
  if (action === "fundraise") return FUNDRAISE_ACTION_COST;
  return getBuildDonorBaseActionCost(donorBaseLevel);
}

/**
 * Diminishing-returns shape for a turn's TOTAL passive campaign favorability
 * (media spending + travel presence + the primary in-state bonus), applied once
 * to the summed positive gain.
 *
 * Third member of the "curves must intersect" family, alongside
 * {@link advertiseFavorabilityGain} and {@link campaignInfluenceGain}. Both of
 * those were given a favorability/influence-dependent penalty precisely so a
 * self-reinforcing stat has a stable equilibrium below the cap. The passive
 * campaign channel was missed by both fixes and stayed flat.
 *
 * Root cause this closes: passive gain did not vary with favorability at all,
 * while decay is bounded — `calculateFavorabilityAboveThresholdPenalty` maxes
 * out at (100−60)×0.05 = 2.0/turn. A maxed media tree pays
 * 0.5 (starter) + 1.5 (Broadcast t3) + 1.0 (Digital Ads t3) = 3.0/turn, doubled
 * to 6.0 inside the final-four-turn season window, plus 1.0/turn for travel.
 * Gain 3.0+ against a hard ceiling of 2.0 means the curves never intersect and
 * the candidate pins at 100 permanently. The engine already knew: see
 * `isTargetMediaSustainedAtCap` in simpleInfluence.ts, which detects exactly
 * this state (mediaLevel >= 4) to explain a disabled Support button, rather
 * than preventing it.
 *
 * Curve: base − (favorability − 80) × 0.15, floored at 0.5. The 0.5 floor sits
 * well under the 2.0 decay ceiling, so no combination of passives can re-pin at
 * the cap.
 *
 * Threshold set at 80, not 70, deliberately: political operations are meant to
 * be the STRONG way to build standing, so the penalty should not start biting
 * in the range a serious campaign lives in. A fully-invested media + travel
 * stack (4.0/turn raw) reaches an equilibrium near 95 — high, clearly rewarding
 * the investment, and still short of the permanent 100 pin that made
 * reputation unassailable. Lowering this threshold weakens campaigns; raising
 * it past ~85 restores the pin. This is the paired opposite of the softened
 * `APPROVAL_SCALAR_EXPONENT`: favorability matters marginally less per point,
 * and operations are the intended way to earn the points that remain.
 *
 * Apply AFTER the season multiplier: the final-four-turn 2x doubles the raw
 * gain, and curving the pre-doubled value would let the doubled result clear
 * decay again in exactly the turns that cast 30% of the vote.
 */
export const PASSIVE_FAV_DIMINISH_THRESHOLD = 80;
export const PASSIVE_FAV_DIMINISH_RATE = 0.15;
export const PASSIVE_FAV_MIN_PER_TURN = 0.5;

export function diminishPassiveFavorabilityGain(
  rawGain: number,
  currentFavorability: number
): number {
  if (rawGain <= 0) return rawGain;
  const penalty =
    currentFavorability > PASSIVE_FAV_DIMINISH_THRESHOLD
      ? (currentFavorability - PASSIVE_FAV_DIMINISH_THRESHOLD) * PASSIVE_FAV_DIMINISH_RATE
      : 0;
  return Math.max(PASSIVE_FAV_MIN_PER_TURN, rawGain - penalty);
}

/**
 * All available player actions.
 * Costs are balanced for ~25 starting actions per character, with 4 action points
 * regenerated per turn. Dynamic costs (campaign, advertise, donor actions) are
 * computed via getCampaignActionCost() / getAdvertiseActionCost() / getDonorActionCost()
 * and override the static baseCost field at execution time.
 */
export const ACTIONS: Record<ActionType, ActionDefinition> = {
  fundraise: {
    type: "fundraise",
    name: "Fundraise",
    description: "Raise money from your donor base",
    baseCost: FUNDRAISE_ACTION_COST,
    requiresState: false,
    effect: (character: Character, _state?: State, ctx?: ActionEffectContext) => {
      // Single source of truth: the UI card, the advisor and the projection
      // quote this same quote, so the advertised yield can never drift from
      // the credited result. canPerformAction runs the quote first; the throw
      // below is a defensive invariant for direct effect callers that skip
      // validation.
      const quote = quoteFundraiseAction(
        {
          donorBaseLevel: character.donorBaseLevel,
          politicalInfluence: character.politicalInfluence,
          fundraising: character.stats?.fundraising,
        },
        ctx?.priceLevel
      );
      if (!quote.ok) throw new Error(quote.error);
      const amount = quote.yieldAnchor;
      const fmt = ctx?.formatFunds ?? plainFunds;
      return {
        fundsChange: amount,
        message: `Successfully raised ${fmt(amount)} from your donors!`,
      };
    },
  },

  campaign: {
    type: "campaign",
    name: "Campaign",
    description:
      "Increase your political influence — up to +1%, with diminishing returns above 50% (cost scales with current influence and state GDP)",
    baseCost: 1, // dynamic — actual cost computed via getCampaignActionCost()
    requiresState: false,
    effect: (character: Character, state?: State, ctx?: ActionEffectContext) => {
      // Single source of truth: the UI card quotes this same quote, so the
      // advertised cost/gain can never drift from the debited/credited result.
      // canPerformAction runs the quote first; the throw below is a defensive
      // invariant for direct effect callers that skip validation.
      const quote = quoteCampaignAction(
        {
          politicalInfluence: character.politicalInfluence,
          charisma: character.stats?.charisma,
          intellect: character.stats?.intellect,
        },
        state
          ? {
              gdpMillions: state.gdp,
              population: state.population,
              countryId: character.countryId,
              preset: ctx?.preset,
            }
          : undefined,
        ctx?.priceLevel
      );
      if (!quote.ok) throw new Error(quote.error);
      return {
        fundsChange: -quote.fundCostAnchor,
        politicalInfluenceChange: quote.influenceGain,
        message: `Campaigned in ${state?.name ?? "your state"} — gained ${quote.influenceGain.toFixed(2)}% political influence.`,
      };
    },
  },

  advertise: {
    type: "advertise",
    name: "Run Advertisements",
    description: "Run ads to boost your favorability rating",
    baseCost: 5,
    requiresState: false,
    effect: (character: Character, state?: State, ctx?: ActionEffectContext) => {
      // Single source of truth: the UI card quotes this same quote, so the
      // advertised cost/gain can never drift from the debited/credited result.
      // canPerformAction runs the quote first; the throw below is a defensive
      // invariant for direct effect callers that skip validation.
      const quote = quoteAdvertiseAction(
        {
          favorability: character.favorability,
          charisma: character.stats?.charisma,
        },
        state
          ? {
              gdpMillions: state.gdp,
              population: state.population,
              countryId: character.countryId,
              preset: ctx?.preset,
            }
          : undefined,
        ctx?.priceLevel
      );
      if (!quote.ok) throw new Error(quote.error);
      const fmt = ctx?.formatFunds ?? plainFunds;

      return {
        fundsChange: -quote.fundCostAnchor,
        favorabilityChange: quote.favorabilityGain,
        message: `Spent ${fmt(quote.fundCostAnchor)} on ads and gained ${quote.favorabilityGain} favorability points!`,
      };
    },
  },

  buildDonorBase: {
    type: "buildDonorBase",
    name: "Build Donor Network",
    description: "Expand your donor base to increase fundraising effectiveness",
    baseCost: 6,
    requiresState: false,
    effect: (character: Character, state?: State, ctx?: ActionEffectContext) => {
      // Single source of truth: the UI card quotes this same quote, so the
      // advertised cost/gain can never drift from the debited/credited result.
      // canPerformAction runs the quote first; the throw below is a defensive
      // invariant for direct effect callers that skip validation.
      const quote = quoteBuildDonorBaseAction(
        {
          donorBaseLevel: character.donorBaseLevel,
          fundraising: character.stats?.fundraising,
        },
        state
          ? {
              gdpMillions: state.gdp,
              population: state.population,
              countryId: character.countryId,
              preset: ctx?.preset,
            }
          : undefined,
        ctx?.priceLevel
      );
      if (!quote.ok) throw new Error(quote.error);
      const fmt = ctx?.formatFunds ?? plainFunds;

      return {
        fundsChange: -quote.fundCostAnchor,
        donorBaseLevelChange: quote.donorGain,
        message: `Spent ${fmt(quote.fundCostAnchor)} to expand your donor network!`,
      };
    },
  },

  poll: {
    type: "poll",
    name: "Quick Poll",
    description:
      "Commission a quick poll — see your topline appeal and best/worst demographic groups ($25,000)",
    baseCost: POLL_ACTION_COST,
    requiresState: false,
    effect: (character: Character, _state?: State, ctx?: ActionEffectContext) => {
      // Single source of truth: the poll page quotes this same quote and the
      // poll API route debits it, so the advertised cost can never drift from
      // the charged result. canPerformAction runs the quote first; the throw
      // below is a defensive invariant for direct effect callers that skip
      // validation.
      const quote = quotePollAction(
        { intellect: character.stats?.intellect },
        "small",
        ctx?.priceLevel
      );
      if (!quote.ok) throw new Error(quote.error);
      const fmt = ctx?.formatFunds ?? plainFunds;
      return {
        fundsChange: -quote.fundCostAnchor,
        message: `Quick poll commissioned (${fmt(quote.fundCostAnchor)}). Topline results available.`,
      };
    },
  },

  pollLarge: {
    type: "pollLarge",
    name: "Full Demographic Poll",
    description:
      "Commission a comprehensive poll — full breakdown across every demographic group and category ($75,000)",
    baseCost: POLL_LARGE_ACTION_COST,
    requiresState: false,
    effect: (character: Character, _state?: State, ctx?: ActionEffectContext) => {
      // Single source of truth: the poll page quotes this same quote and the
      // poll API route debits it, so the advertised cost can never drift from
      // the charged result. canPerformAction runs the quote first; the throw
      // below is a defensive invariant for direct effect callers that skip
      // validation.
      const quote = quotePollAction(
        { intellect: character.stats?.intellect },
        "large",
        ctx?.priceLevel
      );
      if (!quote.ok) throw new Error(quote.error);
      const fmt = ctx?.formatFunds ?? plainFunds;
      return {
        fundsChange: -quote.fundCostAnchor,
        message: `Full demographic poll commissioned (${fmt(quote.fundCostAnchor)}). Detailed breakdown available.`,
      };
    },
  },

  convertCash: {
    type: "convertCash",
    name: "Personal Campaign Donation",
    description:
      "Convert personal cash on hand into campaign funds at a 50% rate (infamy scales with amount)",
    baseCost: CONVERT_CASH_ACTION_COST,
    requiresState: false,
    effect: (character: Character) => {
      // Default effect uses all cash; execute route overrides with convertAmount.
      // Post-Phase-8: prefer the per-currency personal balance in the home
      // currency; fall back to the legacy cashOnHand for un-migrated fixtures.
      // Single source of truth: the shared conversion and infamy legs (the
      // same legs quoteConvertCashAction prices) so the credited conversion
      // can never drift from the debited one. The legs — not the full quote —
      // because a zero home-bucket balance is not a quotable amount but must
      // still price (canPerformAction probes this effect for its funds check
      // after the zero-wealth gate).
      const homeCode = getHomeCurrency(character);
      const cash = character.currencyBalances?.personal?.[homeCode] ?? character.cashOnHand ?? 0;
      const converted = convertCashConversion(cash);
      const infamy = calculateConvertCashInfamy(cash);
      // `cash`/`converted` are already in LOCAL home currency, so format with the
      // home symbol directly (no anchor→local conversion).
      return {
        cashOnHandChange: -cash,
        fundsChange: converted,
        infamyChange: infamy,
        message: `Donated ${formatLocalFunds(cash, homeCode)} personal funds — ${formatLocalFunds(converted, homeCode)} added to campaign coffers. +${infamy} Infamy.`,
      };
    },
  },

  rest: {
    type: "rest",
    name: "Rest",
    description: "Take a break (does nothing)",
    baseCost: REST_ACTION_COST,
    requiresState: false,
    effect: () => {
      // Single source of truth: the dashboard, the advisor and
      // canPerformAction read this same quote, so the advertised (zero) cost
      // can never drift from the charged result. canPerformAction runs the
      // quote first; the throw below is a defensive invariant for direct
      // effect callers that skip validation.
      const quote = quoteRestAction();
      if (!quote.ok) throw new Error(quote.error);
      return {
        message: REST_RESULT_MESSAGE,
      };
    },
  },

  debatePrep: {
    type: "debatePrep",
    name: "Debate Prep",
    // Single source of truth: the card effect label quotes this same chance
    // constant, so the advertised odds can never drift from the resolved roll
    // (the text previously advertised 10% while the roll resolved 15%).
    description: describeDebatePrepAction(),
    baseCost: DEBATE_PREP_ACTION_COST,
    requiresState: false,
    // The actual roll + Debate write is handled in the execute route (it needs
    // RNG and the character's current stat). This placeholder keeps the standard
    // cost/validation path working.
    effect: () => {
      return { message: "You studied hard." };
    },
  },
};

/**
 * Maps an action to the generic-drift stat its use grows. Performing the action
 * adds `USE_GROWTH_INCREMENT` of XP to this stat (flushed each turn). Energy
 * grows on every action separately (active play), so it is not listed here.
 */
export const USE_GROWTH_STAT_BY_ACTION: Partial<Record<ActionType, StatKey>> = {
  fundraise: "fundraising",
  buildDonorBase: "fundraising",
  campaign: "charisma",
  advertise: "charisma",
  poll: "intellect",
  pollLarge: "intellect",
};

export type CanPerformActionOptions = {
  /** When true, fund and personal-cash checks use `currencyBalances` (must match execute route). */
  forexEnabled?: boolean;
  /** Live home FX rate for converting stored local campaign funds back to internal units. */
  homeFxRate?: number;
  /** World reset preset selecting the GDP-baseline era for cost validation. */
  preset?: string;
  /** Resolved between-era campaign price level; 1 preserves current behavior. */
  priceLevel?: number;
  /**
   * Resolved RPG-stats feature flag for Debate Prep validation. The execute
   * shell always passes the resolved value; callers that cannot know it omit
   * the field and skip the flag leg only (the stat-block leg still applies).
   */
  rpgStatsEnabled?: boolean;
};

/**
 * Validate if character can perform an action
 */
export function canPerformAction(
  character: Character,
  actionType: ActionType,
  state?: State,
  options?: CanPerformActionOptions
): { canPerform: boolean; reason?: string } {
  const forexEnabled = options?.forexEnabled ?? false;
  const homeFxRate = options?.homeFxRate;
  const action = ACTIONS[actionType];

  if (!action) {
    return { canPerform: false, reason: "Invalid action type" };
  }

  // Campaign validates through the same rules quote the UI and the effect use:
  // tiered AP cost, GDP-scaled fund cost, stat-scaled gain and the 100% cap.
  // Missing stats or missing home-state economics reject here with the quote
  // reason instead of falling back to neutral values.
  if (actionType === "campaign") {
    const quote = quoteCampaignAction(
      {
        politicalInfluence: character.politicalInfluence,
        charisma: character.stats?.charisma,
        intellect: character.stats?.intellect,
      },
      state
        ? {
            gdpMillions: state.gdp,
            population: state.population,
            countryId: character.countryId,
            preset: options?.preset,
          }
        : undefined,
      options?.priceLevel
    );
    if (!quote.ok) {
      return { canPerform: false, reason: quote.error };
    }
  }

  // BuildDonorBase validates through the same rules quote the UI and the
  // effect use: level-scaled AP cost, GDP-scaled fund cost with the
  // fundraising discount, and the +1 level gain. Missing stats or missing
  // home-state economics reject here with the quote reason instead of
  // falling back to neutral values.
  if (actionType === "buildDonorBase") {
    const quote = quoteBuildDonorBaseAction(
      {
        donorBaseLevel: character.donorBaseLevel,
        fundraising: character.stats?.fundraising,
      },
      state
        ? {
            gdpMillions: state.gdp,
            population: state.population,
            countryId: character.countryId,
            preset: options?.preset,
          }
        : undefined,
      options?.priceLevel
    );
    if (!quote.ok) {
      return { canPerform: false, reason: quote.error };
    }
  }

  const actualCost = getActionPointCost(character, actionType);

  // Check action points against real cost
  if (character.actions < actualCost) {
    return {
      canPerform: false,
      reason: `Not enough action points. Required: ${actualCost}, Available: ${character.actions}`,
    };
  }

  // Converting cash requires spendable liquid personal balance; savings must be withdrawn first.
  if (actionType === "convertCash" && getTotalPersonalLiquidWealth(character, forexEnabled) <= 0) {
    return {
      canPerform: false,
      reason: "You have no personal cash on hand to convert.",
    };
  }

  // Fundraise validates through the same rules quote the UI and the effect
  // use: flat AP cost and the stat-scaled yield. A zero donor base rejects
  // here with the quote reason instead of pricing a yield that cannot be
  // earned.
  if (actionType === "fundraise") {
    const quote = quoteFundraiseAction(
      {
        donorBaseLevel: character.donorBaseLevel,
        politicalInfluence: character.politicalInfluence,
        fundraising: character.stats?.fundraising,
      },
      options?.priceLevel
    );
    if (!quote.ok) {
      return { canPerform: false, reason: quote.error };
    }
  }

  // Polls validate through the same rules quote the poll page and the effect
  // use: flat AP cost and the intellect-scaled fund cost. A missing intellect
  // stat rejects here with the quote reason instead of falling back to the
  // unscaled base.
  if (actionType === "poll" || actionType === "pollLarge") {
    const tier: PollTier = actionType === "pollLarge" ? "large" : "small";
    const quote = quotePollAction(
      { intellect: character.stats?.intellect },
      tier,
      options?.priceLevel
    );
    if (!quote.ok) {
      return { canPerform: false, reason: quote.error };
    }
  }

  // Debate Prep validates through the same rules quote the execute gate
  // uses: flat AP cost, the fixed success chance and the flag + stat-block
  // eligibility. A missing stat block rejects here with the quote reason
  // instead of charging for a roll that cannot land. The flag leg applies
  // only when the caller passes the resolved value (the execute shell does).
  if (actionType === "debatePrep") {
    const quote = quoteDebatePrepAction(
      {
        debate: character.stats?.debate,
        hasStats: !!character.stats,
      },
      { rpgStatsEnabled: options?.rpgStatsEnabled }
    );
    if (!quote.ok) {
      return { canPerform: false, reason: quote.error };
    }
  }

  // Advertise validates through the same rules quote the UI and the effect use:
  // tiered AP cost, GDP-scaled fund cost and the charisma-scaled gain. Missing
  // stats or missing home-state economics reject here with the quote reason
  // instead of falling back to neutral values.
  if (actionType === "advertise") {
    const quote = quoteAdvertiseAction(
      {
        favorability: character.favorability,
        charisma: character.stats?.charisma,
      },
      state
        ? {
            gdpMillions: state.gdp,
            population: state.population,
            countryId: character.countryId,
            preset: options?.preset,
          }
        : undefined,
      options?.priceLevel
    );
    if (!quote.ok) {
      return { canPerform: false, reason: quote.error };
    }
  }

  // Rest validates through the same rules quote the effect uses: zero AP
  // cost, zero fund cost, always eligible. The quote cannot reject; the gate
  // keeps every action on one validation path with one failure shape.
  if (actionType === "rest") {
    const quote = quoteRestAction();
    if (!quote.ok) {
      return { canPerform: false, reason: quote.error };
    }
  }

  // Check if state is required
  if (action.requiresState && !state) {
    return {
      canPerform: false,
      reason: `This action requires selecting a state`,
    };
  }

  // Check funds for actions that cost money. effect.fundsChange is ANCHOR; the
  // stored balance is LOCAL. Compare and report in LOCAL home currency — campaign
  // funds live in local and the UI must never surface anchor (₳) to the player.
  const effect = action.effect(character, state, {
    formatFunds: plainFunds,
    preset: options?.preset,
  });
  if (effect.fundsChange && effect.fundsChange < 0) {
    const costAnchor = Math.abs(effect.fundsChange);
    const balanceLocal = character.currencyBalances?.campaign ?? character.funds ?? 0;
    const usingForex = forexEnabled && !!character.currencyBalances;
    const requiredLocal = usingForex ? costAnchor * (homeFxRate ?? 1) : costAnchor;
    if (balanceLocal < requiredLocal) {
      const homeCurrency = getHomeCurrency(character);
      return {
        canPerform: false,
        reason: `Not enough funds. Required: ${formatLocalFunds(requiredLocal, homeCurrency)}, Available: ${formatLocalFunds(balanceLocal, homeCurrency)}`,
      };
    }
  }

  return { canPerform: true };
}

/** Action types that support ×5 / ×10 batch execution in the UI (simulation + future wiring). */
export const BATCHABLE_ACTION_TYPES: readonly ActionType[] = [
  "fundraise",
  "campaign",
  "advertise",
  "buildDonorBase",
  "poll",
  "pollLarge",
] as const;

/** Tiered action-point cost for one run at current stats (used by execute route and batch simulation). */
export function getActionPointCost(character: Character, actionType: ActionType): number {
  const action = ACTIONS[actionType];
  if (actionType === "campaign") {
    return getCampaignActionCost(character.politicalInfluence ?? 0);
  }
  if (actionType === "advertise") {
    return getAdvertiseActionCost(character.favorability ?? 0);
  }
  if (actionType === "rest") {
    return REST_ACTION_COST;
  }
  if (actionType === "poll") {
    return getPollActionCost("small");
  }
  if (actionType === "pollLarge") {
    return getPollActionCost("large");
  }
  if (actionType === "fundraise") {
    return getDonorActionCost(character.donorBaseLevel ?? 0, "fundraise");
  }
  if (actionType === "buildDonorBase") {
    return getDonorActionCost(character.donorBaseLevel ?? 0, "buildDonorBase");
  }
  return action.baseCost;
}

function applyEffectToCharacter(
  character: Character,
  actionType: ActionType,
  state: State | undefined,
  forexEnabled = false,
  homeFxRate?: number
): Character {
  const effect = ACTIONS[actionType].effect(character, state);
  const c: Character = { ...character };
  if (effect.fundsChange) {
    // effect.fundsChange is in ANCHOR units. Apply directly to whichever field
    // holds the local-currency truth: post-forex it's currencyBalances.campaign
    // (multiplied by rate); pre-forex it's funds.
    if (forexEnabled && c.currencyBalances) {
      const deltaLocal = effect.fundsChange * (homeFxRate ?? 1);
      c.currencyBalances = {
        ...c.currencyBalances,
        campaign: (c.currencyBalances.campaign ?? 0) + deltaLocal,
      };
    } else {
      c.funds = (c.funds ?? 0) + effect.fundsChange;
    }
  }
  if (effect.politicalInfluenceChange != null) {
    c.politicalInfluence = Math.min(
      100,
      Math.max(0, (c.politicalInfluence ?? 0) + effect.politicalInfluenceChange)
    );
  }
  if (effect.favorabilityChange != null) {
    c.favorability = Math.min(100, Math.max(0, (c.favorability ?? 0) + effect.favorabilityChange));
  }
  if (effect.infamyChange != null) {
    c.infamy = Math.min(100, Math.max(0, (c.infamy ?? 0) + effect.infamyChange));
  }
  if (effect.donorBaseLevelChange != null) {
    c.donorBaseLevel = (c.donorBaseLevel ?? 0) + effect.donorBaseLevelChange;
  }
  if (effect.cashOnHandChange != null) {
    if (forexEnabled && c.currencyBalances) {
      const code = getHomeCurrency(c);
      c.currencyBalances = {
        ...c.currencyBalances,
        personal: {
          ...c.currencyBalances.personal,
          [code]: (c.currencyBalances.personal[code] ?? 0) + effect.cashOnHandChange,
        },
      };
    } else {
      c.cashOnHand = (c.cashOnHand ?? 0) + effect.cashOnHandChange;
    }
  }
  return c;
}

export type SimulateActionBatchResult =
  | { ok: true; totalActionPoints: number; netFundsChange: number; finalCharacter: Character }
  | { ok: false; reason?: string };

/**
 * Simulate running the same action N times in sequence (client preview / batch UX).
 * Applies tiered costs and stat updates per step; fails on first step that cannot run.
 */
export function simulateActionBatch(
  character: Character,
  state: State | undefined,
  actionType: ActionType,
  count: 5 | 10,
  forexEnabled = false,
  homeFxRate?: number
): SimulateActionBatchResult {
  let c: Character = { ...character };
  let totalActionPoints = 0;
  // Track initial balance in LOCAL units (currencyBalances.campaign or funds);
  // convert to anchor for the returned netFundsChange (ANCHOR — UI contract).
  const initialBalanceLocal = character.currencyBalances?.campaign ?? character.funds ?? 0;
  const rate = forexEnabled && character.currencyBalances ? (homeFxRate ?? 1) : 1;
  const initialFunds = initialBalanceLocal / rate;

  for (let i = 0; i < count; i++) {
    const validation = canPerformAction(c, actionType, state, { forexEnabled, homeFxRate });
    if (!validation.canPerform) {
      return { ok: false, reason: validation.reason };
    }
    const ap = getActionPointCost(c, actionType);
    totalActionPoints += ap;
    c = {
      ...applyEffectToCharacter(c, actionType, state, forexEnabled, homeFxRate),
      actions: (c.actions ?? 0) - ap,
    };
  }

  const finalBalanceLocal = c.currencyBalances?.campaign ?? c.funds ?? 0;
  const netFundsChange = finalBalanceLocal / rate - initialFunds;
  return { ok: true, totalActionPoints, netFundsChange, finalCharacter: c };
}

/**
 * Build the result message for a batched (×N) action run, summarizing the net
 * stat and campaign-fund deltas. The fund delta is read straight from the LOCAL
 * stored balances and rendered in the player's home currency — never anchor (₳)
 * — matching the single-run messages.
 */
export function buildBatchResultMessage(
  count: number,
  before: Character,
  after: Character | null,
  fallbackSingleRunMessage: string,
  homeCurrency: CurrencyCode
): string {
  if (count <= 1 || !after) {
    return fallbackSingleRunMessage;
  }

  const piDelta = (after.politicalInfluence ?? 0) - (before.politicalInfluence ?? 0);
  const favDelta = (after.favorability ?? 0) - (before.favorability ?? 0);
  // Campaign funds are stored in LOCAL; the delta is already in home currency.
  const afterBalanceLocal = after.currencyBalances?.campaign ?? after.funds ?? 0;
  const beforeBalanceLocal = before.currencyBalances?.campaign ?? before.funds ?? 0;
  const fundsDelta = afterBalanceLocal - beforeBalanceLocal;
  const donorDelta = (after.donorBaseLevel ?? 0) - (before.donorBaseLevel ?? 0);
  const infamyDelta = (after.infamy ?? 0) - (before.infamy ?? 0);

  const parts: string[] = [`Completed ${count} times.`];
  if (piDelta !== 0) {
    parts.push(`Political influence ${piDelta > 0 ? "+" : ""}${piDelta}% total.`);
  }
  if (favDelta !== 0) {
    parts.push(`Favorability ${favDelta > 0 ? "+" : ""}${favDelta} total.`);
  }
  if (fundsDelta !== 0) {
    parts.push(
      fundsDelta > 0
        ? `Campaign funds +${formatLocalFunds(fundsDelta, homeCurrency)} total.`
        : `Campaign funds −${formatLocalFunds(Math.abs(fundsDelta), homeCurrency)} total.`
    );
  }
  if (donorDelta !== 0) {
    parts.push(`Donor network +${donorDelta} level(s) total.`);
  }
  if (infamyDelta !== 0) {
    parts.push(`Infamy ${infamyDelta > 0 ? "+" : ""}${infamyDelta} total.`);
  }

  if (parts.length === 1) {
    return `Completed ${count} times. ${fallbackSingleRunMessage}`;
  }
  return parts.join(" ");
}
