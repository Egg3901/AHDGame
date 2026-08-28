import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { resolveEngagement, engagementControlBonus } from "../engagement";
import type { NavairUnit, NavalMission } from "../types";
import type { CountryId } from "@/lib/constants/countries";

function hull(
  over: Partial<NavairUnit> & { countryId: string; mission: NavalMission }
): NavairUnit {
  return {
    _id: new ObjectId(),
    branchId: "navy",
    domain: "naval",
    name: "Task Force",
    type: "Guided-Missile Destroyer",
    icon: "ship",
    posture: "standard",
    techTier: 1,
    personnel: 1000,
    readiness: 100,
    basePower: 64,
    upkeepBase: 100,
    vet: 2,
    xp: 0,
    equipment: { firepower: 50, protection: 50, support: 50 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: "gen-1",
    createdTurn: 1,
    station: "nat",
    integrity: 100,
    supply: 100,
    ...over,
    countryId: over.countryId as CountryId,
  } as NavairUnit;
}

describe("resolveEngagement", () => {
  it("does not fire when neither side is there to fight", () => {
    const a = [hull({ countryId: "US", mission: "TRANSIT" })];
    const b = [hull({ countryId: "RU", mission: "PORT" })];
    expect(resolveEngagement("nat", a, b)).toBeNull();
  });

  it("fires when only one side came to fight, because the other is there anyway", () => {
    const a = [hull({ countryId: "US", mission: "BLOCKADE" })];
    const b = [hull({ countryId: "RU", mission: "TRANSIT" })];
    expect(resolveEngagement("nat", a, b)).not.toBeNull();
  });

  it("never deletes a formation, however badly it loses", () => {
    // The game's convention: a mauled unit keeps its general and its theater and rebuilds
    // in place. A delete here would dangle `assignedGeneralId` and silently rearrange a
    // chain of command that battle is not allowed to touch.
    const weak = [hull({ countryId: "RU", mission: "SEA_CONTROL", basePower: 1 })];
    const strong = Array.from({ length: 6 }, () =>
      hull({ countryId: "US", mission: "SEA_CONTROL", basePower: 99 })
    );
    const result = resolveEngagement("nat", strong, weak);
    expect(result).not.toBeNull();
    // The loser still exists and still has its general.
    expect(weak[0].assignedGeneralId).toBe("gen-1");
    expect(weak[0].theaterId).toBe("reserve");
  });

  it("takes crews down with the hulls, which is what makes a mauled fleet weak", () => {
    const a = [hull({ countryId: "US", mission: "SEA_CONTROL" })];
    const b = [hull({ countryId: "RU", mission: "SEA_CONTROL" })];
    resolveEngagement("nat", a, b);
    expect(a[0].personnel).toBeLessThan(1000);
    expect(a[0].personnel).toBeGreaterThan(0);
  });

  it("costs both sides at parity, so contesting water is a real grind", () => {
    const a = [hull({ countryId: "US", mission: "SEA_CONTROL" })];
    const b = [hull({ countryId: "RU", mission: "SEA_CONTROL" })];
    resolveEngagement("nat", a, b);
    expect(a[0].integrity).toBeLessThan(100);
    expect(b[0].integrity).toBeLessThan(100);
    // Not annihilation: a parity fight is survivable, or nobody would ever contest.
    expect(a[0].integrity).toBeGreaterThan(50);
  });

  it("hurts the weaker side more", () => {
    const weak = [hull({ countryId: "RU", mission: "SEA_CONTROL", basePower: 10 })];
    const strong = [hull({ countryId: "US", mission: "SEA_CONTROL", basePower: 99 })];
    resolveEngagement("nat", strong, weak);
    // resolveEngagement always writes integrity on a formation that fought, so the
    // fallback here is only to satisfy the optional type, never a real value.
    expect(weak[0].integrity).toBeLessThan(strong[0].integrity ?? 100);
  });

  it("is deterministic, so a replay reproduces the same war", () => {
    const run = () => {
      const a = [hull({ countryId: "US", mission: "SEA_CONTROL" })];
      const b = [hull({ countryId: "RU", mission: "BLOCKADE" })];
      const r = resolveEngagement("nat", a, b);
      return { margin: r?.outcome.marginPct, integ: a[0].integrity };
    };
    expect(run()).toEqual(run());
  });

  it("marks fighters as engaged, so they cannot also repair this turn", () => {
    const a = [hull({ countryId: "US", mission: "SEA_CONTROL" })];
    const b = [hull({ countryId: "RU", mission: "SEA_CONTROL" })];
    resolveEngagement("nat", a, b);
    expect(a[0].engaged).toBe(true);
  });
});

describe("engagementControlBonus", () => {
  it("rewards a decisive win without handing over the region", () => {
    // One good turn must not undo twenty turns of somebody else holding the water.
    expect(engagementControlBonus(100)).toBeLessThanOrEqual(15);
    expect(engagementControlBonus(100)).toBeGreaterThan(0);
  });

  it("is worth nothing for a standstill", () => {
    expect(engagementControlBonus(0)).toBe(0);
  });
});
