import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/providerIdentityIndexes", () => ({
  ensureProviderIdentityIndexes: vi.fn().mockResolvedValue([]),
}));

const { ensureIndexMock } = vi.hoisted(() => ({
  ensureIndexMock: vi.fn(),
}));

vi.mock("./helpers", () => ({
  ensureIndex: ensureIndexMock,
}));

import { seedCoreIndexes } from "./core";

describe("seedCoreIndexes", () => {
  beforeEach(() => {
    ensureIndexMock.mockReset();
  });

  it("requires the registered model-aware index and never heals existing sector documents", async () => {
    const indexes = vi.fn().mockResolvedValue([
      {
        key: {
          corporationId: 1,
          stateId: 1,
          sectorType: 1,
          industryModel: 1,
          mediaDiscriminator: 1,
        },
        unique: true,
      },
    ]);
    const db = {
      collection: vi.fn(() => ({
        indexes,
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        createIndex: vi.fn().mockResolvedValue("corporations_sequentialId"),
      })),
    } as unknown as Db;

    await seedCoreIndexes(db, vi.fn());

    expect(indexes).toHaveBeenCalledOnce();
    const uniqueIndexOrder = ensureIndexMock.mock.calls.find(
      (call) =>
        call[1] === "corporateSectors" &&
        call[3]?.name === "corporateSectors_corporation_state_type_models_unique"
    );
    expect(uniqueIndexOrder).toBeDefined();
  });

  it("rejects bootstrap when registered identity migration did not install the new index", async () => {
    const indexes = vi.fn().mockResolvedValue([{ key: { _id: 1 }, name: "_id_" }]);
    const db = {
      collection: vi.fn(() => ({
        indexes,
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        createIndex: vi.fn().mockResolvedValue("corporations_sequentialId"),
      })),
    } as unknown as Db;

    await expect(seedCoreIndexes(db, vi.fn())).rejects.toThrow(
      "Required corporate sector identity index"
    );
  });
});
