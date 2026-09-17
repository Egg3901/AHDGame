import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  updateOne: vi.fn(),
  insertOne: vi.fn(),
  verifyAuth: vi.fn(),
  clearAuthCookie: vi.fn(),
  invalidateCachedUser: vi.fn(),
  recordAudit: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/utils/network", () => ({ getClientIp: async () => "192.0.2.1" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "synthetic-tracking" }) }),
}));
vi.mock("@/lib/auth", () => ({
  verifyAuth: mocks.verifyAuth,
  clearAuthCookie: mocks.clearAuthCookie,
}));
vi.mock("@/lib/auth/userDocCache", () => ({ invalidateCachedUser: mocks.invalidateCachedUser }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/api/errors", () => ({
  handleRouteError: () => new Response(null, { status: 500 }),
}));
import { POST } from "./route";

const id = new ObjectId("000000000000000000000001");
const request = () =>
  new Request("https://game.example.invalid/api/auth/logout", {
    method: "POST",
    headers: { "user-agent": "synthetic-test" },
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.verifyAuth.mockResolvedValue({ userId: id.toHexString(), username: "synthetic-user" });
  mocks.getDb.mockResolvedValue({
    collection: (name: string) =>
      name === "users" ? { updateOne: mocks.updateOne } : { insertOne: mocks.insertOne },
  });
  mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
  mocks.insertOne.mockResolvedValue({ acknowledged: true });
});

describe("confirmed account logout", () => {
  it("keeps the cutoff monotonic, evicts around the write and records activity", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ ok: true });
    const [filter, update] = mocks.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: id });
    expect(update.$max.authRevokedAt).toBeInstanceOf(Date);
    expect(update.$set.lastLogout).toEqual(update.$max.authRevokedAt);
    expect(update.$set).not.toHaveProperty("authRevokedAt");
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
    expect(update.$max).not.toHaveProperty("authMigrationFence");
    expect(mocks.clearAuthCookie).toHaveBeenCalledExactlyOnceWith("user_logout");
    expect(mocks.insertOne.mock.calls[0][0]).toMatchObject({
      type: "logout",
      userId: id,
      userAgent: "synthetic-test",
    });
  });

  it("does not clear cookies or settle while revocation is pending", async () => {
    let finish!: (value: { acknowledged: boolean }) => void;
    mocks.updateOne.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    let settled = false;
    const response = POST(request()).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(mocks.updateOne).toHaveBeenCalled());
    expect(settled).toBe(false);
    expect(mocks.clearAuthCookie).not.toHaveBeenCalled();
    finish({ acknowledged: true });
    expect((await response).status).toBe(200);
  });

  for (const failure of ["connection", "write", "unacknowledged"]) {
    it(`returns retryable 503 and retains credentials on ${failure} failure`, async () => {
      if (failure === "connection")
        mocks.getDb.mockRejectedValue(new Error("synthetic unavailable"));
      if (failure === "write")
        mocks.updateOne.mockRejectedValue(new Error("synthetic unavailable"));
      if (failure === "unacknowledged") mocks.updateOne.mockResolvedValue({ acknowledged: false });
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(mocks.clearAuthCookie).not.toHaveBeenCalled();
      expect(mocks.recordAudit).not.toHaveBeenCalled();
      expect(mocks.insertOne).not.toHaveBeenCalled();
    });
  }

  it("allows cookie cleanup when there is no authenticated account", async () => {
    mocks.verifyAuth.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.clearAuthCookie).toHaveBeenCalled();
  });

  it("does not make audit storage a condition of confirmed revocation", async () => {
    mocks.insertOne.mockRejectedValue(new Error("synthetic audit unavailable"));
    expect((await POST(request())).status).toBe(200);
    expect(mocks.clearAuthCookie).toHaveBeenCalled();
  });
});

describe("fenced account logout", () => {
  it("still revokes sessions for a fenced account (no fence predicate on logout)", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const [filter] = mocks.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: id });
    expect(filter).not.toHaveProperty("authMigrationFence");
  });
});
