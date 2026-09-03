import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { mergeNationalCorporations } from "./mergeNationalCorporations";

// The live German reunification is the shape every test encodes: DE dissolves
// into DD, and DE's National Corporation tree (a flagged primary plus split-off
// enterprises) must fold into DD's — not survive as a second, ghost primary.

function cursorOf<T>(docs: T[]) {
  const c = {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn(() => c),
    limit: vi.fn(() => c),
    next: vi.fn(async () => docs[0] ?? null),
  };
  return c;
}

const SURVIVOR_PRIMARY_ID = new ObjectId("6f0000000000000000000001");
const GHOST_PRIMARY_ID = new ObjectId("6f0000000000000000000031");
const GHOST_ENERGY_ID = new ObjectId("6f00000000000000000000c1");
const SURVIVOR_ENERGY_ID = new ObjectId("6f0000000000000000000091");

function survivorPrimary() {
  return {
    _id: SURVIVOR_PRIMARY_ID,
    name: "East Germany",
    countryOwnerId: "DD",
    isPrimaryNationalCorporation: true,
    assignedSectorTypes: [],
  };
}

function ghostPrimary() {
  return {
    _id: GHOST_PRIMARY_ID,
    name: "Germany",
    countryOwnerId: "DE",
    isPrimaryNationalCorporation: true,
    assignedSectorTypes: [],
  };
}

function ghostEnergySplitOff() {
  return {
    _id: GHOST_ENERGY_ID,
    name: "German Energy Enterprise",
    countryOwnerId: "DE",
    isPrimaryNationalCorporation: false,
    assignedSectorTypes: ["energy"],
  };
}

describe("mergeNationalCorporations", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("bonds");
    // Default: the consolidation's absorbed-country find returns the ghost
    // tree; ensurePrimaryNationalCorporation re-finds the same collection, so
    // tests narrow per case below.
    db.collectionMocks.corporations.find.mockImplementation(() => cursorOf([]));
    db.collectionMocks.corporations.findOne.mockResolvedValue(survivorPrimary());
  });

  it("dissolves the ghost primary and its split-offs, counting them", async () => {
    db.collectionMocks.corporations.find.mockImplementation((filter: unknown) => {
      const f = filter as { countryOwnerId?: string };
      if (f?.countryOwnerId === "DE") return cursorOf([ghostPrimary(), ghostEnergySplitOff()]);
      return cursorOf([survivorPrimary()]);
    });

    const res = await mergeNationalCorporations(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
    });

    expect(res.corpsDissolved).toBe(2);
    const deleted = db.collectionMocks.corporations.deleteOne.mock.calls.map((c) =>
      (c[0] as { _id: ObjectId })._id.toString()
    );
    expect(deleted).toContain(GHOST_PRIMARY_ID.toString());
    expect(deleted).toContain(GHOST_ENERGY_ID.toString());
  });

  it("routes sectors to the survivor split-off claiming the type, else the survivor primary", async () => {
    db.collectionMocks.corporations.find.mockImplementation((filter: unknown) => {
      const f = filter as { countryOwnerId?: string };
      if (f?.countryOwnerId === "DE") return cursorOf([ghostPrimary(), ghostEnergySplitOff()]);
      return cursorOf([survivorPrimary()]);
    });
    const ghostEnergySector = {
      _id: new ObjectId(),
      sectorType: "energy",
      corporationId: GHOST_ENERGY_ID,
    };
    const ghostRetailSector = {
      _id: new ObjectId(),
      sectorType: "retail",
      corporationId: GHOST_PRIMARY_ID,
    };
    db.collectionMocks.corporateSectors.find.mockImplementation((filter: unknown) => {
      const f = filter as { corporationId?: ObjectId };
      if (f?.corporationId?.toString() === GHOST_ENERGY_ID.toString())
        return cursorOf([ghostEnergySector]);
      if (f?.corporationId?.toString() === GHOST_PRIMARY_ID.toString())
        return cursorOf([ghostRetailSector]);
      return cursorOf([]);
    });

    await mergeNationalCorporations(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
    });

    const updates = db.collectionMocks.corporateSectors.updateMany.mock.calls;
    const retailUpdate = updates.find(
      (c) =>
        (c[1] as { $set: { corporationId: ObjectId } }).$set.corporationId.toString() ===
        SURVIVOR_PRIMARY_ID.toString()
    );
    expect(retailUpdate).toBeDefined();
    // No survivor split-off claims "energy" here, so energy falls to the primary too.
    const energyUpdate = updates.find(
      (c) =>
        (c[1] as { $set: { corporationId: ObjectId } }).$set.corporationId.toString() ===
        SURVIVOR_PRIMARY_ID.toString()
    );
    expect(energyUpdate).toBeDefined();
  });

  it("keeps the one-NatCorp-per-type invariant: a claimed type folds into the survivor's split-off", async () => {
    const survivorEnergy = {
      ...survivorPrimary(),
      _id: SURVIVOR_ENERGY_ID,
      isPrimaryNationalCorporation: false,
      assignedSectorTypes: ["energy"],
    };
    db.collectionMocks.corporations.find.mockImplementation((filter: unknown) => {
      const f = filter as { countryOwnerId?: string; _id?: { $ne?: ObjectId } };
      if (f?.countryOwnerId === "DE") return cursorOf([ghostEnergySplitOff()]);
      // The survivor's split-off roster query excludes the primary by _id.
      if (f?._id?.$ne) return cursorOf([survivorEnergy]);
      return cursorOf([survivorPrimary()]);
    });
    const ghostEnergySector = {
      _id: new ObjectId(),
      sectorType: "energy",
      corporationId: GHOST_ENERGY_ID,
    };
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursorOf([ghostEnergySector]));

    await mergeNationalCorporations(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
    });

    const updates = db.collectionMocks.corporateSectors.updateMany.mock.calls;
    expect(updates).toHaveLength(1);
    expect(
      (updates[0][1] as { $set: { corporationId: ObjectId } }).$set.corporationId.toString()
    ).toBe(SURVIVOR_ENERGY_ID.toString());
  });

  it("re-stamps absorbed sovereign bonds onto the survivor primary with provenance", async () => {
    db.collectionMocks.corporations.find.mockImplementation((filter: unknown) => {
      const f = filter as { countryOwnerId?: string };
      if (f?.countryOwnerId === "DE") return cursorOf([ghostPrimary()]);
      return cursorOf([survivorPrimary()]);
    });
    const ghostBond = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      corporationId: GHOST_PRIMARY_ID,
      issuerName: "Germany",
      matured: false,
    };
    db.collectionMocks.bonds.find.mockReturnValue(cursorOf([ghostBond]));

    const res = await mergeNationalCorporations(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
    });

    expect(res.bondsRestamped).toBe(1);
    const writes = db.collectionMocks.bonds.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    expect(writes[0].updateOne.update.$set.corporationId).toBe(SURVIVOR_PRIMARY_ID);
    expect(writes[0].updateOne.update.$set.issuerName).toBe("East Germany");
    expect(writes[0].updateOne.update.$set.originalIssuerName).toBe("Germany");
  });

  it("does not clobber an already-stamped originalIssuerName on a re-run", async () => {
    db.collectionMocks.corporations.find.mockImplementation((filter: unknown) => {
      const f = filter as { countryOwnerId?: string };
      if (f?.countryOwnerId === "DE") return cursorOf([ghostPrimary()]);
      return cursorOf([survivorPrimary()]);
    });
    const ghostBond = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      corporationId: GHOST_PRIMARY_ID,
      issuerName: "Germany",
      originalIssuerName: "West Germany",
      matured: false,
    };
    db.collectionMocks.bonds.find.mockReturnValue(cursorOf([ghostBond]));

    await mergeNationalCorporations(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
    });

    const writes = db.collectionMocks.bonds.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    expect(writes[0].updateOne.update.$set.originalIssuerName).toBeUndefined();
  });

  it("re-stamps corp-held stakes (golden shares) to the survivor primary", async () => {
    db.collectionMocks.corporations.find.mockImplementation((filter: unknown) => {
      const f = filter as { countryOwnerId?: string };
      if (f?.countryOwnerId === "DE") return cursorOf([ghostPrimary()]);
      return cursorOf([survivorPrimary()]);
    });

    await mergeNationalCorporations(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
    });

    const calls = db.collectionMocks.corporations.updateMany.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual({ "shareholders.corporationId": GHOST_PRIMARY_ID });
    const opts = calls[0][2] as { arrayFilters: Array<{ "elem.corporationId": ObjectId }> };
    expect(opts.arrayFilters[0]["elem.corporationId"].toString()).toBe(GHOST_PRIMARY_ID.toString());
    expect(
      (calls[0][1] as { $set: { "shareholders.$[elem].corporationId": ObjectId } }).$set[
        "shareholders.$[elem].corporationId"
      ].toString()
    ).toBe(SURVIVOR_PRIMARY_ID.toString());
  });

  it("deletes the shells last, after sectors and bonds have moved", async () => {
    db.collectionMocks.corporations.find.mockImplementation((filter: unknown) => {
      const f = filter as { countryOwnerId?: string };
      if (f?.countryOwnerId === "DE") return cursorOf([ghostPrimary()]);
      return cursorOf([survivorPrimary()]);
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursorOf([{ _id: new ObjectId(), sectorType: "retail", corporationId: GHOST_PRIMARY_ID }])
    );

    const order: string[] = [];
    db.collectionMocks.corporateSectors.updateMany.mockImplementation(async () => {
      order.push("sectors");
      return { modifiedCount: 1 };
    });
    db.collectionMocks.bonds.bulkWrite.mockImplementation(async () => {
      order.push("bonds");
      return {};
    });
    db.collectionMocks.corporations.deleteOne.mockImplementation(async () => {
      order.push("delete");
      return { deletedCount: 1 };
    });

    await mergeNationalCorporations(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
    });

    expect(order.indexOf("sectors")).toBeLessThan(order.indexOf("delete"));
    expect(order.indexOf("bonds")).toBeLessThan(order.indexOf("delete"));
  });

  it("is idempotent: a re-run finds nothing keyed to the absorbed country", async () => {
    db.collectionMocks.corporations.find.mockImplementation((filter: unknown) => {
      const f = filter as { countryOwnerId?: string };
      if (f?.countryOwnerId === "DE") return cursorOf([]);
      return cursorOf([survivorPrimary()]);
    });

    const res = await mergeNationalCorporations(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
    });

    expect(res).toEqual({ corpsDissolved: 0, sectorsMoved: 0, bondsRestamped: 0 });
    expect(db.collectionMocks.corporations.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.bonds.bulkWrite).not.toHaveBeenCalled();
  });
});
