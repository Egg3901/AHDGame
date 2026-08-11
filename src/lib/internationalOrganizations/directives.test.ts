import { describe, it, expect } from "vitest";
import { buildDirectiveNudgesByCountry } from "./directives";
import { getDirectiveDef } from "@/lib/constants/orgDirectives";
import type { CountryId } from "@/lib/constants/countries";

describe("buildDirectiveNudgesByCountry", () => {
  const members = new Map<string, CountryId[]>([
    ["EU", ["DE", "IE"]],
    ["MERCOSUR", ["BR"]],
  ]);

  it("spreads a directive's delta to every member of its org, keyed by metricId", () => {
    const cohesion = getDirectiveDef("cohesion_funds")!;
    const out = buildDirectiveNudgesByCountry(
      [{ organizationId: "EU", directiveKey: "cohesion_funds" }],
      members
    );
    expect(out.get("DE")?.get(cohesion.metricId)).toBe(cohesion.delta);
    expect(out.get("IE")?.get(cohesion.metricId)).toBe(cohesion.delta);
    // Non-member org untouched.
    expect(out.get("BR")).toBeUndefined();
  });

  it("sums two directives that target the same metric for a member", () => {
    // Two distinct directives, but force same metric to verify accumulation by
    // using the same key twice (a re-affirmed directive).
    const def = getDirectiveDef("productivity_compact")!;
    const out = buildDirectiveNudgesByCountry(
      [
        { organizationId: "EU", directiveKey: "productivity_compact" },
        { organizationId: "EU", directiveKey: "productivity_compact" },
      ],
      members
    );
    expect(out.get("DE")?.get(def.metricId)).toBe(def.delta * 2);
  });

  it("keeps different metrics separate for the same member", () => {
    const a = getDirectiveDef("productivity_compact")!;
    const b = getDirectiveDef("green_transition")!;
    const out = buildDirectiveNudgesByCountry(
      [
        { organizationId: "EU", directiveKey: "productivity_compact" },
        { organizationId: "EU", directiveKey: "green_transition" },
      ],
      members
    );
    expect(out.get("DE")?.get(a.metricId)).toBe(a.delta);
    expect(out.get("DE")?.get(b.metricId)).toBe(b.delta);
  });

  it("skips unknown directive keys (no entry, no throw)", () => {
    const out = buildDirectiveNudgesByCountry(
      [{ organizationId: "EU", directiveKey: "not_a_real_directive" }],
      members
    );
    expect(out.size).toBe(0);
  });

  it("returns an empty map when there are no active directives", () => {
    expect(buildDirectiveNudgesByCountry([], members).size).toBe(0);
  });
});
