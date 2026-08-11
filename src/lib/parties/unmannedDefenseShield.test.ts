import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { resolveUnmannedDefaultCaptureMultiplier } from "./unmannedDefenseShield";
import { DEFENSE_UNMANNED_CAPTURE_MULTIPLIER } from "@/lib/turn/partyOrg/defenseConstants";

function setup() {
  const db = createMockDb();
  db.collection("characters");
  db.collection("users");
  return db;
}

describe("resolveUnmannedDefaultCaptureMultiplier", () => {
  it("returns 1.0 for a non-default (custom) party — customs get no shield", async () => {
    const db = setup();
    const mult = await resolveUnmannedDefaultCaptureMultiplier(db as unknown as Db, {
      isDefault: false,
      chairId: new ObjectId(),
    });
    expect(mult).toBe(1);
  });

  it("shields a default party with a vacant chair (0.5×)", async () => {
    const db = setup();
    const mult = await resolveUnmannedDefaultCaptureMultiplier(db as unknown as Db, {
      isDefault: true,
      chairId: null,
    });
    expect(mult).toBe(DEFENSE_UNMANNED_CAPTURE_MULTIPLIER);
  });

  it("shields a default party whose chair is an NPP (character has no userId)", async () => {
    const db = setup();
    db.collectionMocks.characters.findOne.mockResolvedValue({ _id: new ObjectId() });
    const mult = await resolveUnmannedDefaultCaptureMultiplier(db as unknown as Db, {
      isDefault: true,
      chairId: new ObjectId(),
    });
    expect(mult).toBe(DEFENSE_UNMANNED_CAPTURE_MULTIPLIER);
  });

  it("shields a default party whose chair's user is banned", async () => {
    const db = setup();
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: new ObjectId(),
      userId: new ObjectId(),
    });
    db.collectionMocks.users.findOne.mockResolvedValue(null); // banned → filtered out → not found
    const mult = await resolveUnmannedDefaultCaptureMultiplier(db as unknown as Db, {
      isDefault: true,
      chairId: new ObjectId(),
    });
    expect(mult).toBe(DEFENSE_UNMANNED_CAPTURE_MULTIPLIER);
  });

  it("returns 1.0 for a default party with an active human chair — no shield", async () => {
    const db = setup();
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: new ObjectId(),
      userId: new ObjectId(),
    });
    db.collectionMocks.users.findOne.mockResolvedValue({ _id: new ObjectId() }); // active, not banned
    const mult = await resolveUnmannedDefaultCaptureMultiplier(db as unknown as Db, {
      isDefault: true,
      chairId: new ObjectId(),
    });
    expect(mult).toBe(1);
  });
});
