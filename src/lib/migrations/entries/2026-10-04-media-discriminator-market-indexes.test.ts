import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-10-04-media-discriminator-market-indexes";

describe("media-discriminator market indexes", () => {
  it("creates the extended identity keys before replacing prior guards", async () => {
    const calls: string[] = [];
    const db = {
      collection: (name: string) => ({
        createIndex: vi.fn(async (keys: object, options: { name: string }) => {
          calls.push(`create:${name}:${Object.keys(keys).join(",")}`);
          return options.name;
        }),
        dropIndex: vi.fn(async (name: string) => {
          calls.push(`drop:${name}`);
        }),
      }),
    } as unknown as Db;

    const result = await migration.execute(db, { dryRun: false });

    expect(calls.slice(0, 3)).toEqual([
      "create:corporateSectors:corporationId,stateId,sectorType,industryModel,mediaDiscriminator",
      "create:unownedSectors:stateId,sectorType,industryModel,mediaDiscriminator",
      "create:unions:countryId,sectorType,industryModel,mediaDiscriminator",
    ]);
    expect(calls.slice(3)).toEqual([
      "drop:corporateSectors_corporationId_stateId_sectorType_industryModel",
      "drop:corporateSectors_corporationId_stateId_sectorType",
      "drop:unowned_state_type_model_unique",
      "drop:stateId_1_sectorType_1",
      "drop:unions_country_type_model_seeded_unique",
      "drop:unions_country_sectorType_seeded_unique",
      "drop:unions_country_sectorType_unique",
    ]);
    expect(calls.findIndex((call) => call.startsWith("drop:"))).toBe(3);
    expect(result.documentsScanned).toBe(0);
    expect(result.documentsUpdated).toBe(0);
    expect(result.notes?.[0]).toBe("index plans processed: 3");
  });

  it("defaults to a no-write dry run", async () => {
    const createIndex = vi.fn();
    const dropIndex = vi.fn();
    const db = {
      collection: () => ({ createIndex, dropIndex }),
    } as unknown as Db;

    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(dropIndex).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
    expect(result.documentsScanned).toBe(0);
    expect(result.notes).toHaveLength(11);
  });
});
