import { describe, it, expect } from "vitest";
import { makeStrictInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import { MAX_QUERY_LIMIT, runCount, runDistinct, runQuery } from "./inspect";

function seed() {
  return makeStrictInMemoryStore({
    widgets: [
      { _id: "w1", kind: "a", bad: true },
      { _id: "w2", kind: "b", bad: true },
      { _id: "w3", kind: "a", bad: false },
    ],
  });
}

describe("runQuery", () => {
  it("returns matched and returned counts separately", async () => {
    const { db } = seed();
    const result = await runQuery(db, { collection: "widgets", filter: { bad: true } });
    expect(result.matched).toBe(2);
    expect(result.returned).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("caps the limit so a query cannot pull a whole collection into a response", async () => {
    const { db } = seed();
    const result = await runQuery(db, { collection: "widgets", limit: 10_000 });
    expect(result.returned).toBeLessThanOrEqual(MAX_QUERY_LIMIT);
  });

  it("needs a collection", async () => {
    const { db } = seed();
    await expect(runQuery(db, { collection: "" })).rejects.toThrow(/needs a collection/);
  });

  describe("server-side code execution", () => {
    const banned = [
      { $where: "this.bad === true" },
      { $expr: { $function: { body: "function(){}", args: [], lang: "js" } } },
      { kind: { $function: { body: "x" } } },
    ];

    it.each(banned)("refuses %j", async (filter) => {
      const { db } = seed();
      await expect(
        runQuery(db, { collection: "widgets", filter: filter as Record<string, unknown> })
      ).rejects.toThrow(/not permitted/);
    });
  });
});

describe("runCount", () => {
  it("counts", async () => {
    const { db } = seed();
    expect(await runCount(db, "widgets", { bad: true })).toBe(2);
    expect(await runCount(db, "widgets")).toBe(3);
  });

  it("refuses $where", async () => {
    const { db } = seed();
    await expect(runCount(db, "widgets", { $where: "1" })).rejects.toThrow(/not permitted/);
  });
});

describe("runDistinct", () => {
  it("refuses $where", async () => {
    const { db } = seed();
    await expect(runDistinct(db, "widgets", "kind", { $where: "1" })).rejects.toThrow(
      /not permitted/
    );
  });
});
