import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getDb: vi.fn(),
  parseJsonBody: vi.fn(),
  hash: vi.fn(),
  usersFindOne: vi.fn(),
  updateOne: vi.fn(),
  charactersFindOne: vi.fn(),
  createAdminLog: vi.fn(),
  invalidateCachedUser: vi.fn(),
}));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/api/validate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/validate")>()),
  parseJsonBody: mocks.parseJsonBody,
}));
vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash } }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: mocks.createAdminLog }));
vi.mock("@/lib/auth/userDocCache", () => ({ invalidateCachedUser: mocks.invalidateCachedUser }));
vi.mock("@/lib/api/errors", () => ({
  handleRouteError: () => new Response(null, { status: 500 }),
}));

import { POST } from "./route";

const targetId = new ObjectId("000000000000000000000001");
const targetHex = targetId.toHexString();
const cutoff = new Date("2026-01-01T00:00:00Z");
const request = () =>
  new Request("https://game.example.invalid/api/admin/users/reset-password", {
    method: "POST",
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({
    ok: true,
    admin: { username: "synthetic-admin" },
  });
  mocks.parseJsonBody.mockResolvedValue({
    success: true,
    data: { userId: targetHex, newPassword: "synthetic-new-password" },
  });
  mocks.usersFindOne.mockResolvedValue({
    _id: targetId,
    username: "synthetic-user",
    password: "synthetic-old-digest",
    authRevokedAt: cutoff,
    passwordChangedAt: cutoff,
    updatedAt: cutoff,
  });
  mocks.charactersFindOne.mockResolvedValue({ name: "synthetic-character" });
  mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
  mocks.hash.mockResolvedValue("synthetic-new-digest");
  mocks.createAdminLog.mockResolvedValue(undefined);
  mocks.getDb.mockResolvedValue({
    collection: (name: string) =>
      name === "users"
        ? { findOne: mocks.usersFindOne, updateOne: mocks.updateOne }
        : { findOne: mocks.charactersFindOne },
  });
});

describe("POST /api/admin/users/reset-password", () => {
  it("binds the write to the credential and revocation snapshot with monotonic timestamps", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ success: true });

    const [filter, update] = mocks.updateOne.mock.calls[0];
    expect(filter).toEqual({
      _id: targetId,
      password: "synthetic-old-digest",
      authRevokedAt: cutoff,
      authMigrationFence: { $exists: false },
    });
    expect(update.$set.password).toBe("synthetic-new-digest");
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(update.$max.passwordChangedAt).toBeInstanceOf(Date);
    expect(update.$max.authRevokedAt).toBeInstanceOf(Date);
    expect(update.$max.passwordChangedAt).toEqual(update.$max.authRevokedAt);
    expect(update.$max.authRevokedAt.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
    expect(update.$set.updatedAt.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
  });

  it("evicts the cached account before and after the write and audits without the secret", async () => {
    await POST(request());
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateCachedUser).toHaveBeenCalledWith(targetHex);
    const [evictBefore, evictAfter] = mocks.invalidateCachedUser.mock.invocationCallOrder;
    const [writeAt] = mocks.updateOne.mock.invocationCallOrder;
    expect(evictBefore).toBeLessThan(writeAt);
    expect(evictAfter).toBeGreaterThan(writeAt);

    expect(mocks.createAdminLog).toHaveBeenCalledTimes(1);
    const audit = mocks.createAdminLog.mock.calls[0][0];
    expect(audit).toMatchObject({
      category: "account",
      action: "password_reset",
      username: "synthetic-user",
      characterName: "synthetic-character",
      adminUsername: "synthetic-admin",
    });
    expect(JSON.stringify(audit)).not.toContain("synthetic-new-password");
    expect(JSON.stringify(audit)).not.toContain("synthetic-new-digest");
  });

  it("repairs a banned target without touching ban flags or roles", async () => {
    mocks.usersFindOne.mockResolvedValue({
      _id: targetId,
      username: "synthetic-user",
      password: "synthetic-old-digest",
      authRevokedAt: cutoff,
      isBanned: true,
      banReason: "synthetic-reason",
      role: "player",
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    const [filter, update] = mocks.updateOne.mock.calls[0];
    expect(filter).not.toHaveProperty("isBanned");
    expect(JSON.stringify(update)).not.toContain("isBanned");
    expect(JSON.stringify(update)).not.toContain("banReason");
    expect(JSON.stringify(update)).not.toContain("role");
  });

  it("reports a concurrent account change without claiming success or auditing", async () => {
    mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body.success).not.toBe(true);
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("returns retryable 503 when the write is unacknowledged", async () => {
    mocks.updateOne.mockResolvedValue({ acknowledged: false, matchedCount: 1 });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).success).not.toBe(true);
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("returns retryable 503 when the write is rejected", async () => {
    mocks.updateOne.mockRejectedValue(new Error("synthetic unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).success).not.toBe(true);
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("does not settle or audit while the security write is pending", async () => {
    let finish!: (value: { acknowledged: boolean; matchedCount: number }) => void;
    mocks.updateOne.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    let settled = false;
    const pending = POST(request()).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(mocks.updateOne).toHaveBeenCalled());
    expect(settled).toBe(false);
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    finish({ acknowledged: true, matchedCount: 1 });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(mocks.createAdminLog).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed password change when the character lookup fails", async () => {
    mocks.charactersFindOne.mockRejectedValue(new Error("synthetic lookup unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(mocks.createAdminLog).toHaveBeenCalledTimes(1);
    expect(mocks.createAdminLog.mock.calls[0][0].characterName).toBeUndefined();
  });

  it("keeps the committed password change when audit storage fails", async () => {
    mocks.createAdminLog.mockRejectedValue(new Error("synthetic audit unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
  });

  it("returns 404 without writing or auditing for a missing account", async () => {
    mocks.usersFindOne.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });
});

it.each([null, {}, "malformed", undefined])(
  "rejects a present migration fence before resetting credentials: %s",
  async (fence) => {
    mocks.usersFindOne.mockResolvedValue({
      _id: targetId,
      username: "synthetic-user",
      password: "synthetic-old-digest",
      authMigrationFence: fence,
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
  }
);
