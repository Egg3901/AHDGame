import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-10-04-industry-model-market-indexes";

describe("industry-model market indexes", () => {
  it("builds model-aware unique keys before dropping old guards", async () => {
    const calls: string[] = [];
    const db = {
      collection: (name: string) => ({
        createIndex: vi.fn(async (keys: object, options: { name: string }) => {
          calls.push(`create:${name}:${Object.keys(keys).join(",")}`);
          return options.name;
        }),
        dropIndex: vi.fn(async (name: string) => {
          calls.push(`drop:${name}:${name}`);
        }),
      }),
    } as unknown as Db;
    await migration.execute(db, { dryRun: false });
    expect(calls.slice(0, 3)).toEqual([
      "create:corporateSectors:corporationId,stateId,sectorType,industryModel",
      "create:unownedSectors:stateId,sectorType,industryModel",
      "create:unions:countryId,sectorType,industryModel",
    ]);
    expect(calls.slice(3)).toEqual([
      "drop:corporateSectors_corporationId_stateId_sectorType:corporateSectors_corporationId_stateId_sectorType",
      "drop:stateId_1_sectorType_1:stateId_1_sectorType_1",
      "drop:unions_country_sectorType_seeded_unique:unions_country_sectorType_seeded_unique",
    ]);
  });

  it("dry-runs without creating or dropping indexes", async () => {
    const createIndex = vi.fn();
    const dropIndex = vi.fn();
    const db = {
      collection: () => ({ createIndex, dropIndex }),
    } as unknown as Db;
    const result = await migration.execute(db, { dryRun: true });
    expect(createIndex).not.toHaveBeenCalled();
    expect(dropIndex).not.toHaveBeenCalled();
    expect(result.notes).toHaveLength(6);
  });
});
