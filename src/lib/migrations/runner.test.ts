import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { runMigrations } from "./runner";
import type { Migration } from "./types";

function makeMockDb(initialMarkers: { _id: string; completedAt: Date }[] = []): {
  db: Db;
  markers: Map<string, { _id: string; completedAt: Date; [k: string]: unknown }>;
} {
  const markers = new Map<string, { _id: string; completedAt: Date; [k: string]: unknown }>(
    initialMarkers.map((m) => [m._id, m])
  );
  const db = {
    collection: () => ({
      findOne: async ({ _id }: { _id: string }) => markers.get(_id) ?? null,
      insertOne: async (doc: { _id: string; completedAt: Date; [k: string]: unknown }) => {
        // Real Mongo throws E11000 on a duplicate _id; the runner must not
        // depend on insert semantics for the forced-rerun path.
        if (markers.has(doc._id)) throw new Error(`E11000 duplicate key: ${doc._id}`);
        markers.set(doc._id, doc);
        return { acknowledged: true, insertedId: doc._id };
      },
      replaceOne: async (
        { _id }: { _id: string },
        doc: { _id: string; completedAt: Date; [k: string]: unknown },
        opts?: { upsert?: boolean }
      ) => {
        const existed = markers.has(_id);
        if (existed || opts?.upsert === true) markers.set(_id, doc);
        return { acknowledged: true, matchedCount: existed ? 1 : 0 };
      },
    }),
  } as unknown as Db;
  return { db, markers };
}

function makeMigration(
  id: string,
  opts: { idempotent?: boolean; execute?: Migration["execute"] } = {}
): Migration {
  return {
    id,
    description: `${id} description`,
    idempotent: opts.idempotent ?? true,
    execute: opts.execute ?? vi.fn().mockResolvedValue({ documentsUpdated: 1 }),
  };
}

describe("runMigrations", () => {
  it("runs migrations in registry order", async () => {
    const calls: string[] = [];
    const migrations = [
      makeMigration("a", {
        execute: async () => {
          calls.push("a");
          return {};
        },
      }),
      makeMigration("b", {
        execute: async () => {
          calls.push("b");
          return {};
        },
      }),
    ];
    const { db } = makeMockDb();

    const summary = await runMigrations(db, { migrations, dryRun: false });

    expect(calls).toEqual(["a", "b"]);
    expect(summary.ranIds).toEqual(["a", "b"]);
    expect(summary.skippedIds).toEqual([]);
  });

  it("skips migrations whose marker already exists", async () => {
    const calls: string[] = [];
    const migrations = [
      makeMigration("a", {
        execute: async () => {
          calls.push("a");
          return {};
        },
      }),
      makeMigration("b", {
        execute: async () => {
          calls.push("b");
          return {};
        },
      }),
    ];
    const { db } = makeMockDb([{ _id: "a", completedAt: new Date() }]);

    const summary = await runMigrations(db, { migrations, dryRun: false });

    expect(calls).toEqual(["b"]);
    expect(summary.ranIds).toEqual(["b"]);
    expect(summary.skippedIds).toEqual(["a"]);
  });

  it("writes a marker after each successful run", async () => {
    const migrations = [makeMigration("a", { execute: async () => ({ documentsUpdated: 5 }) })];
    const { db, markers } = makeMockDb();

    await runMigrations(db, { migrations, dryRun: false });

    expect(markers.has("a")).toBe(true);
    expect(markers.get("a")?.completedAt).toBeInstanceOf(Date);
  });

  it("does NOT write a marker on dry-run", async () => {
    const migrations = [makeMigration("a")];
    const { db, markers } = makeMockDb();

    await runMigrations(db, { migrations, dryRun: true });

    expect(markers.has("a")).toBe(false);
  });

  it("passes dryRun: true to executes when in dry-run mode", async () => {
    const seen: boolean[] = [];
    const migrations = [
      makeMigration("a", {
        execute: async (_db, ctx) => {
          seen.push(ctx.dryRun);
          return {};
        },
      }),
    ];
    const { db } = makeMockDb();

    await runMigrations(db, { migrations, dryRun: true });

    expect(seen).toEqual([true]);
  });

  it("respects --only filter (runs the named migration even if later in order, skips others)", async () => {
    const calls: string[] = [];
    const migrations = [
      makeMigration("a", {
        execute: async () => {
          calls.push("a");
          return {};
        },
      }),
      makeMigration("b", {
        execute: async () => {
          calls.push("b");
          return {};
        },
      }),
      makeMigration("c", {
        execute: async () => {
          calls.push("c");
          return {};
        },
      }),
    ];
    const { db } = makeMockDb();

    await runMigrations(db, { migrations, dryRun: false, only: ["b"] });

    expect(calls).toEqual(["b"]);
  });

  it("respects --from filter (runs from the named migration onward)", async () => {
    const calls: string[] = [];
    const migrations = [
      makeMigration("a", {
        execute: async () => {
          calls.push("a");
          return {};
        },
      }),
      makeMigration("b", {
        execute: async () => {
          calls.push("b");
          return {};
        },
      }),
      makeMigration("c", {
        execute: async () => {
          calls.push("c");
          return {};
        },
      }),
    ];
    const { db } = makeMockDb();

    await runMigrations(db, { migrations, dryRun: false, from: "b" });

    expect(calls).toEqual(["b", "c"]);
  });

  it("fails fast: throws on the first migration error and stops", async () => {
    const calls: string[] = [];
    const migrations = [
      makeMigration("a", {
        execute: async () => {
          calls.push("a");
          return {};
        },
      }),
      makeMigration("b", {
        execute: async () => {
          calls.push("b");
          throw new Error("boom");
        },
      }),
      makeMigration("c", {
        execute: async () => {
          calls.push("c");
          return {};
        },
      }),
    ];
    const { db } = makeMockDb();

    await expect(runMigrations(db, { migrations, dryRun: false })).rejects.toThrow(/boom/);
    expect(calls).toEqual(["a", "b"]);
  });

  it("skips a migration when its marker exists, regardless of idempotency", async () => {
    const calls: string[] = [];
    const migrations = [
      makeMigration("a", {
        idempotent: false,
        execute: async () => {
          calls.push("a");
          return {};
        },
      }),
    ];
    const { db } = makeMockDb([{ _id: "a", completedAt: new Date() }]);

    const summary = await runMigrations(db, { migrations, dryRun: false });

    expect(calls).toEqual([]);
    expect(summary.skippedIds).toEqual(["a"]);
  });

  it("--force with --only re-runs an idempotent migration whose marker exists", async () => {
    const calls: string[] = [];
    const migrations = [
      makeMigration("a", {
        idempotent: true,
        execute: async () => {
          calls.push("a");
          return {};
        },
      }),
    ];
    const { db } = makeMockDb([{ _id: "a", completedAt: new Date() }]);

    await runMigrations(db, { migrations, dryRun: false, only: ["a"], force: true });

    expect(calls).toEqual(["a"]);
  });

  it("throws when --from references an unknown id", async () => {
    const migrations = [makeMigration("a")];
    const { db } = makeMockDb();

    await expect(runMigrations(db, { migrations, dryRun: false, from: "nope" })).rejects.toThrow(
      /--from/
    );
  });
});
