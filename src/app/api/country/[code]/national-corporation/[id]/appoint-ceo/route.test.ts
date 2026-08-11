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
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/nationalization/authority", () => ({ assertTreasuryAuthority: vi.fn() }));

let db: MockDb;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/CN/national-corporation/x/appoint-ceo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ code: "CN", id }) });

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("characters");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: new ObjectId(), name: "SoT" } },
  } as never);
});

describe("POST /api/country/[code]/national-corporation/[id]/appoint-ceo", () => {
  it("returns 403 when the actor lacks treasury authority", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(false);

    const corpId = new ObjectId();
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ nomineeCharacterId: new ObjectId().toHexString() }),
      ctx(corpId.toHexString())
    );
    expect(res.status).toBe(403);
  });

  it("sets pendingCeoCharacterId on a valid appointment", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true);

    const corpId = new ObjectId();
    const nomineeId = new ObjectId();
    // 1st findOne → target NatCorp; eligibility findOne (already-CEO) → null.
    db.collectionMocks.corporations.findOne
      .mockResolvedValueOnce({
        _id: corpId,
        countryId: "CN",
        countryOwnerId: "CN",
        ownershipState: "stateOwned",
        name: "China National Corporation",
      })
      .mockResolvedValueOnce(null);
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: nomineeId,
      name: "Nominee",
      countryId: "CN",
      userId: new ObjectId(),
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ nomineeCharacterId: nomineeId.toHexString() }),
      ctx(corpId.toHexString())
    );
    expect(res.status).toBe(200);
    const update = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(update[0]).toEqual({ _id: corpId });
    expect(update[1].$set.pendingCeoCharacterId).toEqual(nomineeId);
  });

  it("rejects a nominee who is already CEO of a corporation (409)", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true);

    const corpId = new ObjectId();
    const nomineeId = new ObjectId();
    db.collectionMocks.corporations.findOne
      .mockResolvedValueOnce({
        _id: corpId,
        countryId: "CN",
        countryOwnerId: "CN",
        ownershipState: "stateOwned",
        name: "China National Corporation",
      })
      .mockResolvedValueOnce({ _id: new ObjectId(), name: "Acme Corp" }); // already a CEO
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: nomineeId,
      name: "Nominee",
      countryId: "CN",
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ nomineeCharacterId: nomineeId.toHexString() }),
      ctx(corpId.toHexString())
    );
    expect(res.status).toBe(409);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a nominee residing in another country", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true);

    const corpId = new ObjectId();
    const nomineeId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValueOnce({
      _id: corpId,
      countryId: "CN",
      countryOwnerId: "CN",
      ownershipState: "stateOwned",
      name: "China National Corporation",
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: nomineeId,
      name: "Nominee",
      countryId: "US", // foreign
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ nomineeCharacterId: nomineeId.toHexString() }),
      ctx(corpId.toHexString())
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reside in this country/i);
  });

  it("resolves the NatCorp by its sequential id (the /corporation/[id] URL form)", async () => {
    // Regression: the page passes the corp's sequential id (e.g. 900007), not the
    // ObjectId hex — the route must resolve it, not reject it as "Invalid corporation ID".
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true);

    const corpId = new ObjectId();
    const nomineeId = new ObjectId();
    db.collectionMocks.corporations.findOne
      .mockResolvedValueOnce({
        _id: corpId,
        sequentialId: 900_007,
        countryId: "CN",
        countryOwnerId: "CN",
        ownershipState: "stateOwned",
        name: "China National Corporation",
      })
      .mockResolvedValueOnce(null);
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: nomineeId,
      name: "Nominee",
      countryId: "CN",
      userId: new ObjectId(),
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ nomineeCharacterId: nomineeId.toHexString() }),
      ctx("900007")
    );

    expect(res.status).toBe(200);
    // Looked up by sequentialId + country scope, not by _id.
    expect(db.collectionMocks.corporations.findOne.mock.calls[0][0]).toEqual({
      sequentialId: 900_007,
      countryOwnerId: "CN",
    });
  });

  it("404s when the target is not a National Corporation of this country", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true);

    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValueOnce(null);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ nomineeCharacterId: new ObjectId().toHexString() }),
      ctx(corpId.toHexString())
    );
    expect(res.status).toBe(404);
  });
});
