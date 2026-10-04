import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { MIGRATIONS } from "./registry";
import { runMigrations } from "./runner";

const MARKET_INDEX_MIGRATION_IDS = [
  "2026-10-04-industry-model-market-indexes",
  "2026-10-04-media-discriminator-market-indexes",
];

describe("bootstrap market identity indexes", () => {
  it("recreates index metadata when reset collections are empty but migration markers remain", async () => {
    const markers = new Set(MARKET_INDEX_MIGRATION_IDS);
    const created: Array<{ collection: string; name: string }> = [];
    const collections = new Map<string, object>();
    const db = {
      collection(name: string) {
        if (name === "migrationsRun") {
          return {
            findOne: vi.fn(async ({ _id }: { _id: string }) =>
              markers.has(_id) ? { _id, completedAt: new Date() } : null
            ),
            replaceOne: vi.fn(async ({ _id }: { _id: string }) => markers.add(_id)),
          };
        }
        if (!collections.has(name)) {
          collections.set(name, {
            createIndex: vi.fn(async (_keys: unknown, options: { name: string }) => {
              created.push({ collection: name, name: options.name });
              return options.name;
            }),
            dropIndex: vi.fn(async () => {
              const error = Object.assign(new Error("index not found"), { code: 27 });
              throw error;
            }),
          });
        }
        return collections.get(name);
      },
    } as unknown as Db;
    const migrations = MIGRATIONS.filter((migration) =>
      MARKET_INDEX_MIGRATION_IDS.includes(migration.id)
    );

    const result = await runMigrations(db, {
      migrations,
      dryRun: false,
      only: MARKET_INDEX_MIGRATION_IDS,
      force: true,
    });

    expect(result.ranIds).toEqual(MARKET_INDEX_MIGRATION_IDS);
    expect(result.skippedIds).toEqual([]);
    expect(created).toContainEqual({
      collection: "corporateSectors",
      name: "corporateSectors_corporation_state_type_models_unique",
    });
    expect(created).toContainEqual({
      collection: "unownedSectors",
      name: "unowned_state_type_models_unique",
    });
    expect(created).toContainEqual({
      collection: "corporateSectors",
      name: "corporateSectors_corporationId_stateId_sectorType_industryModel",
    });
    expect(created).toContainEqual({
      collection: "unownedSectors",
      name: "unowned_state_type_model_unique",
    });
  });
});
