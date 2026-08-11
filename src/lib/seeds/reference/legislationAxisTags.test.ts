import { describe, it, expect } from "vitest";
import { legislationTypes } from "./legislationTypes";
import type { LegislationType } from "@/lib/db/types";

/**
 * P6.2 axis-tag corrections. A law's effective axis is DERIVED from its option
 * scores (some option economic≠0 → economic dimension; some social≠0 → social
 * dimension), not a stored field — so this guard is robust to the policyOptions
 * helper internals. (legislationTypes already spreads the country files; dedupe
 * by _id so a country re-export can't shadow the assertion.)
 */

function effectiveAxis(t: LegislationType): "economic" | "social" | "both" | "none" {
  const opts = t.policyOptions ?? [];
  const hasEcon = opts.some((o) => (o.economic ?? 0) !== 0);
  const hasSoc = opts.some((o) => (o.social ?? 0) !== 0);
  return hasEcon && hasSoc ? "both" : hasEcon ? "economic" : hasSoc ? "social" : "none";
}

const byId = new Map<string, LegislationType>();
for (const t of legislationTypes) byId.set(t._id, t);

function axisOf(id: string): string {
  const t = byId.get(id);
  expect(t, `law ${id} must exist`).toBeDefined();
  return effectiveAxis(t!);
}

describe("P6.2 legislation axis tags", () => {
  it("defense spending is BOTH (fiscal + authoritarian/security)", () => {
    expect(axisOf("us_defense_spending")).toBe("both");
    expect(axisOf("uk_defence_spending")).toBe("both");
    expect(axisOf("uk_trident_defence")).toBe("both");
  });

  it("senate filibuster rules is SOCIAL (governance/procedural)", () => {
    expect(axisOf("senate_filibuster_rules")).toBe("social");
  });

  it("workforce development is ECONOMIC (skills/labor spending)", () => {
    expect(axisOf("us_workforce_development")).toBe("economic");
    expect(axisOf("us_state_workforce_development")).toBe("economic");
  });

  it("emergency services is BOTH (spending + public safety)", () => {
    expect(axisOf("us_emergency_services")).toBe("both");
  });
});
