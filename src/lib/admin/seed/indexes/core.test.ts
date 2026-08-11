import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureIndexMock, normalizeAndMergeCorporateSectorsMock } = vi.hoisted(() => ({
  ensureIndexMock: vi.fn(),
  normalizeAndMergeCorporateSectorsMock: vi.fn(),
}));

vi.mock("./helpers", () => ({
  ensureIndex: ensureIndexMock,
}));

vi.mock("@/lib/corporations/repairDuplicateSectors", () => ({
  normalizeAndMergeCorporateSectors: normalizeAndMergeCorporateSectorsMock,
}));

import { seedCoreIndexes } from "./core";

describe("seedCoreIndexes", () => {
  beforeEach(() => {
    ensureIndexMock.mockReset();
    normalizeAndMergeCorporateSectorsMock.mockReset();
    normalizeAndMergeCorporateSectorsMock.mockResolvedValue({
      normalizedSectors: [],
      mergedGroups: [],
    });
  });

  it("heals duplicate corporate sectors before creating the unique identity index", async () => {
    const indexes = vi.fn().mockResolvedValue([{ key: { _id: 1 }, name: "_id_" }]);
    const db = {
      collection: vi.fn(() => ({
        indexes,
      })),
    } as unknown as Db;

    await seedCoreIndexes(db, vi.fn());

    expect(normalizeAndMergeCorporateSectorsMock).toHaveBeenCalledWith(db, expect.any(Date));
    const repairOrder = normalizeAndMergeCorporateSectorsMock.mock.invocationCallOrder[0];
    const uniqueIndexOrder = ensureIndexMock.mock.calls.find(
      (call) =>
        call[1] === "corporateSectors" &&
        call[3]?.name === "corporateSectors_corporationId_stateId_sectorType"
    );
    expect(uniqueIndexOrder).toBeDefined();
    expect(repairOrder).toBeLessThan(
      ensureIndexMock.mock.invocationCallOrder[
        ensureIndexMock.mock.calls.indexOf(uniqueIndexOrder!)
      ]
    );
  });

  it("skips the heal when the corporate sector identity index already exists", async () => {
    const indexes = vi.fn().mockResolvedValue([
      {
        key: { corporationId: 1, stateId: 1, sectorType: 1 },
        name: "corp_sector_identity_v2",
        unique: true,
      },
    ]);
    const db = {
      collection: vi.fn(() => ({
        indexes,
      })),
    } as unknown as Db;

    await seedCoreIndexes(db, vi.fn());

    expect(normalizeAndMergeCorporateSectorsMock).not.toHaveBeenCalled();
  });
});
