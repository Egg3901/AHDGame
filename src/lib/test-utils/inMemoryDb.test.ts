import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "./inMemoryDb";

describe("inMemoryDb document paths", () => {
  it("applies ordinary nested updates", async () => {
    const db = createInMemoryDb();
    db.seed("items", [{ _id: "one", nested: { value: 1 } }]);

    await db
      .collection("items")
      .updateOne({ _id: "one" }, { $set: { "nested.value": 2, "nested.extra": true } });

    expect(db.collection("items").docs[0]).toMatchObject({
      nested: { value: 2, extra: true },
    });
  });

  it.each(["__proto__.polluted", "constructor.prototype.polluted"])(
    "rejects prototype-polluting update path %s",
    async (path) => {
      const db = createInMemoryDb();
      db.seed("items", [{ _id: "one" }]);

      await expect(
        db.collection("items").updateOne({ _id: "one" }, { $set: { [path]: true } })
      ).rejects.toThrow("unsafe document path");
      expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    }
  );
});

describe("inMemoryDb — driver surface used by bootstrapGameWorld", () => {
  it("findOneAndUpdate honours upsert and returns the new doc", async () => {
    const db = createInMemoryDb();
    const res = await db
      .collection("counters")
      .findOneAndUpdate(
        { _id: "party_US" },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" }
      );
    expect(res).toMatchObject({ _id: "party_US", seq: 1 });

    const again = await db
      .collection("counters")
      .findOneAndUpdate(
        { _id: "party_US" },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" }
      );
    expect(again).toMatchObject({ seq: 2 });
  });

  it("replaceOne swaps the body but keeps _id", async () => {
    const db = createInMemoryDb();
    db.seed("budgets", [{ _id: "US", fiscalYear: 1991, gdp: 1 }]);

    const res = await db
      .collection("budgets")
      .replaceOne({ _id: "US" }, { fiscalYear: 2019, gdp: 2 });

    expect(res.modifiedCount).toBe(1);
    expect(await db.collection("budgets").findOne({ _id: "US" })).toEqual({
      _id: "US",
      fiscalYear: 2019,
      gdp: 2,
    });
  });

  it("replaceOne upserts when asked and nothing matches", async () => {
    const db = createInMemoryDb();

    const res = await db
      .collection("budgets")
      .replaceOne({ _id: "UK" }, { gdp: 3 }, { upsert: true });

    expect(res.upsertedCount).toBe(1);
    expect(await db.collection("budgets").findOne({ _id: "UK" })).toEqual({ _id: "UK", gdp: 3 });
  });

  it("distinct returns unique values, filtered", async () => {
    const db = createInMemoryDb();
    db.seed("militaryUnits", [
      { _id: 1, countryId: "US", branch: "army" },
      { _id: 2, countryId: "US", branch: "army" },
      { _id: 3, countryId: "US", branch: "navy" },
      { _id: 4, countryId: "UK", branch: "raf" },
    ]);

    const branches = await db.collection("militaryUnits").distinct("branch", { countryId: "US" });

    expect([...branches].sort()).toEqual(["army", "navy"]);
  });

  it("indexes() resolves to an array so callers can .catch()", async () => {
    const db = createInMemoryDb();
    await expect(db.collection("crises").indexes()).resolves.toEqual([]);
  });

  it("find() cursor is async-iterable", async () => {
    const db = createInMemoryDb();
    db.seed("users", [{ _id: 1 }, { _id: 2 }]);

    const seen: unknown[] = [];
    for await (const doc of db.collection("users").find({})) seen.push(doc);

    expect(seen).toHaveLength(2);
  });
});
