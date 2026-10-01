import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/admin/seed/indexes/plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/seed/indexes/plan")>();
  return {
    ...actual,
    collectSeedIndexPlan: vi.fn(async () => [
      { collection: "logs", key: { a: "text" }, options: { name: "logs_text" } },
      {
        collection: "logs",
        key: { expiresAt: 1 },
        options: { name: "logs_ttl", expireAfterSeconds: 0 },
      },
      { collection: "plays", key: { k: 1 }, options: { name: "plays_unique", unique: true } },
      { collection: "orders", key: { s: 1 }, options: { name: "orders_ok_unique", unique: true } },
      { collection: "orders", key: { t: 1 }, options: { name: "orders_turn" } },
    ]),
  };
});

describe("2026-10-01-reconcile-seed-indexes migration", () => {
  function mockDb() {
    const createIndex = vi.fn(async () => "ok");
    const db = {
      collection: (name: string) => ({
        indexes: async () => [{ key: { _id: 1 } }],
        createIndex,
        aggregate: () => ({
          toArray: async () => (name === "plays" ? [{ duplicates: 3 }] : []),
        }),
      }),
    } as unknown as Db;
    return { db, createIndex };
  }

  it("creates plain and duplicate-free unique indexes, and skips text, TTL and duplicate-blocked unique", async () => {
    const { migration } =
      await import("@/lib/migrations/entries/2026-10-01-reconcile-seed-indexes");
    const { db, createIndex } = mockDb();
    const result = await migration.execute(db, { dryRun: false });
    const created = createIndex.mock.calls.map(
      (call) => (call as unknown[])[1] as { name: string }
    );
    expect(created.map((o) => o.name)).toEqual(["orders_ok_unique", "orders_turn"]);
    const notes = (result.notes ?? []).join("\n");
    expect(notes).toMatch(/skipped logs\.logs_text: text/);
    expect(notes).toMatch(/skipped logs\.logs_ttl: TTL/);
    expect(notes).toMatch(/skipped plays\.plays_unique: 3 duplicate/);
    expect(result.documentsUpdated).toBe(2);
  });

  it("writes nothing on a dry run", async () => {
    const { migration } =
      await import("@/lib/migrations/entries/2026-10-01-reconcile-seed-indexes");
    const { db, createIndex } = mockDb();
    const result = await migration.execute(db, { dryRun: true });
    expect(createIndex).not.toHaveBeenCalled();
    expect((result.notes ?? []).filter((n) => n.startsWith("would create"))).toHaveLength(2);
  });
});
