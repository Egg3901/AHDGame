import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { migration } from "./2026-10-15-income-tax-policy-parity";

function setup() {
  const memory = createInMemoryDb();
  const policies = [
    {
      _id: new ObjectId(),
      scope: "national",
      stateId: "br_national",
      legislationTypeId: "br_income_tax_rate",
      policyOptionId: "br_18",
      policyOptionIndex: 3,
      economic: 0,
      social: 0,
      effectDirection: 0,
    },
    {
      _id: new ObjectId(),
      scope: "national",
      stateId: "ng_national",
      legislationTypeId: "ng_personal_income_tax",
      policyOptionId: "ng_19",
      policyOptionIndex: 3,
      economic: 0,
      social: 0,
      effectDirection: 1,
    },
  ];
  const budgets = [
    { _id: "BR", countryId: "BR", taxRates: { incomeTax: 22 }, revenue: { incomeTax: 220 } },
    { _id: "NG", countryId: "NG", taxRates: { incomeTax: 24 }, revenue: { incomeTax: 240 } },
  ];
  memory.seed("statePolicies", policies);
  memory.seed("federalBudget", budgets);
  memory.seed("legislationTypes", [
    { _id: "br_income_tax_rate", policyOptions: [{ id: "br_18", rate: 18 }] },
    { _id: "ng_personal_income_tax", policyOptions: [{ id: "ng_19", rate: 19 }] },
  ]);
  return { db: memory as unknown as Db, policies, budgets };
}

describe("income-tax seed repair migration", () => {
  it("repairs both policy rates without changing fiscal or ideological values, and replays safely", async () => {
    const { db, policies, budgets } = setup();
    expect((await migration.execute(db, { dryRun: false })).documentsUpdated).toBe(2);
    const repaired = await db.collection("statePolicies").find({}).toArray();
    expect(repaired).toEqual(
      policies.map((policy, index) => ({
        ...policy,
        policyOptionId: index === 0 ? "rate:22" : "rate:24",
      }))
    );
    expect(await db.collection("federalBudget").find({}).toArray()).toEqual(budgets);
    expect((await migration.execute(db, { dryRun: false })).documentsUpdated).toBe(0);
  });

  it("honors dry-run", async () => {
    const { db, policies } = setup();
    const result = await migration.execute(db, { dryRun: true });
    expect(result.documentsUpdated).toBe(0);
    expect(result.notes?.[0]).toContain("2 seed policies");
    expect(await db.collection("statePolicies").find({}).toArray()).toEqual(policies);
  });

  it.each(["enactedBy", "enactedByBillId", "enactedAt", "enactedTurn"])(
    "preserves a policy carrying %s",
    async (field) => {
      const { db, policies } = setup();
      await db
        .collection("statePolicies")
        .updateOne(
          { _id: policies[0]._id },
          { $set: { [field]: field === "enactedTurn" ? 0 : "existing" } }
        );
      expect((await migration.execute(db, { dryRun: false })).documentsUpdated).toBe(1);
      expect(
        (await db.collection("statePolicies").findOne({ _id: policies[0]._id }))?.policyOptionId
      ).toBe("br_18");
    }
  );

  it("uses pending targets without cancelling their phase-in", async () => {
    const { db, policies } = setup();
    await db
      .collection<{ _id: string; taxRatePhaseIn?: { incomeTax: number } }>("federalBudget")
      .updateOne({ _id: "BR" }, { $set: { "taxRatePhaseIn.incomeTax": 30 } });
    await migration.execute(db, { dryRun: false });
    expect(
      (await db.collection("statePolicies").findOne({ _id: policies[0]._id }))?.policyOptionId
    ).toBe("rate:30");
    expect(
      (
        await db
          .collection<{ _id: string; taxRatePhaseIn?: { incomeTax: number } }>("federalBudget")
          .findOne({ _id: "BR" })
      )?.taxRatePhaseIn
    ).toEqual({
      incomeTax: 30,
    });
  });
});
