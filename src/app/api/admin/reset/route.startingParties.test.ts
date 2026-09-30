import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reset: vi.fn(),
  db: vi.fn(),
  admin: vi.fn(),
  clearCookie: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ clearAuthCookie: mocks.clearCookie }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.db }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/api/errors", () => ({
  handleRouteError: (error: Error) => new Response(error.message, { status: 500 }),
}));
vi.mock("@/lib/admin/resetAndBootstrapGameWorld", () => ({
  resetAndBootstrapGameWorld: mocks.reset,
}));
vi.mock("@/lib/seeds/presetSelector", () => ({
  isKnownPreset: (preset: string) =>
    ["1991-default", "2019-default", "2019-no-parties"].includes(preset),
}));

import { POST } from "./route";

function request(preset: string, stream: boolean, body: Record<string, unknown>) {
  return new Request(
    `http://localhost/api/admin/reset?preset=${preset}${stream ? "&stream=1" : ""}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("admin reset starting parties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admin.mockResolvedValue({ ok: true, admin: { username: "admin" } });
    mocks.db.mockResolvedValue({});
    mocks.reset.mockResolvedValue({ reset: { success: true, details: {} }, logs: [] });
  });

  for (const stream of [false, true]) {
    it(`passes the no-parties choice with the 1991 data preset (${stream ? "stream" : "JSON"})`, async () => {
      const res = await POST(
        request("1991-default", stream, { bootstrap: true, startingParties: "none" })
      );
      expect(res.status).toBe(200);
      await res.text();
      expect(mocks.reset).toHaveBeenCalledWith(
        expect.objectContaining({
          preset: "1991-default",
          startingParties: "none",
          mode: "vacant",
          seedOnly: false,
        })
      );
    });

    it(`rejects an unsupported no-parties preset before database access (${stream ? "stream" : "JSON"})`, async () => {
      const res = await POST(request("2019-default", stream, { startingParties: "none" }));
      expect(res.status).toBe(400);
      expect(mocks.db).not.toHaveBeenCalled();
      expect(mocks.reset).not.toHaveBeenCalled();
    });

    it(`keeps omitted options on the existing historical path (${stream ? "stream" : "JSON"})`, async () => {
      const res = await POST(request("1991-default", stream, { bootstrap: true }));
      expect(res.status).toBe(200);
      await res.text();
      expect(mocks.reset).toHaveBeenCalledWith(
        expect.objectContaining({
          preset: "1991-default",
          startingParties: undefined,
          mode: "historical",
        })
      );
    });

    it(`validates the starting-party value (${stream ? "stream" : "JSON"})`, async () => {
      const res = await POST(request("1991-default", stream, { startingParties: "anything" }));
      expect(res.status).toBe(400);
      expect(mocks.reset).not.toHaveBeenCalled();
    });
  }
});
