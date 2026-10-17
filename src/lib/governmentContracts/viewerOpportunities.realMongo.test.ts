import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { ObjectId } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { listGovernmentTenders } from "./queries";
describe.skipIf(!REAL_MONGO_ENABLED)("viewer contract filter on owned Mongo", () => {
  let fixture: IsolatedMongod;
  beforeAll(async () => {
    fixture = await startIsolatedMongod("government-contract-viewer");
  }, 40000);
  afterAll(async () => {
    if (fixture) await stopIsolatedMongod(fixture);
  });
  it("filters before pagination and does not accept another viewer's corporation id", async () => {
    const db = fixture.db,
      user = new ObjectId(),
      stranger = new ObjectId(),
      corp = new ObjectId(),
      otherCorp = new ObjectId();
    await db.collection("corporations").insertMany([
      { _id: corp, userId: user, type: "extraction", countryId: "US" },
      { _id: otherCorp, userId: stranger, type: "extraction", countryId: "US" },
    ]);
    await db.collection("corporateSectors").insertMany([
      { corporationId: corp, stateId: "TX" },
      { corporationId: otherCorp, stateId: "MN" },
    ]);
    await db.collection("stateResourceCapacity").insertMany([
      { countryId: "US", stateId: "TX", resources: { iron: 10000 } },
      { countryId: "US", stateId: "MN", resources: { iron: 5000 } },
    ]);
    await db.collection("exchangeRates").insertOne({ currencyCode: "USD", rate: 1.25 });
    await db.collection<{ _id: string }>("governmentTenders").insertMany(
      Array.from({ length: 24 }, (_, i) => ({
        _id: new ObjectId().toHexString(),
        countryId: "US",
        publishedTurn: 1,
        closesTurn: 25,
        awardDeadlineTurn: 49,
        status: "open",
        terms: {
          type: "extraction",
          stateId: i < 12 ? "TX" : "MN",
          resource: "iron",
          share: 0.01,
          minimumSigningFeeAnchor: 500,
        },
        bids: { private: { amount: 999, userId: stranger.toHexString() } },
        publishedBy: "private",
        updatedAt: new Date(),
      }))
    );
    const result = await listGovernmentTenders(db, "US", "active", undefined, 2, 5, {
      userId: user.toHexString(),
    });
    expect(result).toMatchObject({ total: 12, totalPages: 2, page: 2, pageSize: 10 });
    expect(result.tenders).toHaveLength(2);
    expect(
      result.tenders.every((r) => r.terms.type === "extraction" && r.terms.stateId === "TX")
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private");
    const foreign = await listGovernmentTenders(db, "US", "active", undefined, 1, 5, {
      userId: user.toHexString(),
      corporationId: otherCorp.toHexString(),
    });
    expect(foreign.total).toBe(0);
  });
});
