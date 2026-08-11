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

function makeRequest() {
  return new Request("http://localhost/api/country/CN/national-corporation/x/remove-ceo", {
    method: "POST",
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ code: "CN", id }) });

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("corporationCeoVotes");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: new ObjectId(), name: "SoT" } },
  } as never);
});

describe("POST /api/country/[code]/national-corporation/[id]/remove-ceo", () => {
  it("returns 403 when the actor lacks treasury authority", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(false);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), ctx(new ObjectId().toHexString()));
    expect(res.status).toBe(403);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("vacates the seat and clears CEO identity + votes", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true);

    const corpId = new ObjectId();
    const removedUserId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      countryId: "CN",
      countryOwnerId: "CN",
      ownershipState: "stateOwned",
      name: "China National Corporation",
      ceoVacant: false,
      ceoId: new ObjectId(),
      userId: removedUserId,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), ctx(corpId.toHexString()));
    expect(res.status).toBe(200);

    const update = db.collectionMocks.corporations.updateOne.mock.calls[0];
    expect(update[0]).toEqual({ _id: corpId });
    expect(update[1].$set.ceoVacant).toBe(true);
    expect(update[1].$unset).toMatchObject({ ceoId: "", userId: "", pendingCeoCharacterId: "" });
    expect(db.collectionMocks.corporationCeoVotes.deleteMany).toHaveBeenCalledWith({
      corporationId: corpId,
    });

    // Removed CEO is notified.
    const { createNotification } = await import("@/lib/notifications");
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: removedUserId, type: "ceo_resigned" })
    );
  });

  it("returns 400 when the seat is already vacant", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true);

    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      countryId: "CN",
      countryOwnerId: "CN",
      ownershipState: "stateOwned",
      name: "China National Corporation",
      ceoVacant: true,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), ctx(corpId.toHexString()));
    expect(res.status).toBe(400);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("404s when the target is not a National Corporation of this country", async () => {
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true);
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), ctx(new ObjectId().toHexString()));
    expect(res.status).toBe(404);
  });
});
