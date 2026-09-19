import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppropriationSettlement } from "@/lib/military/appropriation";
import { applyAppropriationSettlementWithOverdraft } from "@/lib/db/collections/defenseAppropriation";

const uri = process.env.MONGODB_URI;
const parsedUri = uri ? new URL(uri) : null;
const canRun = Boolean(
  parsedUri &&
  (parsedUri.hostname === "127.0.0.1" || parsedUri.hostname === "localhost") &&
  parsedUri.port === "27018"
);
const suite = canRun ? describe : describe.skip;

suite("defense appropriation same-document CAS", () => {
  let client: MongoClient;
  const countryId = `CAS_${process.pid}_${Date.now()}`;
  const dbName = `ahd_atomic_defense_${process.pid}_${Date.now()}`;

  beforeAll(async () => {
    client = new MongoClient(uri!);
    await client.connect();
    await client
      .db(dbName)
      .collection("federalBudget")
      .insertOne({
        countryId,
        treasuryBalance: 1_000,
        gdp: 100_000,
        debt: { principal: 0, ceiling: 1_000_000 },
        defenseAppropriation: { balance: 10, accruedThroughTurn: 4, arrearsRatio: 0 },
      });
  });

  afterAll(async () => {
    await client.db(dbName).collection("federalBudget").deleteOne({ countryId });
    await client.close();
  });

  it("allows one winner and one loser without double debiting treasury", async () => {
    const db = client.db(dbName);
    const settlement = {
      delta: -15,
      overdraftDrawn: 5,
      arrearsRatio: 0.1,
      balance: 0,
      accrued: 0,
      paid: 10,
    } as AppropriationSettlement;
    const budget = await db.collection("federalBudget").findOne({ countryId });
    expect(budget).not.toBeNull();

    const results = await Promise.all([
      applyAppropriationSettlementWithOverdraft(
        db,
        countryId,
        5,
        settlement,
        budget!.treasuryBalance as number,
        budget!.defenseAppropriation.balance as number,
        budget as never
      ),
      applyAppropriationSettlementWithOverdraft(
        db,
        countryId,
        5,
        settlement,
        budget!.treasuryBalance as number,
        budget!.defenseAppropriation.balance as number,
        budget as never
      ),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await db.collection("federalBudget").findOne({ countryId });
    expect(after?.treasuryBalance).toBe(995);
    expect(after?.defenseAppropriation?.balance).toBe(-5);
    expect(after?.defenseAppropriation?.accruedThroughTurn).toBe(5);
  });
});
