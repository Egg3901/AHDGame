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

  it("matches dotted paths into arrays when any element matches", async () => {
    const db = createInMemoryDb();
    db.seed("corps", [
      { _id: "holder", shareholders: [{ corporationId: "tgt", shares: 10 }] },
      { _id: "plain", shareholders: [{ corporationId: "other", shares: 5 }] },
    ]);

    expect(
      await db.collection("corps").countDocuments({ "shareholders.corporationId": "tgt" })
    ).toBe(1);
    expect(
      await db.collection("corps").countDocuments({ "shareholders.corporationId": "missing" })
    ).toBe(0);
  });

  it("pulls array elements by selector and treats a missing element as a no-op", async () => {
    const db = createInMemoryDb();
    db.seed("funds", [
      { _id: "f", holdings: [{ corporationId: "tgt" }, { corporationId: "kept" }] },
    ]);

    const pulled = await db
      .collection("funds")
      .updateOne({ _id: "f" }, { $pull: { holdings: { corporationId: "tgt" } } });
    expect(pulled.matchedCount).toBe(1);
    expect(db.collection("funds").docs[0]).toMatchObject({ holdings: [{ corporationId: "kept" }] });

    const repulled = await db
      .collection("funds")
      .updateOne({ _id: "f" }, { $pull: { holdings: { corporationId: "tgt" } } });
    expect(repulled.matchedCount).toBe(1);
    expect(db.collection("funds").docs[0]).toMatchObject({ holdings: [{ corporationId: "kept" }] });
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

describe("inMemoryDb — query and update operators", () => {
  it("$regex matches strings, honouring $options: 'i'", async () => {
    const db = createInMemoryDb();
    db.seed("parties", [
      { _id: 1, name: "Labour" },
      { _id: 2, name: "Conservative" },
    ]);

    expect(await db.collection("parties").findOne({ name: { $regex: "^Lab" } })).toMatchObject({
      _id: 1,
    });
    expect(
      await db.collection("parties").findOne({ name: { $regex: "^lab", $options: "i" } })
    ).toMatchObject({ _id: 1 });
    expect(await db.collection("parties").findOne({ name: { $regex: "^zz" } })).toBeNull();
  });

  it("$not inverts a nested operator expression", async () => {
    const db = createInMemoryDb();
    db.seed("states", [
      { _id: "CA", houseDistricts: 52 },
      { _id: "WY", houseDistricts: 1 },
    ]);

    const rows = await db
      .collection("states")
      .find({ houseDistricts: { $not: { $gt: 10 } } })
      .toArray();

    expect(rows.map((r) => r._id)).toEqual(["WY"]);
  });

  it("$type matches BSON-ish aliases", async () => {
    const db = createInMemoryDb();
    db.seed("states", [{ _id: "CA", gdp: 3 }, { _id: "TX", gdp: "3" }, { _id: "NY" }]);

    const nums = await db
      .collection("states")
      .find({ gdp: { $type: "number" } })
      .toArray();
    const strs = await db
      .collection("states")
      .find({ gdp: { $type: "string" } })
      .toArray();

    expect(nums.map((r) => r._id)).toEqual(["CA"]);
    expect(strs.map((r) => r._id)).toEqual(["TX"]);
  });

  it("$mul multiplies, treating a missing field as 0", async () => {
    const db = createInMemoryDb();
    db.seed("states", [{ _id: "CA", gdp: 10 }, { _id: "NY" }]);

    await db.collection("states").updateMany({}, { $mul: { gdp: 2 } });

    expect(await db.collection("states").findOne({ _id: "CA" })).toMatchObject({ gdp: 20 });
    expect(await db.collection("states").findOne({ _id: "NY" })).toMatchObject({ gdp: 0 });
  });

  it("bulkWrite accepts replaceOne alongside updateOne and insertOne", async () => {
    const db = createInMemoryDb();
    db.seed("laws", [{ _id: 1, title: "old" }]);

    await db
      .collection("laws")
      .bulkWrite([
        { replaceOne: { filter: { _id: 1 }, replacement: { title: "new" } } },
        { insertOne: { document: { _id: 2, title: "second" } } },
      ]);

    expect(await db.collection("laws").findOne({ _id: 1 })).toEqual({ _id: 1, title: "new" });
    expect(await db.collection("laws").countDocuments()).toBe(2);
  });

  it("still throws on a genuinely unknown operator", async () => {
    // The file's contract: throw on the unrecognised rather than silently match
    // nothing, which is what would let a conservation test pass while lying.
    const db = createInMemoryDb();
    db.seed("x", [{ _id: 1, a: 1 }]);

    await expect(db.collection("x").findOne({ a: { $bogus: 1 } })).rejects.toThrow(
      /unsupported operator/
    );
  });
});

describe("bulkWrite update/delete many", () => {
  it("applies updateMany within a bulk batch", async () => {
    // seedUnions assigns representing unions with a bulk updateMany; without
    // this the whole bootstrap died there.
    const db = createInMemoryDb();
    const coll = db.collection("corporateSectors");
    await coll.insertOne({ countryId: "US", sectorType: "steel", representingUnionId: null });
    await coll.insertOne({ countryId: "US", sectorType: "steel", representingUnionId: null });
    await coll.insertOne({ countryId: "UK", sectorType: "steel", representingUnionId: null });

    const res = await coll.bulkWrite([
      {
        updateMany: {
          filter: { countryId: "US", sectorType: "steel", representingUnionId: null },
          update: { $set: { representingUnionId: "u1" } },
        },
      },
    ]);

    expect(res.modifiedCount).toBe(2);
    expect(res.matchedCount).toBe(2);
    expect(await coll.countDocuments({ representingUnionId: "u1" })).toBe(2);
    expect(await coll.countDocuments({ representingUnionId: null })).toBe(1);
  });

  it("applies deleteMany and deleteOne within a bulk batch", async () => {
    const db = createInMemoryDb();
    const coll = db.collection("things");
    await coll.insertOne({ tag: "a" });
    await coll.insertOne({ tag: "a" });
    await coll.insertOne({ tag: "b" });
    await coll.insertOne({ tag: "b" });

    await coll.bulkWrite([{ deleteMany: { filter: { tag: "a" } } }]);
    expect(await coll.countDocuments({})).toBe(2);

    await coll.bulkWrite([{ deleteOne: { filter: { tag: "b" } } }]);
    expect(await coll.countDocuments({ tag: "b" })).toBe(1);
  });

  it("still refuses an operation it does not model", async () => {
    // The file's invariant: throw rather than silently match nothing.
    const db = createInMemoryDb();
    await expect(
      db.collection("things").bulkWrite([{ replaceMany: { filter: {}, replacement: {} } } as never])
    ).rejects.toThrow(/unsupported bulk op/);
  });
});
