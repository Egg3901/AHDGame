import { describe, expect, it } from "vitest";
import { resolveOperation, type OperationInput } from "./resolveOperation";

const BASE: OperationInput = {
  networkLevel: 3,
  coverage: 50,
  tradecraft: 5,
  statMultiplier: 1,
  counterIntel: 20,
  suspicion: 20,
  difficulty: 20,
  successRoll: 0.5,
  compromiseRoll: 0.5,
};

describe("resolveOperation", () => {
  it("succeeds on a low success roll and misses on a high one", () => {
    expect(resolveOperation({ ...BASE, successRoll: 0.01 }).outcome).toBe("success");
    expect(resolveOperation({ ...BASE, successRoll: 0.99 }).outcome).toBe("miss");
  });

  it("is clean when the compromise roll is high", () => {
    expect(resolveOperation({ ...BASE, compromiseRoll: 0.99 }).compromise).toBe("clean");
  });

  it("attributes on the deepest compromise rolls", () => {
    expect(resolveOperation({ ...BASE, compromiseRoll: 0 }).compromise).toBe("attributed");
  });

  it("allows a successful operation to be attributed", () => {
    // The whole point of two axes: you got the thing, and everyone knows.
    const r = resolveOperation({ ...BASE, successRoll: 0, compromiseRoll: 0 });
    expect(r.outcome).toBe("success");
    expect(r.compromise).toBe("attributed");
  });

  it("raises success chance with network level", () => {
    const low = resolveOperation({ ...BASE, networkLevel: 0 });
    const high = resolveOperation({ ...BASE, networkLevel: 5 });
    expect(high.successChance).toBeGreaterThan(low.successChance);
  });

  it("raises success chance with coverage and with tradecraft", () => {
    expect(resolveOperation({ ...BASE, coverage: 100 }).successChance).toBeGreaterThan(
      resolveOperation({ ...BASE, coverage: 0 }).successChance
    );
    expect(resolveOperation({ ...BASE, tradecraft: 10 }).successChance).toBeGreaterThan(
      resolveOperation({ ...BASE, tradecraft: 1 }).successChance
    );
  });

  it("lowers success chance as difficulty climbs", () => {
    expect(resolveOperation({ ...BASE, difficulty: 100 }).successChance).toBeLessThan(
      resolveOperation({ ...BASE, difficulty: 0 }).successChance
    );
  });

  it("makes a high-suspicion network far likelier to be compromised at all", () => {
    const cold = resolveOperation({ ...BASE, suspicion: 0, compromiseRoll: 0.3 });
    const hot = resolveOperation({ ...BASE, suspicion: 100, compromiseRoll: 0.3 });
    expect(cold.compromise).toBe("clean");
    expect(hot.compromise).not.toBe("clean");
  });

  it("lets a defender's counter-intelligence push a compromise up to attribution", () => {
    const weak = resolveOperation({
      ...BASE,
      counterIntel: 0,
      suspicion: 100,
      compromiseRoll: 0.4,
    });
    const strong = resolveOperation({
      ...BASE,
      counterIntel: 100,
      suspicion: 100,
      compromiseRoll: 0.4,
    });
    expect(weak.compromise).toBe("blown");
    expect(strong.compromise).toBe("attributed");
  });

  it("buys quiet with tradecraft", () => {
    expect(resolveOperation({ ...BASE, tradecraft: 10 }).compromiseChance).toBeLessThan(
      resolveOperation({ ...BASE, tradecraft: 1 }).compromiseChance
    );
  });

  it("never returns a compromise outside the ladder", () => {
    const ladder = ["clean", "blown", "detected", "attributed"];
    for (let i = 0; i <= 20; i++) {
      const r = resolveOperation({
        ...BASE,
        compromiseRoll: i / 20,
        suspicion: i * 5,
        counterIntel: (20 - i) * 5,
      });
      expect(ladder).toContain(r.compromise);
    }
  });

  it("keeps both chances inside [0, 1] under absurd inputs", () => {
    const wild = resolveOperation({
      networkLevel: 999,
      coverage: 999,
      tradecraft: 999,
      statMultiplier: 50,
      counterIntel: 999,
      suspicion: 999,
      difficulty: -999,
      successRoll: 0.5,
      compromiseRoll: 0.5,
    });
    expect(wild.successChance).toBeGreaterThanOrEqual(0);
    expect(wild.successChance).toBeLessThanOrEqual(1);
    expect(wild.compromiseChance).toBeGreaterThanOrEqual(0);
    expect(wild.compromiseChance).toBeLessThanOrEqual(1);
  });

  it("treats a negative stat multiplier as zero rather than inverting the roll", () => {
    // A corrupt multiplier must not make an operation impossible-to-fail or
    // negative-chance; it collapses to no chance at all.
    expect(resolveOperation({ ...BASE, statMultiplier: -5 }).successChance).toBe(0);
  });
});
