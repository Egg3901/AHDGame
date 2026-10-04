import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import {
  completeFresh1991VehicleModelSeed,
  convertFresh1991AutomobileSeedRows,
  prepareFresh1991VehicleModelSeed,
} from "./fresh1991VehicleModelSeed";

function fakeDb(counts: Record<string, number> = {}, marker?: unknown) {
  const updates: Array<{ collection: string; filter: unknown; update: unknown }> = [];
  const db = {
    collection: (name: string) => ({
      findOne: vi.fn(async () =>
        name === "gameConfig" ? { _id: "default", fresh1991VehicleModelSeed: marker } : null
      ),
      countDocuments: vi.fn(async () => counts[name] ?? 0),
      updateOne: vi.fn(async (filter: unknown, update: unknown) => {
        updates.push({ collection: name, filter, update });
        return { matchedCount: 1, modifiedCount: 1 };
      }),
    }),
  } as unknown as Db;
  return { db, updates };
}

describe("fresh 1991 vehicle-model seed gate", () => {
  const enabled = { enabled: true, preset: "1991-default", resetReference: true };

  it("defaults to dry-run and requires every economic identity collection to be empty", async () => {
    const { db, updates } = fakeDb();
    const result = await prepareFresh1991VehicleModelSeed(db, enabled);
    expect(result).toMatchObject({ enabled: true, ready: true, resumed: false });
    expect(Object.values(result.counts)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(updates).toEqual([]);
  });

  it("rejects populated worlds before writing a marker", async () => {
    const { db, updates } = fakeDb({ corporateSectors: 1 });
    await expect(
      prepareFresh1991VehicleModelSeed(db, { ...enabled, dryRun: false })
    ).rejects.toThrow("Fresh vehicle-model seed preflight requires empty economic collections");
    expect(updates).toEqual([]);
  });

  it("writes the in-progress marker only after an explicit reset preflight and marks completion", async () => {
    const { db, updates } = fakeDb();
    await prepareFresh1991VehicleModelSeed(db, { ...enabled, dryRun: false });
    expect(updates[0]?.update).toMatchObject({
      $set: {
        fresh1991VehicleModelSeed: {
          preset: "1991-default",
          schema: "manufacturing-vehicles-v1",
          status: "in_progress",
        },
      },
    });
    await completeFresh1991VehicleModelSeed(db);
    expect(updates[1]?.update).toEqual({
      $set: { "fresh1991VehicleModelSeed.status": "complete" },
    });
  });

  it("does not enable on other presets or without the explicit reference reset", async () => {
    const { db } = fakeDb();
    await expect(
      prepareFresh1991VehicleModelSeed(db, { ...enabled, preset: "2019-default" })
    ).rejects.toThrow("requires an explicit 1991 reference reset");
    await expect(
      prepareFresh1991VehicleModelSeed(db, { ...enabled, resetReference: false })
    ).rejects.toThrow("requires an explicit 1991 reference reset");
  });

  it("rekeys only type/model fields on marker-authorized fresh seed rows", async () => {
    const writes: Array<{ collection: string; filter: unknown; update: unknown }> = [];
    const corpRows = [
      {
        _id: "issuer-42",
        type: "automobiles",
        liquidCapital: 42_000,
        sharePrice: 190,
        marketCapitalization: 19_000_000,
        shareholders: [{ corporationId: "fund-holder-8", shares: 100 }],
        issuedShares: 100_000,
      },
    ];
    const sectorRows = [
      {
        _id: "plant-91",
        corporationId: "issuer-42",
        sectorType: "automobiles",
        capitalStock: 5_000,
        capitalBookAnchor: 5_500,
        constructionInProgressAnchor: 250,
        buildQueue: [{ unitsOrdered: 80, costPaidAnchor: 250, onlineTurn: 12 }],
        workers: 900,
        wageLevel: 1.1,
        representingUnionId: "union-auto-1",
      },
    ];
    const db = {
      collection: (name: string) => ({
        findOne: vi.fn(async () => ({
          _id: "default",
          fresh1991VehicleModelSeed: {
            preset: "1991-default",
            schema: "manufacturing-vehicles-v1",
            status: "in_progress",
            startedAt: new Date(),
          },
        })),
        updateMany: vi.fn(async (filter: unknown, update: unknown) => {
          writes.push({ collection: name, filter, update });
          const rows: Record<string, unknown>[] = name === "corporations" ? corpRows : sectorRows;
          const expectedKey = name === "corporations" ? "type" : "sectorType";
          const expectedValue = name === "corporations" ? "automobiles" : "automobiles";
          let modifiedCount = 0;
          for (const row of rows) {
            if (row[expectedKey] !== expectedValue) continue;
            Object.assign(row, (update as { $set: Record<string, unknown> }).$set);
            modifiedCount += 1;
          }
          return { modifiedCount };
        }),
      }),
    } as unknown as Db;

    await expect(convertFresh1991AutomobileSeedRows(db)).resolves.toEqual({
      corporations: 1,
      sectors: 1,
    });
    expect(corpRows[0]).toEqual({
      _id: "issuer-42",
      type: "manufacturing",
      industryModel: "vehicles",
      liquidCapital: 42_000,
      sharePrice: 190,
      marketCapitalization: 19_000_000,
      shareholders: [{ corporationId: "fund-holder-8", shares: 100 }],
      issuedShares: 100_000,
    });
    expect(sectorRows[0]).toEqual({
      _id: "plant-91",
      corporationId: "issuer-42",
      sectorType: "manufacturing",
      industryModel: "vehicles",
      capitalStock: 5_000,
      capitalBookAnchor: 5_500,
      constructionInProgressAnchor: 250,
      buildQueue: [{ unitsOrdered: 80, costPaidAnchor: 250, onlineTurn: 12 }],
      workers: 900,
      wageLevel: 1.1,
      representingUnionId: "union-auto-1",
    });
    expect(writes).toEqual([
      {
        collection: "corporations",
        filter: { type: "automobiles" },
        update: { $set: { type: "manufacturing", industryModel: "vehicles" } },
      },
      {
        collection: "corporateSectors",
        filter: { sectorType: "automobiles" },
        update: { $set: { sectorType: "manufacturing", industryModel: "vehicles" } },
      },
    ]);
  });
});
