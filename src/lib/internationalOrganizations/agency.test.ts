import { describe, it, expect } from "vitest";
import { buildAgencyNudgesByCountry } from "./agency";
import { getAgencyDef } from "@/lib/constants/orgAgencies";
import type { CountryId } from "@/lib/constants/countries";

describe("buildAgencyNudgesByCountry", () => {
  const members = new Map<string, CountryId[]>([
    ["UN", ["US", "UK"]],
    ["EU", ["DE"]],
  ]);

  it("applies a funded programme's metric to every member of its org", () => {
    const def = getAgencyDef("humanitarian_relief")!;
    const out = buildAgencyNudgesByCountry(
      [{ organizationId: "UN", agencyKey: "humanitarian_relief" }],
      members
    );
    expect(out.get("US")?.get(def.metricId)).toBe(def.delta);
    expect(out.get("UK")?.get(def.metricId)).toBe(def.delta);
    expect(out.get("DE")).toBeUndefined();
  });

  it("skips unknown agency keys", () => {
    const out = buildAgencyNudgesByCountry([{ organizationId: "UN", agencyKey: "nope" }], members);
    expect(out.size).toBe(0);
  });

  it("accumulates two programmes targeting the same metric", () => {
    const def = getAgencyDef("humanitarian_relief")!;
    const out = buildAgencyNudgesByCountry(
      [
        { organizationId: "UN", agencyKey: "humanitarian_relief" },
        { organizationId: "UN", agencyKey: "humanitarian_relief" },
      ],
      members
    );
    expect(out.get("US")?.get(def.metricId)).toBe(def.delta * 2);
  });
});
