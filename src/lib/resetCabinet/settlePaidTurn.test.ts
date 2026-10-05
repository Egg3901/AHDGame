import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { settlePaidResetCabinetTurn } from "./settlePaidTurn";

function fixture() {
  const mock = createMockDb();
  const account = {
    _id: "US:us_health_department",
    worldId: "reset-world",
    countryId: "US",
    departmentId: "us_health_department",
    sourceTurn: 1,
    accruedThroughTurn: 1,
    lastAuthorityPaid: 0,
    annualAuthority: 480,
    balance: 0,
    encumbered: 0,
    arrears: 0,
    externallySettled: false,
    familyAnnualDemand: { L18: 480 },
    programAllocationPercents: { L18: 100 },
    lastProgramDelivery: {},
  };
  mock.collection("resetDepartmentAccounts").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([account]),
  });
  mock.collectionMocks.resetDepartmentAccounts!.bulkWrite.mockResolvedValue({ matchedCount: 1 });
  return { db: mock as unknown as Db, mock, account };
}

function request(db: Db) {
  return {
    db,
    worldId: "reset-world",
    countryId: "US" as const,
    turn: 2,
    expectedAccountIds: ["US:us_health_department"],
    paidAuthorityByAccount: { "US:us_health_department": 10 },
  };
}

describe("v2 Cabinet paid-turn shell", () => {
  it("settles a paid account once without charging treasury again", async () => {
    const { db, mock } = fixture();
    expect(await settlePaidResetCabinetTurn(request(db))).toMatchObject({
      accounts: 1,
      advanced: 1,
      authorityPaid: 10,
      outlaid: 10,
    });
    expect(mock.collectionMocks.resetDepartmentAccounts!.bulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: expect.objectContaining({
              worldId: "reset-world",
              accruedThroughTurn: 1,
              programAllocationPercents: { L18: 100 },
            }),
            update: {
              $set: expect.objectContaining({
                balance: 0,
                lastAuthorityPaid: 10,
                lastProgramDelivery: {
                  L18: expect.objectContaining({ requested: 10, outlaid: 10 }),
                },
              }),
            },
          }),
        }),
      ],
      { ordered: true }
    );
  });

  it("fails closed before writing for an incomplete payment or account roster", async () => {
    const { db, mock } = fixture();
    await expect(
      settlePaidResetCabinetTurn({ ...request(db), paidAuthorityByAccount: {} })
    ).rejects.toThrow("paid share");
    await expect(
      settlePaidResetCabinetTurn({
        ...request(db),
        expectedAccountIds: ["US:us_health_department", "US:missing"],
      })
    ).rejects.toThrow("missing a world-bound account");
    expect(mock.collectionMocks.resetDepartmentAccounts!.bulkWrite).not.toHaveBeenCalled();
  });

  it("surfaces a concurrent account write for a safe turn retry", async () => {
    const { db, mock } = fixture();
    mock.collectionMocks.resetDepartmentAccounts!.bulkWrite.mockResolvedValue({ matchedCount: 0 });
    await expect(settlePaidResetCabinetTurn(request(db))).rejects.toThrow("compare-and-swap");
  });

  it("leaves specialized accounts to their existing shell on later turns", async () => {
    const { db, mock, account } = fixture();
    mock.collectionMocks.resetDepartmentAccounts!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { ...account, accruedThroughTurn: 2, lastAuthorityPaid: 10 },
        {
          ...account,
          _id: "US:us_defense_department",
          departmentId: "us_defense_department",
          externallySettled: true,
        },
      ]),
    });
    const result = await settlePaidResetCabinetTurn({
      ...request(db),
      turn: 3,
      expectedAccountIds: ["US:us_health_department", "US:us_defense_department"],
    });
    expect(result).toMatchObject({ accounts: 2, advanced: 1, authorityPaid: 10 });
    const ops = mock.collectionMocks.resetDepartmentAccounts!.bulkWrite.mock.calls[0]![0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter._id).toBe("US:us_health_department");
  });
});
