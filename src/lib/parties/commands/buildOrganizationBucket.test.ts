import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { buildOrganizationBucket } from "./buildOrganizationBucket";

function cursor(rows: Array<Record<string, unknown>>) {
  return { toArray: async () => rows } as never;
}

describe("buildOrganizationBucket", () => {
  it("bootstraps legacy balances, deposits atomically, and never replaces the spender units", async () => {
    const db = createMockDb();
    const collection = db.collection("statePartyOrg");
    const rows = [
      { _id: "CA_1", countryId: "US", stateId: "CA", partyId: "1", organization: 20 },
      { _id: "CA_2", countryId: "US", stateId: "CA", partyId: "2", organization: 30 },
    ];
    collection.find.mockReturnValue(cursor(rows));
    collection.findOneAndUpdate.mockResolvedValue({
      ...rows[0],
      organizationUnits: 41,
      lastOrganizationBuildTurn: 100,
    });

    const result = await buildOrganizationBucket(db as unknown as Db, {
      countryId: "US",
      stateId: "CA",
      partyId: "1",
      stateRowId: "CA_1",
      currentTurn: 100,
      now: new Date("2026-10-04T12:00:00Z"),
    });

    expect(result?.rows.find((row) => row.id === "CA_1")).toMatchObject({
      organizationUnits: 41,
      lastOrganizationBuildTurn: 100,
    });
    expect(collection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "CA_1", countryId: "US", stateId: "CA", partyId: "1" }),
      expect.any(Array),
      { returnDocument: "after" }
    );
    const operations = (collection.bulkWrite.mock.calls as unknown[][]).flatMap(
      (call) => call[0] as unknown[]
    ) as Array<{
      updateOne?: {
        filter?: { organizationUnits?: number };
        update: { $set: Record<string, unknown> };
      };
    }>;
    const spenderShareWrite = operations.find(
      (operation) => operation.updateOne?.filter?.organizationUnits === 41
    );
    expect(spenderShareWrite?.updateOne?.update.$set).not.toHaveProperty("organizationUnits");
  });

  it("reconciles shares when another party contributes during the first write", async () => {
    const db = createMockDb();
    const collection = db.collection("statePartyOrg");
    const before = [
      {
        _id: "CA_1",
        countryId: "US",
        stateId: "CA",
        partyId: "1",
        organization: 30,
        organizationUnits: 60,
      },
      {
        _id: "CA_2",
        countryId: "US",
        stateId: "CA",
        partyId: "2",
        organization: 20,
        organizationUnits: 40,
      },
    ];
    const afterConcurrentBuild = [
      { ...before[0], organizationUnits: 61 },
      { ...before[1], organizationUnits: 41 },
    ];
    collection.find
      .mockReturnValueOnce(cursor(before))
      .mockReturnValueOnce(cursor(before))
      .mockReturnValueOnce(cursor(afterConcurrentBuild));
    collection.findOneAndUpdate.mockResolvedValue({
      ...before[0],
      organizationUnits: 61,
      lastOrganizationBuildTurn: 200,
    });

    const result = await buildOrganizationBucket(db as unknown as Db, {
      countryId: "US",
      stateId: "CA",
      partyId: "1",
      stateRowId: "CA_1",
      currentTurn: 200,
      now: new Date("2026-10-04T13:00:00Z"),
    });

    expect(collection.bulkWrite).toHaveBeenCalledTimes(2);
    expect(result?.totalUnits).toBe(102);
    expect(result?.denominatorUnits).toBe(202);
    expect(result?.rows.find((row) => row.id === "CA_2")?.organization).toBeCloseTo(20.297, 3);
    expect(result?.rows.find((row) => row.id === "CA_1")?.delta).toBeCloseTo(0.3473, 4);
    expect(result?.rows.find((row) => row.id === "CA_2")?.delta).toBeCloseTo(-0.101, 4);
  });
});
