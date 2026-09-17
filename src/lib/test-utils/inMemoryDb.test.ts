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

    expect(await db.collection("corps").countDocuments({ "shareholders.corporationId": "tgt" })).toBe(1);
    expect(
      await db.collection("corps").countDocuments({ "shareholders.corporationId": "missing" })
    ).toBe(0);
  });

  it("pulls array elements by selector and treats a missing element as a no-op", async () => {
    const db = createInMemoryDb();
    db.seed("funds", [{ _id: "f", holdings: [{ corporationId: "tgt" }, { corporationId: "kept" }] }]);

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
