import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  CONTRACT_ID,
  DEFECT_ID,
  RESTORED_PROTECTION,
  UNIT_ID,
  defect,
} from "./AHD-1171-us-marine-lot-progress";

function productionIncidentDb(): Db {
  const contract = {
    _id: new ObjectId(CONTRACT_ID),
    countryId: "US",
    component: "marine",
    lotsOrdered: 1,
    lotsDelivered: 1,
    amountPaid: 151_500_000,
    status: "complete",
  };
  const unit = {
    _id: new ObjectId(UNIT_ID),
    countryId: "US",
    domain: "marine",
    type: "Marine Division",
    equipment: { firepower: 3, protection: 2, support: 3 },
  };
  const arsenal = { countryId: "US", stock: { marine: 0 } };

  return {
    collection: (name: string) => ({
      findOne: async () =>
        name === "defenceContracts" ? contract : name === "militaryUnits" ? unit : arsenal,
      updateOne: async (_filter: unknown, update: { $set?: Record<string, number> }) => {
        if (name !== "militaryUnits" || update.$set?.["equipment.protection"] == null) {
          return { matchedCount: 0, modifiedCount: 0 };
        }
        unit.equipment.protection = update.$set["equipment.protection"];
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
  } as unknown as Db;
}

const context = { env: "prod", dryRun: true, now: new Date("2026-08-23T00:00:00Z") } as const;

describe("AHD-1171 US marine lot progress remediation", () => {
  it("detects, repairs, and verifies the exact audited production incident", async () => {
    const db = productionIncidentDb();
    expect((await defect.detect(db, context)).affected).toBe(1);
    const plan = await defect.plan(db, context);
    expect(plan).toMatchObject({ affected: 1, moneyDelta: 0 });
    expect((await defect.apply(db, plan, { ...context, dryRun: false })).documentsUpdated).toBe(1);
    expect(await defect.verify(db, context)).toMatchObject({ ok: true, remaining: 0 });
  });

  it("is a production-only, capped, money-conserving, idempotent heal", () => {
    expect(defect.id).toBe(DEFECT_ID);
    expect(defect.envs).toEqual(["prod"]);
    expect(defect.idempotent).toBe(true);
    expect(defect.guards).toEqual(
      expect.arrayContaining(["turn-lock-free", "money-conserving", "max-affected:1"])
    );
    expect(RESTORED_PROTECTION).toBe(2.75);
  });
});
