import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/providerIdentityIndexes", () => ({
  ensureProviderIdentityIndexes: vi.fn().mockResolvedValue([]),
}));

const { ensureIndexMock, normalizeAndMergeCorporateSectorsMock } = vi.hoisted(() => ({
  ensureIndexMock: vi.fn(),
  normalizeAndMergeCorporateSectorsMock: vi.fn(),
}));

vi.mock("../helpers", () => ({
  ensureIndex: ensureIndexMock,
}));

vi.mock("@/lib/corporations/repairDuplicateSectors", () => ({
  normalizeAndMergeCorporateSectors: normalizeAndMergeCorporateSectorsMock,
}));

import {
  assertUniqueCorporationSequentialIds,
  findDuplicateCorporationSequentialIds,
} from "./assertUniqueCorporationIds";
import { seedCoreIndexes } from "./core";

// The seven duplicate groups from the issue #2028 report: identifiers
// 900009 through 900016 reused across country/type seed sources.
function issue2028Corpora() {
  const rows: Array<{ _id: string; sequentialId: number; name: string; countryId: string }> = [];
  const pair = (seq: number, a: [string, string], b: [string, string]) => {
    rows.push(
      { _id: `${a[1]}-corp`, sequentialId: seq, name: a[0], countryId: a[1] },
      { _id: `${b[1]}-corp`, sequentialId: seq, name: b[0], countryId: b[1] }
    );
  };
  pair(900009, ["Soviet Union", "RU"], ["France", "FR"]);
  pair(900010, ["Italy", "IT"], ["East Germany", "DD"]);
  pair(900011, ["Régie et Charbonnages de France", "FR"], ["Spain", "ES"]);
  pair(900012, ["IRI-ENI Holding", "IT"], ["Sweden", "SE"]);
  pair(900014, ["Statens Affärsverk", "SE"], ["Greece", "GR"]);
  pair(900015, ["İktisadi Devlet Teşekkülleri Holding", "TR"], ["Austria", "AT"]);
  pair(900016, ["DEI-SEK Dimosies Epicheiriseis", "GR"], ["Finland", "FI"]);
  return rows;
}

function mockDb(corps: unknown[], createIndexImpl?: () => Promise<string>) {
  const createIndex = vi.fn().mockImplementation(createIndexImpl ?? (async () => "ok"));
  const db = {
    collection: vi.fn(() => ({
      indexes: vi.fn().mockResolvedValue([{ key: { _id: 1 }, name: "_id_" }]),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(corps) })),
      createIndex,
    })),
  } as unknown as Db;
  return { db, createIndex };
}

describe("findDuplicateCorporationSequentialIds", () => {
  it("returns no collisions for unique ids", () => {
    expect(
      findDuplicateCorporationSequentialIds([
        { _id: "a", sequentialId: 900_001, name: "United States", countryId: "US" },
        { _id: "b", sequentialId: 900_019, name: "France", countryId: "FR" },
      ])
    ).toEqual([]);
  });

  it("ignores corporations without a sequentialId (sparse index)", () => {
    expect(
      findDuplicateCorporationSequentialIds([
        { _id: "a", name: "No Id", countryId: "US" },
        { _id: "b", sequentialId: null, name: "Null Id", countryId: "US" },
      ])
    ).toEqual([]);
  });

  it("reports every issue #2028 duplicate group deterministically", () => {
    const collisions = findDuplicateCorporationSequentialIds(issue2028Corpora());
    expect(collisions.map((c) => c.sequentialId)).toEqual([
      900009, 900010, 900011, 900012, 900014, 900015, 900016,
    ]);
    for (const collision of collisions) {
      expect(collision.holders).toHaveLength(2);
    }
  });
});

describe("assertUniqueCorporationSequentialIds", () => {
  it("resolves when all ids are unique", async () => {
    const { db } = mockDb([
      { _id: "a", sequentialId: 900_001, name: "United States", countryId: "US" },
    ]);
    await expect(assertUniqueCorporationSequentialIds(db)).resolves.toBeUndefined();
  });

  it("fails naming every colliding identifier plus holder names and countries", async () => {
    const { db } = mockDb(issue2028Corpora());
    const error = await assertUniqueCorporationSequentialIds(db).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    for (const seq of [900009, 900010, 900011, 900012, 900014, 900015, 900016]) {
      expect(error.message).toContain(String(seq));
    }
    for (const name of ["Soviet Union", "France", "East Germany", "Finland"]) {
      expect(error.message).toContain(name);
    }
  });
});

describe("seedCoreIndexes corporation guard (issue #2028)", () => {
  beforeEach(() => {
    ensureIndexMock.mockReset();
    normalizeAndMergeCorporateSectorsMock.mockReset();
    normalizeAndMergeCorporateSectorsMock.mockResolvedValue({
      normalizedSectors: [],
      mergedGroups: [],
    });
  });

  it("creates the unique corporations_sequentialId index on a clean world", async () => {
    const { db, createIndex } = mockDb([]);
    await seedCoreIndexes(db, vi.fn());
    const corpIndexCall = createIndex.mock.calls.find(
      (call) => call[1]?.name === "corporations_sequentialId"
    );
    expect(corpIndexCall).toBeDefined();
    expect(corpIndexCall?.[1]).toMatchObject({ unique: true });
  });

  it("refuses index creation when seeded corporations collide, before createIndex", async () => {
    const { db, createIndex } = mockDb(issue2028Corpora());
    await expect(seedCoreIndexes(db, vi.fn())).rejects.toThrow(/900009/);
    expect(
      createIndex.mock.calls.filter((call) => call[1]?.name === "corporations_sequentialId")
    ).toHaveLength(0);
  });

  it("keeps index creation failure fatal instead of swallowing it", async () => {
    const { db } = mockDb([], async () => {
      const err = new Error("E11000 duplicate key error collection: corporations") as Error & {
        code: number;
      };
      err.code = 11000;
      throw err;
    });
    await expect(seedCoreIndexes(db, vi.fn())).rejects.toThrow(
      /corporations_sequentialId unique index creation failed/
    );
  });

  it("stays tolerant when an equivalent unique guard already exists", async () => {
    const log = vi.fn();
    const createIndex = vi.fn(async (key: unknown, options?: { name?: string }) => {
      if (options?.name === "corporations_sequentialId") {
        // Code 86 shape: same key spec held under another name. Deliberately
        // avoids the phrase "already exists" so the test exercises the
        // equivalent-guard lookup branch, not the message-match branch.
        const err = new Error(
          "IndexKeySpecsConflict: existing index legacy_corps_seq has the same key specification"
        ) as Error & { code: number };
        err.code = 86;
        throw err;
      }
      return "ok";
    });
    const db = {
      collection: vi.fn(() => ({
        indexes: vi.fn().mockResolvedValue([
          { key: { _id: 1 }, name: "_id_" },
          { key: { sequentialId: 1 }, name: "legacy_corps_seq", unique: true },
        ]),
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        createIndex,
      })),
    } as unknown as Db;
    await expect(seedCoreIndexes(db, log)).resolves.toBeUndefined();
    expect(log.mock.calls.join("\n")).toContain("already exists");
  });

  it("stays tolerant on a plain already-exists createIndex outcome", async () => {
    const log = vi.fn();
    const createIndex = vi.fn(async (key: unknown, options?: { name?: string }) => {
      if (options?.name === "corporations_sequentialId") {
        throw new Error("Index already exists: corporations_sequentialId");
      }
      return "ok";
    });
    const db = {
      collection: vi.fn(() => ({
        indexes: vi.fn().mockResolvedValue([{ key: { _id: 1 }, name: "_id_" }]),
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
        createIndex,
      })),
    } as unknown as Db;
    await expect(seedCoreIndexes(db, log)).resolves.toBeUndefined();
    expect(log.mock.calls.join("\n")).toContain("already exists");
  });
});
