import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { POST, DELETE } from "./route";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { registerDevice, revokeDevice } from "@/lib/nativePush/devices";
import { providerConfigured } from "@/lib/nativePush/providers";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/nativePush/devices", () => ({ registerDevice: vi.fn(), revokeDevice: vi.fn() }));
vi.mock("@/lib/nativePush/providers", () => ({ providerConfigured: vi.fn() }));
const installation = "a".repeat(64);
const token = "b".repeat(64);
const request = (body: unknown, method = "POST", origin?: string) =>
  new Request("https://example.com/api/push/device", {
    method,
    headers: {
      "Content-Type": "application/json",
      host: "example.com",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
beforeEach(async () => {
  vi.resetAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(createMockDb() as unknown as Db);
  vi.mocked(providerConfigured).mockReturnValue(true);
  vi.mocked(registerDevice).mockResolvedValue(true);
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: {
      userId: "507f1f77bcf86cd799439011",
      username: "test",
      email: "test@example.com",
      role: "player",
      isAdmin: false,
    },
  });
});
describe("native push device API", () => {
  it("binds registration to the authenticated account and prevents caching", async () => {
    const response = await POST(request({ installation, token, provider: "apns" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(registerDevice).toHaveBeenCalledOnce();
    expect(vi.mocked(registerDevice).mock.calls[0][1].toHexString()).toBe(
      "507f1f77bcf86cd799439011"
    );
  });
  it("rejects unauthenticated, cross-origin and malformed registrations", async () => {
    vi.mocked(requireBasicAuth).mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({}, { status: 401 }),
    });
    expect((await POST(request({ installation, token, provider: "fcm" }))).status).toBe(401);
    expect(
      (
        await POST(
          request({ installation, token, provider: "fcm" }, "POST", "https://other.example")
        )
      ).status
    ).toBe(403);
    expect((await POST(request({ installation, token: "../x", provider: "apns" }))).status).toBe(
      400
    );
    expect(registerDevice).not.toHaveBeenCalled();
  });
  it("returns unavailable rather than pretending an unconfigured provider works", async () => {
    vi.mocked(providerConfigured).mockReturnValue(false);
    expect((await POST(request({ installation, token, provider: "fcm" }))).status).toBe(503);
    expect(registerDevice).not.toHaveBeenCalled();
  });
  it("allows only the strong installation secret to revoke after sign-out", async () => {
    expect((await DELETE(request({ installation }, "DELETE"))).status).toBe(200);
    expect(revokeDevice).toHaveBeenCalledWith(expect.anything(), installation);
    expect(requireBasicAuth).not.toHaveBeenCalled();
    expect((await DELETE(request({ installation: "short" }, "DELETE"))).status).toBe(400);
  });
  it("does not expose database errors or tokens", async () => {
    vi.mocked(registerDevice).mockRejectedValue(new Error(`Database: ${token}`));
    const response = await POST(request({ installation, token, provider: "fcm" }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(token);
  });
});
