import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { dispatchNativePush } from "./dispatcher";
import { sendNativePush } from "./providers";
import { pushDevices } from "./devices";
import type { PushDevice } from "./types";

vi.mock("./providers", () => ({ providerConfigured: vi.fn(() => true), sendNativePush: vi.fn() }));
vi.mock("./devices", () => ({ pushDevices: vi.fn() }));
let db: MockDb;
const device: PushDevice = {
  _id: "installation-hash",
  userId: new ObjectId(),
  token: "token",
  tokenHash: "token-hash",
  provider: "fcm",
  environment: "production",
  revision: "lease-revision",
  cursorAt: new Date(Date.now() - 60_000),
  cursorId: new ObjectId("000000000000000000000000"),
  expiresAt: new Date(Date.now() + 60_000),
  nextAttemptAt: new Date(),
  leaseUntil: new Date(),
};
const notification = {
  _id: new ObjectId(),
  type: "general_win",
  read: false,
  createdAt: new Date(),
};
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  const devices = db.collection("nativePushDevices");
  vi.mocked(pushDevices).mockResolvedValue(devices);
  devices.findOneAndUpdate.mockResolvedValue(null).mockResolvedValueOnce(device);
  devices.findOne.mockResolvedValue(device);
  db.collection("users").findOne.mockResolvedValue({ notificationPreferences: {} });
  db.collection("notifications").find().toArray.mockResolvedValue([notification]);
  vi.mocked(sendNativePush).mockResolvedValue("sent");
});
describe("native push inbox dispatch", () => {
  it("sends one private alert for new activity and advances only the leased device", async () => {
    await dispatchNativePush(db as unknown as Db);
    expect(sendNativePush).toHaveBeenCalledWith(device);
    expect(db.collection("nativePushDevices").updateOne).toHaveBeenCalledWith(
      { _id: device._id, revision: device.revision },
      expect.objectContaining({ $set: expect.objectContaining({ cursorId: notification._id }) })
    );
  });
  it("advances muted activity without delivering it", async () => {
    db.collection("users").findOne.mockResolvedValue({
      notificationPreferences: { mutedTypes: ["general_win"] },
    });
    await dispatchNativePush(db as unknown as Db);
    expect(sendNativePush).not.toHaveBeenCalled();
    expect(db.collection("nativePushDevices").updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ cursorId: notification._id }) })
    );
  });
  it("does not send after an installation is revoked or rebound", async () => {
    db.collection("nativePushDevices").findOne.mockResolvedValue(null);
    await dispatchNativePush(db as unknown as Db);
    expect(sendNativePush).not.toHaveBeenCalled();
  });
  it("keeps the cursor for provider retries and removes only explicitly invalid tokens", async () => {
    vi.mocked(sendNativePush).mockResolvedValue("retry");
    await dispatchNativePush(db as unknown as Db);
    expect(db.collection("nativePushDevices").updateOne.mock.calls[0][1].$set).not.toHaveProperty(
      "cursorId"
    );
    expect(db.collection("nativePushDevices").deleteOne).not.toHaveBeenCalled();
    db.collection("nativePushDevices").findOneAndUpdate.mockResolvedValueOnce(device);
    vi.mocked(sendNativePush).mockResolvedValue("invalid");
    await dispatchNativePush(db as unknown as Db);
    expect(db.collection("nativePushDevices").deleteOne).toHaveBeenCalledWith({
      _id: device._id,
      revision: device.revision,
    });
  });
});
