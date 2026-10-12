import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
const mocks = vi.hoisted(() => ({ access: vi.fn(), grant: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(async () => createMockDb()) }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSessionWithCharacter: mocks.auth }));
vi.mock("@/lib/referendum/pmAccess", () => ({ canDecideReferendum: mocks.access }));
vi.mock("@/lib/referendum/grantReferendum", () => ({ grantReferendum: mocks.grant }));
import { POST } from "./route";
const context = { params: Promise.resolve({ code: "uk", refId: new ObjectId().toHexString() }) };
const req = (body: unknown) =>
  new Request("http://test/api/country/uk/referendum/id/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("referendum PM decision endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: new ObjectId() } },
    });
    mocks.access.mockResolvedValue(true);
    mocks.grant.mockResolvedValue({ status: 200, body: {} });
  });
  it("passes authorized NPP leadership decisions to the domain", async () => {
    expect((await POST(req({ action: "grant" }), context)).status).toBe(200);
    expect(mocks.grant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isPM: true, adminOverride: false })
    );
  });
  it("validates actions before calling the domain", async () => {
    expect((await POST(req({ action: "other" }), context)).status).toBe(400);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("does not forward a forged admin override", async () => {
    mocks.access.mockResolvedValue(false);
    await POST(req({ action: "decline", adminOverride: true }), context);
    expect(mocks.grant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isPM: false, adminOverride: false })
    );
  });
});
