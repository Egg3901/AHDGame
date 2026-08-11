import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  validateCaretakerPosition,
  appointCaretakerMinister,
  dismissCaretakerMinister,
} from "../caretakerMinister";

const now = new Date("2026-06-24T12:00:00Z");

describe("validateCaretakerPosition (pure)", () => {
  it("accepts a real, non-head US cabinet seat", () => {
    expect(validateCaretakerPosition("US", "secretary_of_state")).toBeNull();
  });
  it("rejects an unknown position id", () => {
    expect(validateCaretakerPosition("US", "minister_of_nonsense")).toBe("invalid-position");
  });
});

describe("appointCaretakerMinister (I/O)", () => {
  let db: MockDb;
  const nppId = new ObjectId();
  const appointingCharacterId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    vi.mocked(db.collection("npps").findOne).mockResolvedValue({
      _id: nppId,
      name: "Jane Caretaker",
      party: "5",
      countryId: "US",
      retiredAt: null,
    } as never);
    // No existing seat held by this NPP.
    vi.mocked(db.collection("cabinetMembers").findOne).mockResolvedValue(null);
  });

  it("installs the caretaker seat with isNPP + appointedByCharacterId", async () => {
    const result = await appointCaretakerMinister(db as unknown as Db, {
      countryId: "US",
      positionId: "secretary_of_state",
      nppId,
      appointingCharacterId,
      now,
    });
    expect(result.ok).toBe(true);
    expect(result.nppName).toBe("Jane Caretaker");

    // Replaces any current holder, then inserts the NPP seat.
    expect(db.collectionMocks["cabinetMembers"]!.deleteOne).toHaveBeenCalledWith({
      countryId: "US",
      positionId: "secretary_of_state",
    });
    const inserted = db.collectionMocks["cabinetMembers"]!.insertOne.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(inserted.isNPP).toBe(true);
    expect((inserted.nppId as ObjectId).equals(nppId)).toBe(true);
    expect(inserted.characterId).toBeNull();
    expect((inserted.appointedByCharacterId as ObjectId).equals(appointingCharacterId)).toBe(true);
    expect(inserted.ministerialActions).toBeTypeOf("number");
  });

  it("rejects an unknown position without touching the DB", async () => {
    const result = await appointCaretakerMinister(db as unknown as Db, {
      countryId: "US",
      positionId: "not_a_real_seat",
      nppId,
      appointingCharacterId,
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid-position");
    expect(db.collectionMocks["npps"]!.findOne).not.toHaveBeenCalled();
  });

  it("rejects an NPP from another country", async () => {
    vi.mocked(db.collection("npps").findOne).mockResolvedValue({
      _id: nppId,
      name: "Foreign NPP",
      party: "5",
      countryId: "BR",
      retiredAt: null,
    } as never);
    const result = await appointCaretakerMinister(db as unknown as Db, {
      countryId: "US",
      positionId: "secretary_of_state",
      nppId,
      appointingCharacterId,
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("npp-wrong-country");
  });

  it("rejects a retired NPP", async () => {
    vi.mocked(db.collection("npps").findOne).mockResolvedValue({
      _id: nppId,
      name: "Retired NPP",
      party: "5",
      countryId: "US",
      retiredAt: new Date(),
    } as never);
    const result = await appointCaretakerMinister(db as unknown as Db, {
      countryId: "US",
      positionId: "secretary_of_state",
      nppId,
      appointingCharacterId,
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("npp-retired");
  });

  it("rejects an NPP that already holds a seat", async () => {
    vi.mocked(db.collection("cabinetMembers").findOne).mockResolvedValue({
      _id: new ObjectId(),
      positionId: "secretary_of_treasury",
    } as never);
    const result = await appointCaretakerMinister(db as unknown as Db, {
      countryId: "US",
      positionId: "secretary_of_state",
      nppId,
      appointingCharacterId,
      now,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("npp-already-seated");
    expect(db.collectionMocks["cabinetMembers"]!.insertOne).not.toHaveBeenCalled();
  });
});

describe("dismissCaretakerMinister (I/O)", () => {
  it("deletes only a player-appointed NPP caretaker seat", async () => {
    const db = createMockDb();
    vi.mocked(db.collection("cabinetMembers").deleteOne).mockResolvedValue({
      deletedCount: 1,
    } as never);
    const result = await dismissCaretakerMinister(db as unknown as Db, {
      countryId: "US",
      positionId: "secretary_of_state",
    });
    expect(result.ok).toBe(true);
    // The delete filter guards on isNPP + a human appointer.
    expect(db.collectionMocks["cabinetMembers"]!.deleteOne).toHaveBeenCalledWith({
      countryId: "US",
      positionId: "secretary_of_state",
      isNPP: true,
      appointedByCharacterId: { $ne: null },
    });
  });

  it("is a no-op error when the seat is not a caretaker", async () => {
    const db = createMockDb();
    vi.mocked(db.collection("cabinetMembers").deleteOne).mockResolvedValue({
      deletedCount: 0,
    } as never);
    const result = await dismissCaretakerMinister(db as unknown as Db, {
      countryId: "US",
      positionId: "secretary_of_state",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not-caretaker");
  });
});
