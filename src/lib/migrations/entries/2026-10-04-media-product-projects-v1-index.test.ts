import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import {
  MEDIA_PRODUCT_ACTIVE_INDEX,
  MEDIA_PRODUCT_CORPORATION_INDEX,
  MEDIA_PRODUCT_PROJECTS,
  MEDIA_PRODUCT_STAGE_INDEX,
} from "@/lib/products/mediaProduct";
import { migration } from "./2026-10-04-media-product-projects-v1-index";

describe("media product project indexes", () => {
  it("creates active-development, lifecycle, and corporation lookup indexes", async () => {
    const createIndex = vi.fn().mockResolvedValue("created");
    const db = { collection: vi.fn().mockReturnValue({ createIndex }) };
    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collection).toHaveBeenCalledWith(MEDIA_PRODUCT_PROJECTS);
    expect(createIndex).toHaveBeenNthCalledWith(
      1,
      { activeDevelopmentCorporationId: 1 },
      expect.objectContaining({
        name: MEDIA_PRODUCT_ACTIVE_INDEX,
        unique: true,
        partialFilterExpression: { activeDevelopmentCorporationId: { $exists: true } },
      })
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      2,
      { stage: 1, corporationId: 1 },
      { name: MEDIA_PRODUCT_STAGE_INDEX }
    );
    expect(createIndex).toHaveBeenNthCalledWith(
      3,
      { corporationId: 1, stage: 1 },
      { name: MEDIA_PRODUCT_CORPORATION_INDEX }
    );
    expect(result.documentsUpdated).toBe(0);
  });

  it("is dry-run by default", async () => {
    const createIndex = vi.fn();
    const db = { collection: vi.fn().mockReturnValue({ createIndex }) };
    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.notes?.[0]).toContain("Would create");
  });
});
