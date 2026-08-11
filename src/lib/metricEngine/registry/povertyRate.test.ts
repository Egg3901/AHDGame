import { describe, expect, it } from "vitest";
import { povertyRateNode, unemploymentNode } from "./economic";
import { evalNode } from "../coexistence";
import { evaluateRegistry } from "../evaluate";
import { topoSort } from "../topoSort";
import type { EngineNodeContext } from "../types";

const ctx = (over: Partial<EngineNodeContext>): EngineNodeContext => ({
  current: {},
  prev: {},
  prevSimBaseline: {},
  providers: {},
  spending: {},
  policyValue: NaN,
  ...over,
});

// Baseline ctx: unemployment 5, Gini-100 inequality 40, no social spend.
// (The medianIncome LEVEL term was dropped at P3a go-live — local-currency
// incomes can't be normalized without a country anchor; named for balance.)
const baseCurrent = {
  "economic.unemploymentRate": 5,
  "social.incomeInequality": 40,
};

describe("povertyRateNode (LIVE since P3a — channel + DAG + lagged edge)", () => {
  it("reads the {spending:'social'} channel — more social spending lowers poverty", () => {
    const lowSpend = evalNode(
      povertyRateNode,
      ctx({ current: baseCurrent, spending: { social: 0 } }),
      "s1"
    );
    const highSpend = evalNode(
      povertyRateNode,
      ctx({ current: baseCurrent, spending: { social: 100 } }),
      "s1"
    );
    expect(highSpend.value).toBeLessThan(lowSpend.value);
  });

  it("rises with unemployment (reads the live unemploymentRate engine node via ctx.current)", () => {
    const low = evalNode(
      povertyRateNode,
      ctx({ current: { ...baseCurrent, "economic.unemploymentRate": 3 } }),
      "s1"
    );
    const high = evalNode(
      povertyRateNode,
      ctx({ current: { ...baseCurrent, "economic.unemploymentRate": 12 } }),
      "s1"
    );
    expect(high.value).toBeGreaterThan(low.value);
  });

  it("rises with Gini-100 income inequality (same-turn social node)", () => {
    const equal = evalNode(
      povertyRateNode,
      ctx({ current: { ...baseCurrent, "social.incomeInequality": 28 } }),
      "s1"
    );
    const unequal = evalNode(
      povertyRateNode,
      ctx({ current: { ...baseCurrent, "social.incomeInequality": 55 } }),
      "s1"
    );
    expect(unequal.value).toBeGreaterThan(equal.value);
  });

  it("reads crimeRate as a LAGGED edge (per-100k scale, from prev not current)", () => {
    const lowCrime = evalNode(
      povertyRateNode,
      ctx({ current: baseCurrent, prev: { "publicSafety.crimeRate": 1800 } }),
      "s1"
    );
    const highCrime = evalNode(
      povertyRateNode,
      ctx({ current: baseCurrent, prev: { "publicSafety.crimeRate": 9500 } }),
      "s1"
    );
    expect(highCrime.value).toBeGreaterThan(lowCrime.value);
  });

  it("clamps to the [3,35] bounds at joint extremes", () => {
    const extreme = evalNode(
      povertyRateNode,
      ctx({
        current: {
          ...baseCurrent,
          "economic.unemploymentRate": 15,
          "social.incomeInequality": 70,
        },
        prev: { "publicSafety.crimeRate": 15000 },
      }),
      "s1"
    );
    expect(extreme.value).toBeLessThanOrEqual(35);
    expect(extreme.value).toBeGreaterThanOrEqual(3);
  });

  it("evaluates after unemploymentRate in topo order and reads its this-turn value", () => {
    // gdp drives unemployment via Okun; povertyRate then reads the fresh unemployment.
    const ordered = topoSort([unemploymentNode, povertyRateNode]);
    expect(ordered.map((n) => n.id)).toEqual(["economic.unemploymentRate", "economic.povertyRate"]);
    const out = evaluateRegistry(ordered, {
      stateId: "s1",
      prev: { "publicSafety.crimeRate": 5000 },
      prevSimBaseline: { "economic.unemploymentRate": 5 },
      providers: {},
      spending: { social: 0 },
      policyValues: {},
      seedCurrent: { "social.incomeInequality": 40 },
    });
    expect(out["economic.povertyRate"]).toBeDefined();
    expect(out["economic.povertyRate"].value).toBeGreaterThanOrEqual(3);
  });
});
