import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("./fundQueries", () => ({
  debitFundPosition: vi.fn(),
  creditFundPosition: vi.fn(),
}));

describe("releaseCharacterHeldIndexFundPositionsToFloat", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("does nothing when the character holds no fund positions", async () => {
    const characterId = new ObjectId();
    db.collection("indexFundPositions").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { releaseCharacterHeldIndexFundPositionsToFloat } =
      await import("./releaseCharacterHeldPositionsToFloat");
    const { debitFundPosition } = await import("./fundQueries");

    const result = await releaseCharacterHeldIndexFundPositionsToFloat(db as unknown as Db, [
      characterId,
    ]);

    expect(result).toEqual({ unitsReleased: 0, positionsReleased: 0 });
    expect(debitFundPosition).not.toHaveBeenCalled();
  });

  it("debits the character's position and credits the fund_reserve position for each held fund", async () => {
    const characterId = new ObjectId();
    const fundIdA = new ObjectId();
    const fundIdB = new ObjectId();

    db.collection("indexFundPositions").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: new ObjectId(), fundId: fundIdA, characterId, units: 40 },
        { _id: new ObjectId(), fundId: fundIdB, characterId, units: 15 },
      ]),
    });
    db.collection("indexFunds").findOne.mockImplementation(({ _id }: { _id: ObjectId }) =>
      Promise.resolve(_id.equals(fundIdA) ? { quotedNav: 120 } : { quotedNav: 80 })
    );

    const { releaseCharacterHeldIndexFundPositionsToFloat } =
      await import("./releaseCharacterHeldPositionsToFloat");
    const { debitFundPosition, creditFundPosition } = await import("./fundQueries");
    vi.mocked(debitFundPosition).mockResolvedValue({
      ok: true,
      position: null,
      legacyUnitsRedeemed: 0,
    });

    const result = await releaseCharacterHeldIndexFundPositionsToFloat(db as unknown as Db, [
      characterId,
    ]);

    expect(result).toEqual({ unitsReleased: 55, positionsReleased: 2 });
    expect(debitFundPosition).toHaveBeenCalledWith(db, fundIdA, "character", { characterId }, 40);
    expect(debitFundPosition).toHaveBeenCalledWith(db, fundIdB, "character", { characterId }, 15);
    expect(creditFundPosition).toHaveBeenCalledWith(db, fundIdA, "fund_reserve", {}, 40, 120);
    expect(creditFundPosition).toHaveBeenCalledWith(db, fundIdB, "fund_reserve", {}, 15, 80);
  });

  it("skips a position when a concurrent change makes the debit stale (CAS miss)", async () => {
    const characterId = new ObjectId();
    const fundId = new ObjectId();

    db.collection("indexFundPositions").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: new ObjectId(), fundId, characterId, units: 10 }]),
    });

    const { releaseCharacterHeldIndexFundPositionsToFloat } =
      await import("./releaseCharacterHeldPositionsToFloat");
    const { debitFundPosition, creditFundPosition } = await import("./fundQueries");
    vi.mocked(debitFundPosition).mockResolvedValue({ ok: false });

    const result = await releaseCharacterHeldIndexFundPositionsToFloat(db as unknown as Db, [
      characterId,
    ]);

    expect(result).toEqual({ unitsReleased: 0, positionsReleased: 0 });
    expect(creditFundPosition).not.toHaveBeenCalled();
  });
});
