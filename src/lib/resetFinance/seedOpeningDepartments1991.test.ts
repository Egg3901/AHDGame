import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { buildOpeningDepartmentBoards1991 } from "./openingDepartmentBoards1991";
import { openingFiscalBooks1991 } from "./opening1991";
import { openingNamedGrantClaims1991 } from "./openingOwnership1991";
import { buildOpeningDepartmentFundingPartition } from "./rules/liveDepartmentAccount";
import { openingNationalTreasurySnapshots } from "./rules/treasurySnapshot";
import { seedOpeningDepartmentBoards1991 } from "./seedOpeningDepartments1991";
import { openingCabinetActionStates } from "@/lib/resetCabinet/rules/actionState";

describe("v2 department opening persistence", () => {
  it("writes and verifies all three country boards before returning a receipt", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      resetWorldId: "new-world",
      currentTurn: 1,
      manuallyEnabledSeats: ["secretary_of_education"],
    });
    const expected = buildOpeningDepartmentBoards1991("new-world", 1);
    const collection = db.collection("resetDepartmentOpeningBoards");
    collection.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue(expected) } as never);
    const fiscal = openingFiscalBooks1991();
    const partition = buildOpeningDepartmentFundingPartition(
      expected,
      DEPARTMENT_DEFINITIONS,
      {
        US: fiscal.US.grants,
        UK: fiscal.UK.grants,
        JP: fiscal.JP.grants,
      },
      openingNamedGrantClaims1991()
    );
    const accounts = db.collection("resetDepartmentAccounts");
    accounts.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(partition.accounts),
    } as never);
    const continuity = db.collection("resetDepartmentContinuity");
    continuity.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(partition.continuity),
    } as never);
    const treasuries = db.collection("resetNationalTreasuries");
    treasuries.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(
          openingNationalTreasurySnapshots("new-world", 1, fiscal, partition.accounts)
        ),
    } as never);
    const actionStates = db.collection("resetCabinetActionStates");
    actionStates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(openingCabinetActionStates("new-world", 1)),
    } as never);
    const receipt = await seedOpeningDepartmentBoards1991(db as unknown as Db, "new-world", 1);
    expect(collection.bulkWrite).toHaveBeenCalledTimes(1);
    expect(collection.bulkWrite.mock.calls[0][0]).toHaveLength(3);
    expect(accounts.bulkWrite).toHaveBeenCalledTimes(1);
    expect(accounts.bulkWrite.mock.calls[0][0]).toHaveLength(partition.accounts.length);
    expect(continuity.bulkWrite.mock.calls[0][0]).toHaveLength(3);
    expect(treasuries.bulkWrite.mock.calls[0][0]).toHaveLength(3);
    expect(receipt.worldId).toBe("new-world");
    expect(actionStates.bulkWrite.mock.calls[0][0]).toHaveLength(3);
    // Value-only opening balance changes remain compatible with running v2
    // worlds and must not invalidate their Cabinet seed receipt.
    expect(receipt.revision).toBe(8);
    expect(receipt.verificationHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cannot certify an incomplete readback", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      resetWorldId: "new-world",
      currentTurn: 1,
      manuallyEnabledSeats: ["secretary_of_education"],
    });
    const collection = db.collection("resetDepartmentOpeningBoards");
    collection.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) } as never);
    await expect(
      seedOpeningDepartmentBoards1991(db as unknown as Db, "new-world", 1)
    ).rejects.toThrow("readback verification");
  });

  it("cannot certify when the live account readback is incomplete", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      resetWorldId: "new-world",
      currentTurn: 1,
      manuallyEnabledSeats: ["secretary_of_education"],
    });
    const expected = buildOpeningDepartmentBoards1991("new-world", 1);
    db.collection("resetDepartmentOpeningBoards").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(expected),
    } as never);
    db.collection("resetDepartmentAccounts").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    await expect(
      seedOpeningDepartmentBoards1991(db as unknown as Db, "new-world", 1)
    ).rejects.toThrow("spendable accounts failed readback");
  });

  it("cannot certify when the continuity reserve readback is incomplete", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      resetWorldId: "new-world",
      currentTurn: 1,
      manuallyEnabledSeats: ["secretary_of_education"],
    });
    const expected = buildOpeningDepartmentBoards1991("new-world", 1);
    db.collection("resetDepartmentOpeningBoards").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(expected),
    } as never);
    const fiscal = openingFiscalBooks1991();
    const partition = buildOpeningDepartmentFundingPartition(
      expected,
      DEPARTMENT_DEFINITIONS,
      { US: fiscal.US.grants, UK: fiscal.UK.grants, JP: fiscal.JP.grants },
      openingNamedGrantClaims1991()
    );
    db.collection("resetDepartmentAccounts").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(partition.accounts),
    } as never);
    db.collection("resetDepartmentContinuity").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    await expect(
      seedOpeningDepartmentBoards1991(db as unknown as Db, "new-world", 1)
    ).rejects.toThrow("continuity reserve failed readback");
  });

  it("cannot certify when the national cash opening readback is incomplete", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      resetWorldId: "new-world",
      currentTurn: 1,
      manuallyEnabledSeats: ["secretary_of_education"],
    });
    const expected = buildOpeningDepartmentBoards1991("new-world", 1);
    db.collection("resetDepartmentOpeningBoards").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(expected),
    } as never);
    const fiscal = openingFiscalBooks1991();
    const partition = buildOpeningDepartmentFundingPartition(
      expected,
      DEPARTMENT_DEFINITIONS,
      { US: fiscal.US.grants, UK: fiscal.UK.grants, JP: fiscal.JP.grants },
      openingNamedGrantClaims1991()
    );
    db.collection("resetDepartmentAccounts").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(partition.accounts),
    } as never);
    db.collection("resetDepartmentContinuity").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(partition.continuity),
    } as never);
    db.collection("resetNationalTreasuries").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    await expect(
      seedOpeningDepartmentBoards1991(db as unknown as Db, "new-world", 1)
    ).rejects.toThrow("national treasury failed readback");
  });

  it("rejects a v2 Cabinet opening with the historical education seat missing", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      resetWorldId: "new-world",
      currentTurn: 1,
      manuallyEnabledSeats: [],
    });
    await expect(
      seedOpeningDepartmentBoards1991(db as unknown as Db, "new-world", 1)
    ).rejects.toThrow("education seat");
    expect(db.collection("resetDepartmentOpeningBoards").bulkWrite).not.toHaveBeenCalled();
  });
});
