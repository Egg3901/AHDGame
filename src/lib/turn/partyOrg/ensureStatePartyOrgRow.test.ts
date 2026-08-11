import { beforeEach, describe, expect, it } from "vitest";
import { type Db } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ensureStatePartyOrgRow } from "./ensureStatePartyOrgRow";

const party = { sequentialId: 2 } as never;

describe("ensureStatePartyOrgRow", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("statePartyOrg");
  });

  it("returns the existing row without upserting when one is present", async () => {
    const existing = {
      _id: "BY_2",
      countryId: "DE",
      stateId: "BY",
      partyId: "2",
      organization: 17,
      politicalStrength: 5,
      hasPresence: true,
    };
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(existing);

    const row = await ensureStatePartyOrgRow(db as unknown as Db, {
      countryId: "DE",
      stateId: "BY",
      party,
      hasPresence: true,
    });

    expect(row).toBe(existing);
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
  });

  it("heals a legacy row found by _id that is missing countryId", async () => {
    // A row created by the old leadership upsert (no countryId) is invisible to
    // countryId-scoped queries; the helper must repair it so the PS spend can
    // find it instead of failing with missing-row.
    const malformed = {
      _id: "BY_2",
      stateId: "BY",
      partyId: "2",
      organization: 0,
      politicalStrength: 30,
      chairId: "abc",
      // countryId intentionally absent
    };
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(malformed);

    const row = await ensureStatePartyOrgRow(db as unknown as Db, {
      countryId: "DE",
      stateId: "BY",
      party,
      hasPresence: true,
    });

    expect(row.countryId).toBe("DE");
    // Existing data (chair, PS, org) preserved — only scope fields healed.
    expect(row.politicalStrength).toBe(30);
    expect(row.chairId).toBe("abc");
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledWith(
      { _id: "BY_2" },
      { $set: expect.objectContaining({ countryId: "DE" }) }
    );
  });

  it("bootstraps a 0% row via upsert when none exists", async () => {
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);

    const row = await ensureStatePartyOrgRow(db as unknown as Db, {
      countryId: "DE",
      stateId: "BY",
      party,
      hasPresence: true,
    });

    expect(row._id).toBe("BY_2");
    expect(row.partyId).toBe("2");
    expect(row.organization).toBe(0);
    expect(row.politicalStrength).toBe(0);
    expect(row.hasPresence).toBe(true);

    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledWith(
      { _id: "BY_2" },
      { $setOnInsert: expect.objectContaining({ _id: "BY_2", organization: 0 }) },
      { upsert: true }
    );
  });

  it("stamps hasPresence=false on the bootstrapped row when caller has no presence", async () => {
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);

    const row = await ensureStatePartyOrgRow(db as unknown as Db, {
      countryId: "DE",
      stateId: "BY",
      party,
      hasPresence: false,
    });

    expect(row.hasPresence).toBe(false);
  });

  it("refuses to create a row for a non-electoral US region (DC)", async () => {
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);

    await expect(
      ensureStatePartyOrgRow(db as unknown as Db, {
        countryId: "US",
        stateId: "DC",
        party,
        hasPresence: true,
      })
    ).rejects.toThrow(/DC|electoral/i);

    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
  });

  it("refuses Alaska under 1953-default until statehood admission", async () => {
    db.collection("gameState");
    db.collection("states");
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
      currentYear: 1953,
    });
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);

    await expect(
      ensureStatePartyOrgRow(db as unknown as Db, {
        countryId: "US",
        stateId: "AK",
        party,
        hasPresence: true,
      })
    ).rejects.toThrow(/territory|admitted/i);

    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
  });

  it("allows Alaska once admittedYear is on the state doc", async () => {
    db.collection("gameState");
    db.collection("states");
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
      currentYear: 1959,
    });
    db.collectionMocks["states"]!.find.mockReturnValue(
      createAsyncIterableCursor([{ _id: "AK", admittedYear: 1959 }])
    );
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);

    const row = await ensureStatePartyOrgRow(db as unknown as Db, {
      countryId: "US",
      stateId: "AK",
      party,
      hasPresence: true,
    });

    expect(row._id).toBe("AK_2");
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalled();
  });

  it("still bootstraps a row for a real US electoral state (WY)", async () => {
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);

    const row = await ensureStatePartyOrgRow(db as unknown as Db, {
      countryId: "US",
      stateId: "WY",
      party,
      hasPresence: true,
    });

    expect(row._id).toBe("WY_2");
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalled();
  });
});
