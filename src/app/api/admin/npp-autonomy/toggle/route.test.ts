import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock requireAdmin to force-admin by default; individual tests override.
vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: vi.fn(async () => ({
    ok: true,
    response: new Response(),
    admin: { username: "tester" },
  })),
}));

const updateOne = vi.fn(async (_filter: any, _op: any) => ({ matchedCount: 1 }));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({ collection: () => ({ updateOne }) })),
}));

import { POST } from "./route";
import { requireAdmin } from "@/lib/api/requireAdmin";

function req(body: any) {
  return new Request("http://localhost/api/admin/npp-autonomy/toggle", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/admin/npp-autonomy/toggle", () => {
  beforeEach(() => updateOne.mockClear());

  it("sets nppAutonomyEnabled true and records by/at", async () => {
    const res = await POST(req({ enabled: true }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(updateOne).toHaveBeenCalled();
    const [, op] = updateOne.mock.calls[0];
    expect(op.$set.nppAutonomyEnabled).toBe(true);
    expect(op.$set.nppAutonomyEnabledBy).toBe("tester");
    expect(op.$set.nppAutonomyEnabledAt).toBeTruthy();
  });

  it("unsets by/at when disabling", async () => {
    const res = await POST(req({ enabled: false }));
    const json = await res.json();
    expect(json.success).toBe(true);
    const [, op] = updateOne.mock.calls[0];
    expect(op.$set.nppAutonomyEnabled).toBe(false);
    expect(op.$unset.nppAutonomyEnabledBy).toBe("");
    expect(op.$unset.nppAutonomyEnabledAt).toBe("");
  });

  it("rejects non-admin", async () => {
    (requireAdmin as any).mockResolvedValueOnce({
      ok: false,
      response: new Response("no", { status: 403 }),
    });
    const res = await POST(req({ enabled: true }));
    expect(res.status).toBe(403);
  });
});
