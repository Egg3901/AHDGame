import { describe, it, expect } from "vitest";
import { INTERFERENCE_SCRUTINY } from "./credibility";
import {
  DISMISSAL_SCRUTINY,
  INDEPENDENCE_COSTS,
  REVOCATION_SCRUTINY,
  scrutinyAfterDismissal,
  scrutinyAfterRevocation,
} from "./independence";

describe("dismissal is never a laundromat", () => {
  it("keeps the whole stock and adds the penalty, applying no retention haircut", () => {
    expect(scrutinyAfterDismissal({ chairInfamy: 40 })).toBe(40 + DISMISSAL_SCRUTINY);
  });

  it("clamps at the ceiling instead of overflowing", () => {
    expect(scrutinyAfterDismissal({ chairInfamy: 95 })).toBe(100);
    expect(scrutinyAfterRevocation({ chairInfamy: 95 })).toBe(100);
  });

  it("treats a missing or malformed stock as zero", () => {
    expect(scrutinyAfterDismissal({ chairInfamy: undefined as never })).toBe(DISMISSAL_SCRUTINY);
    expect(scrutinyAfterDismissal({ chairInfamy: -20 })).toBe(DISMISSAL_SCRUTINY);
  });
});

describe("the price ladder is ordered by how far the act goes", () => {
  it("charges more for removing the person than for overriding one decision", () => {
    expect(DISMISSAL_SCRUTINY).toBeGreaterThan(INTERFERENCE_SCRUTINY);
  });

  it("charges most for a statute, which outlasts the government that passed it", () => {
    expect(REVOCATION_SCRUTINY).toBeGreaterThan(DISMISSAL_SCRUTINY);
  });
});

describe("revocation", () => {
  it("adds the statutory penalty to the existing stock", () => {
    expect(scrutinyAfterRevocation({ chairInfamy: 10 })).toBe(10 + REVOCATION_SCRUTINY);
  });
});

describe("INDEPENDENCE_COSTS", () => {
  it("publishes numbers that match the engine, so the card cannot drift", () => {
    const byAction = new Map(INDEPENDENCE_COSTS.map((c) => [c.action, c.scrutiny]));
    expect(byAction.get("Set the rate directly")).toBe(INTERFERENCE_SCRUTINY);
    expect(byAction.get("Dismiss the chair")).toBe(DISMISSAL_SCRUTINY);
    expect(byAction.get("Revoke independence by statute")).toBe(REVOCATION_SCRUTINY);
  });
});
