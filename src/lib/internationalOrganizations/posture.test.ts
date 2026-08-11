import { describe, it, expect } from "vitest";
import { buildPostureNudgesByCountry } from "./posture";
import { postureEffect } from "@/lib/constants/orgPosture";
import type { CountryId } from "@/lib/constants/countries";

describe("buildPostureNudgesByCountry", () => {
  const members = new Map<string, CountryId[]>([
    ["NATO", ["US", "UK", "DE"]],
    ["EU", ["DE", "IE"]],
  ]);

  it("spreads a non-standard posture's effect to every alliance member", () => {
    const eff = postureEffect("heightened");
    const out = buildPostureNudgesByCountry(
      [{ organizationId: "NATO", posture: "heightened" }],
      members
    );
    for (const c of ["US", "UK", "DE"] as CountryId[]) {
      expect(out.get(c)?.get("militaryReadiness")).toBe(eff.militaryReadiness);
      expect(out.get(c)?.get("civilLiberties")).toBe(eff.civilLiberties);
    }
    expect(out.get("IE")).toBeUndefined();
  });

  it("standard posture contributes nothing (parity)", () => {
    const out = buildPostureNudgesByCountry(
      [{ organizationId: "NATO", posture: "standard" }],
      members
    );
    expect(out.size).toBe(0);
  });

  it("accumulates effects for a country in two non-standard alliances on the same metric", () => {
    const out = buildPostureNudgesByCountry(
      [
        { organizationId: "NATO", posture: "heightened" },
        { organizationId: "EU", posture: "heightened" },
      ],
      members
    );
    // DE is in both → double the per-alliance militaryReadiness nudge.
    expect(out.get("DE")?.get("militaryReadiness")).toBe(
      postureEffect("heightened").militaryReadiness * 2
    );
    // US only in NATO → single.
    expect(out.get("US")?.get("militaryReadiness")).toBe(
      postureEffect("heightened").militaryReadiness
    );
  });

  it("article 5 also applies an economic-growth drag", () => {
    const out = buildPostureNudgesByCountry(
      [{ organizationId: "NATO", posture: "article5" }],
      members
    );
    expect(out.get("US")?.get("gdpGrowth")).toBe(postureEffect("article5").gdpGrowth);
    expect(out.get("US")?.get("gdpGrowth")).toBeLessThan(0);
  });
});
