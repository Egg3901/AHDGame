import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { seedBudgets } from "./seedBudgets";
import { generateDefaultEnactedLaws } from "@/lib/seeds/reference/budgets";

/**
 * Audit S5: the enacted-law reseed upsert must $unset gdpCostFraction /
 * incomeCostFraction when the current seed definition does not carry them,
 * otherwise a law reseeded from a high-fraction option to a low/no-fraction
 * option keeps charging the stale fraction (calculateEnactedLawAnnualCost
 * trusts persisted fractions first).
 */
describe("seedBudgets stale cost-fraction unset", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("$unsets gdpCostFraction/incomeCostFraction when the seed law does not define them, and never unsets defined ones", async () => {
    const expectedLaws = generateDefaultEnactedLaws("2019-default").filter(
      (law) => law.countryId === "US"
    );
    expect(expectedLaws.length).toBeGreaterThan(0);

    await seedBudgets(db as unknown as Db, false, () => {}, "2019-default");

    const calls = db.collection("enactedLaws").updateOne.mock.calls as Array<
      [
        { legislationTypeId?: string },
        {
          $set?: Record<string, unknown>;
          $unset?: Record<string, "">;
        },
      ]
    >;
    expect(calls).toHaveLength(expectedLaws.length);

    for (const [filter, update] of calls) {
      const set = update.$set ?? {};
      const unset = update.$unset ?? {};
      for (const field of ["gdpCostFraction", "incomeCostFraction"] as const) {
        if (set[field] === undefined) {
          // Seed definition does not carry the field -> stale value must be unset.
          expect(unset[field], `${filter.legislationTypeId}: missing $unset.${field}`).toBe("");
        } else {
          // Seed definition carries the field -> must not be unset ($set/$unset
          // conflict would also throw in real Mongo).
          expect(
            unset[field],
            `${filter.legislationTypeId}: $unset conflicts with $set.${field}`
          ).toBeUndefined();
        }
      }
      // Legacy cost fields keep the same invariant.
      for (const field of [
        "gdpPerCapitaMultiplier",
        "annualCostPerCapita",
        "annualCostUsd",
      ] as const) {
        if (set[field] === undefined) {
          expect(unset[field]).toBe("");
        } else {
          expect(unset[field]).toBeUndefined();
        }
      }
    }
  });

  it("exercises both branches (some laws define a fraction, some do not)", async () => {
    await seedBudgets(db as unknown as Db, false, () => {}, "2019-default");
    const calls = db.collection("enactedLaws").updateOne.mock.calls as Array<
      [unknown, { $set?: Record<string, unknown>; $unset?: Record<string, ""> }]
    >;
    const withFraction = calls.filter(
      ([, u]) => (u.$set?.gdpCostFraction ?? u.$set?.incomeCostFraction) !== undefined
    );
    const withoutFraction = calls.filter(
      ([, u]) => u.$set?.gdpCostFraction === undefined && u.$set?.incomeCostFraction === undefined
    );
    // If either bucket is empty the first test is vacuous for that branch —
    // fail loudly so the fixture gets updated instead of silently passing.
    expect(withFraction.length).toBeGreaterThan(0);
    expect(withoutFraction.length).toBeGreaterThan(0);
    for (const [, update] of withoutFraction) {
      expect(update.$unset?.gdpCostFraction).toBe("");
      expect(update.$unset?.incomeCostFraction).toBe("");
    }
  });
});
