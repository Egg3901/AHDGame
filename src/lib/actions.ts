import type { Character, State, ActionType } from "@/lib/db/types";
import { getGdpBaseline } from "@/lib/utils/fundGeneration";
import { getHomeCurrency, getTotalPersonalLiquidWealth } from "@/lib/currency/characterFunds";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";
import { statMultiplier } from "@/lib/stats/statMultiplier";
import { DEBATE_PREP_ACTION_COST, NEUTRAL_STAT, type StatKey } from "@/lib/stats/statsConstants";

/**
 * Read a character's stat with a neutral fallback for characters that predate
 * the stat system (pre-grandfather migration). Neutral yields a 1.0× multiplier
 * so unmigrated characters are unaffected.
 */
function statValue(character: Character, key: StatKey): number {
  return character.stats?.[key] ?? NEUTRAL_STAT;
}

/**
 * Currency context the execute route supplies so action result messages render
 * in the player's LOCAL home currency. Campaign funds are stored in local, so
 * message amounts must never show anchor (₳) — see the no-anchor-in-campaign-UI
 * convention. `effect.fundsChange` is in ANCHOR units, so `formatFunds` is
 * responsible for the anchor→local conversion and the local symbol.
 */
export interface ActionEffectContext {
  formatFunds: (anchorAmount: number) => string;
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
 * Infamy gained from converting personal cash to campaign funds.
 * Power curve: 15 × (amount / $1M) ^ 0.564
 * ~4 at $100K, ~15 at $1M, ~55 at $10M, capped at 100.
 */
export function calculateConvertCashInfamy(amount: number): number {
  if (amount <= 0) return 0;
  const raw = 15 * Math.pow(amount / 1_000_000, 0.564);
  return Math.min(100, Math.round(raw));
}

/**
 * Per-use fundraising yield for the Fundraise action.
 * $50K floor + $2K per donor base level (calibrated for 0–75 range),
 * scaled by state influence multiplier (1.0x at 0% → 2.0x at 100%).
 * L0/0%: $50K, L50/50%: $225K, L75/100%: $400K.
 */
export function calculateFundraisingAmount(
  donorBaseLevel: number,
  stateInfluence?: number
): number {
  const base = 50_000 + donorBaseLevel * 2_000;
  if (stateInfluence === undefined) return base;
  const multiplier = 1 + Math.max(0, Math.min(100, stateInfluence)) / 100;
  return Math.round(base * multiplier);
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
 * Tiered action-point cost for the Campaign action (raise state PI).
 * Tier 1–5 based on current state political influence.
 */
export function getCampaignActionCost(influence: number): number {
  const clampedInfluence = Math.max(0, Math.min(100, influence));
  if (clampedInfluence >= 80) return 5;
  if (clampedInfluence >= 60) return 4;
  if (clampedInfluence >= 40) return 3;
  if (clampedInfluence >= 20) return 2;
  return 1;
}

/**
 * Fund cost for the Campaign action.
 * Base $20,000 × tier, scaled by state GDP per capita relative to country baseline.
 * GDP is stored in millions of dollars (e.g. CT = 289,500 → $289.5B).
 */
export function getCampaignFundCost(
  influence: number,
  stateGdpMillions: number,
  statePopulation: number,
  countryId = "US"
): number {
  const tier = getCampaignActionCost(influence); // 1-5
  const multiplier = getFundMultiplier(tier - 1, stateGdpMillions, statePopulation, countryId);
  return Math.round((20_000 * tier * multiplier) / 1_000) * 1_000;
}

/**
 * Fund cost for the Advertise action.
 * Base $100,000 scaled by favorability tier and state GDP per capita.
 */
export function getAdvertiseFundCost(
  favorability: number,
  stateGdpMillions: number,
  statePopulation: number,
  countryId = "US"
): number {
  const tier = getAdvertiseActionCost(favorability) - 5; // tier index 0-4
  const multiplier = getFundMultiplier(tier, stateGdpMillions, statePopulation, countryId);
  return Math.round((100_000 * multiplier) / 1_000) * 1_000;
}

/**
 * Fund cost for the BuildDonorBase action (0–75 level range).
 * Linear base: $3K + $1.5K/level, scaled by state GDP per capita (0.85–2.0×) vs country baseline.
 * Early levels are cheap (~$3K); L75 costs ~$114K (before GDP scaling).
 * Total 0→75 ≈ $4.4M at national-average GDP.
 */
export function getBuildDonorBaseFundCost(
  donorBaseLevel: number,
  stateGdpMillions: number,
  statePopulation: number,
  countryId = "US"
): number {
  const baseCost = 3_000 + donorBaseLevel * 1_500;
  const baseline = getGdpBaseline(countryId);
  const gdpPerCapita = (stateGdpMillions * 1_000_000) / statePopulation;
  const gdpScalar = Math.max(0.85, Math.min(2.0, gdpPerCapita / baseline));
  return Math.round((baseCost * gdpScalar) / 1_000) * 1_000;
}

/**
 * Tiered action-point cost for the Advertise action.
 * Tier based on current favorability (0–100).
 */
export function getAdvertiseActionCost(favorability: number): number {
  const clampedFavorability = Math.max(0, Math.min(100, favorability));
  if (clampedFavorability >= 85) return 9;
  if (clampedFavorability >= 70) return 8;
  if (clampedFavorability >= 50) return 7;
  if (clampedFavorability >= 30) return 6;
  return 5;
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
  if (action === "fundraise") return 3;
  return Math.min(20, Math.round(4 + Math.pow(donorBaseLevel / 75, 1.4) * 16));
}

/**
 * Shared fund-cost multiplier for actions that spend money.
 * multiplier = (1 + tier × 0.2) × gdpScalar
 * gdpScalar = clamp(gdpPerCapita / countryBaseline, 0.85, 2.0)
 * gdpMillions: state GDP stored in millions (e.g. 289_500 = $289.5B)
 */
export function getFundMultiplier(
  tier: number,
  gdpMillions: number,
  population: number,
  countryId = "US"
): number {
  const baseline = getGdpBaseline(countryId);
  const gdpPerCapita = (gdpMillions * 1_000_000) / population;
  const gdpScalar = Math.max(0.85, Math.min(2.0, gdpPerCapita / baseline));
  return (1 + tier * 0.2) * gdpScalar;
}

/**
 * Base favorability gain for one "Run Advertisements" action, before stat
 * scaling. Shared by player actions and NPP turn processing so the two stay at
 * parity: base +3, diminishing returns above 70% favorability (−0.1 per point
 * over 70), floored at 1 so an ad is never fully wasted. `effectivenessMult`
 * carries the player's charisma multiplier; NPPs pass the default 1.
 */
export function advertiseFavorabilityGain(
  currentFavorability: number,
  effectivenessMult = 1
): number {
  const baseGain = 3;
  const penalty = currentFavorability > 70 ? (currentFavorability - 70) * 0.1 : 0;
  return Math.max(1, Math.floor((baseGain - penalty) * effectivenessMult));
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
 * Curve: base − (favorability − 70) × 0.15, floored at 0.5. The rate is steeper
 * than advertise's 0.1 because this stack tops out higher (media + travel), and
 * 0.15 puts a fully-invested campaign's equilibrium near 88 rather than 100.
 * The 0.5 floor sits well under the 2.0 decay ceiling, so no combination of
 * passives can re-pin at the cap.
 *
 * Apply AFTER the season multiplier: the final-four-turn 2x doubles the raw
 * gain, and curving the pre-doubled value would let the doubled result clear
 * decay again in exactly the turns that cast 30% of the vote.
 */
export const PASSIVE_FAV_DIMINISH_THRESHOLD = 70;
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
 * Base political-influence gain for one "Campaign" action, before stat scaling.
 * Shared by player actions and NPP turn processing (mirrors
 * `advertiseFavorabilityGain`'s shape exactly, so the same "curves must
 * intersect" fix applies to both self-reinforcing stats).
 *
 * Root cause this closes: influence used to grow by a FLAT +1/action forever
 * while `calculatePoliticalInfluenceDecay` only takes 0.75% of the CURRENT
 * value/turn — at the 100 cap that's just -0.75, so one campaign action a
 * turn always won under the old formula and influence pinned at the cap for
 * the life of the world (see `shared/constants/formulas.ts`'s decay doc and
 * the 654-turn `ahd_sim_grand53fx` world's 3.6x/consecutive-incumbent
 * measurement). This gives the gain curve the same diminishing shape
 * favorability already has — base +1, penalized above 50 at 1/75 of the
 * excess, floored at 0.1 so campaigning is never fully wasted — so it has a
 * stable intersection with the proportional decay instead of racing it to the
 * cap.
 *
 * Equilibrium (base gain, one campaign/turn, mult=1): decay(I) = 0.0075·I;
 * gain(I) = 1 − (I−50)/75 for I>50. Setting them equal solves to I* = 80 —
 * a hard-campaigning character with charisma-neutral stats converges on ~80
 * influence, not 100, and does so from either side (a fresher/lower character
 * climbs toward it, an over-decayed one recovers toward it). Heavier
 * dedication (multiple banked campaign actions in one turn) raises the
 * practical ceiling but `getCampaignActionCost`'s own 1-5 AP tiers already
 * throttle sustained multi-action-per-turn campaigning as influence climbs,
 * so even a maximally-dedicated player converges below 100 rather than
 * re-pinning at the cap (simulated ~85-93 at 2x normal AP throughput).
 */
export function campaignInfluenceGain(currentInfluence: number, effectivenessMult = 1): number {
  const baseGain = 1;
  const threshold = 50;
  const rate = 1 / 75;
  const penalty = currentInfluence > threshold ? (currentInfluence - threshold) * rate : 0;
  return Math.max(0.1, (baseGain - penalty) * effectivenessMult);
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
    baseCost: 3,
    requiresState: false,
    effect: (character: Character, _state?: State, ctx?: ActionEffectContext) => {
      const baseAmount = calculateFundraisingAmount(
        character.donorBaseLevel,
        character.politicalInfluence ?? 0
      );
      // Fundraising stat scales the yield (gentle ±20%).
      const amount = Math.round(baseAmount * statMultiplier(statValue(character, "fundraising")));
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
    effect: (character: Character, state?: State) => {
      const influence = character.politicalInfluence ?? 0;
      const rawFundCost = state
        ? getCampaignFundCost(influence, state.gdp, state.population, character.countryId)
        : 20_000;
      // Intellect softens the campaign cost-scaling curve (higher → cheaper).
      const fundCost = Math.round(rawFundCost / statMultiplier(statValue(character, "intellect")));
      // Base +1 with diminishing returns above 50% and a floor of 0.1 (shared
      // with NPP processing — see campaignInfluenceGain's doc comment for the
      // equilibrium this creates), then charisma scales the result (gentle ±20%).
      const piGain = campaignInfluenceGain(
        influence,
        statMultiplier(statValue(character, "charisma"))
      );
      return {
        fundsChange: -fundCost,
        politicalInfluenceChange: piGain,
        message: `Campaigned in ${state?.name ?? "your state"} — gained ${piGain.toFixed(2)}% political influence.`,
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
      const currentFav = character.favorability;
      // Base +3 with diminishing returns above 70% and a floor of 1 (shared with
      // NPP processing), then charisma scales the result (gentle ±20%).
      const charismaMult = statMultiplier(statValue(character, "charisma"));
      const favGain = advertiseFavorabilityGain(currentFav, charismaMult);

      const tier = getAdvertiseActionCost(currentFav) - 5; // convert cost (5-9) to tier index (0-4)
      const baseCost = 100_000;
      const multiplier = state
        ? getFundMultiplier(tier, state.gdp, state.population, character.countryId)
        : 1 + tier * 0.2;
      const cost = Math.round((baseCost * multiplier) / 1_000) * 1_000;
      const fmt = ctx?.formatFunds ?? plainFunds;

      return {
        fundsChange: -cost,
        favorabilityChange: favGain,
        message: `Spent ${fmt(cost)} on ads and gained ${favGain} favorability points!`,
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
      const level = character.donorBaseLevel ?? 0;
      const rawCost = state
        ? getBuildDonorBaseFundCost(level, state.gdp, state.population, character.countryId)
        : getBuildDonorBaseFundCost(
            level,
            getGdpBaseline(character.countryId),
            1_000_000,
            character.countryId
          );
      // Fundraising stat makes donor-network expansion cheaper (gentle ±20%).
      const cost = Math.round(rawCost / statMultiplier(statValue(character, "fundraising")));
      const fmt = ctx?.formatFunds ?? plainFunds;

      return {
        fundsChange: -cost,
        donorBaseLevelChange: 1,
        message: `Spent ${fmt(cost)} to expand your donor network!`,
      };
    },
  },

  poll: {
    type: "poll",
    name: "Quick Poll",
    description:
      "Commission a quick poll — see your topline appeal and best/worst demographic groups ($25,000)",
    baseCost: 2,
    requiresState: false,
    effect: (character: Character, _state?: State, ctx?: ActionEffectContext) => {
      // Intellect lowers polling cost (gentle ±20%).
      const cost = Math.round(25_000 / statMultiplier(statValue(character, "intellect")));
      const fmt = ctx?.formatFunds ?? plainFunds;
      return {
        fundsChange: -cost,
        message: `Quick poll commissioned (${fmt(cost)}). Topline results available.`,
      };
    },
  },

  pollLarge: {
    type: "pollLarge",
    name: "Full Demographic Poll",
    description:
      "Commission a comprehensive poll — full breakdown across every demographic group and category ($75,000)",
    baseCost: 6,
    requiresState: false,
    effect: (character: Character, _state?: State, ctx?: ActionEffectContext) => {
      // Intellect lowers polling cost (gentle ±20%).
      const cost = Math.round(75_000 / statMultiplier(statValue(character, "intellect")));
      const fmt = ctx?.formatFunds ?? plainFunds;
      return {
        fundsChange: -cost,
        message: `Full demographic poll commissioned (${fmt(cost)}). Detailed breakdown available.`,
      };
    },
  },

  convertCash: {
    type: "convertCash",
    name: "Personal Campaign Donation",
    description:
      "Convert personal cash on hand into campaign funds at a 50% rate (infamy scales with amount)",
    baseCost: 2,
    requiresState: false,
    effect: (character: Character) => {
      // Default effect uses all cash; execute route overrides with convertAmount.
      // Post-Phase-8: prefer the per-currency personal balance in the home
      // currency; fall back to the legacy cashOnHand for un-migrated fixtures.
      const homeCode = getHomeCurrency(character);
      const cash = character.currencyBalances?.personal?.[homeCode] ?? character.cashOnHand ?? 0;
      const converted = Math.floor(cash * 0.5);
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
    baseCost: 0,
    requiresState: false,
    effect: () => {
      return {
        message: "You took a well-deserved break.",
      };
    },
  },

  debatePrep: {
    type: "debatePrep",
    name: "Debate Prep",
    description:
      "Study briefing books and rehearse. 10% chance to raise your Debate skill by 1. No fund cost.",
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

  if (actionType === "campaign" && (character.politicalInfluence ?? 0) >= 100) {
    return {
      canPerform: false,
      reason: "Your political influence is already at maximum (100%).",
    };
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

  // Fundraising requires an established donor base
  if (actionType === "fundraise" && (character.donorBaseLevel ?? 0) === 0) {
    return {
      canPerform: false,
      reason:
        "You have no donor base. Use 'Build Donor Network' first to establish one before fundraising.",
    };
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
  const effect = action.effect(character, state);
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
