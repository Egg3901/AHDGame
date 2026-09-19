import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { hasRequiredPrimeMinisterSeat } from "./pmSeatEligibility";
import { isSingleplayer } from "@/lib/singleplayer";
vi.mock("@/lib/singleplayer", () => ({ isSingleplayer: vi.fn().mockReturnValue(false) }));
beforeEach(() => vi.mocked(isSingleplayer).mockReturnValue(false));
describe("UK PM seat eligibility", () => {
  it("requires the player's UK Commons seat and projects only its ID", async () => {
    const db = createMockDb();
    const id = new ObjectId();
    expect(await hasRequiredPrimeMinisterSeat(db as unknown as Db, "UK", id, null)).toBe(false);
    expect(db.collectionMocks.electedOfficials.findOne).toHaveBeenCalledWith(
      { countryId: "UK", officeType: "commons", characterId: id },
      { projection: { _id: 1 } }
    );
    db.collectionMocks.electedOfficials.findOne.mockResolvedValue({ _id: new ObjectId() });
    expect(await hasRequiredPrimeMinisterSeat(db as unknown as Db, "UK", id, null)).toBe(true);
  });
  it("checks NPP holders through their Commons seat", async () => {
    const db = createMockDb();
    const id = new ObjectId();
    expect(await hasRequiredPrimeMinisterSeat(db as unknown as Db, "UK", null, id)).toBe(false);
    expect(db.collectionMocks.electedOfficials.findOne).toHaveBeenCalledWith(
      { countryId: "UK", officeType: "commons", nppId: id, isNPP: true },
      { projection: { _id: 1 } }
    );
  });
  it("does not add a UK seat requirement to other governments", async () => {
    const db = createMockDb();
    expect(
      await hasRequiredPrimeMinisterSeat(db as unknown as Db, "IE", new ObjectId(), null)
    ).toBe(true);
    expect(db.collection).not.toHaveBeenCalled();
  });
  it("preserves the explicitly pinned singleplayer head of state", async () => {
    const db = createMockDb();
    vi.mocked(isSingleplayer).mockReturnValue(true);
    db.collection("characters").findOne.mockResolvedValue({ _id: new ObjectId() });
    expect(
      await hasRequiredPrimeMinisterSeat(db as unknown as Db, "UK", new ObjectId(), null)
    ).toBe(true);
    expect(db.collectionMocks.electedOfficials).toBeUndefined();
  });
});
