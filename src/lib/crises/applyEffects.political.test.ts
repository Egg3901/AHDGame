import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { applyCrisisEffects } from "./applyEffects";
import type { CrisisEffect } from "@/lib/db/types/crisis";

/**
 * A crisis's POLITICAL effects. These were collected and then dropped for the
 * whole cutover — an earthquake moved macro metrics and approval, and did
 * nothing to infrastructure or public safety.
 */
const metricEffect = (metricCategory: string, metricField: string, value: number): CrisisEffect =>
  ({ targetType: "metric", metricCategory, metricField, value }) as unknown as CrisisEffect;

describe("applyCrisisEffects — political half", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("macroMetrics");
    db.collection("politicalMetrics");
  });

  function boardWrites() {
    const calls = db.collectionMocks.politicalMetrics!.bulkWrite.mock.calls;
    return calls.flatMap(
      (c) =>
        c[0] as Array<{
          updateOne: {
            filter: { _id: string };
            update: { $set: { values: Record<string, number> } };
          };
        }>
    );
  }

  it("lands an infrastructure crisis on the board family, as a VALUE", async () => {
    // Asserting the WRITTEN VALUE, not that an update was issued: a dotted
    // `$inc` would have been issued too and silently done nothing.
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([
        { _id: "CA", countryId: "US", values: { "infrastructure.condition": 60 } },
      ]);

    await applyCrisisEffects(
      db as unknown as Db,
      [metricEffect("infrastructure", "roadCondition", -8)],
      ["CA"],
      ["US"]
    );

    const written = boardWrites();
    expect(written.length).toBeGreaterThan(0);
    const set = written[0].updateOne.update.$set;
    // Damage, so the family must move DOWN from its seeded 60.
    expect(set.values["infrastructure.condition"]).toBeLessThan(60);
    // VALUE, not residual: a crisis heals, it does not redefine the country.
    expect((set as Record<string, unknown>).residuals).toBeUndefined();
  });

  it("still routes the macro half to macroMetrics", async () => {
    db.collection("politicalMetrics").find().toArray.mockResolvedValue([]);
    await applyCrisisEffects(
      db as unknown as Db,
      [metricEffect("economic", "unemploymentRate", 2)],
      ["CA"],
      ["US"]
    );
    const call = db.collectionMocks.macroMetrics!.updateMany.mock.calls[0];
    expect((call[1] as { $inc: Record<string, number> }).$inc).toMatchObject({
      "economic.unemploymentRate.value": 2,
    });
    expect(db.collectionMocks.politicalMetrics!.bulkWrite).not.toHaveBeenCalled();
  });

  it("routes one-time GDP rate interactions through the engine input channel", async () => {
    db.collection("politicalMetrics").find().toArray.mockResolvedValue([]);
    await applyCrisisEffects(
      db as unknown as Db,
      [metricEffect("economic", "gdpGrowth", -0.75)],
      ["CA"],
      ["US"]
    );

    const call = db.collectionMocks.macroMetrics!.updateMany.mock.calls[0];
    expect((call[1] as { $inc: Record<string, number> }).$inc).toEqual({
      "economic.sectorGrowth.value": -0.75,
    });
    expect(
      (call[1] as { $inc: Record<string, number> }).$inc["economic.gdpGrowth.value"]
    ).toBeUndefined();
  });

  it("hits every targeted region, not just the first", async () => {
    db.collection("politicalMetrics")
      .find()
      .toArray.mockImplementation(() =>
        Promise.resolve([{ _id: "CA", countryId: "US", values: { "order.safety": 50 } }])
      );
    await applyCrisisEffects(
      db as unknown as Db,
      [metricEffect("publicSafety", "crimeRate", 400)],
      ["CA", "TX"],
      ["US"]
    );
    const targeted = db.collectionMocks.politicalMetrics!.find.mock.calls.map(
      (c) => (c[0] as { _id?: string })?._id
    );
    expect(targeted).toEqual(expect.arrayContaining(["CA", "TX"]));
  });

  it("drops a legacy path the adapter has no family for, rather than guessing", async () => {
    // ADAPTER_TIER1 is the reviewed legacy<->family correspondence. Inventing a
    // mapping for a path it omits would fabricate a channel nobody designed.
    db.collection("politicalMetrics").find().toArray.mockResolvedValue([]);
    await applyCrisisEffects(
      db as unknown as Db,
      [metricEffect("governance", "notARealMetric", -5)],
      ["CA"],
      ["US"]
    );
    expect(db.collectionMocks.politicalMetrics!.bulkWrite).not.toHaveBeenCalled();
  });
});
