/**
 * Maintenance gating for registration.
 *
 * The maintenance check runs first in the handler (before rate limiting,
 * body parsing, or any DB write), so this suite only needs to mock the DB
 * and the request-header lookup `getClientIp()` depends on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })),
}));

function registerRequest(): Request {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "new@test.dev",
      username: "newplayer",
      password: "SuperSecret123!",
      ageConfirmed: true,
      termsAccepted: true,
    }),
  });
}

function mockDbWithMaintenance(maintenanceMode: boolean | "off" | "partial" | "full") {
  return {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "gameConfig") {
        return { findOne: vi.fn().mockResolvedValue({ _id: "default", maintenanceMode }) };
      }
      return {
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      };
    }),
  };
}

describe("POST /api/auth/register - maintenance gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks with 503 while maintenance mode is 'full'", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDbWithMaintenance("full") as never);

    const { POST } = await import("./route");
    const res = await POST(registerRequest());

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/maintenance/i);
  });

  it("blocks with 503 while maintenance mode is 'partial'", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDbWithMaintenance("partial") as never);

    const { POST } = await import("./route");
    const res = await POST(registerRequest());

    expect(res.status).toBe(503);
  });

  it("blocks with 503 for the legacy boolean true", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDbWithMaintenance(true) as never);

    const { POST } = await import("./route");
    const res = await POST(registerRequest());

    expect(res.status).toBe(503);
  });

  it("does NOT short-circuit with 503 while maintenance mode is 'off'", async () => {
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(mockDbWithMaintenance("off") as never);

    const { POST } = await import("./route");
    const res = await POST(registerRequest());

    // Past the maintenance gate, the request will fail later (rate limiter /
    // registration gate aren't mocked here) — the point of this test is only
    // that maintenance itself did not produce the 503.
    expect(res.status).not.toBe(503);
  });
});
