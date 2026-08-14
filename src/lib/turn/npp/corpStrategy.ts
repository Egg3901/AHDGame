/**
 * NPP corporation strategy loop (v5).
 *
 * WHAT WAS WRONG. The brain was a stateless reflex controller: every turn it
 * re-derived the same fixed if/else ladders from scratch, with a static CEO
 * archetype multiplier as the only variation. It never recorded what it tried
 * and never measured whether anything worked, so it could not course-correct.
 * A corp in a structurally hopeless position kept applying the same levers
 * forever, which is why prod corps sat losing money for twenty turns with
 * healthy factories.
 *
 * WHAT THIS ADDS. A closed loop with four parts:
 *
 *   1. MEMORY      `corp.nppStrategy`: which strategy, when adopted, the score
 *                  at adoption, and the best score each strategy has ever
 *                  realized for this corp.
 *   2. A SCORE     `corpMargin`, net income over revenue. Already computed by
 *                  the brain, already currency-normalized, scale-free, and (as
 *                  of the debt-service change) inclusive of the cost that was
 *                  actually killing corps. One number, comparable across
 *                  countries and eras, unlike every money constant in the
 *                  module.
 *   3. A MENU      Five bundles of levers that ALREADY EXIST. No new mechanics:
 *                  a strategy only re-weights growth targets, budgets,
 *                  dividends, divestment tolerance and whether expansion and
 *                  growth capex are permitted.
 *   4. SWITCHING   Lag-aware, hysteretic, deterministic.
 *
 * WHY `expand` IS THE DEFAULT AND WHY THAT MATTERS. `expand` reproduces the
 * pre-v5 lever settings exactly (every multiplier 1, everything permitted). A
 * corp that is doing fine never leaves it and therefore never changes
 * behaviour. Only a corp whose score fails to improve over a full evaluation
 * window moves, which bounds the blast radius of shipping this into a live
 * world to precisely the corps that are already failing.
 *
 * THE LAG IS THE HARD PART. `CAPACITY_BUILD_TURNS` is 48 for most sector
 * types, so a plant ordered under `expand` does not exist for 48 turns. Any
 * evaluation window shorter than the build lag judges `expand` a failure
 * before its capacity lands, switches away, and oscillates forever. Hence
 * {@link CAPACITY_STRATEGY_TENURE}: capacity-bearing strategies get a full
 * build cycle before they may be judged at all.
 */

import { CAPACITY_BUILD_TURNS_DEFAULT } from "@/lib/constants/capacityEconomy";

export type NppCorpStrategy = "expand" | "harvest" | "defend" | "retrench" | "pivot";

export const NPP_CORP_STRATEGIES: readonly NppCorpStrategy[] = [
  "expand",
  "harvest",
  "defend",
  "retrench",
  "pivot",
] as const;

/**
 * Strategies that commit capacity, and therefore cannot be judged until the
 * capacity they bought has had time to land.
 */
const CAPACITY_BEARING: ReadonlySet<NppCorpStrategy> = new Set(["expand", "pivot"]);

/**
 * Turns a capacity-bearing strategy runs before it may be judged. One full
 * build cycle: ordering a plant and then abandoning the strategy before it is
 * delivered is strictly worse than never ordering it, because the cash is gone
 * and the capacity never arrives.
 */
export const CAPACITY_STRATEGY_TENURE = CAPACITY_BUILD_TURNS_DEFAULT;

/**
 * Turns a non-capacity strategy runs before it may be judged. Budget, dividend
 * and divestment changes show up in the very next turn's income, so these need
 * only enough turns to see past single-turn noise.
 */
export const STRATEGY_MIN_TENURE = 8;

/**
 * Margin points of improvement over the adoption baseline required for a
 * strategy to count as working. Deliberately small but non-zero: demanding
 * exact improvement would churn on rounding, and demanding a lot would keep a
 * corp in a strategy that is barely holding.
 */
export const STRATEGY_IMPROVEMENT_EPSILON = 0.5;

/** Persisted per-corp strategy memory. */
export interface NppStrategyState {
  id: NppCorpStrategy;
  /** Turn the strategy was adopted, for the tenure gate. */
  adoptedTurn: number;
  /** `corpMargin` at adoption. The bar the strategy has to beat. */
  baselineScore: number;
  /** Most recent `corpMargin` observed under this strategy. */
  lastScore?: number;
  /**
   * Best score each strategy has ever realized FOR THIS CORP. This is the
   * memory that makes the loop more than a round-robin: a corp that has already
   * discovered `harvest` works in its market returns to it rather than
   * rediscovering it, and a strategy that failed here is not retried while a
   * better-scoring one is untried.
   */
  scores?: Partial<Record<NppCorpStrategy, number>>;
}

/**
 * Multipliers a strategy applies on top of the CEO archetype's. These compose:
 * archetype is who the CEO is, strategy is what the situation demands.
 */
export interface StrategyLevers {
  /** Added to the per-sector growth-target adjustment in section 2. */
  growthDelta: number;
  /** May found a new sector this turn (section 5). */
  allowExpansion: boolean;
  /** May buy NEW capacity, as opposed to replacing what wore out (section 6). */
  allowGrowthCapex: boolean;
  /** Scales the dividend rate (section 4). */
  dividendMult: number;
  /** Scales the marketing budget (section 3). */
  marketingMult: number;
  /** Scales the R&D budget (section 3). */
  rdMult: number;
  /**
   * Raises the margin at which a losing sector is shed (section 1). Positive
   * means quicker to divest.
   */
  divestMarginFloorDelta: number;
}

/**
 * `expand` is the identity: every multiplier 1, everything permitted, no
 * divestment tilt. It is byte-identical to the pre-v5 brain, which is what lets
 * this ship into a live world without touching corps that are doing fine.
 */
const LEVERS: Record<NppCorpStrategy, StrategyLevers> = {
  expand: {
    growthDelta: 0,
    allowExpansion: true,
    allowGrowthCapex: true,
    dividendMult: 1,
    marketingMult: 1,
    rdMult: 1,
    divestMarginFloorDelta: 0,
  },
  // Stop reinvesting, take the cash out. For a corp in a market with no room
  // left: capacity it adds cannot be sold, so the return on holding it is worse
  // than the return on paying it out.
  harvest: {
    growthDelta: -2,
    allowExpansion: false,
    allowGrowthCapex: false,
    dividendMult: 1.5,
    marketingMult: 0.5,
    rdMult: 0.25,
    divestMarginFloorDelta: 0,
  },
  // Hold the position, protect share. Marketing is the only lever that defends
  // an incumbent's revenue without adding units to a market that cannot take
  // them, which is why it is the one thing that goes UP here.
  defend: {
    growthDelta: 0,
    allowExpansion: false,
    allowGrowthCapex: false,
    dividendMult: 1,
    marketingMult: 1.4,
    rdMult: 1,
    divestMarginFloorDelta: 0,
  },
  // Losing money. Stop all discretionary spend, shed the worst sectors, rebuild
  // cash. No dividend: paying out while insolvent is how a corp dies with a
  // healthy-looking payout history.
  retrench: {
    growthDelta: -3,
    allowExpansion: false,
    allowGrowthCapex: false,
    dividendMult: 0,
    marketingMult: 0.2,
    rdMult: 0,
    divestMarginFloorDelta: 10,
  },
  // The core market is structurally gone. Shed it and enter elsewhere. This is
  // the only strategy that both divests aggressively AND expands, because that
  // combination is the whole point of a pivot.
  pivot: {
    growthDelta: -1,
    allowExpansion: true,
    allowGrowthCapex: true,
    dividendMult: 0,
    marketingMult: 0.6,
    rdMult: 0.5,
    divestMarginFloorDelta: 5,
  },
};

export function strategyLevers(id: NppCorpStrategy): StrategyLevers {
  return LEVERS[id] ?? LEVERS.expand;
}

/**
 * Strategies a CARETAKER may use. A caretaker NPP is minding a corporation a
 * PLAYER owns while they are away. It must preserve value, not place bets: no
 * pivots (irreversible, and it would sell the business the player built), no
 * expansion (spends the player's cash on a position they did not choose).
 * `retrench` is permitted because letting a player's corp bleed to death is not
 * "preserving" anything, but its divestment tilt is the one thing a caretaker
 * applies with the owner's sectors, so it is deliberately last-resort.
 */
export const CARETAKER_STRATEGIES: ReadonlySet<NppCorpStrategy> = new Set([
  "expand",
  "harvest",
  "defend",
  "retrench",
]);

export interface StrategySituation {
  /** `corpMargin`, net of overhead AND debt service. */
  score: number;
  /** True when debt service alone exceeds gross operating income. */
  debtDominant: boolean;
  /** True when the corp's sectors mostly cannot sell what they already make. */
  chronicLowFill: boolean;
  /** True when there is unowned headroom the corp could actually enter. */
  hasHeadroom: boolean;
  /** True when an NPP is running a corp owned by a player. */
  isCaretaker: boolean;
}

/**
 * Situational prior, used when the corp has no recorded score for a strategy.
 * Deterministic and explicable: every branch below is a statement about what
 * the corp's own numbers say, not a dice roll.
 */
export function situationalStrategy(s: StrategySituation): NppCorpStrategy {
  // Debt service eating the business is not fixed by operating levers. Cut
  // everything discretionary and rebuild cash so the corp can service or retire
  // the debt. This is prod corp 446's exact position.
  if (s.debtDominant) return "retrench";
  if (s.score < 0) return "retrench";
  // Cannot sell what it already makes: adding capacity is the one thing
  // guaranteed not to help. Move if allowed to, otherwise stop reinvesting.
  if (s.chronicLowFill) return s.isCaretaker ? "harvest" : "pivot";
  // Healthy and there is room: grow.
  if (s.score >= 15 && s.hasHeadroom) return "expand";
  // Healthy but boxed in: protect what it has rather than buy units nobody
  // wants.
  if (s.score >= 15) return "defend";
  // Thin but positive: stop bleeding it on discretionary spend.
  return "harvest";
}

/** Whether enough turns have passed for this strategy to be fairly judged. */
export function tenureSatisfied(state: NppStrategyState, turn: number): boolean {
  const required = CAPACITY_BEARING.has(state.id) ? CAPACITY_STRATEGY_TENURE : STRATEGY_MIN_TENURE;
  return turn - state.adoptedTurn >= required;
}

export interface StrategyDecision {
  state: NppStrategyState;
  changed: boolean;
}

/**
 * Advance the loop one turn.
 *
 * `eligible` is the caller's cohort stagger (the same 1-in-8 slot the glut
 * mothball pass uses). Young worlds are wall-to-wall single-sector NPP corps,
 * so an unstaggered switch is a cohort-wide behaviour cliff followed by a
 * cohort-wide swing back. Staggering also means a market re-prices between
 * waves, so later corps decide against fresh information.
 */
export function advanceStrategy(args: {
  prior: NppStrategyState | undefined;
  turn: number;
  situation: StrategySituation;
  /** True on this corp's stagger slot. Switching is refused otherwise. */
  eligible: boolean;
}): StrategyDecision {
  const { prior, turn, situation, eligible } = args;
  const allowed = situation.isCaretaker ? CARETAKER_STRATEGIES : new Set(NPP_CORP_STRATEGIES);

  // First sight of this corp: adopt, record the baseline, change nothing else.
  // Deliberately `expand` rather than the situational pick, so introducing the
  // loop is behaviour-neutral on turn one and every corp gets one honest
  // evaluation window before anything moves.
  if (!prior || !allowed.has(prior.id)) {
    const id: NppCorpStrategy = prior && !allowed.has(prior.id) ? "harvest" : "expand";
    return {
      state: { id, adoptedTurn: turn, baselineScore: situation.score, scores: prior?.scores },
      changed: !!prior,
    };
  }

  // Always record what this strategy is achieving, even on turns it cannot be
  // judged. `scores` keeps the BEST result each strategy ever produced here, so
  // one bad turn does not condemn a strategy that works.
  const scores = { ...(prior.scores ?? {}) };
  const best = scores[prior.id];
  if (best === undefined || situation.score > best) scores[prior.id] = situation.score;
  const held: NppStrategyState = { ...prior, lastScore: situation.score, scores };

  if (!eligible || !tenureSatisfied(prior, turn)) return { state: held, changed: false };

  // It is working: still clear of the bar it was adopted against. Defer the
  // next evaluation, but DO NOT raise the bar.
  //
  // An earlier version re-baselined to the current score here, and that quietly
  // abandons every good strategy. Ratcheting the bar by
  // STRATEGY_IMPROVEMENT_EPSILON every tenure window demands perpetual
  // improvement at a fixed rate, which nothing real sustains: a strategy that
  // takes a corp from -1 to a stable +12 gets judged a failure eight turns
  // later for merely holding +12. The convergence test in this module's spec
  // caught it as a corp that found the right answer and then wandered off.
  //
  // The loop's job is to escape strategies that are NOT working, not to
  // micro-optimize ones that are. A strategy that keeps clearing its adoption
  // baseline keeps its place; one that decays back to it gets re-evaluated.
  if (situation.score >= prior.baselineScore + STRATEGY_IMPROVEMENT_EPSILON) {
    return { state: { ...held, adoptedTurn: turn }, changed: false };
  }

  // It is not working. Pick the next one, never the incumbent.
  //
  // The ordering below is the whole explore/exploit balance, and both extremes
  // were wrong when tried:
  //
  //   Exploit-first (prefer the best already-tried strategy) LIVELOCKS. A corp
  //   scoring below zero always reads "retrench" from the situational prior, so
  //   once retrench itself stops working the only candidate left is whatever it
  //   ran before, and the corp ping-pongs between two strategies forever
  //   without ever evaluating the other three.
  //
  //   Explore-first (always prefer an untried strategy) THROWS AWAY WHAT WORKS.
  //   A corp that already discovered harvest scores 40 here abandons it to try
  //   expand, which is the opposite of learning.
  //
  // So: the situational prior wins when it is untried, because the situation is
  // live information about the corp's position NOW and a recorded score is not.
  // Failing that, exploit a tried strategy that is clearly better than what the
  // corp is currently achieving. Failing that, explore. Every branch is
  // deterministic; there is no randomness anywhere in this module.
  const candidates = NPP_CORP_STRATEGIES.filter((k) => allowed.has(k) && k !== prior.id);
  const untried = candidates.filter((k) => scores[k] === undefined);
  const situational = situationalStrategy(situation);
  const bestTried = candidates
    .filter((k) => scores[k] !== undefined)
    .reduce<NppCorpStrategy | null>(
      (a, b) => (a === null || (scores[b] ?? -Infinity) > (scores[a] ?? -Infinity) ? b : a),
      null
    );

  let next: NppCorpStrategy;
  if (untried.includes(situational)) {
    next = situational;
  } else if (
    bestTried !== null &&
    (scores[bestTried] ?? -Infinity) > situation.score + STRATEGY_IMPROVEMENT_EPSILON
  ) {
    next = bestTried;
  } else if (untried.length > 0) {
    next = untried[0];
  } else {
    next = bestTried ?? candidates[0] ?? prior.id;
  }

  return {
    state: { id: next, adoptedTurn: turn, baselineScore: situation.score, scores },
    changed: true,
  };
}
