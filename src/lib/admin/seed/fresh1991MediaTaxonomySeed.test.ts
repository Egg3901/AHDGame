import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import {
  completeFresh1991MediaTaxonomySeed,
  convertFresh1991MediaTaxonomyRows,
  prepareFresh1991MediaTaxonomySeed,
} from "./fresh1991MediaTaxonomySeed";

describe("fresh 1991 media taxonomy seed", () => {
  const enabled = { enabled: true, preset: "1991-default", resetReference: true };

  it("defaults to dry run and preflights every economic identity collection", async () => {
    const updates: unknown[] = [];
    const db = {
      collection: (name: string) => ({
        findOne: vi.fn(async () => null),
        countDocuments: vi.fn(async () => 0),
        updateOne: vi.fn(async (...args: unknown[]) => {
          updates.push([name, ...args]);
          return { matchedCount: 1 };
        }),
      }),
    } as unknown as Db;

    const result = await prepareFresh1991MediaTaxonomySeed(db, enabled);

    expect(result).toMatchObject({ enabled: true, ready: true, resumed: false });
    expect(Object.values(result.counts)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(updates).toEqual([]);
  });

  it("rejects populated worlds and requires an explicit 1991 reference reset", async () => {
    const makeDb = (count: number) =>
      ({
        collection: () => ({
          findOne: vi.fn(async () => null),
          countDocuments: vi.fn(async () => count),
          updateOne: vi.fn(),
        }),
      }) as unknown as Db;

    await expect(
      prepareFresh1991MediaTaxonomySeed(makeDb(1), { ...enabled, dryRun: false })
    ).rejects.toThrow("requires empty economic collections");
    await expect(
      prepareFresh1991MediaTaxonomySeed(makeDb(0), { ...enabled, resetReference: false })
    ).rejects.toThrow("requires an explicit 1991 reference reset");
    await expect(
      prepareFresh1991MediaTaxonomySeed(makeDb(0), { ...enabled, preset: "2019-default" })
    ).rejects.toThrow("requires an explicit 1991 reference reset");
  });

  it("rekeys seeded entertainment identities only, retaining ids and fund positions", async () => {
    const collections: Record<string, Array<Record<string, unknown>>> = {
      corporations: [
        {
          _id: "corp-ent",
          type: "entertainment",
          liquidCapital: 80_000,
          issuedShares: 500,
          shareholders: [{ fundId: "fund-1", shares: 200 }],
        },
        { _id: "corp-media", type: "media", liquidCapital: 40_000 },
      ],
      corporateSectors: [
        { _id: "sector-ent", sectorType: "entertainment", capitalStock: 12_000 },
        { _id: "sector-media", sectorType: "media", capitalStock: 6_000 },
      ],
      unownedSectors: [{ _id: "market-ent", sectorType: "entertainment", revenue: 900 }],
      unions: [{ _id: "union-ent", sectorType: "entertainment", treasury: 550 }],
    };
    const writes: Array<{ collection: string; update: unknown }> = [];
    const db = {
      collection: (name: string) => ({
        findOne: vi.fn(async () => ({
          fresh1991MediaTaxonomySeed: {
            preset: "1991-default",
            schema: "media-entertainment-taxonomy-v1",
            status: "in_progress",
          },
        })),
        countDocuments: vi.fn(async (filter: Record<string, string>) => {
          const [key, value] = Object.entries(filter)[0] ?? [];
          return (collections[name] ?? []).filter((row) => row[key] === value).length;
        }),
        updateMany: vi.fn(async (_filter: unknown, update: unknown) => {
          writes.push({ collection: name, update });
          const rows = collections[name] ?? [];
          const key = name === "corporations" ? "type" : "sectorType";
          let modifiedCount = 0;
          for (const row of rows) {
            if (row[key] !== "entertainment") continue;
            Object.assign(row, (update as { $set: Record<string, unknown> }).$set);
            modifiedCount++;
          }
          return { modifiedCount };
        }),
      }),
    } as unknown as Db;
    const before = structuredClone(collections);

    const preview = await convertFresh1991MediaTaxonomyRows(db);
    expect(preview).toMatchObject({ dryRun: true, corporations: 1, corporateSectors: 1 });
    expect(collections).toEqual(before);

    const applied = await convertFresh1991MediaTaxonomyRows(db, { dryRun: false });
    expect(applied).toMatchObject({ dryRun: false, unownedSectors: 1, unions: 1 });
    expect(collections.corporations[0]).toMatchObject({
      _id: "corp-ent",
      type: "media",
      mediaDiscriminator: "entertainment",
      liquidCapital: 80_000,
      issuedShares: 500,
    });
    expect(collections.corporations[0]?.shareholders).toEqual(before.corporations[0]?.shareholders);
    expect(collections.corporations[1]).toEqual(before.corporations[1]);
    expect(collections.corporateSectors[0]).toMatchObject({
      _id: "sector-ent",
      sectorType: "media",
      mediaDiscriminator: "entertainment",
      capitalStock: 12_000,
    });
    expect(collections.unownedSectors[0]).toMatchObject({
      _id: "market-ent",
      sectorType: "media",
      mediaDiscriminator: "entertainment",
      revenue: 900,
    });
    expect(collections.unions[0]).toMatchObject({
      _id: "union-ent",
      sectorType: "media",
      mediaDiscriminator: "entertainment",
      treasury: 550,
    });
    expect(writes).toHaveLength(4);
    expect(applied.identityConservationDeltas).toEqual({
      corporationIds: 0,
      sectorIds: 0,
      unownedMarketIds: 0,
      unionIds: 0,
      fundPositions: 0,
      fundNav: 0,
    });
  });

  it("refuses conversion unless the fresh-seed marker is active", async () => {
    const db = {
      collection: () => ({ findOne: vi.fn(async () => null) }),
    } as unknown as Db;
    await expect(convertFresh1991MediaTaxonomyRows(db)).rejects.toThrow(
      "in-progress fresh 1991 seed marker"
    );
  });

  it("marks completion only after required seed writes succeed", async () => {
    const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
    const db = { collection: () => ({ updateOne }) } as unknown as Db;
    await expect(completeFresh1991MediaTaxonomySeed(db, false)).resolves.toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
    await expect(completeFresh1991MediaTaxonomySeed(db)).resolves.toBe(true);
    expect(updateOne).toHaveBeenCalledWith(
      {
        _id: "default",
        "fresh1991MediaTaxonomySeed.schema": "media-entertainment-taxonomy-v1",
        "fresh1991MediaTaxonomySeed.status": "in_progress",
      },
      { $set: { "fresh1991MediaTaxonomySeed.status": "complete" } }
    );
  });
});
