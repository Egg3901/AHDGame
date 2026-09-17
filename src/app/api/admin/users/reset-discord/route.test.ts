import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getDb: vi.fn(),
  usersFindOne: vi.fn(),
  usersUpdateOne: vi.fn(),
  charactersFindOne: vi.fn(),
  createAdminLog: vi.fn(),
  invalidateCachedUser: vi.fn(),
}));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: mocks.createAdminLog }));
vi.mock("@/lib/auth/userDocCache", () => ({ invalidateCachedUser: mocks.invalidateCachedUser }));
vi.mock("@/lib/api/errors", () => ({
  handleRouteError: () => new Response(null, { status: 500 }),
}));

import { POST } from "./route";

const targetId = new ObjectId("000000000000000000000001");
const targetHex = targetId.toHexString();
const cutoff = new Date("2026-01-01T00:00:00Z");

let targetDoc: Record<string, unknown> | null;
let duplicateDoc: Record<string, unknown> | null;

const post = (body: unknown) =>
  new Request("https://game.example.invalid/api/admin/users/reset-discord", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const validBody = () => post({ userId: targetHex });

function linkedTarget(overrides: Record<string, unknown> = {}) {
  return {
    _id: targetId,
    username: "synthetic-user",
    password: "synthetic-password-digest",
    googleId: "synthetic-google-id",
    discordId: "synthetic-discord-id",
    discordUsername: "synthetic-discord-user",
    authRevokedAt: cutoff,
    updatedAt: cutoff,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  targetDoc = linkedTarget();
  duplicateDoc = null;
  mocks.requireAdmin.mockResolvedValue({
    ok: true,
    admin: { username: "synthetic-admin" },
  });
  mocks.usersFindOne.mockImplementation((filter: Record<string, unknown>) => {
    const idFilter = filter._id as Record<string, unknown> | undefined;
    if (idFilter && "$ne" in idFilter) return Promise.resolve(duplicateDoc);
    return Promise.resolve(targetDoc);
  });
  mocks.usersUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
  mocks.charactersFindOne.mockResolvedValue({ name: "synthetic-character" });
  mocks.createAdminLog.mockResolvedValue(undefined);
  mocks.getDb.mockResolvedValue({
    // No updateMany: any bulk unlink attempt throws instead of partially applying.
    collection: (name: string) =>
      name === "users"
        ? { findOne: mocks.usersFindOne, updateOne: mocks.usersUpdateOne }
        : { findOne: mocks.charactersFindOne },
  });
});

describe("POST /api/admin/users/reset-discord", () => {
  it("unlinks only the target with an exact snapshot CAS and honest single-account shape", async () => {
    const response = await POST(validBody());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ success: true, affectedAccounts: 1 });
    expect(JSON.stringify(body)).not.toContain("account(s)");

    expect(mocks.usersUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = mocks.usersUpdateOne.mock.calls[0];
    expect(filter).toEqual({
      _id: targetId,
      password: "synthetic-password-digest",
      googleId: "synthetic-google-id",
      discordId: "synthetic-discord-id",
      authRevokedAt: cutoff,
      authMigrationFence: { $exists: false },
    });
    expect(update.$unset).toEqual({
      discordId: "",
      discordUsername: "",
      discordAvatar: "",
      discordLinkedAt: "",
    });
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(update.$max.authRevokedAt).toBeInstanceOf(Date);
    expect(update.$max.authRevokedAt.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
    expect(JSON.stringify(update)).not.toContain("isBanned");

    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateCachedUser).toHaveBeenCalledWith(targetHex);
    const [evictBefore, evictAfter] = mocks.invalidateCachedUser.mock.invocationCallOrder;
    const [writeAt] = mocks.usersUpdateOne.mock.invocationCallOrder;
    expect(evictBefore).toBeLessThan(writeAt);
    expect(evictAfter).toBeGreaterThan(writeAt);

    expect(mocks.createAdminLog).toHaveBeenCalledTimes(1);
    expect(mocks.createAdminLog.mock.calls[0][0]).toMatchObject({
      category: "account",
      action: "discord_reset",
      username: "synthetic-user",
      characterName: "synthetic-character",
      adminUsername: "synthetic-admin",
    });
    expect(JSON.stringify(mocks.createAdminLog.mock.calls[0][0])).not.toContain("account(s)");
  });

  it("rejects a fenced target on read, including null and malformed markers", async () => {
    for (const authMigrationFence of ["synthetic-fence", null, 42]) {
      vi.resetAllMocks();
      mocks.requireAdmin.mockResolvedValue({
        ok: true,
        admin: { username: "synthetic-admin" },
      });
      mocks.getDb.mockResolvedValue({
        collection: () => ({ findOne: mocks.usersFindOne }),
      });
      targetDoc = linkedTarget({ authMigrationFence });
      mocks.usersFindOne.mockResolvedValue(targetDoc);

      const response = await POST(validBody());
      expect(response.status).toBe(409);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect((await response.json()).success).not.toBe(true);
    }
    expect(mocks.usersUpdateOne).not.toHaveBeenCalled();
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });

  it("reports a concurrent fence landing as a 409 without auditing", async () => {
    mocks.usersUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });
    const response = await POST(validBody());
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).success).not.toBe(true);
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the revocation snapshot is malformed", async () => {
    targetDoc = linkedTarget({ authRevokedAt: "synthetic-junk-cutoff" });
    mocks.usersUpdateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });
    const response = await POST(validBody());
    expect(response.status).toBe(409);
    const [filter] = mocks.usersUpdateOne.mock.calls[0];
    expect(filter).toMatchObject({
      $and: [{ authRevokedAt: { $exists: true } }, { authRevokedAt: { $exists: false } }],
    });
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
  });

  it("repairs a banned target without touching ban flags or roles", async () => {
    targetDoc = linkedTarget({ isBanned: true, banReason: "synthetic-reason" });
    const response = await POST(validBody());
    expect(response.status).toBe(200);
    expect((await response.json()).affectedAccounts).toBe(1);
    const [filter, update] = mocks.usersUpdateOne.mock.calls[0];
    expect(filter).not.toHaveProperty("isBanned");
    expect(JSON.stringify(update)).not.toContain("isBanned");
    expect(JSON.stringify(update)).not.toContain("banReason");
    expect(JSON.stringify(update)).not.toContain("role");
  });

  it("allows unlink when Google remains but no password is set", async () => {
    targetDoc = linkedTarget({ password: "" });
    const response = await POST(validBody());
    expect(response.status).toBe(200);
    expect((await response.json()).affectedAccounts).toBe(1);
  });

  it("denies removing the last usable login method", async () => {
    targetDoc = linkedTarget({ password: "", googleId: undefined });
    const response = await POST(validBody());
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body.success).not.toBe(true);
    expect(String(body.error)).toContain("another login method");
    expect(mocks.usersUpdateOne).not.toHaveBeenCalled();
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });

  it("fails closed when another account holds the same Discord id", async () => {
    duplicateDoc = { _id: new ObjectId("000000000000000000000002") };
    const response = await POST(validBody());
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.usersUpdateOne).not.toHaveBeenCalled();
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });

  it("is idempotent with no credential write when no Discord is linked", async () => {
    targetDoc = linkedTarget({ discordId: undefined, discordUsername: undefined });
    const response = await POST(validBody());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ success: true, affectedAccounts: 0 });
    expect(mocks.usersUpdateOne).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when the write is unacknowledged", async () => {
    mocks.usersUpdateOne.mockResolvedValue({ acknowledged: false, matchedCount: 1 });
    const response = await POST(validBody());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).success).not.toBe(true);
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("returns retryable 503 when the write is rejected", async () => {
    mocks.usersUpdateOne.mockRejectedValue(new Error("synthetic unavailable"));
    const response = await POST(validBody());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).success).not.toBe(true);
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("does not settle or audit while the unlink write is pending", async () => {
    let finish!: (value: { acknowledged: boolean; matchedCount: number }) => void;
    mocks.usersUpdateOne.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    let settled = false;
    const pending = POST(validBody()).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(mocks.usersUpdateOne).toHaveBeenCalled());
    expect(settled).toBe(false);
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    finish({ acknowledged: true, matchedCount: 1 });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(mocks.createAdminLog).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed unlink when the character lookup fails", async () => {
    mocks.charactersFindOne.mockRejectedValue(new Error("synthetic lookup unavailable"));
    const response = await POST(validBody());
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(mocks.createAdminLog).toHaveBeenCalledTimes(1);
    expect(mocks.createAdminLog.mock.calls[0][0].characterName).toBeUndefined();
  });

  it("keeps the committed unlink when audit storage fails", async () => {
    mocks.createAdminLog.mockRejectedValue(new Error("synthetic audit unavailable"));
    const response = await POST(validBody());
    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
  });

  it("rejects malformed ids that the old length check accepted", async () => {
    for (const userId of ["zzzzzzzzzzzzzzzzzzzzzzzz", "short", "000000000000000000000001!"]) {
      const response = await POST(post({ userId }));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.usersUpdateOne).not.toHaveBeenCalled();
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
  });

  it("returns 404 without writing or auditing for a missing account", async () => {
    targetDoc = null;
    const response = await POST(validBody());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.usersUpdateOne).not.toHaveBeenCalled();
    expect(mocks.createAdminLog).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });
});
