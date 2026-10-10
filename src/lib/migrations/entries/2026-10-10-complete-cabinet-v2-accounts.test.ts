import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, createAsyncIterableCursor, type MockDb } from "@/lib/test-utils/mockDb";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { missingCabinetAccounts } from "@/lib/resetCabinet/rules/accountRoster";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { migration } from "./2026-10-10-complete-cabinet-v2-accounts";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";

vi.mock("@/lib/db/runRequiredTransaction", () => ({
  runRequiredTransaction: vi.fn(async (body) => body({ id: "migration-session" })),
}));

describe("complete Cabinet v2 accounts migration", () => {
  let db: MockDb;
  const countries = ["US", "UK", "JP"] as const;
  beforeEach(() => {
    db = createMockDb();
    db.collection("resetNationalTreasuries").bulkWrite.mockResolvedValue({
      matchedCount: countries.length,
    });
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
      resetWorldId: "world",
      isProcessing: false,
      metricsSystemVersion: "v2",
      cabinetSystemVersion: "v2",
      resetVersionSeeds: Object.fromEntries(
        ["metrics", "cabinet"].map((system) => [
          system,
          {
            worldId: "world",
            revision: RESET_V2_SEED_REVISION[system as "metrics" | "cabinet"],
            sourceTurn: 1,
            completedAt: "verified",
            verificationHash: "hash",
          },
        ])
      ),
    });
    db.collection("resetNationalTreasuries").find.mockReturnValue(
      createAsyncIterableCursor(
        countries.map((countryId) => ({
          _id: countryId,
          countryId,
          worldId: "world",
          sourceTurn: 1,
          settledThroughTurn: 100,
        }))
      )
    );
  });
  it("inserts only zero-value accounts and extends the existing treasury roster atomically", async () => {
    const client = { startSession: vi.fn() };
    const result = await migration.execute({ ...db, client } as unknown as Db, { dryRun: false });
    expect(runRequiredTransaction).toHaveBeenLastCalledWith(expect.any(Function), {
      client,
      timeoutMS: 60_000,
    });
    expect(result.documentsInserted).toBeGreaterThan(0);
    const [rows, options] = db.collectionMocks.resetDepartmentAccounts.insertMany.mock.calls[0]!;
    expect(options.session).toBeDefined();
    expect(
      rows.every(
        (row: { balance: number; annualAuthority: number; accruedThroughTurn: number }) =>
          row.balance === 0 && row.annualAuthority === 0 && row.accruedThroughTurn === 100
      )
    ).toBe(true);
    expect(db.collectionMocks.resetNationalTreasuries.bulkWrite).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            update: expect.objectContaining({ $addToSet: expect.anything() }),
          }),
        }),
      ]),
      expect.objectContaining({ session: expect.anything() })
    );
    expect(db.collectionMocks.gameState.updateOne).toHaveBeenLastCalledWith(
      expect.anything(),
      { $set: { isProcessing: false } },
      expect.anything()
    );
  });
  it("has a read-only dry run", async () => {
    const result = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(result.documentsInserted).toBe(0);
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.resetDepartmentAccounts.insertMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.resetNationalTreasuries.bulkWrite).not.toHaveBeenCalled();
  });
  it("fails the transaction if a treasury update does not match", async () => {
    db.collection("resetNationalTreasuries").bulkWrite.mockResolvedValue({ matchedCount: 0 });
    await expect(migration.execute(db as unknown as Db, { dryRun: false })).rejects.toThrow(
      "lost a current-world treasury"
    );
  });
  it("replays without replacing existing money or obligations", async () => {
    const accounts = countries
      .flatMap((countryId) =>
        missingCabinetAccounts({
          definitions: DEPARTMENT_DEFINITIONS,
          accounts: [],
          worldId: "world",
          countryId,
          sourceTurn: 1,
          currentTurn: 100,
        })
      )
      .map((row) => ({ ...row, balance: 123, encumbered: 7, arrears: 9 }));
    db.collection("resetDepartmentAccounts").find.mockReturnValue(
      createAsyncIterableCursor(accounts)
    );
    db.collection("resetNationalTreasuries").find.mockReturnValue(
      createAsyncIterableCursor(
        countries.map((countryId) => ({
          _id: countryId,
          countryId,
          worldId: "world",
          sourceTurn: 1,
          settledThroughTurn: 100,
          departmentAccountIds: accounts
            .filter((row) => row.countryId === countryId)
            .map((row) => row._id),
        }))
      )
    );
    expect(
      (await migration.execute(db as unknown as Db, { dryRun: false })).documentsInserted
    ).toBe(0);
    expect(db.collectionMocks.resetDepartmentAccounts.insertMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.resetDepartmentAccounts.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.resetNationalTreasuries.bulkWrite).not.toHaveBeenCalled();
  });
  it("repairs treasury registration even when all account records already exist", async () => {
    const accounts = countries.flatMap((countryId) =>
      missingCabinetAccounts({
        definitions: DEPARTMENT_DEFINITIONS,
        accounts: [],
        worldId: "world",
        countryId,
        sourceTurn: 1,
        currentTurn: 100,
      })
    );
    db.collection("resetDepartmentAccounts").find.mockReturnValue(
      createAsyncIterableCursor(accounts)
    );
    const result = await migration.execute(db as unknown as Db, { dryRun: false });
    expect(result.documentsInserted).toBe(0);
    expect(result.documentsUpdated).toBe(countries.length);
    expect(db.collectionMocks.resetDepartmentAccounts.insertMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.resetNationalTreasuries.bulkWrite).toHaveBeenCalled();
  });
  it("refuses a partially settled turn", async () => {
    db.collectionMocks.resetNationalTreasuries.find.mockReturnValue(createAsyncIterableCursor([]));
    await expect(migration.execute(db as unknown as Db, { dryRun: false })).rejects.toThrow(
      "settled current-world treasury"
    );
    expect(db.collectionMocks.resetDepartmentAccounts.insertMany).not.toHaveBeenCalled();
  });
});
