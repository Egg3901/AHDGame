import { describe, it, expect } from "vitest";
import {
  advanceStrategy,
  strategyLevers,
  situationalStrategy,
  tenureSatisfied,
  CARETAKER_STRATEGIES,
  CAPACITY_STRATEGY_TENURE,
  STRATEGY_MIN_TENURE,
  STRATEGY_IMPROVEMENT_EPSILON,
  NPP_CORP_STRATEGIES,
  type NppStrategyState,
  type StrategySituation,
} from "./corpStrategy";

const base: StrategySituation = {
  score: 20,
  debtDominant: false,
  chronicLowFill: false,
  hasHeadroom: true,
  isCaretaker: false,
};
const sit = (o: Partial<StrategySituation> = {}): StrategySituation => ({ ...base, ...o });

describe("strategy levers", () => {
  it("makes expand the exact identity", () => {
    // THE SHIP-SAFETY PROPERTY. expand must reproduce the pre-v5 levers
    // exactly, because every corp adopts it on first sight. If any of these
    // drift, introducing the loop silently changes behaviour for every healthy
    // corp in a live world.
    const l = strategyLevers("expand");
    expect(l).toEqual({
      growthDelta: 0,
      allowExpansion: true,
      allowGrowthCapex: true,
      dividendMult: 1,
      marketingMult: 1,
      rdMult: 1,
      divestMarginFloorDelta: 0,
    });
  });

  it("never lets a non-expand strategy buy growth capacity except pivot", () => {
    // Adding units is the one thing that cannot help a corp whose problem is
    // that it already cannot sell its output. Pivot is the exception because it
    // is entering a DIFFERENT market.
    for (const id of NPP_CORP_STRATEGIES) {
      if (id === "expand" || id === "pivot") continue;
      expect(strategyLevers(id).allowGrowthCapex, id).toBe(false);
      expect(strategyLevers(id).allowExpansion, id).toBe(false);
    }
  });

  it("refuses a dividend while retrenching", () => {
    // Paying out while insolvent is how a corp dies with a healthy-looking
    // payout history.
    expect(strategyLevers("retrench").dividendMult).toBe(0);
  });

  it("raises marketing only in defend", () => {
    // Marketing is the one lever that protects an incumbent's revenue without
    // adding units to a market that cannot absorb them.
    expect(strategyLevers("defend").marketingMult).toBeGreaterThan(1);
    for (const id of NPP_CORP_STRATEGIES) {
      if (id === "defend" || id === "expand") continue;
      expect(strategyLevers(id).marketingMult, id).toBeLessThan(1);
    }
  });
});

describe("situational prior", () => {
  it("retrenches when debt service is eating the business", () => {
    // Prod corp 446's exact position: healthy sectors, interest above operating
    // income. No operating lever fixes that.
    expect(situationalStrategy(sit({ debtDominant: true, score: 25 }))).toBe("retrench");
  });

  it("retrenches on a negative margin", () => {
    expect(situationalStrategy(sit({ score: -3 }))).toBe("retrench");
  });

  it("pivots when it cannot sell what it already makes", () => {
    expect(situationalStrategy(sit({ chronicLowFill: true }))).toBe("pivot");
  });

  it("harvests instead of pivoting when it is a caretaker", () => {
    // A caretaker must not sell the business a player built.
    expect(situationalStrategy(sit({ chronicLowFill: true, isCaretaker: true }))).toBe("harvest");
  });

  it("expands when healthy with somewhere to go, defends when boxed in", () => {
    expect(situationalStrategy(sit({ score: 25, hasHeadroom: true }))).toBe("expand");
    expect(situationalStrategy(sit({ score: 25, hasHeadroom: false }))).toBe("defend");
  });

  it("harvests a thin but positive margin", () => {
    expect(situationalStrategy(sit({ score: 5 }))).toBe("harvest");
  });
});

describe("tenure", () => {
  const st = (id: NppStrategyState["id"], adoptedTurn: number): NppStrategyState => ({
    id,
    adoptedTurn,
    baselineScore: 10,
  });

  it("gives a capacity-bearing strategy a full build cycle", () => {
    // THE OSCILLATION GUARD. A plant ordered under expand does not exist for
    // CAPACITY_BUILD_TURNS. Judging expand before then always reads failure,
    // switches away, and the corp flips forever without ever receiving the
    // capacity it paid for.
    expect(tenureSatisfied(st("expand", 100), 100 + CAPACITY_STRATEGY_TENURE - 1)).toBe(false);
    expect(tenureSatisfied(st("expand", 100), 100 + CAPACITY_STRATEGY_TENURE)).toBe(true);
    expect(tenureSatisfied(st("pivot", 100), 100 + CAPACITY_STRATEGY_TENURE - 1)).toBe(false);
  });

  it("judges a non-capacity strategy sooner", () => {
    // Budget and dividend changes land in next turn's income, so these only
    // need enough turns to see past noise.
    expect(tenureSatisfied(st("harvest", 100), 100 + STRATEGY_MIN_TENURE - 1)).toBe(false);
    expect(tenureSatisfied(st("harvest", 100), 100 + STRATEGY_MIN_TENURE)).toBe(true);
  });
});

describe("the loop", () => {
  it("adopts expand on first sight and changes nothing", () => {
    const d = advanceStrategy({ prior: undefined, turn: 10, situation: sit(), eligible: true });
    expect(d.state.id).toBe("expand");
    expect(d.state.adoptedTurn).toBe(10);
    expect(d.state.baselineScore).toBe(20);
    expect(d.changed).toBe(false);
  });

  it("refuses to switch off its stagger slot", () => {
    // Without staggering the whole cohort would switch on one turn, which is a
    // behaviour cliff followed by a cohort-wide swing back.
    const prior: NppStrategyState = { id: "harvest", adoptedTurn: 0, baselineScore: 50 };
    const d = advanceStrategy({ prior, turn: 100, situation: sit({ score: 1 }), eligible: false });
    expect(d.changed).toBe(false);
    expect(d.state.id).toBe("harvest");
  });

  it("holds a working strategy and defers its next evaluation", () => {
    const prior: NppStrategyState = { id: "harvest", adoptedTurn: 0, baselineScore: 10 };
    const d = advanceStrategy({
      prior,
      turn: 100,
      situation: sit({ score: 10 + STRATEGY_IMPROVEMENT_EPSILON }),
      eligible: true,
    });
    expect(d.changed).toBe(false);
    expect(d.state.id).toBe("harvest");
    // The evaluation clock resets...
    expect(d.state.adoptedTurn).toBe(100);
    // ...but the BAR DOES NOT MOVE. Ratcheting the baseline to the current
    // score demands perpetual improvement at a fixed rate, which nothing real
    // sustains: a strategy that takes a corp from -1 to a stable +12 would be
    // judged a failure one window later for merely holding +12. The loop exists
    // to escape strategies that are not working, not to micro-optimize ones
    // that are.
    expect(d.state.baselineScore).toBe(10);
  });

  it("re-evaluates a strategy that decays back to its adoption baseline", () => {
    // The other side of not ratcheting: holding the bar fixed must not mean
    // holding a strategy forever. One that slides back gets judged again.
    const prior: NppStrategyState = { id: "harvest", adoptedTurn: 0, baselineScore: 10 };
    const d = advanceStrategy({ prior, turn: 100, situation: sit({ score: 10 }), eligible: true });
    expect(d.changed).toBe(true);
    expect(d.state.id).not.toBe("harvest");
  });

  it("switches away from a strategy that is not improving", () => {
    const prior: NppStrategyState = { id: "harvest", adoptedTurn: 0, baselineScore: 10 };
    const d = advanceStrategy({
      prior,
      turn: 100,
      situation: sit({ score: 9, debtDominant: true }),
      eligible: true,
    });
    expect(d.changed).toBe(true);
    expect(d.state.id).toBe("retrench");
    expect(d.state.adoptedTurn).toBe(100);
  });

  it("remembers what worked here and returns to it", () => {
    // THE POINT OF THE MEMORY. Without it this is a round-robin that
    // rediscovers the same answer forever.
    const prior: NppStrategyState = {
      id: "defend",
      adoptedTurn: 0,
      baselineScore: 30,
      scores: { harvest: 40, retrench: 5 },
    };
    const d = advanceStrategy({
      prior,
      turn: 100,
      // Situational prior here is harvest (thin positive), which is also the
      // best recorded, so the two agree.
      situation: sit({ score: 4 }),
      eligible: true,
    });
    expect(d.changed).toBe(true);
    expect(d.state.id).toBe("harvest");
  });

  it("prefers an untried strategy with a live signal over a known-mediocre one", () => {
    // The exploration term, and it is deterministic rather than random.
    const prior: NppStrategyState = {
      id: "defend",
      adoptedTurn: 0,
      baselineScore: 30,
      scores: { defend: 30, harvest: 2 },
    };
    const d = advanceStrategy({
      prior,
      turn: 100,
      situation: sit({ score: 1, debtDominant: true }),
      eligible: true,
    });
    // retrench is untried AND is what the situation says. It wins over harvest.
    expect(d.state.id).toBe("retrench");
  });

  it("never re-picks the incumbent", () => {
    const prior: NppStrategyState = {
      id: "retrench",
      adoptedTurn: 0,
      baselineScore: 10,
      scores: { retrench: 99 },
    };
    const d = advanceStrategy({
      prior,
      turn: 100,
      situation: sit({ score: -5 }),
      eligible: true,
    });
    // Situational prior is retrench, which it is already running and which is
    // not working. It must go somewhere else rather than sit still.
    expect(d.changed).toBe(true);
    expect(d.state.id).not.toBe("retrench");
  });

  it("records the best score a strategy ever reached, not the latest", () => {
    const prior: NppStrategyState = {
      id: "defend",
      adoptedTurn: 99,
      baselineScore: 10,
      scores: { defend: 40 },
    };
    const d = advanceStrategy({ prior, turn: 100, situation: sit({ score: 3 }), eligible: true });
    expect(d.state.scores?.defend).toBe(40);
  });

  it("keeps a caretaker off the strategies that gamble with a player's company", () => {
    expect(CARETAKER_STRATEGIES.has("pivot")).toBe(false);
    const prior: NppStrategyState = { id: "expand", adoptedTurn: 0, baselineScore: 30 };
    const d = advanceStrategy({
      prior,
      turn: 1000,
      situation: sit({ score: 1, chronicLowFill: true, isCaretaker: true }),
      eligible: true,
    });
    expect(CARETAKER_STRATEGIES.has(d.state.id)).toBe(true);
    expect(d.state.id).not.toBe("pivot");
  });

  it("moves a caretaker off a strategy it is no longer allowed to run", () => {
    // A corp that pivoted as an NPP-owned firm and then gained a player owner.
    const prior: NppStrategyState = { id: "pivot", adoptedTurn: 0, baselineScore: 30 };
    const d = advanceStrategy({
      prior,
      turn: 5,
      situation: sit({ isCaretaker: true }),
      eligible: false,
    });
    expect(d.changed).toBe(true);
    expect(d.state.id).toBe("harvest");
  });

  it("is deterministic", () => {
    // No Math.random anywhere: the module's stated invariant, and what makes a
    // turn replayable.
    const prior: NppStrategyState = { id: "harvest", adoptedTurn: 0, baselineScore: 10 };
    const args = { prior, turn: 100, situation: sit({ score: 2 }), eligible: true };
    expect(advanceStrategy(args)).toEqual(advanceStrategy(args));
  });

  it("converges rather than oscillating once a strategy works", () => {
    // Run the loop forward and confirm it settles instead of flip-flopping.
    let state = advanceStrategy({
      prior: undefined,
      turn: 0,
      situation: sit({ score: 0 }),
      eligible: true,
    }).state;
    let switches = 0;
    for (let turn = 1; turn <= 400; turn++) {
      // Score improves only under harvest, so the loop should find it and stay.
      const score = state.id === "harvest" ? 12 + turn / 100 : -1;
      const d = advanceStrategy({
        prior: state,
        turn,
        situation: sit({ score, hasHeadroom: false }),
        eligible: true,
      });
      if (d.changed) switches++;
      state = d.state;
    }
    expect(state.id).toBe("harvest");
    // A handful of switches while searching is fine; hundreds is oscillation.
    expect(switches).toBeLessThan(10);
  });
});
