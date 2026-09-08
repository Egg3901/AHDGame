import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { installationHash, registerDevice, revokeDevice } from "./devices";
let db: MockDb;
const userId = new ObjectId();
const input = {
  installation: "a".repeat(64),
  token: "b".repeat(64),
  provider: "fcm" as const,
  environment: "production" as const,
};
beforeEach(() => {
  db = createMockDb();
  Object.assign(db.collection("nativePushDevices"), {
    createIndexes: vi.fn().mockResolvedValue([]),
  });
});
describe("native push ownership", () => {
  it("hashes installation credentials and starts a new account at the current inbox position", async () => {
    const before = Date.now();
    await registerDevice(db as unknown as Db, userId, input);
    const [query, update] = db.collection("nativePushDevices").updateOne.mock.calls[0];
    expect(query).toEqual({ _id: installationHash(input.installation) });
    expect(update.$set.userId).toEqual(userId);
    expect(update.$set.cursorAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(JSON.stringify(update)).not.toContain(input.installation);
  });
  it("preserves an active cursor during token rotation instead of replaying activity", async () => {
    db.collection("nativePushDevices").findOne.mockResolvedValue({
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await registerDevice(db as unknown as Db, userId, input);
    expect(db.collection("nativePushDevices").updateOne.mock.calls[0][1].$set).not.toHaveProperty(
      "cursorAt"
    );
  });
  it("resets the cursor when the installation changes accounts", async () => {
    db.collection("nativePushDevices").findOne.mockResolvedValue({ userId: new ObjectId() });
    await registerDevice(db as unknown as Db, userId, input);
    expect(db.collection("nativePushDevices").updateOne.mock.calls[0][1].$set).toHaveProperty(
      "cursorAt"
    );
  });
  it("revokes using the installation hash without needing a login session", async () => {
    await revokeDevice(db as unknown as Db, input.installation);
    expect(db.collection("nativePushDevices").deleteOne).toHaveBeenCalledWith({
      _id: installationHash(input.installation),
    });
  });
});
