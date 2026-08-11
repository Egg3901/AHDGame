import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { CorporateSector } from "@/lib/db/types";

describe("mandateControl", () => {
  let db: MockDb;
  const corpId = new ObjectId();
  const sectorId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["corporations", "corporateSectors"]) db.collection(n);
  });

  it("setCorpMandate sets an active posture", async () => {
    const { setCorpMandate } = await import("./mandateControl");
    await setCorpMandate(db as unknown as Db, corpId, {
      priceControlled: true,
      employmentGuaranteed: false,
    });
    const call = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ _id: corpId });
    expect(call[1].$set.soeMandate).toEqual({
      priceControlled: true,
      employmentGuaranteed: false,
    });
  });

  it("setCorpMandate unsets when both flags are off", async () => {
    const { setCorpMandate } = await import("./mandateControl");
    await setCorpMandate(db as unknown as Db, corpId, {
      priceControlled: false,
      employmentGuaranteed: false,
    });
    const call = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(call[1].$unset).toEqual({ soeMandate: "" });
    expect(call[1].$set).not.toHaveProperty("soeMandate");
  });

  it("setSectorMandate stores explicit booleans for a sector it owns", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: sectorId,
      corporationId: corpId,
    } as unknown as CorporateSector);
    const { setSectorMandate } = await import("./mandateControl");
    await setSectorMandate(db as unknown as Db, corpId, sectorId, {
      priceControlled: false,
      employmentGuaranteed: true,
    });
    const call = db.collectionMocks.corporateSectors.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ _id: sectorId });
    expect(call[1].$set.soeMandate).toEqual({
      priceControlled: false,
      employmentGuaranteed: true,
    });
  });

  it("setSectorMandate throws for a sector the corp does not own", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    const { setSectorMandate } = await import("./mandateControl");
    await expect(
      setSectorMandate(db as unknown as Db, corpId, sectorId, {
        priceControlled: true,
        employmentGuaranteed: true,
      })
    ).rejects.toThrow(/not found/i);
  });

  it("clearSectorMandate unsets the override after verifying ownership", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: sectorId,
      corporationId: corpId,
    } as unknown as CorporateSector);
    const { clearSectorMandate } = await import("./mandateControl");
    await clearSectorMandate(db as unknown as Db, corpId, sectorId);
    const call = db.collectionMocks.corporateSectors.updateOne.mock.calls[0];
    expect(call[1].$unset).toEqual({ soeMandate: "" });
  });
});
