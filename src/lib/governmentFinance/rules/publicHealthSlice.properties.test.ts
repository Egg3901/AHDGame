import { describe, expect, it } from "vitest";
import { reconcileProgramSettlement } from "./reconciliation";
import { settleProgramAccount } from "./implementation";
import type { ProgramAccountInput } from "./types";

function input(authority: number, capacity: number, openingBalance: number): ProgramAccountInput {
  return {
    programId: "us_public_health_workforce",
    legislationTypeId: "us_public_health",
    policyOptionId: "public_health_opt_1",
    status: "operating",
    priority: 6,
    openingBalance,
    openingEncumbered: Math.floor(openingBalance / 4),
    accruedThroughTurn: 4,
    turn: 5,
    authority,
    programDemand: 1_000,
    requestedOutlay: 400,
    requestedEncumbrance: 200,
    capacity: {
      capacityType: "public_health_operations",
      maintenanceDemand: 0,
      programDemand: 1_000,
      sourceBreakdown: { workforce: capacity, facilities: 0, systems: 0, efficiency: 0 },
    },
    coverageRatio: 1,
    rampFactor: 1,
  };
}

describe("department settlement properties", () => {
  it("conserves money across a bounded input grid", () => {
    for (const authority of [0, 1, 250, 500, 1_000, 2_000]) {
      for (const capacity of [0, 250, 500, 1_000, 2_000]) {
        for (const openingBalance of [0, 10, 1_000]) {
          const value = input(authority, capacity, openingBalance);
          const result = settleProgramAccount(value);
          expect(reconcileProgramSettlement(value, result)).toEqual({ ok: true, failures: [] });
          expect(result.closingBalance).toBeGreaterThanOrEqual(0);
          expect(result.closingEncumbered).toBeLessThanOrEqual(result.closingBalance);
        }
      }
    }
  });

  it("is monotonic in funding and capacity", () => {
    const fundingFactors = [100, 500, 1_000].map(
      (authority) =>
        settleProgramAccount(input(authority, 1_000, 0)).implementation.implementationFactor
    );
    const capacityFactors = [100, 500, 1_000].map(
      (capacity) =>
        settleProgramAccount(input(1_000, capacity, 0)).implementation.implementationFactor
    );
    expect(fundingFactors).toEqual([...fundingFactors].sort((a, b) => a - b));
    expect(capacityFactors).toEqual([...capacityFactors].sort((a, b) => a - b));
  });
});
