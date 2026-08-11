import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/nationalization/authority", () => ({ assertTreasuryAuthority: vi.fn() }));

let db: MockDb;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/CN/national-corporation/900007/draw-cap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ code: "CN", id: "900007" }) };

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: new ObjectId(), name: "FM" } },
  } as never);
  db.collectionMocks.corporations.findOne.mockResolvedValue({
    _id: new ObjectId(),
    sequentialId: 900_007,
    countryId: "CN",
    countryOwnerId: "CN",
    ownershipState: "stateOwned",
  });
});

describe("POST .../draw-cap", () => {
  it("lets the finance minister set the per-turn draw cap", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true);
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ cap: 7_500_000 }), ctx);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.corporations.updateOne.mock.calls[0][1].$set.treasuryDrawCap).toBe(
      7_500_000
    );
  });

  it("403s without treasury authority (e.g. the CEO)", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(false);
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ cap: 0 }), ctx);
    expect(res.status).toBe(403);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});
