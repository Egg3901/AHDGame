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

let db: MockDb;
const ceoId = new ObjectId();

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/CN/national-corporation/900007/profit-split", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ code: "CN", id: "900007" }) };

async function setAuthCharacter(id: ObjectId) {
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: id, name: "Actor" } },
  } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collectionMocks.corporations.findOne.mockResolvedValue({
    _id: new ObjectId(),
    sequentialId: 900_007,
    countryId: "CN",
    countryOwnerId: "CN",
    ownershipState: "stateOwned",
    ceoVacant: false,
    ceoId,
  });
});

describe("POST .../profit-split", () => {
  it("clamps the CEO's retention to the 0–75 band and persists it", async () => {
    await setAuthCharacter(ceoId);
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ retentionPercent: 90 }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).retentionPercent).toBe(75); // ≥25% always remits
    expect(
      db.collectionMocks.corporations.updateOne.mock.calls[0][1].$set.profitRetentionPercent
    ).toBe(75);
  });

  it("403s for a character who is not the seated CEO", async () => {
    await setAuthCharacter(new ObjectId()); // not the CEO
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ retentionPercent: 40 }), ctx);
    expect(res.status).toBe(403);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});
