import { describe, expect, it } from "vitest";
import {
  accrueWarheads,
  deterrenceScore,
  NUCLEAR_NODES,
  nuclearNode,
  nuclearNodeStatus,
  productionCapFor,
  warheadUnitCost,
} from "./nuclearProgram";

describe("tree shape", () => {
  it("every prerequisite key exists", () => {
    for (const n of NUCLEAR_NODES) {
      for (const req of n.requires)
        expect(nuclearNode(req), `${n.key} requires ${req}`).toBeDefined();
    }
  });

  it("device nodes all carry a production cap and a tension spike", () => {
    for (const n of NUCLEAR_NODES.filter((n) => n.kind === "device")) {
      expect(n.productionCap ?? 0).toBeGreaterThan(0);
      expect(n.tensionSpike ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("nuclearNodeStatus", () => {
  const fission = nuclearNode("device-fission")!;
  const thermo = nuclearNode("device-thermo")!;

  it("gates on year, then prerequisites", () => {
    expect(nuclearNodeStatus(fission, {}, 1940)).toBe("future");
    expect(nuclearNodeStatus(fission, {}, 1953)).toBe("available");
    expect(nuclearNodeStatus(thermo, {}, 1953)).toBe("locked");
    expect(nuclearNodeStatus(thermo, { "device-fission": 1, "device-boosted": 2 }, 1953)).toBe(
      "available"
    );
    expect(nuclearNodeStatus(fission, { "device-fission": 1 }, 1953)).toBe("adopted");
  });
});

describe("production", () => {
  it("no device, no production", () => {
    expect(productionCapFor({})).toBe(0);
    expect(accrueWarheads({}, 5, 1e9)).toEqual({ built: 0, cost: 0 });
  });

  it("best adopted tier sets the cap and the rate clamps to it", () => {
    const adopted = { "device-fission": 1, "device-boosted": 2 };
    expect(productionCapFor(adopted)).toBe(4);
    const { built, cost } = accrueWarheads(adopted, 99, 1e9);
    expect(built).toBe(4);
    expect(cost).toBe(4 * warheadUnitCost(adopted));
  });

  it("a starved budget builds only what it can pay for, money conserved", () => {
    const adopted = { "device-fission": 1 };
    const unit = warheadUnitCost(adopted);
    const { built, cost } = accrueWarheads(adopted, 2, unit * 1.5);
    expect(built).toBe(1);
    expect(cost).toBe(unit);
  });

  it("unit cost falls as the tier matures", () => {
    const fissionOnly = warheadUnitCost({ "device-fission": 1 });
    const thermo = warheadUnitCost({
      "device-fission": 1,
      "device-boosted": 1,
      "device-thermo": 1,
    });
    expect(thermo).toBeLessThan(fissionOnly);
  });
});

describe("deterrenceScore", () => {
  it("a stockpile with no delivery leg deters nobody", () => {
    expect(deterrenceScore({ "device-thermo": 1 }, 500)).toBe(0);
  });

  it("grows with warheads and delivery legs, capped at 100", () => {
    const oneLeg = { "device-fission": 1, "delivery-bombers": 1 };
    const allLegs = {
      ...oneLeg,
      "delivery-irbm": 1,
      "delivery-icbm": 1,
      "delivery-slbm": 1,
    };
    expect(deterrenceScore(oneLeg, 25)).toBeLessThan(deterrenceScore(allLegs, 25));
    expect(deterrenceScore(allLegs, 1e6)).toBe(100);
  });
});
