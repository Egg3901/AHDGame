/** Owned, isolated mongod proof; never reads a configured or production URI. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { withPartyTerritoryMutation } from "./territoryMutation";
import { getPartyFrontier } from "./partyFrontier";

describe.skipIf(!REAL_MONGO_ENABLED)("party territory claims on real Mongo", () => {
  let fixture: IsolatedMongod;
  let db: Db;
  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-party-territory-");
    db = fixture.db;
  }, 40_000);
  afterAll(async () => {
    if (fixture) await stopIsolatedMongod(fixture);
  });
  it("admits one of two overlapping writers and releases only its own token", async () => {
    await db
      .collection("politicalParties")
      .insertOne({ _id: new ObjectId(), countryId: "US", sequentialId: 1 });
    const party = { countryId: "US", partyId: "1" } as const;
    let entered!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = withPartyTerritoryMutation(db, [party], async () => {
      entered();
      await gate;
      return "first";
    });
    await ready;
    try {
      await expect(
        withPartyTerritoryMutation(db, [{ ...party, partyId: "01alias" }], async () => "second")
      ).rejects.toThrow("in progress");
      expect(
        await db
          .collection("politicalParties")
          .countDocuments({ territoryMutation: { $exists: true } })
      ).toBe(1);
    } finally {
      finish();
      await first;
    }
    expect(
      await db
        .collection("politicalParties")
        .countDocuments({ territoryMutation: { $exists: true } })
    ).toBe(0);
  });
  it("a real last-member departure changes the next live frontier immediately", async () => {
    await db
      .collection<{ _id: string; countryId: string }>("states")
      .insertMany(["WA", "OR", "CA", "AZ"].map((_id) => ({ _id, countryId: "US" })));
    const member = new ObjectId();
    await db.collection("characters").insertMany([
      { _id: new ObjectId(), countryId: "US", homeState: "WA", party: "1" },
      { _id: member, countryId: "US", homeState: "OR", party: "1" },
      { _id: new ObjectId(), countryId: "US", homeState: "CA", party: "1" },
    ]);
    expect((await getPartyFrontier(db, "US", "1")).frontier.has("AZ")).toBe(true);
    await withPartyTerritoryMutation(db, [{ countryId: "US", partyId: "1" }], async () => {
      await db
        .collection("characters")
        .updateOne({ _id: member }, { $set: { party: "independent" } });
    });
    const after = await getPartyFrontier(db, "US", "1");
    expect(after.frontier.has("AZ")).toBe(false);
    expect(after.frontier.has("OR")).toBe(true);
  });
});
