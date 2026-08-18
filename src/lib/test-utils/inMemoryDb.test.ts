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
