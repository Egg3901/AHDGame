/**
 * NPP Action AI
 * Determines which actions NPPs should take based on office status and personality.
 *
 * Technocrat NPPs (e.g. autonomous central-bank chairs) are excluded from the
 * action-processing loop at the query layer via isTechnocrat: { $ne: true } in
 * `processNppActions` — this module only decides actions for political NPPs and
 * must never be fed technocrat docs.
 */

import type { NPPPersonality } from "@/lib/db/types/npp";
import type { CareerArchetypeModifiers } from "@/lib/nppAutonomy/v3/careerArchetype";
import type { NppContextSignals } from "@/lib/npp/actionSignals";
import { advertiseFavorabilityGain, getCampaignActionCost } from "@/lib/actions";

export interface NppActionContext {
  hasOffice: boolean;
  personality: NPPPersonality;
  funds: number;
  actionPoints: number;
  donorBaseLevel: number;
  /** Current favorability 0–100. Only read on the v3+ signal path. */
  favorability?: number;
  /**
   * Current political influence 0–100. Read on the v3+ signal path AND
   * (unconditionally, all autonomy levels) to price the Campaign action's
   * escalating 1-5 AP/fund tier — see `getNppCampaignApCost`. Missing/undefined
   * is treated as 0 (cheapest tier), matching a freshly-created NPP.
   */
  politicalInfluence?: number;
}

export interface ActionPriorities {
  buildDonorBase: number;
  campaign: number;
  advertise: number;
  partyDonation: number;
}

export const NPP_ACTION_COSTS = {
  buildDonorBase: [5, 10, 15, 20, 25],
  advertise: 2,
  partyDonation: 1,
} as const;

/**
 * Base fund cost for one Campaign action at the cheapest (tier 1, influence
 * < 20) tier — was a flat $5,000 regardless of influence. Campaign's AP cost
 * now escalates through the SAME 1-5 tier ladder the player faces via
 * {@link getCampaignActionCost} (see `getNppCampaignApCost` /
 * `getNppCampaignFundCost` below): a flat cost against `campaignInfluenceGain`'s
 * diminishing return would still let NPPs grind out marginal influence
 * forever, just more slowly — the cost side needs to close off the ratchet
 * too, not just the gain side.
 */
export const NPP_CAMPAIGN_FUND_COST_BASE = 5_000;

export const NPP_FUND_COSTS = {
  buildDonorBase: [10_000, 25_000, 50_000, 75_000, 100_000],
  advertise: 3_000,
  partyDonation: 5_000,
} as const;

/** AP cost for the Campaign action — same 1-5 tier ladder as the player's
 *  `getCampaignActionCost`, keyed off the NPP's current political influence. */
export function getNppCampaignApCost(politicalInfluence: number): number {
  return getCampaignActionCost(politicalInfluence);
}

/** Fund cost for the Campaign action — same tier ladder, NPP-scale base rate. */
export function getNppCampaignFundCost(politicalInfluence: number): number {
  return NPP_CAMPAIGN_FUND_COST_BASE * getCampaignActionCost(politicalInfluence);
}

// Hard cap on NPP donor-base level. Player donor bases scale to 75; NPP economy
// is capped lower so NPPs don't outpace player fund-gen. Single source of truth
// shared between the action AI and any UI that displays the cap.
export const NPP_MAX_DONOR_BASE_LEVEL = 10;
const NPP_AP_PER_TURN = 2;
// Save heuristic window, in turns of AP regen. Sized to the WORST-case buildDonorBase
// gap, not an average one: NPP_ACTION_COSTS.buildDonorBase[4] = 25 AP is the permanent
// plateau cost from donor-base level 4 onward (see getActionPointCost's Math.min(level,
// 4) clamp), and live-world sampling found level-4+ NPPs sitting at 2-3 AP when this
// heuristic is evaluated (they spend most of their AP on cheaper actions every cycle —
// see NPP_ACTIONS_PER_CYCLE's comment in nppActionProcessing.ts). A worst-case deficit of
// 25 AP from 0 needs ceil(25/2) = 13 turns; the old value of 4 (8 AP of headroom) could
// never bridge that, so 0 of 1,764 level-4 NPPs in a 654-turn world ever held >= 25 AP —
// the candidate was structurally unreachable, not merely unlikely. 13 covers the exact
// worst case with no slack to spare, so it does not turn "save" into a default behavior
// for the cheaper, already-reachable lower levels.
const SAVE_MAX_TURNS = 13;
// Probability per tick of choosing to save instead of acting when the save heuristic applies.
// Keeps saving as occasional flavor rather than a lock-in that starves every other action.
const SAVE_PROBABILITY = 0.33;

// ── Funds-poor fallback ──────────────────────────────────────────────────────
// Symmetric counterpart to the AP-side "save" heuristic above. That heuristic covers an
// NPP that is funds-rich but AP-poor (wait for AP to regen). Nothing previously covered
// the opposite: an NPP that is AP-rich but funds-poor — and unlike AP, waiting alone
// doesn't reliably fix it, because fund generation is population/economy-scaled and can
// sit below every action's fund cost indefinitely in a small state or weak currency (see
// the currency-conversion fix in nppActionProcessing.ts for the latter). Without a path
// out, such an NPP banks action points to the 100 cap and takes NO action of any kind,
// forever — confirmed against a 654-turn world: whole small-population/weak-currency
// cohorts sat at 96-99 AP against funds worth less than the cheapest action.
//
// `fundraise` converts the NPP's own spare AP into a small amount of funds — a real,
// costed action (not free money) that only ever fires as a last resort, when NOTHING
// else is affordable. The gain is deliberately smaller than every real action's fund
// cost, so it takes several fundraise ticks to unlock anything else — scarcity persists,
// it just stops being a dead end.
export const FUNDRAISE_AP_COST = 4;
export const FUNDRAISE_FUNDS_ANCHOR_GAIN = 750;

// ── v3+ context-signal tuning ────────────────────────────────────────────────

/** Influence at/above which campaigning is treated as worthless (the gain is hard-capped at 100). */
const INFLUENCE_SATURATION = 99;
/** Favorability at/above which advertising is treated as worthless. */
const FAVORABILITY_SATURATION = 99;
/**
 * How far out an election starts pulling behaviour toward campaigning. 96 turns
 * ≈ four days of game clock — long enough to read as a campaign season.
 */
const ELECTION_HORIZON_TURNS = 96;
/** Peak extra weight on campaign/advertise at the moment an election opens. */
const ELECTION_RAMP_MAX = 1.0;
/** Party-treasury ratio below/above which donation appetite shifts. */
const PARTY_TREASURY_LEAN = 0.6;
const PARTY_TREASURY_FLUSH = 1.6;

/**
 * Decisiveness of the final action draw. Below 1 sharpens toward the top-weighted
 * action; above 1 flattens toward a coin flip. Stubborn NPPs are single-minded;
 * flexible ones are erratic — the same axis that already separates ideologues
 * from reformers, now visible turn to turn instead of only in aggregate.
 */
const TEMPERATURE_MIN = 0.5;
const TEMPERATURE_MAX = 2.0;
/** Weight bonus for repeating the previous action within a cycle (see `lastAction`). */
const COMMITMENT_BONUS = 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Selection temperature for an NPP. Stubbornness drives the archetype component
 * (stubborn ⇒ decisive ⇒ low temperature); `temperatureMult` carries the
 * per-NPP idiosyncrasy offset so two equally stubborn politicians still differ.
 */
export function actionTemperature(personality: NPPPersonality, temperatureMult = 1): number {
  const stubbornness = clamp(personality.stubbornness, 0, 100) / 100;
  // 1.35 at stubbornness 0 → 0.65 at stubbornness 100.
  const base = 1.35 - 0.7 * stubbornness;
  return clamp(base * temperatureMult, TEMPERATURE_MIN, TEMPERATURE_MAX);
}

/**
 * Marginal-utility and situational scaling applied on the v3+ path only.
 *
 * The single biggest source of "NPPs look stupid" was that nothing ever told
 * them an action had stopped working. Influence is hard-capped at 100 by the
 * caller, and advertising's gain decays above 70 favorability and is clamped at
 * 100 — so a maxed-out NPP would keep paying full price for literally nothing,
 * every cycle, forever. These multipliers make a saturated action score zero,
 * and the existing `priority <= 0` guard then drops it from the candidate set
 * entirely.
 */
function applySignalScaling(
  priorities: ActionPriorities,
  context: NppActionContext,
  signals: NppContextSignals
): void {
  const favorability = clamp(context.favorability ?? 0, 0, 100);
  const influence = clamp(context.politicalInfluence ?? 0, 0, 100);

  // Saturation damping.
  priorities.campaign *=
    influence >= INFLUENCE_SATURATION ? 0 : clamp((100 - influence) / 30, 0.1, 1);
  // advertiseFavorabilityGain floors at 1 and so never self-zeroes; the explicit
  // saturation cutoff is what actually stops the waste.
  priorities.advertise *=
    favorability >= FAVORABILITY_SATURATION
      ? 0
      : clamp(advertiseFavorabilityGain(favorability) / 3, 0.15, 1);
  // Diminishing appetite for donor-base levels already banked.
  priorities.buildDonorBase *=
    0.5 +
    0.5 *
      (1 - clamp(context.donorBaseLevel, 0, NPP_MAX_DONOR_BASE_LEVEL) / NPP_MAX_DONOR_BASE_LEVEL);

  // Election proximity: spend near the race, build war chest away from it.
  if (signals.turnsToElection != null) {
    const ramp =
      1 + ELECTION_RAMP_MAX * clamp(1 - signals.turnsToElection / ELECTION_HORIZON_TURNS, 0, 1);
    priorities.campaign *= ramp;
    priorities.advertise *= ramp;
    priorities.buildDonorBase /= Math.sqrt(ramp);
    priorities.partyDonation /= ramp;
  }

  // Contest pressure.
  if (signals.facesChallenger) {
    priorities.campaign *= 1.35;
    priorities.advertise *= 1.35;
  } else if (signals.isCandidate) {
    // Running unopposed — no reason to burn the war chest.
    priorities.campaign *= 0.8;
    priorities.advertise *= 0.8;
  } else if (!context.hasOffice) {
    priorities.buildDonorBase *= 1.2;
  }

  // Government status.
  if (context.hasOffice) {
    if (signals.inGovernment) {
      priorities.partyDonation *= 1.2;
      priorities.advertise *= 1.1;
    } else {
      priorities.campaign *= 1.15;
    }
  }

  // Party finances: give more when the party is poor relative to its rivals.
  if (signals.partyTreasuryRatio != null) {
    if (signals.partyTreasuryRatio < PARTY_TREASURY_LEAN) priorities.partyDonation *= 1.6;
    else if (signals.partyTreasuryRatio > PARTY_TREASURY_FLUSH) priorities.partyDonation *= 0.4;
  }
}

/**
 * Compute action priorities. When `modifiers` are supplied (the v3 full-agency
 * path), the career archetype scales the relevant priorities: campaign/advertise
 * by campaignAggressionMult and buildDonorBase by fundraiseAppetiteMult. When
 * `signals` are also supplied, world state (election proximity, contest status,
 * government status, party finances) and marginal-utility damping are layered on
 * top.
 *
 * Without modifiers AND without signals (v0–v2) behavior is byte-identical to the
 * pre-v3 logic — that compatibility contract is load-bearing and covered by test.
 */
export function calculateActionPriorities(
  context: NppActionContext,
  modifiers?: CareerArchetypeModifiers,
  signals?: NppContextSignals
): ActionPriorities {
  const { hasOffice, personality } = context;

  const priorities: ActionPriorities = hasOffice
    ? { campaign: 40, advertise: 30, buildDonorBase: 20, partyDonation: 10 }
    : { buildDonorBase: 50, campaign: 25, advertise: 15, partyDonation: 10 };

  if (personality.loyalty > 70) priorities.partyDonation += 20;
  if (personality.loyalty < 30) priorities.partyDonation -= 15;
  if (personality.ambition > 70) {
    priorities.buildDonorBase += 10;
    priorities.campaign += 10;
  }

  // v3: archetype scaling. partyDonation stays loyalty-driven (untouched).
  if (modifiers) {
    priorities.campaign = Math.round(priorities.campaign * modifiers.campaignAggressionMult);
    priorities.advertise = Math.round(priorities.advertise * modifiers.campaignAggressionMult);
    priorities.buildDonorBase = Math.round(
      priorities.buildDonorBase * modifiers.fundraiseAppetiteMult
    );
  }

  // v3+ context signals. Applied after archetype scaling so the archetype still
  // sets the NPP's disposition and the world only modulates it.
  if (signals) {
    applySignalScaling(priorities, context, signals);
    for (const key of Object.keys(priorities) as (keyof ActionPriorities)[]) {
      priorities[key] = Math.round(priorities[key]);
    }
    // Safety floor: an unlucky combination of dampers could zero every option and
    // leave the NPP permanently inert. Donating to their party is always coherent.
    const anyPositive = (Object.keys(priorities) as (keyof ActionPriorities)[]).some(
      (k) => priorities[k] > 0
    );
    if (!anyPositive) priorities.partyDonation = 1;
  }

  for (const key of Object.keys(priorities) as (keyof ActionPriorities)[]) {
    priorities[key] = Math.max(0, priorities[key]);
  }

  return priorities;
}

export type NppActionType =
  "buildDonorBase" | "campaign" | "advertise" | "partyDonation" | "fundraise" | "none";

export interface NppActionDecision {
  action: NppActionType;
  reason: string;
}

interface ActionCandidate {
  action: keyof ActionPriorities;
  priority: number;
  apCost: number;
  fundCost: number;
}

/** v3+ extras for the decision. Omitted entirely on the v0–v2 path. */
export interface NppDecisionOptions {
  signals?: NppContextSignals;
  /**
   * The action this NPP took immediately before, within the same processing
   * cycle. Gets a weight bonus, so an NPP tends to follow through on what they
   * started rather than re-rolling from scratch four times a cycle. Costs
   * nothing to track and is what turns statistical noise into a visible burst of
   * activity ("they went all-in on advertising this week").
   */
  lastAction?: keyof ActionPriorities;
  /** Per-NPP temperature offset from `nppIdiosyncrasy`. */
  temperatureMult?: number;
}

/**
 * Decide the next NPP action. `rng` is an injectable [0,1) source so the turn
 * loop can supply a deterministic seeded RNG (replay-safe; see
 * `lib/events/substrate/rng.ts`). Defaults to Math.random for back-compat —
 * read at call time, so test spies on Math.random still apply.
 *
 * RNG DISCIPLINE: this function consumes at most two `rng()` calls (the save
 * heuristic, then the draw), and the v3+ additions below deliberately consume
 * ZERO extra — temperature and commitment reshape the weights rather than adding
 * draws. That keeps the RNG stream aligned call-for-call with the pre-v3 path,
 * so enabling the smarter brain cannot desynchronise a replay.
 */
export function decideNppAction(
  context: NppActionContext,
  rng: () => number = Math.random,
  modifiers?: CareerArchetypeModifiers,
  options?: NppDecisionOptions
): NppActionDecision {
  const priorities = calculateActionPriorities(context, modifiers, options?.signals);
  const { funds, actionPoints, donorBaseLevel, politicalInfluence } = context;
  const buildAtCap = donorBaseLevel >= NPP_MAX_DONOR_BASE_LEVEL;

  const affordable: ActionCandidate[] = [];
  let buildCandidate: ActionCandidate | null = null;

  for (const action of Object.keys(priorities) as Array<keyof ActionPriorities>) {
    const priority = priorities[action];
    if (priority <= 0) continue;
    if (action === "buildDonorBase" && buildAtCap) continue;

    const apCost = getActionPointCost(action, donorBaseLevel, politicalInfluence ?? 0);
    const fundCost = getFundCost(action, donorBaseLevel, politicalInfluence ?? 0);
    const candidate: ActionCandidate = { action, priority, apCost, fundCost };

    if (action === "buildDonorBase") buildCandidate = candidate;
    if (actionPoints >= apCost && funds >= fundCost) affordable.push(candidate);
  }

  // Save heuristic: occasionally skip a cheap action to accumulate AP for the next buildDonorBase.
  // Conditions: build is a meaningful priority, AP is the actual blocker (funds shortages
  // don't resolve by waiting — fund-gen runs every turn regardless), the wait is short,
  // and we lose the coin flip. The combination prevents the lock-in that previously kept
  // NPPs from ever doing partyDonation/advertise.
  if (
    buildCandidate &&
    buildCandidate.priority > 30 &&
    actionPoints < buildCandidate.apCost &&
    funds >= buildCandidate.fundCost &&
    Math.ceil((buildCandidate.apCost - actionPoints) / NPP_AP_PER_TURN) <= SAVE_MAX_TURNS &&
    rng() < SAVE_PROBABILITY
  ) {
    return { action: "none", reason: `Saving for buildDonorBase L${donorBaseLevel + 1}` };
  }

  if (affordable.length === 0) {
    // Funds-poor fallback (see the constants above for the full rationale): every real
    // action was priced out, but there's spare AP to convert into a little cash instead of
    // idling. Gated on AP alone — waiting doesn't help an AP-rich NPP the way it helps a
    // funds-rich/AP-poor one above, so there's no equivalent "is the wait short enough"
    // check here, just "can it afford this one cheap step."
    if (actionPoints >= FUNDRAISE_AP_COST) {
      return { action: "fundraise", reason: "Cash-poor fallback: grassroots fundraising" };
    }
    return { action: "none", reason: "No affordable action" };
  }

  // Weighted random pick across affordable actions so NPPs diversify across their priority
  // list rather than monotonically firing only the top-priority action every tick.
  //
  // On the v3+ path the weights are first reshaped by temperature and by
  // commitment to the previous action. Both are pure transforms of the weight
  // vector — no extra rng() call — so the draw below is unchanged in structure
  // and identical in RNG consumption to the pre-v3 version.
  let weights = affordable.map((c) => c.priority);
  if (options?.signals) {
    const temperature = actionTemperature(context.personality, options.temperatureMult);
    weights = affordable.map((candidate) => {
      const committed =
        options.lastAction === candidate.action
          ? candidate.priority * COMMITMENT_BONUS
          : candidate.priority;
      return Math.pow(committed, 1 / temperature);
    });
  }

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  let roll = rng() * totalWeight;
  for (let i = 0; i < affordable.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      return {
        action: affordable[i].action,
        reason: `Weighted pick (priority ${affordable[i].priority})`,
      };
    }
  }
  const last = affordable[affordable.length - 1];
  return { action: last.action, reason: `Weighted pick (priority ${last.priority})` };
}

function getActionPointCost(
  action: keyof ActionPriorities,
  donorBaseLevel: number,
  politicalInfluence: number
): number {
  if (action === "campaign") return getNppCampaignApCost(politicalInfluence);
  if (action === "buildDonorBase") {
    return NPP_ACTION_COSTS.buildDonorBase[Math.min(donorBaseLevel, 4)];
  }
  return NPP_ACTION_COSTS[action];
}

function getFundCost(
  action: keyof ActionPriorities,
  donorBaseLevel: number,
  politicalInfluence: number
): number {
  if (action === "campaign") return getNppCampaignFundCost(politicalInfluence);
  if (action === "buildDonorBase") {
    return NPP_FUND_COSTS.buildDonorBase[Math.min(donorBaseLevel, 4)];
  }
  return NPP_FUND_COSTS[action];
}
