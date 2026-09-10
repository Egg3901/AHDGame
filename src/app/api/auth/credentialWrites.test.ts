import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  getDb: vi.fn(),
  findOne: vi.fn(),
  updateOne: vi.fn(),
  requireBasicAuth: vi.fn(),
  parseJsonBody: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
  consumePasswordReset: vi.fn(),
  invalidateCachedUser: vi.fn(),
  recordAudit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: mocks.requireBasicAuth }));
vi.mock("@/lib/api/validate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/validate")>()),
  parseJsonBody: mocks.parseJsonBody,
}));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare, hash: mocks.hash } }));
vi.mock("@/lib/passwordReset", () => ({ consumePasswordReset: mocks.consumePasswordReset }));
vi.mock("@/lib/auth/userDocCache", () => ({ invalidateCachedUser: mocks.invalidateCachedUser }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/utils/network", () => ({ getClientIp: async () => "192.0.2.1" }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: vi.fn(),
  AUTH_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));
vi.mock("@/lib/api/rateLimit.mongo", () => ({
  durableRateLimit: async () => ({ ok: true }),
}));
vi.mock("@/lib/api/errors", () => ({
  handleRouteError: () => new Response(null, { status: 500 }),
}));

import { POST as changePassword } from "./change-password/route";
import { POST as setPassword } from "./set-password/route";
import { POST as resetPassword } from "./reset-password/route";

const id = new ObjectId("000000000000000000000001");
const cutoff = new Date("2026-01-01T00:00:00Z");
const issuedAt = new Date("2026-01-02T00:00:00Z");
const request = () =>
  new Request("https://game.example.invalid/api/auth/password", { method: "POST" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDb.mockResolvedValue({
    collection: () => ({ findOne: mocks.findOne, updateOne: mocks.updateOne }),
  });
  mocks.findOne.mockResolvedValue({
    _id: id,
    password: "synthetic-old-digest",
    authRevokedAt: cutoff,
  });
  mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
  mocks.requireBasicAuth.mockResolvedValue({ ok: true, user: { userId: id.toHexString() } });
  mocks.parseJsonBody.mockResolvedValue({
    success: true,
    data: {
      currentPassword: "synthetic-current-password",
      newPassword: "synthetic-new-password",
      password: "synthetic-reset-password",
      token: "synthetic-reset-token",
    },
  });
  mocks.verifyAuth.mockResolvedValue({ userId: id.toHexString(), iat: issuedAt.getTime() / 1000 });
  mocks.compare.mockResolvedValue(true);
  mocks.hash.mockResolvedValue("synthetic-new-digest");
  mocks.consumePasswordReset.mockResolvedValue({ userId: id, createdAt: issuedAt });
});

describe("conditional credential writes", () => {
  for (const [name, route, password] of [
    ["change", changePassword, "synthetic-old-digest"],
    ["set", setPassword, undefined],
    ["reset", resetPassword, "synthetic-old-digest"],
  ] as const) {
    it(`${name} binds the write to the credential and revocation snapshot`, async () => {
      mocks.findOne.mockResolvedValue({ _id: id, password, authRevokedAt: cutoff });
      const response = await route(request());
      expect(response.status).toBe(200);
      const [filter, update] = mocks.updateOne.mock.calls[0];
      expect(filter).toEqual({
        _id: id,
        password: password ?? null,
        authRevokedAt: cutoff,
        ...(name === "reset" ? {} : { isBanned: { $ne: true } }),
      });
      expect(update.$set).toEqual({ password: "synthetic-new-digest" });
      expect(update.$max.authRevokedAt).toBeInstanceOf(Date);
      expect(update.$max.passwordChangedAt).toEqual(update.$max.authRevokedAt);
      expect(mocks.invalidateCachedUser).toHaveBeenCalledExactlyOnceWith(id.toHexString());
    });

    it(`${name} reports a concurrent account change without claiming success`, async () => {
      mocks.findOne.mockResolvedValue({ _id: id, password, authRevokedAt: cutoff });
      mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });
      const response = await route(request());
      expect(response.status).toBe(409);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
      expect(mocks.recordAudit).not.toHaveBeenCalled();
    });
  }

  for (const [name, route] of [
    ["change", changePassword],
    ["set", setPassword],
  ] as const) {
    for (const restricted of [{ isBanned: true }, { authRevokedAt: issuedAt }]) {
      it(`${name} rejects fresh account restrictions despite a cached basic-auth grant: ${JSON.stringify(restricted)}`, async () => {
        mocks.findOne.mockResolvedValue({ _id: id, password: undefined, ...restricted });
        const response = await route(request());
        expect(response.status).toBe(401);
        expect(mocks.hash).not.toHaveBeenCalled();
        expect(mocks.updateOne).not.toHaveBeenCalled();
      });
    }
    it(`${name} requires the freshly verified session to own this account`, async () => {
      mocks.verifyAuth.mockResolvedValue({
        userId: new ObjectId().toHexString(),
        iat: issuedAt.getTime() / 1000,
      });
      expect((await route(request())).status).toBe(401);
      expect(mocks.updateOne).not.toHaveBeenCalled();
    });
  }

  it("does not overwrite an existing password through first-password setup", async () => {
    expect((await setPassword(request())).status).toBe(400);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("does not write when the current password is incorrect", async () => {
    mocks.compare.mockResolvedValue(false);
    expect((await changePassword(request())).status).toBe(401);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  for (const changedAt of [
    issuedAt,
    new Date(issuedAt.getTime() + 1000),
    "invalid",
    new Date(NaN),
  ]) {
    it(`rejects a reset link older than the current credential or malformed credential time: ${String(changedAt)}`, async () => {
      mocks.findOne.mockResolvedValue({
        _id: id,
        password: "digest",
        passwordChangedAt: changedAt,
      });
      expect((await resetPassword(request())).status).toBe(400);
      expect(mocks.hash).not.toHaveBeenCalled();
      expect(mocks.updateOne).not.toHaveBeenCalled();
    });
  }

  it("accepts fresh reset proof after the last credential change", async () => {
    mocks.findOne.mockResolvedValue({ _id: id, password: "digest", passwordChangedAt: cutoff });
    expect((await resetPassword(request())).status).toBe(200);
  });

  it("rejects consumed reset proof for a missing account", async () => {
    mocks.findOne.mockResolvedValue(null);
    expect((await resetPassword(request())).status).toBe(400);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
});
