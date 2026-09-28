import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import { seedModernTransitionBudgets2027 } from "./seedModernTransitionBudgets2027";

const noop = () => {};

describe("2027 transition fiscal seeding", () => {
  it("persists the authored HU budget without inventing PL or RO budgets", async () => {
    const db = createInMemoryDb() as unknown as Db;
    const source = getInitialNationalBudgetsForPreset("2027-default").find(
      (budget) => budget.countryId === "HU"
    );
    expect(source).toBeDefined();

    await seedModernTransitionBudgets2027(db, true, "2027-default", noop);
    const rows = await db
      .collection<{ countryId: string; gdp: number }>("federalBudget")
      .find({ countryId: { $in: ["HU", "PL", "RO"] } })
      .toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.countryId).toBe("HU");
    expect(rows[0]?.gdp).toBe(source?.gdp);

    await seedModernTransitionBudgets2027(db, false, "2027-default", noop);
    expect(await db.collection("federalBudget").countDocuments({ countryId: "HU" })).toBe(1);
  });

  it("does not seed a modern budget in 1991", async () => {
    const db = createInMemoryDb() as unknown as Db;
    await seedModernTransitionBudgets2027(db, true, "1991-default", noop);
    expect(await db.collection("federalBudget").countDocuments({})).toBe(0);
  });
});
