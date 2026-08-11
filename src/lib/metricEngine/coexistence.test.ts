import { describe, expect, it, vi } from "vitest";
import { evalNode } from "./coexistence";
import type { EngineNodeContext, RegistryNode } from "./types";

const baseNode = (over: Partial<RegistryNode> = {}): RegistryNode => ({
  id: "economic.x",
  categoryId: "economic",
  metricId: "x",
  kind: "derived",
  inputs: [],
  bounds: [-10, 15],
  inertia: 0.4,
  ...over,
});

const ctx = (over: Partial<EngineNodeContext>): EngineNodeContext => ({
  current: {},
  prev: {},
  prevSimBaseline: {},
  providers: {},
  spending: {},
  policyValue: 0,
  ...over,
});

describe("evalNode", () => {
  it("preserves the policy delta on top of the simulated baseline", () => {
    const node = baseNode({ compute: () => 3 });
    // prev simBaseline 2, policy pushed value to 5 → policyDelta = 3
    const out = evalNode(node, ctx({ policyValue: 5, prevSimBaseline: { "economic.x": 2 } }), "s1");
    // newSimBaseline = 0.4*2 + 0.6*3 = 2.6 ; value = 2.6 + 3 = 5.6
    expect(out.simBaseline).toBeCloseTo(2.6, 5);
    expect(out.value).toBeCloseTo(5.6, 5);
  });

  it("caps |policyDelta| at maxPolicyDelta", () => {
    const node = baseNode({ compute: () => 0, maxPolicyDelta: 8, bounds: [-100, 100] });
    const out = evalNode(
      node,
      ctx({ policyValue: 50, prevSimBaseline: { "economic.x": 0 } }),
      "s1"
    );
    // policyDelta clamped 50→8 ; value = 0 + 8 = 8
    expect(out.value).toBeCloseTo(8, 5);
  });

  it("caps a negative policyDelta symmetrically at -maxPolicyDelta", () => {
    const node = baseNode({ compute: () => 0, maxPolicyDelta: 8, bounds: [-100, 100] });
    const out = evalNode(
      node,
      ctx({ policyValue: -50, prevSimBaseline: { "economic.x": 0 } }),
      "s1"
    );
    expect(out.value).toBeCloseTo(-8, 5);
  });

  it("cold-starts simBaseline := blended target (zero initial delta) when no prev", () => {
    const node = baseNode({ compute: () => 9 });
    const out = evalNode(node, ctx({ policyValue: 4 }), "s1"); // prevSimBaseline absent
    // cold-start: prevSimBaseline := simTarget(9) → newSimBaseline = 0.4*9 + 0.6*9 = 9
    expect(out.simBaseline).toBeCloseTo(9, 5);
    // policyDelta = policyValue(4) - prevSimBaseline(9) = -5 ; value = 9 + (-5) = 4
    expect(out.value).toBeCloseTo(4, 5);
  });

  it("rejects a non-finite prevSimBaseline (treats as cold-start)", () => {
    const node = baseNode({ compute: () => 9 });
    const out = evalNode(
      node,
      ctx({ policyValue: 4, prevSimBaseline: { "economic.x": NaN } }),
      "s1"
    );
    expect(out.simBaseline).toBeCloseTo(9, 5); // NaN prev ignored → cold-start path
    expect(out.value).toBeCloseTo(4, 5);
  });

  it("clamps the written value to bounds", () => {
    // finite prev baseline 0 + large policy value 999 → net 999, clamped to max
    const node = baseNode({ compute: () => 0, bounds: [-10, 15] });
    const out = evalNode(
      node,
      ctx({ policyValue: 999, prevSimBaseline: { "economic.x": 0 } }),
      "s1"
    );
    expect(out.value).toBe(15);
  });

  it("applies the circuit-breaker when configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // finite prev baseline 0 + policy 100 → net 100; prev value 0 → capped to 0+5
    const node = baseNode({ compute: () => 0, bounds: [-100, 100], circuitBreaker: 5 });
    const out = evalNode(
      node,
      ctx({ policyValue: 100, prev: { "economic.x": 0 }, prevSimBaseline: { "economic.x": 0 } }),
      "s1"
    );
    expect(out.value).toBe(5);
    warn.mockRestore();
  });

  it("falls back the delta numerator to simTarget when policyValue is non-finite (parity: fresh metric → delta 0)", () => {
    const node = baseNode({ compute: () => 6, bounds: [-100, 100] });
    // policyValue NaN (no stored value) + no prev baseline → delta 0, value = simTarget
    const out = evalNode(node, ctx({ policyValue: NaN }), "s1");
    expect(out.value).toBeCloseTo(6, 5);
  });

  it("honors per-node decimals (unemployment uses 2dp)", () => {
    const node = baseNode({ compute: () => 4.456, decimals: 2, bounds: [2, 15] });
    const out = evalNode(
      node,
      ctx({ policyValue: 4.456, prevSimBaseline: { "economic.x": 4.456 } }),
      "s1"
    );
    expect(out.value).toBe(4.46);
  });

  it("value-EMA shape (maxPolicyDelta:0) blends prevSimBaseline toward target with zero delta", () => {
    // unemployment parity shape: simBaseline carries the value, no policy delta
    const node = baseNode({
      compute: () => 6, // Okun target
      inertia: 0.85,
      decimals: 2,
      maxPolicyDelta: 0,
      bounds: [2, 15],
    });
    // prevValue(policy) 4.5 but maxPolicyDelta 0 → delta 0; prevSimBaseline 4.5 (= prev value)
    const out = evalNode(
      node,
      ctx({ policyValue: 4.5, prevSimBaseline: { "economic.x": 4.5 } }),
      "s1"
    );
    // 0.85*4.5 + 0.15*6 = 4.725; Math.round(4.725*100)/100 = 4.72 (float: 472.499… ),
    // identical to gdpGrowth.ts's Math.round(x*100)/100 → parity-correct.
    expect(out.value).toBe(4.72);
  });

  it("never writes NaN — falls back to prev value when compute() yields non-finite", () => {
    const node = baseNode({ compute: () => 1 / 0 - 1 / 0, bounds: [0, 100] }); // NaN
    const out = evalNode(node, ctx({ policyValue: 5, prev: { "economic.x": 42 } }), "s1");
    expect(out.value).toBe(42); // last finite value, not NaN
  });

  it("never writes NaN — falls back to lower bound when no prev and compute() is non-finite", () => {
    const node = baseNode({ compute: () => Number.NaN, bounds: [2, 40] });
    const out = evalNode(node, ctx({ policyValue: NaN }), "s1");
    expect(out.value).toBe(2);
  });

  it("defaults simTarget to policyValue when a node has no compute()", () => {
    const node = baseNode({ compute: undefined, bounds: [-100, 100] });
    const out = evalNode(node, ctx({ policyValue: 7 }), "s1");
    // simTarget = policyValue = 7, cold-start → value = 7
    expect(out.value).toBeCloseTo(7, 5);
  });

  it("clamps newSimBaseline to node.bounds (ticket #826 item 12: unbounded internal EMA baseline)", () => {
    // Simulates an entrenched out-of-bounds simBaseline (e.g. carried over from
    // before this fix, or from many turns of divergent policyDelta accumulation).
    // Without clamping the internal baseline, the EMA blend (0.5*300 + 0.5*50 = 175)
    // would stay out of bounds forever even though `value` itself is clamped.
    const node = baseNode({ compute: () => 50, bounds: [0, 100], inertia: 0.5 });
    const out = evalNode(
      node,
      ctx({ policyValue: 50, prevSimBaseline: { "economic.x": 300 } }),
      "s1"
    );
    expect(out.simBaseline).toBe(100); // clamped, not 175
  });

  it("clamps a runaway-negative simBaseline back within bounds (crimeRate-style drift)", () => {
    // Mirrors the live-production reproduction: publicSafety.crimeRate reached
    // simBaseline = -1676.47 against bounds [0, 15000].
    const node = baseNode({ compute: () => 100, bounds: [0, 15000], inertia: 0.9 });
    const out = evalNode(
      node,
      ctx({ policyValue: 100, prevSimBaseline: { "economic.x": -1676.47 } }),
      "s1"
    );
    // unclamped: 0.9*(-1676.47) + 0.1*100 = -1498.823, still negative/out-of-bounds
    expect(out.simBaseline).toBeGreaterThanOrEqual(0);
    expect(out.simBaseline).toBe(0);
  });

  it("recovers within bounds over repeated turns instead of compounding out-of-range state", () => {
    const node = baseNode({ compute: () => 50, bounds: [0, 100], inertia: 0.5 });
    let prevSimBaseline = 300; // corrupted starting state
    for (let turn = 0; turn < 5; turn++) {
      const out = evalNode(
        node,
        ctx({ policyValue: 50, prevSimBaseline: { "economic.x": prevSimBaseline } }),
        "s1"
      );
      expect(out.simBaseline).toBeGreaterThanOrEqual(0);
      expect(out.simBaseline).toBeLessThanOrEqual(100);
      prevSimBaseline = out.simBaseline;
    }
  });

  it("§6.3 targetNudge shifts the target (value settles at compute+nudge), 0 = parity", () => {
    const node = baseNode({ compute: () => 3, bounds: [-100, 100] });
    // no nudge → value = compute (3)
    expect(evalNode(node, ctx({ policyValue: NaN }), "s1").value).toBeCloseTo(3, 5);
    // nudge +2 → simTarget 5, cold-start → value = 5 (not cumulative)
    expect(evalNode(node, ctx({ policyValue: NaN, targetNudge: 2 }), "s1").value).toBeCloseTo(5, 5);
    // signed
    expect(evalNode(node, ctx({ policyValue: NaN, targetNudge: -2 }), "s1").value).toBeCloseTo(
      1,
      5
    );
  });

  describe("era envelope (metric era catalog)", () => {
    it("pre-window hold: baseline AND value clamp to the limit under heavy target + policy delta", () => {
      // Spending-driven node chasing 80, big policy delta on top; ceiling 0 (pre-window).
      const node = baseNode({ compute: () => 80, bounds: [0, 100], inertia: 0.5 });
      const out = evalNode(
        node,
        ctx({
          policyValue: 60, // policyDelta leakage path (bill/cabinet effect)
          prevSimBaseline: { "economic.x": 0 },
          envelope: { limit: 0, kind: "ceiling" },
        }),
        "s1"
      );
      expect(out.simBaseline).toBe(0); // simTarget clamped pre-EMA → baseline cannot saturate
      expect(out.value).toBe(0); // final value clamped → no policy-delta leak
    });

    it("post-window: value chases the rising ceiling but never exceeds it", () => {
      const node = baseNode({ compute: () => 80, bounds: [0, 100], inertia: 0.5 });
      const out = evalNode(
        node,
        ctx({
          policyValue: 5,
          prevSimBaseline: { "economic.x": 5 },
          envelope: { limit: 17, kind: "ceiling" },
        }),
        "s1"
      );
      // EMA toward the CLAMPED target 17: 0.5*5 + 0.5*17 = 11 — growing, ≤ ceiling.
      expect(out.simBaseline).toBeCloseTo(11, 5);
      expect(out.value).toBeLessThanOrEqual(17);
      expect(out.value).toBeGreaterThan(5);
    });

    it("a prior above-cap baseline is pulled under the cap (window tightened)", () => {
      const node = baseNode({ compute: () => 80, bounds: [0, 100], inertia: 0.9 });
      const out = evalNode(
        node,
        ctx({
          policyValue: 50,
          prevSimBaseline: { "economic.x": 50 },
          envelope: { limit: 10, kind: "ceiling" },
        }),
        "s1"
      );
      expect(out.simBaseline).toBeLessThanOrEqual(10);
      expect(out.value).toBeLessThanOrEqual(10);
    });

    it("no envelope / null envelope ⇒ byte-identical to legacy", () => {
      const node = baseNode({ compute: () => 3 });
      const legacy = evalNode(
        node,
        ctx({ policyValue: 5, prevSimBaseline: { "economic.x": 2 } }),
        "s1"
      );
      const withNull = evalNode(
        node,
        ctx({ policyValue: 5, prevSimBaseline: { "economic.x": 2 }, envelope: null }),
        "s1"
      );
      expect(withNull).toEqual(legacy);
    });
  });

  describe("S8 policyDeltaDecay (opt-in shock erosion)", () => {
    // Simulate the coexistence round-trip: value/simBaseline written this turn
    // become policyValue/prevSimBaseline next turn (as the phase persists them).
    const simulateTurns = (
      node: RegistryNode,
      startValue: number,
      startBaseline: number,
      turns: number
    ) => {
      let policyValue = startValue;
      let prevSimBaseline = startBaseline;
      const values: number[] = [];
      for (let t = 0; t < turns; t++) {
        const out = evalNode(
          node,
          ctx({ policyValue, prevSimBaseline: { "economic.x": prevSimBaseline } }),
          "s1"
        );
        values.push(out.value);
        policyValue = out.value;
        prevSimBaseline = out.simBaseline;
      }
      return values;
    };

    it("erodes a one-time crisis shock back toward baseline for an opted-in node", () => {
      // consumerConfidence-shaped node at equilibrium 60 hit by a -15 crisis $inc.
      const node = baseNode({
        compute: () => 60,
        bounds: [0, 100],
        inertia: 0.8,
        maxPolicyDelta: 25,
        policyDeltaDecay: 0.9,
        decimals: 1,
      });
      const values = simulateTurns(node, 45, 60, 40); // shocked value 45, baseline 60
      // Recovers monotonically toward 60 without overshooting…
      expect(values[0]).toBeGreaterThan(45);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
        expect(values[i]).toBeLessThanOrEqual(60);
      }
      // …and is essentially healed after 40 turns (0.9^40 · 15 ≈ 0.2).
      expect(values[values.length - 1]).toBeGreaterThan(59);
    });

    it("caps the preserved shock at maxPolicyDelta before decaying", () => {
      const node = baseNode({
        compute: () => 60,
        bounds: [0, 100],
        inertia: 0.8,
        maxPolicyDelta: 25,
        policyDeltaDecay: 0.9,
        decimals: 1,
      });
      // A stacked -50 excursion is first capped to -25, then decayed to -22.5.
      const out = evalNode(
        node,
        ctx({ policyValue: 10, prevSimBaseline: { "economic.x": 60 } }),
        "s1"
      );
      // newSimBaseline = 60 (at equilibrium); delta = clamp(-50, ±25)·0.9 = -22.5
      expect(out.value).toBeCloseTo(37.5, 5);
    });

    it("regression: a non-opted-in node (no policyDeltaDecay) preserves the shock in full forever", () => {
      const node = baseNode({ compute: () => 60, bounds: [0, 100], inertia: 0.8, decimals: 1 });
      const values = simulateTurns(node, 45, 60, 10);
      // Legacy behavior: the -15 delta is frozen; value stays exactly 45.
      for (const v of values) expect(v).toBeCloseTo(45, 5);
    });

    it("regression: policyDeltaDecay: 1 is byte-identical to omitting it", () => {
      const legacyNode = baseNode({ compute: () => 3 });
      const decayOne = baseNode({ compute: () => 3, policyDeltaDecay: 1 });
      const c = () => ctx({ policyValue: 5, prevSimBaseline: { "economic.x": 2 } });
      expect(evalNode(decayOne, c(), "s1")).toEqual(evalNode(legacyNode, c(), "s1"));
    });
  });
});
