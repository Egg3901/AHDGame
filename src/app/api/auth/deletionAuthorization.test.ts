import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  requireBasicAuth: vi.fn(),
  requireAdmin: vi.fn(),
  verifyAuth: vi.fn(),
  clearAuthCookie: vi.fn(),
  getDb: vi.fn(),
  userFind: vi.fn(),
  characterFind: vi.fn(),
  deleteOne: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
  audit: vi.fn(),
  cascade: vi.fn(),
  stamp: vi.fn(),
  caucus: vi.fn(),
  activity: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  verifyAuth: mocks.verifyAuth,
  clearAuthCookie: mocks.clearAuthCookie,
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: mocks.requireBasicAuth }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: mocks.audit }));
vi.mock("@/lib/account/cascadeCharacterDeletion", () => ({
  cascadeCharacterDeletion: mocks.cascade,
}));
vi.mock("@/lib/financialTxLog/stampDeleted", () => ({ stampSubjectDeleted: mocks.stamp }));
vi.mock("@/lib/caucus/cleanupCaucusParticipationForCharacters", () => ({
  cleanupCaucusParticipationForCharacters: mocks.caucus,
}));
vi.mock("@/lib/db/collections/activityLog", () => ({ logCharacterDeleted: mocks.activity }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/api/errors", () => ({
  handleRouteError: () => new Response(null, { status: 500 }),
}));

import { DELETE as selfDelete } from "./delete-account/route";
import { POST as adminDelete } from "../admin/users/delete/route";

const userId = new ObjectId("000000000000000000000001");
const cutoff = new Date("2026-01-01T00:00:00Z");
const issuedAt = new Date("2026-01-02T00:00:00Z").getTime() / 1000;
const account = () => ({
  _id: userId,
  username: "synthetic-account",
  role: "user",
  isAdmin: false,
  authRevokedAt: cutoff,
});
const request = () =>
  new Request("https://game.example.invalid/api/admin/users/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: userId.toHexString() }),
  });

function expectNoDeletion() {
  for (const fn of [
    mocks.deleteOne,
    mocks.deleteMany,
    mocks.updateMany,
    mocks.audit,
    mocks.cascade,
    mocks.stamp,
    mocks.caucus,
    mocks.activity,
    mocks.clearAuthCookie,
  ]) {
    expect(fn).not.toHaveBeenCalled();
  }
  expect(mocks.characterFind).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireBasicAuth.mockResolvedValue({
    ok: true,
    user: { userId: userId.toHexString(), isAdmin: false },
  });
  mocks.requireAdmin.mockResolvedValue({
    ok: true,
    admin: { userId: "000000000000000000000002", username: "synthetic-admin" },
  });
  mocks.verifyAuth.mockResolvedValue({ userId: userId.toHexString(), role: "user", iat: issuedAt });
  mocks.userFind.mockResolvedValue(account());
  mocks.characterFind.mockResolvedValue(null);
  mocks.deleteOne.mockResolvedValue({ acknowledged: true, deletedCount: 1 });
  mocks.deleteMany.mockResolvedValue({ acknowledged: true, deletedCount: 0 });
  mocks.getDb.mockResolvedValue({
    collection: (name: string) => ({
      findOne: name === "users" ? mocks.userFind : mocks.characterFind,
      deleteOne: mocks.deleteOne,
      deleteMany: mocks.deleteMany,
      updateMany: mocks.updateMany,
    }),
  });
});

describe("deletion authorization before the legacy cascade", () => {
  it.each([
    null,
    { userId: userId.toHexString() },
    { userId: "000000000000000000000003", iat: issuedAt },
    { userId: userId.toHexString(), iat: cutoff.getTime() / 1000 },
  ])(
    "rejects a missing, changed or revoked verified session despite a cached principal",
    async (payload) => {
      mocks.verifyAuth.mockResolvedValue(payload);
      const response = await selfDelete();
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expectNoDeletion();
    }
  );

  it.each(["invalid", 0, new Date("invalid")])(
    "rejects malformed fresh revocation state",
    async (authRevokedAt) => {
      mocks.userFind.mockResolvedValue({ ...account(), authRevokedAt });
      expect((await selfDelete()).status).toBe(401);
      expectNoDeletion();
    }
  );

  it("rejects a newly banned account before any destructive work", async () => {
    mocks.userFind.mockResolvedValue({ ...account(), isBanned: true });
    expect((await selfDelete()).status).toBe(401);
    expectNoDeletion();
  });

  for (const [name, invoke] of [
    ["self", () => selfDelete()],
    ["admin", () => adminDelete(request())],
  ] as const) {
    it.each([null, {}, "malformed", undefined])(
      `${name} rejects every present source fence`,
      async (authMigrationFence) => {
        mocks.userFind.mockResolvedValue({ ...account(), authMigrationFence });
        const response = await invoke();
        expect(response.status).toBe(409);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expectNoDeletion();
      }
    );

    it.each([{ isAdmin: true }, { role: "admin" }])(
      `${name} protects current admin authority`,
      async (authority) => {
        mocks.userFind.mockResolvedValue({ ...account(), ...authority });
        expect((await invoke()).status).toBe(400);
        expectNoDeletion();
      }
    );

    it(`${name} fails closed on an unavailable fresh account read`, async () => {
      mocks.userFind.mockRejectedValue(new Error("synthetic database failure"));
      const response = await invoke();
      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expectNoDeletion();
    });

    it(`${name} retains successful deletion for a current unfenced ordinary account`, async () => {
      const response = await invoke();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toMatchObject({ success: true });
      expect(mocks.deleteOne).toHaveBeenCalledWith({ _id: userId });
    });
  }
});
