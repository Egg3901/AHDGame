import { describe, expect, it } from "vitest";
import { allocateByPriority } from "./allocation";
import { settleProgramAccount } from "./implementation";
import type { ProgramAccountInput } from "./types";

function fixture(overrides: Partial<ProgramAccountInput> = {}): ProgramAccountInput {
  return {
    programId: "us_public_health_workforce",
    legislationTypeId: "us_public_health",
    policyOptionId: "public_health_opt_1",
    status: "authorized",
    priority: 6,
    openingBalance: 0,
    openingEncumbered: 0,
    accruedThroughTurn: 9,
    turn: 10,
    authority: 6_975_000_000,
    programDemand: 9_300_000_000,
    requestedOutlay: 5_000_000_000,
    requestedEncumbrance: 1_500_000_000,
    capacity: {
      capacityType: "public_health_operations",
      maintenanceDemand: 0,
      programDemand: 100,
      sourceBreakdown: { workforce: 40, facilities: 20, systems: 15, efficiency: 5 },
    },
    coverageRatio: 1,
    rampFactor: 0.5,
    ...overrides,
  };
}

describe("public-health department settlement matrix", () => {
  it("reconciles the design fixture exactly", () => {
    const result = settleProgramAccount(fixture());
    expect(result.authorityAccrued).toBe(6_975_000_000);
    expect(result.outlaid).toBe(5_000_000_000);
    expect(result.closingEncumbered).toBe(1_500_000_000);
    expect(result.availableBalance).toBe(475_000_000);
    expect(result.implementation).toMatchObject({
      fundingRatio: 0.75,
      capacityRatio: 0.8,
      coverageRatio: 1,
      rampFactor: 0.5,
      implementationFactor: 0.3,
      bindingConstraint: "ramp",
    });
  });

  it("distinguishes funding and capacity bottlenecks", () => {
    const funding = settleProgramAccount(
      fixture({
        authority: 50,
        programDemand: 100,
        requestedOutlay: 50,
        requestedEncumbrance: 0,
        rampFactor: 1,
        capacity: { ...fixture().capacity, programDemand: 100 },
      })
    );
    const capacity = settleProgramAccount(
      fixture({
        authority: 100,
        programDemand: 100,
        requestedOutlay: 50,
        requestedEncumbrance: 0,
        rampFactor: 1,
        capacity: {
          ...fixture().capacity,
          programDemand: 160,
        },
      })
    );
    expect(funding.implementation.bindingConstraint).toBe("funding");
    expect(capacity.implementation.bindingConstraint).toBe("capacity");
  });

  it("makes a replay a no-op", () => {
    const result = settleProgramAccount(fixture({ accruedThroughTurn: 10 }));
    expect(result.replayed).toBe(true);
    expect(result.authorityAccrued).toBe(0);
    expect(result.outlaid).toBe(0);
    expect(result.newEncumbrance).toBe(0);
  });

  it("preserves existing encumbrance during repeal and accepts nothing new", () => {
    const result = settleProgramAccount(
      fixture({
        status: "operating",
        repealTurn: 10,
        openingBalance: 2_000,
        openingEncumbered: 1_500,
        authority: 0,
        requestedOutlay: 0,
        requestedEncumbrance: 500,
      })
    );
    expect(result.status).toBe("winding_down");
    expect(result.newEncumbrance).toBe(0);
    expect(result.closingEncumbered).toBe(1_500);
  });

  it("protects higher-priority claims and splits a short tier pro rata", () => {
    expect(
      allocateByPriority(8, [
        { id: "protected", priority: 2, requested: 4 },
        { id: "a", priority: 6, requested: 6 },
        { id: "b", priority: 6, requested: 6 },
      ])
    ).toEqual([
      { id: "protected", priority: 2, requested: 4, allocated: 4 },
      { id: "a", priority: 6, requested: 6, allocated: 2 },
      { id: "b", priority: 6, requested: 6, allocated: 2 },
    ]);
  });
});
