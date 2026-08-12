import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { CorporateSector } from "@/lib/db/types";
import type { LabourContext } from "@/lib/labour/laborCost";
import { STRIKE_MARGIN_PENALTY_PP, STRIKE_REVENUE_THROTTLE } from "@/lib/labour/strikes";
import {
  resolveSectorLabourEconomics,
  resolveSectorLabourProductionEffects,
} from "./sectorLabour";

function sector(strikeStartedAtTurn: number | null = null): CorporateSector {
  return {
    _id: new ObjectId("64b000000000000000000001"),
    strikeStartedAtTurn,
  } as CorporateSector;
}

function labour(overrides: Partial<LabourContext> = {}): LabourContext {
  return {
    wagesEnabled: true,
    unionsEnabled: true,
    fullEnabled: true,
    ...overrides,
  };
}

describe("resolveSectorLabourProductionEffects", () => {
  it("is neutral when there is no strike or industrial action", () => {
    expect(resolveSectorLabourProductionEffects(labour(), sector())).toEqual({
      strikeActive: false,
      outputFactor: 1,
      strikeMarginModifier: 0,
    });
  });

  it("combines strike and bargaining action into one output factor", () => {
    const target = sector(42);
    const effects = resolveSectorLabourProductionEffects(
      labour({
        industrialActionOutputFactorBySectorId: new Map([[target._id.toString(), 0.9]]),
      }),
      target
    );

    expect(effects).toEqual({
      strikeActive: true,
      outputFactor: (1 - STRIKE_REVENUE_THROTTLE) * 0.9,
      strikeMarginModifier: STRIKE_MARGIN_PENALTY_PP,
    });
  });

  it("suppresses strike damage immediately when a no-strike agreement settles", () => {
    const target = sector(42);
    expect(
      resolveSectorLabourProductionEffects(
        labour({ noStrikeProtectedSectorIds: new Set([target._id.toString()]) }),
        target
      )
    ).toEqual({
      strikeActive: false,
      outputFactor: 1,
      strikeMarginModifier: 0,
    });
  });

  it("ignores industrial action when unions are disabled", () => {
    const target = sector();
    expect(
      resolveSectorLabourProductionEffects(
        labour({
          unionsEnabled: false,
          industrialActionOutputFactorBySectorId: new Map([[target._id.toString(), 0.5]]),
        }),
        target
      ).outputFactor
    ).toBe(1);
  });

  it("clamps malformed industrial-action factors at the economic boundary", () => {
    const target = sector();
    const factor = (value: number) =>
      resolveSectorLabourProductionEffects(
        labour({
          industrialActionOutputFactorBySectorId: new Map([[target._id.toString(), value]]),
        }),
        target
      ).outputFactor;

    expect(factor(-1)).toBe(0);
    expect(factor(2)).toBe(1);
    expect(factor(Number.NaN)).toBe(1);
  });
});

describe("resolveSectorLabourEconomics", () => {
  function economicsInput(wageFloor?: number) {
    const id = new ObjectId("64b000000000000000000001");
    return {
      labour: labour({
        ...(wageFloor != null && {
          collectiveAgreementWageFloorBySectorId: new Map([[id.toString(), wageFloor]]),
        }),
      }),
      sector: {
        _id: id,
        stateId: "NY",
        sectorType: "manufacturing",
        wageLevel: 1,
        unionization: 40,
      } as CorporateSector,
      sectorCountryId: "US",
      currentTurn: 120,
      hourlyRevenue: 1000,
      grossMaintenance: 600,
      computedWorkers: 500,
      techLaborCostMultiplier: 1,
      wageIndexByState: new Map(),
      automationIndexByState: new Map(),
      pendingStrikeEvents: [],
    };
  }

  it("prices an agreement wage floor above the employer's own wage level", () => {
    const unfloored = resolveSectorLabourEconomics(economicsInput());
    const floored = resolveSectorLabourEconomics(economicsInput(1.3));

    expect(floored.sectorLaborCost).toBeGreaterThan(unfloored.sectorLaborCost);
  });

  it("never writes the floor back into the employer's wage level", () => {
    // Persisting it would make every settlement permanent, since nothing
    // lowers the field again when the agreement expires.
    const floored = resolveSectorLabourEconomics(economicsInput(1.3));

    expect(floored).not.toHaveProperty("negotiatedWageLevelToPersist");
  });
});
