import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { POLITICAL_MEDIA_ORDER_INDEXES } from "@/lib/politicalMedia/indexes";
import { migration } from "./2026-10-04-political-media-order-indexes";

describe("political media order index migration", () => {
  it("reports the live-world index plan without writing in dry-run mode", async () => {
    const createIndex = vi.fn();
    const db = {
      collection: vi.fn(() => ({ createIndex })),
    } as unknown as Db;

    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.documentsScanned).toBe(2);
    expect(result.documentsUpdated).toBe(0);
    expect(result.notes).toEqual(
      POLITICAL_MEDIA_ORDER_INDEXES.map(
        (index) => `would create ${index.collection}.${index.options.name}`
      )
    );
  });

  it("creates the same registered specs used by fresh-world seeding", async () => {
    const createIndex = vi.fn().mockResolvedValue("index");
    const db = {
      collection: vi.fn(() => ({ createIndex })),
    } as unknown as Db;

    const result = await migration.execute(db, { dryRun: false });

    expect(createIndex.mock.calls).toEqual(
      POLITICAL_MEDIA_ORDER_INDEXES.map((index) => [index.keys, index.options])
    );
    expect(result.documentsUpdated).toBe(POLITICAL_MEDIA_ORDER_INDEXES.length);
  });
});
