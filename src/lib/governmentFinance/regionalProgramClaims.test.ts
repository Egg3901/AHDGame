import { describe, expect, it } from "vitest";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import { buildRegionalProgramClaims, latestRegionalPoliciesByType } from "./regionalProgramClaims";

function policy(typeId: string, enactedTurn: number, enactedAt: string): StatePolicy {
  return {
    stateId: "region",
    legislationTypeId: typeId,
    policyOptionId: `${typeId}_${enactedTurn}`,
    policyOptionIndex: enactedTurn,
    enactedAt: new Date(enactedAt),
    enactedTurn,
    economic: 0,
    social: 0,
    effectDirection: 0,
  };
}

describe("latestRegionalPoliciesByType", () => {
  it("keeps one newest regional policy per legislation type", () => {
    const newest = policy("service", 4, "2026-01-02T00:00:00Z");
    expect(
      latestRegionalPoliciesByType([
        newest,
        policy("service", 3, "2026-01-03T00:00:00Z"),
        policy("tax", 2, "2026-01-01T00:00:00Z"),
      ])
    ).toEqual([newest, expect.objectContaining({ legislationTypeId: "tax" })]);
  });

  it("uses enactment time as the deterministic same-turn tie break", () => {
    const newest = policy("service", 4, "2026-01-02T00:00:00Z");
    expect(
      latestRegionalPoliciesByType([policy("service", 4, "2026-01-01T00:00:00Z"), newest])
    ).toEqual([newest]);
  });

  it("retains a zero-cost policy so regional delivery resolves to one", () => {
    expect(
      buildRegionalProgramClaims({
        policies: [policy("service", 4, "2026-01-02T00:00:00Z")],
        legislationTypes: [],
        annualCostByLegislationTypeId: new Map([["service", 0]]),
      })
    ).toEqual([
      expect.objectContaining({
        legislationTypeId: "service",
        authorizedCost: 0,
      }),
    ]);
  });
});
