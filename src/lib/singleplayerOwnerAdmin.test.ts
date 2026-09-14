import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  promoteSingleplayerOwnerIfNoAdmin,
  shouldGrantOwnerAdminOnRegister,
} from "./singleplayerOwnerAdmin";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("shouldGrantOwnerAdminOnRegister", () => {
  it("grants admin to the first account of a singleplayer world", () => {
    expect(shouldGrantOwnerAdminOnRegister({ singleplayer: true, existingUserCount: 0 })).toBe(
      true
    );
  });

  it("never grants on multiplayer, even for the first account", () => {
    expect(shouldGrantOwnerAdminOnRegister({ singleplayer: false, existingUserCount: 0 })).toBe(
      false
    );
  });

  it("never grants past the first account", () => {
    expect(shouldGrantOwnerAdminOnRegister({ singleplayer: true, existingUserCount: 2 })).toBe(
      false
    );
  });
});

describe("promoteSingleplayerOwnerIfNoAdmin", () => {
  function mockUsers(adminCount: number, earliest: { _id: ObjectId } | null) {
    const db = createMockDb();
    db.collection("users");
    db.collectionMocks["users"]!.countDocuments.mockResolvedValue(adminCount);
    db.collectionMocks["users"]!.findOne.mockResolvedValue(earliest);
    return db;
  }

  it("promotes the earliest user when no admin exists", async () => {
    const earliestId = new ObjectId();
    const db = mockUsers(0, { _id: earliestId });

    const result = await promoteSingleplayerOwnerIfNoAdmin(db as never);

    expect(result).toEqual({ promoted: true, userId: earliestId.toString() });
    expect(db.collectionMocks["users"]!.updateOne).toHaveBeenCalledWith(
      { _id: earliestId },
      { $set: { isAdmin: true, updatedAt: expect.any(Date) } }
    );
  });

  it("does nothing when an admin already exists", async () => {
    const db = mockUsers(1, { _id: new ObjectId() });

    await expect(promoteSingleplayerOwnerIfNoAdmin(db as never)).resolves.toEqual({
      promoted: false,
    });
    expect(db.collectionMocks["users"]!.updateOne).not.toHaveBeenCalled();
  });

  it("does nothing with no users at all", async () => {
    const db = mockUsers(0, null);

    await expect(promoteSingleplayerOwnerIfNoAdmin(db as never)).resolves.toEqual({
      promoted: false,
    });
    expect(db.collectionMocks["users"]!.updateOne).not.toHaveBeenCalled();
  });
});
