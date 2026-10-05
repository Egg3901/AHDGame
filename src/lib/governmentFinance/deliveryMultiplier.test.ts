import { describe, expect, it } from "vitest";
import type { DepartmentProgramState } from "@/lib/db/types/budget";
import { resolvePublicHealthDeliveryMultiplier } from "./deliveryMultiplier";

function program(overrides: Partial<DepartmentProgramState> = {}): DepartmentProgramState {
  return {
    programId: "us_public_health_workforce",
    legislationTypeId: "us_public_health",
    policyOptionId: "public_health_opt_1",
    status: "operating",
    annualDemand: 9_300_000_000,
    periodDemand: 193_750_000,
    authorityThisTurn: 193_750_000,
    obligated: 77_500_000,
    outlaid: 77_500_000,
    arrears: 0,
    fundingRatio: 1,
    capacityRatio: 0.8,
    coverageRatio: 1,
    rampFactor: 0.5,
    implementationFactor: 0.4,
    bindingConstraint: "ramp",
    lastSettledTurn: 18,
    ...overrides,
  };
}

describe("resolvePublicHealthDeliveryMultiplier", () => {
  it("preserves legacy behavior while the feature is disabled", () => {
    expect(
      resolvePublicHealthDeliveryMultiplier({
        enabled: false,
        currentTurn: 18,
        migratedOptionActive: true,
      })
    ).toEqual({ multiplier: 1, reason: "feature_disabled" });
  });

  it("leaves other public-health options on their existing path", () => {
    expect(
      resolvePublicHealthDeliveryMultiplier({
        enabled: true,
        currentTurn: 18,
        migratedOptionActive: false,
      })
    ).toEqual({ multiplier: 1, reason: "option_not_migrated" });
  });

  it("uses the current reconciled implementation factor", () => {
    expect(
      resolvePublicHealthDeliveryMultiplier({
        enabled: true,
        currentTurn: 18,
        migratedOptionActive: true,
        program: program(),
      })
    ).toMatchObject({ multiplier: 0.4, reason: "current_settlement" });
  });

  it("fails closed for missing and stale settlements", () => {
    expect(
      resolvePublicHealthDeliveryMultiplier({
        enabled: true,
        currentTurn: 18,
        migratedOptionActive: true,
      })
    ).toEqual({ multiplier: 0, reason: "missing_settlement" });
    expect(
      resolvePublicHealthDeliveryMultiplier({
        enabled: true,
        currentTurn: 19,
        migratedOptionActive: true,
        program: program(),
      })
    ).toMatchObject({ multiplier: 0, reason: "stale_settlement" });
  });

  it("keeps a repealed migrated program on the delivered path", () => {
    expect(
      resolvePublicHealthDeliveryMultiplier({
        enabled: true,
        currentTurn: 19,
        migratedOptionActive: false,
        program: program({
          status: "closed",
          implementationFactor: 0,
          lastSettledTurn: 19,
          repealTurn: 19,
        }),
      })
    ).toMatchObject({ multiplier: 0, reason: "current_settlement" });
  });
});
