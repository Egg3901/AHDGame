import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { migration } from "./2026-10-16-income-tax-tiers";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
function fixture() {
  const memory = createInMemoryDb();
  memory.seed("gameState", [{ _id: "current", currentTurn: 200, preset: "1991-default" }]);
  memory.seed("federalBudget", [
    {
      _id: "BR",
      countryId: "BR",
      taxRates: { incomeTax: 22 },
      taxRatePhaseIn: { incomeTax: 25 },
      revenue: { incomeTax: 220 },
      treasuryBalance: 77,
    },
  ]);
  memory.seed("stateBudgets", [
    { _id: "BR_SP", countryId: "BR", taxRates: { incomeTax: 5 }, balance: 10 },
  ]);
  memory.seed("states", [{ _id: "BR_SP", countryId: "BR", population: 100 }]);
  memory.seed("characters", [
    { _id: new ObjectId(), demographics: { wealth: "high" }, cashOnHand: 123 },
  ]);
  memory.seed("legislationTypes", [
    {
      _id: "br_tax",
      name: "Income tax",
      countryScope: "br",
      policyDomain: "tax",
      taxRateChange: { scope: "federal", taxType: "incomeTax" },
      policyOptions: [{ id: "a", rate: 22, economic: 0, social: 0 }],
    },
  ]);
  memory.seed("statePolicies", [
    {
      _id: new ObjectId(),
      scope: "national",
      stateId: "br_national",
      legislationTypeId: "br_tax",
      policyOptionId: "a",
      policyOptionIndex: 0,
      economic: 0,
      social: 0,
    },
  ]);
  return { memory, db: memory as unknown as Db };
}
describe("income-tax tier migration", () => {
  it("dry-runs without writing money, rates, characters or policy types", async () => {
    const { memory, db } = fixture();
    const before = JSON.stringify(
      ["characters", "statePolicies", "federalBudget", "stateBudgets", "legislationTypes"].map(
        (name) => memory.collection(name).docs
      )
    );
    expect((await migration.execute(db, { dryRun: true })).documentsUpdated).toBe(0);
    expect(
      JSON.stringify(
        ["characters", "statePolicies", "federalBudget", "stateBudgets", "legislationTypes"].map(
          (name) => memory.collection(name).docs
        )
      )
    ).toBe(before);
  });
  it("preserves revenue, cash, pending targets and the starting character background", async () => {
    const { db } = fixture();
    await migration.execute(db, { dryRun: false });
    expect(await db.collection("federalBudget").findOne({})).toMatchObject({
      taxRates: { incomeTax: 22, incomeTaxLow: 22, incomeTaxMiddle: 22, incomeTaxHigh: 22 },
      taxRatePhaseIn: { incomeTaxLow: 25, incomeTaxMiddle: 25, incomeTaxHigh: 25 },
      revenue: { incomeTax: 220 },
      treasuryBalance: 77,
    });
    expect(
      (await db.collection("federalBudget").findOne({}))?.taxRatePhaseIn.incomeTax
    ).toBeUndefined();
    expect(await db.collection("characters").findOne({})).toMatchObject({
      initialIncomeTier: "high",
      incomeTier: "high",
      incomeTaxStartTurn: 201,
      cashOnHand: 123,
    });
    expect(
      await db.collection("statePolicies").findOne({ legislationTypeId: "br_tax__income_low" })
    ).toMatchObject({ policyOptionId: "rate:25", policyOptionIndex: 0 });
  });
  it("does not overwrite subsequently legislated tier rates or existing character choices on replay", async () => {
    const { db } = fixture();
    await migration.execute(db, { dryRun: false });
    await db
      .collection("federalBudget")
      .updateOne({}, { $set: { "taxRates.incomeTaxLow": 0, "taxRatePhaseIn.incomeTaxHigh": 30 } });
    await db.collection("characters").updateOne({}, { $set: { incomeTier: "middle" } });
    await migration.execute(db, { dryRun: false });
    expect((await db.collection("federalBudget").findOne({}))?.taxRates.incomeTaxLow).toBe(0);
    expect((await db.collection("federalBudget").findOne({}))?.taxRatePhaseIn.incomeTaxHigh).toBe(
      30
    );
    expect((await db.collection("characters").findOne({}))?.initialIncomeTier).toBe("high");
    expect((await db.collection("characters").findOne({}))?.incomeTier).toBe("middle");
    expect(await db.collection("legislationTypes").countDocuments({})).toBe(4);
    expect(await db.collection("statePolicies").countDocuments({})).toBe(4);
  });
});
