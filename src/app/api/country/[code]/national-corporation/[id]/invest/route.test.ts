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
const corpId = new ObjectId();

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/CN/national-corporation/900007/invest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ code: "CN", id: "900007" }) };

function seedCorp(liquidCapital: number) {
  db.collectionMocks.corporations.findOne.mockResolvedValue({
    _id: corpId,
    sequentialId: 900_007,
    countryId: "CN",
    countryOwnerId: "CN",
    ownershipState: "stateOwned",
    ceoVacant: false,
    ceoId,
    liquidCapital,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: ceoId, name: "CEO" } },
  } as never);
});

describe("POST .../invest", () => {
  it("R&D: sets the per-turn modernization budget (no immediate debit)", async () => {
    seedCorp(100_000);
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ kind: "rd", amount: 5_000 }), ctx);
    expect(res.status).toBe(200);
    const upd = db.collectionMocks.corporations.updateOne.mock.calls[0][1];
    expect(upd.$set.rdBudgetPerTurn).toBe(5_000);
    expect(upd.$inc).toBeUndefined();
  });

  it("allows 0 to disable recurring R&D, regardless of current capital", async () => {
    seedCorp(100); // tiny capital — setting a budget never requires funds
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ kind: "rd", amount: 0 }), ctx);
    expect(res.status).toBe(200);
    const upd = db.collectionMocks.corporations.updateOne.mock.calls[0][1];
    expect(upd.$set.rdBudgetPerTurn).toBe(0);
  });

  it("403s for a non-CEO", async () => {
    seedCorp(100_000);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), character: { _id: new ObjectId(), name: "X" } },
    } as never);
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ kind: "rd", amount: 1_000 }), ctx);
    expect(res.status).toBe(403);
  });
});
