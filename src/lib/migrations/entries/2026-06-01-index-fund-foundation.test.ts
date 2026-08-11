import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-06-01-index-fund-foundation";

// Index metadata shape returned by Collection.indexes().
type IdxInfo = {
  key: Record<string, number>;
  name: string;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

/**
 * Minimal stateful fake of the few index operations the migration uses.
 * MockDb does not model index introspection, and the migration's reconcile
 * path is precisely about indexes()/createIndex/dropIndex interplay, so a
 * purpose-built fake is the clearest way to lock the behavior in.
 */
function makeFakeDb(initial: Record<string, IdxInfo[]> = {}) {
  const state: Record<string, IdxInfo[]> = {};
  const created: { collection: string; name: string }[] = [];
  const dropped: { collection: string; name: string }[] = [];

  function collection(name: string) {
    state[name] ??= (initial[name] ?? []).map((i) => ({ ...i }));
    return {
      indexes: async () => state[name].map((i) => ({ ...i })),
      createIndex: async (key: Record<string, number>, opts: IdxInfo) => {
        state[name].push({
          key,
          name: opts.name,
          unique: opts.unique,
          sparse: opts.sparse,
          partialFilterExpression: opts.partialFilterExpression,
        });
        created.push({ collection: name, name: opts.name });
        return opts.name;
      },
      dropIndex: async (indexName: string) => {
        state[name] = state[name].filter((i) => i.name !== indexName);
        dropped.push({ collection: name, name: indexName });
      },
    };
  }

  return { db: { collection } as unknown as Db, state, created, dropped };
}

const run = (db: Db, dryRun = false) => migration.execute(db, { dryRun });

describe("2026-06-01-index-fund-foundation reconcile", () => {
  it("creates every planned index on an empty database and drops nothing", async () => {
    const fake = makeFakeDb();
    const result = await run(fake.db);

    expect(fake.dropped).toHaveLength(0);
    // Every planned index is created exactly once on a clean DB.
    expect(fake.created).toHaveLength(result.documentsScanned ?? 0);
    expect(fake.created.map((c) => c.name)).toContain("idx_indexFunds_slug_unique");
  });

  it("reconciles the seed's divergent index name for the same keys", async () => {
    // Mirrors a fresh bootstrap where seedIndexFundIndexes already created the
    // unique slug index under its own name before this migration runs.
    const fake = makeFakeDb({
      indexFunds: [{ key: { slug: 1 }, name: "indexFunds_slug", unique: true }],
    });

    await run(fake.db);

    expect(fake.dropped).toContainEqual({ collection: "indexFunds", name: "indexFunds_slug" });
    const names = fake.state.indexFunds.map((i) => i.name);
    expect(names).toContain("idx_indexFunds_slug_unique");
    expect(names).not.toContain("indexFunds_slug");
  });

  it("reconciles a same-key index whose options differ (non-unique → unique partial)", async () => {
    // The seed creates the positions index non-unique with no partial filter;
    // this migration owns the unique partial version on the same keys.
    const fake = makeFakeDb({
      indexFundPositions: [
        {
          key: { fundId: 1, holderKind: 1, characterId: 1 },
          name: "indexFundPositions_fund_holder_character",
        },
      ],
    });

    await run(fake.db);

    expect(fake.dropped).toContainEqual({
      collection: "indexFundPositions",
      name: "indexFundPositions_fund_holder_character",
    });
    const canonical = fake.state.indexFundPositions.find(
      (i) => i.name === "idx_indexFundPositions_character_unique"
    );
    expect(canonical?.unique).toBe(true);
    expect(canonical?.partialFilterExpression).toEqual({ characterId: { $exists: true } });
  });

  it("is idempotent — a second run over the canonical set drops and creates nothing", async () => {
    const fake = makeFakeDb();
    await run(fake.db);
    const createdAfterFirst = fake.created.length;
    const droppedAfterFirst = fake.dropped.length;

    await run(fake.db);

    expect(fake.created).toHaveLength(createdAfterFirst);
    expect(fake.dropped).toHaveLength(droppedAfterFirst);
  });

  it("creates indexes when a collection does not exist yet (indexes() throws)", async () => {
    // A fresh world reached via the config-route enable path may not have the
    // index-fund collections yet; indexes() can throw NamespaceNotFound there.
    const created: string[] = [];
    const db = {
      collection: () => ({
        indexes: async () => {
          throw new Error("ns does not exist");
        },
        createIndex: async (_key: Record<string, number>, opts: { name: string }) => {
          created.push(opts.name);
          return opts.name;
        },
        dropIndex: async () => undefined,
      }),
    } as unknown as Db;

    const result = await run(db);

    expect(created).toContain("idx_indexFunds_slug_unique");
    expect(created).toHaveLength(result.documentsScanned ?? 0);
  });

  it("dryRun touches no indexes", async () => {
    const fake = makeFakeDb({
      indexFunds: [{ key: { slug: 1 }, name: "indexFunds_slug", unique: true }],
    });

    const result = await run(fake.db, true);

    expect(fake.created).toHaveLength(0);
    expect(fake.dropped).toHaveLength(0);
    expect((result.notes ?? []).every((n) => n.startsWith("would create"))).toBe(true);
  });
});
