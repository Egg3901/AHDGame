import { describe, it, expect, vi } from "vitest";
import { appointNppChair } from "../appointNppChair";

function mockDb(existingTechnocrat: any | null, bankSeatedElsewhere: any | null = null) {
  const updateOne = vi.fn(async (_filter: any, _op: any) => ({ matchedCount: 1 }));
  const insertOne = vi.fn(async (doc: any) => ({ insertedId: doc._id }));
  const nppsFindOne = vi.fn(async () => existingTechnocrat);
  const banksFindOne = vi.fn(async () => bankSeatedElsewhere);
  const db = {
    collection: (name: string) => ({
      updateOne,
      insertOne,
      findOne:
        name === "npps" ? nppsFindOne : name === "centralBanks" ? banksFindOne : async () => null,
    }),
  } as any;
  return { db, updateOne, insertOne, nppsFindOne, banksFindOne };
}

const bank = { _id: "bank1" as any, countryId: "us" } as any;

describe("appointNppChair", () => {
  it("reuses an existing unseated technocrat and sets chairMode=npp", async () => {
    const existing = {
      _id: "t1" as any,
      countryId: "us",
      isTechnocrat: true,
      technocratRole: "centralBankChair",
    };
    const { db, updateOne, insertOne } = mockDb(existing);
    await appointNppChair(db, bank, "us" as any, 100);
    const [, op] = updateOne.mock.calls[0];
    expect(op.$set.chairMode).toBe("npp");
    expect(String(op.$set.chairNppId)).toBe(String(existing._id));
    expect(op.$set.chairTermExpiresAtTurn).toBe(100 + 192); // CHAIR_TERM_TURNS
    expect(op.$set.vacancyAwaitingAutomaticSelection).toBe(false);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("spawns a new technocrat when none exists", async () => {
    const { db, updateOne, insertOne } = mockDb(null);
    await appointNppChair(db, bank, "us" as any, 100);
    expect(insertOne).toHaveBeenCalledTimes(1);
    const inserted = insertOne.mock.calls[0][0];
    expect(inserted.isTechnocrat).toBe(true);
    const [, op] = updateOne.mock.calls[0];
    expect(op.$set.chairMode).toBe("npp");
    expect(op.$set.chairNppId).toBe(inserted._id);
  });

  it("spawns a fresh technocrat when the existing one is already seated on another bank (I1)", async () => {
    const existing = {
      _id: "t1" as any,
      countryId: "us",
      isTechnocrat: true,
      technocratRole: "centralBankChair",
    };
    // The existing technocrat is already seated as chair on a different bank.
    const otherBank = { _id: "bank2" as any, chairNppId: existing._id };
    const { db, updateOne, insertOne, banksFindOne } = mockDb(existing, otherBank);
    await appointNppChair(db, bank, "us" as any, 100);
    // Must not reuse the double-booked technocrat — spawn a new one instead.
    expect(banksFindOne).toHaveBeenCalledTimes(1);
    expect(insertOne).toHaveBeenCalledTimes(1);
    const inserted = insertOne.mock.calls[0][0];
    const [, op] = updateOne.mock.calls[0];
    expect(op.$set.chairMode).toBe("npp");
    expect(op.$set.chairNppId).toBe(inserted._id);
    expect(String(op.$set.chairNppId)).not.toBe(String(existing._id));
  });

  it("grants a fresh term when the adopted board chair seat is already expired", async () => {
    const nppId = { toString: () => "t-board" };
    const expiredBoardChair = {
      _id: "bank1" as any,
      countryId: "us",
      fomcBoard: [
        {
          seatId: "seat-1",
          isChair: true,
          occupantType: "npp",
          nppId,
          alignment: "hawk",
          termExpiresAtTurn: 10,
        },
      ],
    } as any;
    const { db, updateOne } = mockDb(null);
    await appointNppChair(db, expiredBoardChair, "us" as any, 260);
    const [, op] = updateOne.mock.calls[0];
    expect(op.$set.chairTermExpiresAtTurn).toBe(260 + 192);
    expect(op.$set.fomcBoard[0].termExpiresAtTurn).toBe(260 + 192);
    expect(op.$set.vacancyAwaitingAutomaticSelection).toBe(false);
  });

  it("flips the outgoing chair's alignment so temperament varies over terms", async () => {
    const existing = {
      _id: "t1" as any,
      countryId: "us",
      isTechnocrat: true,
      technocratRole: "centralBankChair",
      personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    };
    const hawkBank = { ...bank, chairAlignment: "hawk" } as any;
    const { db, updateOne } = mockDb(existing);
    await appointNppChair(db, hawkBank, "us" as any, 100);
    const [, op] = updateOne.mock.calls[0];
    expect(op.$set.chairAlignment).toBe("dove");
  });

  it("bootstraps alignment from personality when no prior alignment is set", async () => {
    const stubborn = {
      _id: "t2" as any,
      countryId: "us",
      isTechnocrat: true,
      technocratRole: "centralBankChair",
      personality: { loyalty: 50, ambition: 20, stubbornness: 80 },
    };
    const { db, updateOne } = mockDb(stubborn);
    await appointNppChair(db, bank, "us" as any, 100);
    const [, op] = updateOne.mock.calls[0];
    expect(op.$set.chairAlignment).toBe("hawk");
  });
});
