/**
 * medianIncome keeps whole-unit values but must not drop sub-unit growth
 * (#3394). Each test drives the real registry turn by turn, persisting value
 * and simBaseline the way the phase does, with the stored value fed back as
 * next turn's policy value. The world is already running (a persisted
 * simBaseline equal to the value), so the cold-start turn is out of scope.
 */
import { describe, expect, it } from "vitest";
import { evaluateRegistry } from "@/lib/metricEngine/evaluate";
import { medianIncomeNode } from "@/lib/metricEngine/registry/economic";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

const ID = "economic.medianIncome";

interface RunOptions {
  /** Annual wage growth signal, %/yr (productivity at unemployment 5). */
  annualPct: number;
  turns?: number;
  /** One-time policy change added to the stored value before this turn. */
  shock?: { turn: number; amount: number };
}

function run(start: number, { annualPct, turns = TURNS_PER_YEAR, shock }: RunOptions) {
  let value = start;
  let simBaseline = start;
  const values: number[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    const policyValue = shock?.turn === turn ? value + shock.amount : value;
    const res = evaluateRegistry([medianIncomeNode], {
      stateId: "S",
      countryId: "CN",
      prev: { [ID]: value },
      prevSimBaseline: { [ID]: simBaseline },
      providers: {},
      spending: {},
      policyValues: { [ID]: policyValue },
      seedCurrent: {
        "economic.productivityGrowth": annualPct,
        "economic.unemploymentRate": 5,
      },
    })[ID];
    value = res.value;
    simBaseline = res.simBaseline;
    values.push(value);
  }
  return { value, simBaseline, values };
}

const exact = (start: number, annualPct: number, turns = TURNS_PER_YEAR) =>
  start * (1 + annualPct / 100 / TURNS_PER_YEAR) ** turns;

describe("medianIncome sub-unit precision across 48 turns (#3394)", () => {
  it("1% a year on 1,884 CNY accumulates (0.39 a turn used to round away)", () => {
    const { value, simBaseline } = run(1884, { annualPct: 1 });
    const target = exact(1884, 1);
    expect(target - 1884).toBeGreaterThan(18);
    expect(Math.abs(simBaseline - target)).toBeLessThan(1e-3);
    expect(Math.abs(value - target)).toBeLessThanOrEqual(0.5);
    expect(Number.isInteger(value)).toBe(true);
  });

  it("-1% a year on 1,884 CNY shrinks it by the same mechanism", () => {
    const { value, simBaseline } = run(1884, { annualPct: -1 });
    const target = exact(1884, -1);
    expect(1884 - target).toBeGreaterThan(18);
    expect(Math.abs(simBaseline - target)).toBeLessThan(1e-3);
    expect(Math.abs(value - target)).toBeLessThanOrEqual(0.5);
  });

  it("the value moves monotonically, one whole unit at a time", () => {
    const { values } = run(1884, { annualPct: 1 });
    const steps = values.map((v, i) => v - (i === 0 ? 1884 : values[i - 1]));
    for (const s of steps) expect([0, 1]).toContain(s);
    expect(steps.filter((s) => s === 1).length).toBe(values[values.length - 1] - 1884);
  });

  // Same relative signal, different currency scale: the annual growth factor
  // must agree. Tolerance is the whole-unit display grain, 0.5 / value, plus
  // a 1e-9 numerical floor; the 6dp baseline itself agrees to ~1e-9.
  for (const annualPct of [0.25, 1, -1, 3]) {
    it(`${annualPct}%/yr growth is currency-scale invariant`, () => {
      const factors = [100, 1_884, 50_000, 25_145_041].map((start) => {
        const { value, simBaseline } = run(start, { annualPct });
        const want = exact(start, annualPct) / start;
        expect(Math.abs(simBaseline / start - want)).toBeLessThan(1e-8 + 1e-6 / start);
        expect(Math.abs(value / start - want)).toBeLessThanOrEqual(0.5 / start + 1e-9);
        return simBaseline / start;
      });
      for (const f of factors) expect(f).toBeCloseTo(factors[0], 7);
    });
  }

  it("a one-time policy change is kept whole and keeps growing on top", () => {
    const shocked = run(1884, { annualPct: 1, shock: { turn: 10, amount: 50 } });
    const plain = run(1884, { annualPct: 1 });
    // The +50 rides on top of the same baseline path; no residue is lost or
    // created. Rounding can split the difference by at most one unit.
    expect(Math.abs(shocked.value - plain.value - 50)).toBeLessThanOrEqual(1);
    expect(shocked.simBaseline).toBeCloseTo(plain.simBaseline, 6);
  });

  it("zero growth holds the value exactly: no drift, no money creation", () => {
    const { value, simBaseline, values } = run(1884, { annualPct: 0, turns: TURNS_PER_YEAR * 5 });
    expect(value).toBe(1884);
    expect(simBaseline).toBe(1884);
    expect(new Set(values)).toEqual(new Set([1884]));
  });
});
