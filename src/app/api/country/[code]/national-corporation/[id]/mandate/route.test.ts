import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/nationalization/authority", () => ({ assertTreasuryAuthority: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: () => new Response("rate", { status: 429 }),
}));

const corpId = new ObjectId();
const ceoId = new ObjectId();

async function callPost(characterId: ObjectId, body: Record<string, unknown>) {
  const { POST } = await import("./route");
  return POST(
    new Request("http://t/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code: "cn", id: corpId.toHexString() }) }
  );
}

describe("POST national-corporation mandate — authorization", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    // The CN National Corporation, with a seated CEO.
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: corpId,
      countryId: "CN",
      countryOwnerId: "CN",
      ownershipState: "stateOwned",
      ceoId,
      ceoVacant: false,
    });
  });

  async function authAs(characterId: ObjectId) {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character: { _id: characterId } },
    } as never);
  }

  const corpMandate = { scope: "corp", priceControlled: true, employmentGuaranteed: false };

  it("authorizes the seated CEO even without treasury authority", async () => {
    await authAs(ceoId);
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(false);

    const res = await callPost(ceoId, corpMandate);
    expect(res.status).toBe(200);
    // CEO match short-circuits — treasury check isn't even consulted.
    expect(assertTreasuryAuthority).not.toHaveBeenCalled();
  });

  it("authorizes a treasury official who is not the CEO", async () => {
    const minister = new ObjectId();
    await authAs(minister);
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(true);

    const res = await callPost(minister, corpMandate);
    expect(res.status).toBe(200);
  });

  it("rejects a viewer who is neither CEO nor treasury authority", async () => {
    const rando = new ObjectId();
    await authAs(rando);
    const { assertTreasuryAuthority } = await import("@/lib/nationalization/authority");
    vi.mocked(assertTreasuryAuthority).mockResolvedValue(false);

    const res = await callPost(rando, corpMandate);
    expect(res.status).toBe(403);
  });
});
