import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { loadDefenseFunding } from "./defenseFunding";
import { seedRosterUpkeepFor } from "@/lib/military/seedRosterUpkeep";
import { SEED_UPKEEP_TARGET_SHARE } from "@/lib/military/appropriation";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

function cursor<T>(rows: T[]) {
  return { toArray: vi.fn().mockResolvedValue(rows) };
}

// One unit with hand-computable upkeep: 1000 base x 1.0 (standard posture) x
// 2.6 (US country scale) x 1.0 (standard force tier) x 1.0 (tech tier 1).
const UNIT = {
  upkeepBase: 1000,
  posture: "standard",
  techTier: 1,
  basePower: 100,
  vet: 1,
  equipment: { a: 1, b: 1, c: 1 },
  personnel: 1000,
};
const EXPECTED_UNIT_UPKEEP = 2600;

const LINE_ANNUAL = 48_000_000;
const budgetBase = {
  spending: { byCategory: { defense: LINE_ANNUAL }, stateGrants: 0, debtInterest: 0, total: 0 },
  baselineSpendingByCategory: {},
  gdp: 1_000_000_000_000,
  defenseAppropriation: { balance: -5_000_000, accruedThroughTurn: 600, arrearsRatio: 0 },
};

describe("loadDefenseFunding", () => {
  let db: MockDb;

  function seed(units: unknown[], tierSetting?: string) {
    db = createMockDb();
    db.collection("militaryUnits");
    db.collection("cabinetSettings");
    db.collectionMocks.militaryUnits.find.mockReturnValue(cursor(units));
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue(
      tierSetting ? { _id: "US_secretary_of_defense", tierSetting } : null
    );
  }

  it("returns null when the country fields no force", async () => {
    seed([]);
    const result = await loadDefenseFunding(
      db as unknown as Db,
      "US",
      budgetBase as never,
      "1953-default"
    );
    expect(result).toBeNull();
  });

  it("reconciles the enacted line against actual upkeep with the turn's own ratio", async () => {
    seed([UNIT]);
    const result = await loadDefenseFunding(
      db as unknown as Db,
      "US",
      budgetBase as never,
      "1953-default"
    );
    expect(result).not.toBeNull();
    const seedUpkeep = seedRosterUpkeepFor("1953-default", "US");
    expect(seedUpkeep).toBeGreaterThan(0);
    const accrual = LINE_ANNUAL / TURNS_PER_YEAR;
    // Same composition the turn phase charges: line slice scaled by the
    // seed-share constant and the live-vs-seed roster ratio.
    const upkeep = accrual * SEED_UPKEEP_TARGET_SHARE * (EXPECTED_UNIT_UPKEEP / seedUpkeep);
    expect(result).toMatchObject({
      lineAnnual: LINE_ANNUAL,
      accrualPerTurn: accrual,
      upkeepPerTurn: upkeep,
      shortfallPerTurn: Math.max(0, upkeep - accrual),
      potBalance: -5_000_000,
      arrearsRatio: 0,
      unitCount: 1,
    });
  });

  it("reads the force tier from the defence seat setting", async () => {
    seed([UNIT], "reduced");
    const standard = await loadDefenseFunding(
      db as unknown as Db,
      "US",
      budgetBase as never,
      "1953-default"
    );
    seed([UNIT], "elevated");
    const elevated = await loadDefenseFunding(
      db as unknown as Db,
      "US",
      budgetBase as never,
      "1953-default"
    );
    // reduced x0.85 vs elevated x1.25 on the same roster.
    expect(elevated!.upkeepPerTurn / standard!.upkeepPerTurn).toBeCloseTo(1.25 / 0.85, 6);
    expect(db.collectionMocks.cabinetSettings.findOne).toHaveBeenCalledWith({
      _id: "US_secretary_of_defense",
    });
  });
});
