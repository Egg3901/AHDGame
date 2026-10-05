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
  createEmailChange: vi.fn(),
  consumeEmailChange: vi.fn(),
  sendEmail: vi.fn(),
  invalidateCachedUser: vi.fn(),
  recordAudit: vi.fn(),
  durableRateLimit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ verifyAuth: mocks.verifyAuth }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: mocks.requireBasicAuth }));
vi.mock("@/lib/api/validate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/validate")>()),
  parseJsonBody: mocks.parseJsonBody,
}));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare } }));
vi.mock("@/lib/emailChange", () => ({
  createEmailChange: mocks.createEmailChange,
  consumeEmailChange: mocks.consumeEmailChange,
}));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/auth/userDocCache", () => ({ invalidateCachedUser: mocks.invalidateCachedUser }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/utils/network", () => ({ getClientIp: async () => "192.0.2.1" }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  AUTH_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));
vi.mock("@/lib/api/rateLimit.mongo", () => ({ durableRateLimit: mocks.durableRateLimit }));
vi.mock("@/lib/api/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/errors")>()),
  handleRouteError: () => new Response(null, { status: 500 }),
}));

import { POST as changeEmail } from "./change-email/route";
import { POST as confirmEmail } from "./confirm-email/route";

const id = new ObjectId("000000000000000000000001");
const issuedAt = new Date("2026-01-02T00:00:00Z");
const placeholder = "discord_1@discord.local";
const request = () =>
  new Request("https://game.example.invalid/api/auth/email", { method: "POST" });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDb.mockResolvedValue({
    collection: () => ({ findOne: mocks.findOne, updateOne: mocks.updateOne }),
  });
  mocks.requireBasicAuth.mockResolvedValue({ ok: true, user: { userId: id.toHexString() } });
  mocks.verifyAuth.mockResolvedValue({ userId: id.toHexString(), iat: issuedAt.getTime() / 1000 });
  mocks.durableRateLimit.mockResolvedValue({ ok: true });
  mocks.sendEmail.mockResolvedValue({ sent: true });
  mocks.createEmailChange.mockResolvedValue({ rawToken: "ahde_synthetic" });
  mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
});

describe("POST /api/auth/change-email", () => {
  function body(data: Record<string, unknown>) {
    mocks.parseJsonBody.mockResolvedValue({ success: true, data });
  }

  it("mails a link to the new address without touching the account", async () => {
    body({ email: "new@example.invalid" });
    mocks.findOne
      .mockResolvedValueOnce({ _id: id, email: placeholder, password: "", username: "u" })
      .mockResolvedValueOnce(null);
    const response = await changeEmail(request());
    expect(response.status).toBe(200);
    expect(mocks.createEmailChange).toHaveBeenCalledWith(id, placeholder, "new@example.invalid");
    expect(mocks.sendEmail.mock.calls[0][0].to).toBe("new@example.invalid");
    expect(mocks.sendEmail.mock.calls[0][0].text).toContain("/confirm-email?token=ahde_synthetic");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("requires the current password when the account has one", async () => {
    body({ email: "new@example.invalid" });
    mocks.findOne.mockResolvedValueOnce({ _id: id, email: "old@example.invalid", password: "d" });
    expect((await changeEmail(request())).status).toBe(401);
    expect(mocks.createEmailChange).not.toHaveBeenCalled();
  });

  it("rejects a wrong current password", async () => {
    body({ email: "new@example.invalid", currentPassword: "wrong" });
    mocks.findOne.mockResolvedValueOnce({ _id: id, email: "old@example.invalid", password: "d" });
    mocks.compare.mockResolvedValue(false);
    expect((await changeEmail(request())).status).toBe(401);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses an address another account already uses", async () => {
    body({ email: "taken@example.invalid" });
    mocks.findOne
      .mockResolvedValueOnce({ _id: id, email: placeholder, password: "" })
      .mockResolvedValueOnce({ _id: new ObjectId() });
    expect((await changeEmail(request())).status).toBe(409);
    expect(mocks.createEmailChange).not.toHaveBeenCalled();
  });

  it("refuses the undeliverable placeholder domain", async () => {
    body({ email: "someone@discord.local" });
    expect((await changeEmail(request())).status).toBe(400);
    expect(mocks.findOne).not.toHaveBeenCalled();
  });

  it("refuses a stale session", async () => {
    body({ email: "new@example.invalid" });
    mocks.findOne.mockResolvedValueOnce({
      _id: id,
      email: placeholder,
      password: "",
      isBanned: true,
    });
    expect((await changeEmail(request())).status).toBe(401);
  });

  it("reports a send failure instead of claiming success", async () => {
    body({ email: "new@example.invalid" });
    mocks.findOne
      .mockResolvedValueOnce({ _id: id, email: placeholder, password: "" })
      .mockResolvedValueOnce(null);
    mocks.sendEmail.mockResolvedValue({ sent: false, reason: "send-failed" });
    expect((await changeEmail(request())).status).toBe(503);
  });
});

describe("POST /api/auth/confirm-email", () => {
  beforeEach(() => {
    mocks.parseJsonBody.mockResolvedValue({ success: true, data: { token: "ahde_synthetic" } });
  });

  it("moves the account to the confirmed address with a CAS on the old one", async () => {
    mocks.consumeEmailChange.mockResolvedValue({
      userId: id,
      previousEmail: "old@example.invalid",
      newEmail: "new@example.invalid",
    });
    const response = await confirmEmail(request());
    expect(response.status).toBe(200);
    const [filter, update] = mocks.updateOne.mock.calls[0];
    expect(filter).toMatchObject({
      _id: id,
      email: "old@example.invalid",
      isBanned: { $ne: true },
    });
    expect(update.$set.email).toBe("new@example.invalid");
    expect(update.$set.emailVerifiedAt).toBeInstanceOf(Date);
    expect(mocks.invalidateCachedUser).toHaveBeenCalledWith(id.toHexString());
    expect(mocks.sendEmail.mock.calls[0][0].to).toBe("old@example.invalid");
  });

  it("does not notify an undeliverable placeholder", async () => {
    mocks.consumeEmailChange.mockResolvedValue({
      userId: id,
      previousEmail: placeholder,
      newEmail: "new@example.invalid",
    });
    expect((await confirmEmail(request())).status).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects an invalid or used token", async () => {
    mocks.consumeEmailChange.mockResolvedValue(null);
    expect((await confirmEmail(request())).status).toBe(400);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("does nothing when the account email changed since the request", async () => {
    mocks.consumeEmailChange.mockResolvedValue({
      userId: id,
      previousEmail: "old@example.invalid",
      newEmail: "new@example.invalid",
    });
    mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });
    expect((await confirmEmail(request())).status).toBe(400);
    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });

  it("maps a unique-index race to 409", async () => {
    mocks.consumeEmailChange.mockResolvedValue({
      userId: id,
      previousEmail: "old@example.invalid",
      newEmail: "new@example.invalid",
    });
    mocks.updateOne.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    expect((await confirmEmail(request())).status).toBe(409);
  });
});
