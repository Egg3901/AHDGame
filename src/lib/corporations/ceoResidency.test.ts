import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { doesCeoResideAtHeadquarters, findActiveResidentCeoCorporation } from "./ceoResidency";

describe("ceoResidency", () => {
  it("matches CEO residency by exact headquarters state", () => {
    expect(doesCeoResideAtHeadquarters("CA", "CA")).toBe(true);
    expect(doesCeoResideAtHeadquarters("CA", "TX")).toBe(false);
    expect(doesCeoResideAtHeadquarters(null, "CA")).toBe(false);
  });

  it("returns the corporation when the CEO still lives at HQ", async () => {
    const db = createMockDb();
    db.collection("corporations");
    const ceoId = new ObjectId();
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "ResidentCo",
      ceoId,
      ceoVacant: false,
      headquartersState: "CA",
    });

    const corporation = await findActiveResidentCeoCorporation(db as unknown as Db, ceoId, "CA");

    expect(corporation?._id).toEqual(corpId);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("never vacates a state-owned (NatCorp) CEO for HQ-state non-residency — relaxed country-level rule", async () => {
    const db = createMockDb();
    db.collection("corporations");
    const ceoId = new ObjectId();
    const corpId = new ObjectId();
    // NatCorp HQ is Dongbei (DB) but the CEO lives in Huabei (HB) — same country.
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "China",
      ceoId,
      ceoVacant: false,
      headquartersState: "DB",
      countryOwnerId: "CN",
    });

    const corporation = await findActiveResidentCeoCorporation(db as unknown as Db, ceoId, "HB");

    // Not eligible for combined relocation (null) but must NOT be unseated.
    expect(corporation).toBeNull();
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("returns null but does NOT mutate when CEO's home state no longer matches HQ", async () => {
    // Vacating is the caller's responsibility — this function must never mutate
    // on a read, as it is called from GET (preview) contexts (bug #0813).
    const db = createMockDb();
    db.collection("corporations");
    const ceoId = new ObjectId();
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "MovedCo",
      ceoId,
      ceoVacant: false,
      headquartersState: "NC",
    });

    const corporation = await findActiveResidentCeoCorporation(db as unknown as Db, ceoId, "CA");

    expect(corporation).toBeNull();
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});
