import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { MIGRATIONS } from "./registry";
import { runMigrations } from "./runner";

const MARKET_INDEX_MIGRATION_IDS = ["2026-10-04-media-discriminator-market-indexes"];

describe("bootstrap market identity indexes", () => {
  it("replays only five-key guards over existing multi-lane rows when markers remain", async () => {
    const markers = new Set(MARKET_INDEX_MIGRATION_IDS);
    const calls: string[] = [];
    const existingRows = [
      {
        corporationId: "corp-1",
        stateId: "state-1",
        sectorType: "media",
        industryModel: "generic",
        mediaDiscriminator: "film",
      },
      {
        corporationId: "corp-1",
        stateId: "state-1",
        sectorType: "media",
        industryModel: "generic",
        mediaDiscriminator: "publishing",
      },
    ];
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
            createIndex: vi.fn(async (keys: Record<string, number>, options: { name: string }) => {
              if (
                name === "corporateSectors" &&
                options.name.includes("industryModel") &&
                !("mediaDiscriminator" in keys)
              ) {
                const duplicate = existingRows[0];
                if (
                  existingRows.some(
                    (row) =>
                      row.corporationId === duplicate?.corporationId &&
                      row.stateId === duplicate?.stateId &&
                      row.sectorType === duplicate?.sectorType &&
                      row.industryModel === duplicate?.industryModel
                  )
                ) {
                  throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
                }
              }
              calls.push(`create:${name}:${options.name}`);
              return options.name;
            }),
            dropIndex: vi.fn(async () => {
              calls.push(`drop:${name}`);
              const error = Object.assign(new Error("index not found"), { code: 27 });
              throw error;
            }),
            find: vi.fn(() => existingRows),
            updateMany: vi.fn(() => {
              throw new Error("market-index replay must not write economic rows");
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
    expect(calls.filter((call) => call.startsWith("create:"))).toEqual([
      "create:corporateSectors:corporateSectors_corporation_state_type_models_unique",
      "create:unownedSectors:unowned_state_type_models_unique",
      "create:unions:unions_country_type_models_seeded_unique",
    ]);
    expect(calls.findIndex((call) => call.startsWith("drop:"))).toBe(3);
    expect(calls).not.toContain(
      "create:corporateSectors:corporateSectors_corporationId_stateId_sectorType_industryModel"
    );
    expect(markers).toEqual(new Set(MARKET_INDEX_MIGRATION_IDS));
    expect(existingRows).toHaveLength(2);
  });
});
