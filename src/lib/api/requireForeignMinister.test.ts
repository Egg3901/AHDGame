/**
 * Tests for the NPP-aware behavior of requireForeignMinister: an NPP-held
 * foreign-minister seat (null characterId) is not owned by any player actor, so
 * it must be treated like a vacant seat and fall through to the head-of-gov
 * fallback — not 403 a head of government who is otherwise authorized.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { requireForeignMinister } from "./requireForeignMinister";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";

vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn(),
}));

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("cabinetMembers");
});

describe("requireForeignMinister — NPP-held seat", () => {
  it("falls through to the head-of-gov fallback when the FM seat is NPP-held", async () => {
    const hogCharId = new ObjectId();
    // FM seat exists but is held by an NPP (null characterId).
    db.collectionMocks["cabinetMembers"]!.findOne.mockResolvedValue({
      countryId: "US",
      positionId: "secretary_of_state",
      characterId: null,
      isNPP: true,
      nppId: new ObjectId(),
      characterName: "NPP Diplomat",
    });
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(hogCharId);

    const result = await requireForeignMinister(
      "US",
      hogCharId,
      "President Pat",
      db as unknown as Db
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.positionId).toBe("head_of_government");
    }
  });

  it("authorizes the character holder of an FM seat", async () => {
    const fmCharId = new ObjectId();
    db.collectionMocks["cabinetMembers"]!.findOne.mockResolvedValue({
      countryId: "US",
      positionId: "secretary_of_state",
      characterId: fmCharId,
      characterName: "Secretary Sam",
    });

    const result = await requireForeignMinister(
      "US",
      fmCharId,
      "Secretary Sam",
      db as unknown as Db
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.positionId).toBe("secretary_of_state");
    }
    expect(getHeadOfGovernmentCharacterId).not.toHaveBeenCalled();
  });

  it("forbids a non-FM actor when another player holds the FM seat", async () => {
    // The seat is filled by someone other than the actor — even the head of
    // government must not act while a foreign minister is seated.
    const seatedFmId = new ObjectId();
    const someoneElse = new ObjectId();
    db.collectionMocks["cabinetMembers"]!.findOne.mockResolvedValue({
      countryId: "CN",
      positionId: "minister_of_foreign_affairs",
      characterId: seatedFmId,
      characterName: "Seated Minister",
    });

    const result = await requireForeignMinister(
      "CN",
      someoneElse,
      "Some Premier",
      db as unknown as Db
    );

    expect(result.ok).toBe(false);
    expect(getHeadOfGovernmentCharacterId).not.toHaveBeenCalled();
  });
});
