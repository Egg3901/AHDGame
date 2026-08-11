import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSession: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(5000) }));
vi.mock("@/lib/governorOffice/isSittingLeader", () => ({ isSittingLeader: vi.fn() }));
vi.mock("@/lib/nationalization/ownershipTransition", () => ({
  nationalizeSector: vi
    .fn()
    .mockResolvedValue({ nationalCorporationId: "nc", compensationPaid: 0 }),
  nationalizeWholeCorp: vi
    .fn()
    .mockResolvedValue({ nationalCorporationId: "nc", sectorsAbsorbed: 1, bondsAssumed: 0 }),
}));

let db: MockDb;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/CN/nationalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = () => ({ params: Promise.resolve({ code: "CN" }) });

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("bonds");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireHumanSession } = await import("@/lib/api/requireAuth");
  vi.mocked(requireHumanSession).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);

  const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
  vi.mocked(getCharacterByUserId).mockResolvedValue({
    _id: new ObjectId(),
    name: "Leader",
  } as never);
});

describe("POST /api/country/[code]/nationalize", () => {
  it("returns 403 when the actor is not the head of government", async () => {
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    vi.mocked(isSittingLeader).mockResolvedValue(false);
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: new ObjectId(),
      userId: new ObjectId(),
      liquidCapital: 1000,
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ corporationId: new ObjectId().toHexString(), tier: "seizure" }),
      ctx()
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/head of government/i);
  });

  it("returns 403 when targeting a solvent player corp (executive reach blocked)", async () => {
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    vi.mocked(isSittingLeader).mockResolvedValue(true);
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "CN",
      userId: new ObjectId(), // player-owned
      liquidCapital: 5_000_000, // solvent
      ceoVacant: false,
    });
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ corporationId: new ObjectId().toHexString(), tier: "discounted" }),
      ctx()
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/legislative authorization/i);
    const { nationalizeWholeCorp } = await import("@/lib/nationalization/ownershipTransition");
    expect(nationalizeWholeCorp).not.toHaveBeenCalled();
  });

  it("nationalizes a distressed (insolvent) player corp", async () => {
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    vi.mocked(isSittingLeader).mockResolvedValue(true);
    const targetId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: targetId,
      countryId: "CN",
      userId: new ObjectId(), // player-owned
      liquidCapital: -1, // insolvent ⇒ distressed
      financialDistressSinceTurn: 0, // distress matured (currentTurn 5000 ≫ 72-turn grace)
      ceoVacant: false,
    });
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ corporationId: targetId.toHexString(), tier: "discounted" }),
      ctx()
    );
    expect(res.status).toBe(200);
    const { nationalizeWholeCorp } = await import("@/lib/nationalization/ownershipTransition");
    expect(nationalizeWholeCorp).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        countryId: "CN",
        corporationId: targetId,
        tier: "discounted",
        consequence: expect.objectContaining({ method: "executive", triggers: expect.any(Array) }),
      })
    );
  });

  it("nationalizes an NPC corp (no userId) regardless of distress", async () => {
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    vi.mocked(isSittingLeader).mockResolvedValue(true);
    const targetId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: targetId,
      countryId: "CN",
      liquidCapital: 9_000_000, // healthy, but NPC ⇒ always eligible
      ceoVacant: false,
    });
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ corporationId: targetId.toHexString(), tier: "seizure" }),
      ctx()
    );
    expect(res.status).toBe(200);
    const { nationalizeWholeCorp } = await import("@/lib/nationalization/ownershipTransition");
    expect(nationalizeWholeCorp).toHaveBeenCalled();
  });

  it("passes computed strategic + distress triggers to the transition (P4a)", async () => {
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    vi.mocked(isSittingLeader).mockResolvedValue(true);
    const targetId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: targetId,
      countryId: "CN",
      userId: new ObjectId(), // player-owned
      liquidCapital: -1, // distressed ⇒ passes the executive reach gate
      financialDistressSinceTurn: 0, // distress matured (currentTurn 5000 ≫ 72-turn grace)
      ceoVacant: false,
    });
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
    // Target operates an energy sector in CN...
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          corporationId: targetId,
          stateId: "GD",
          countryId: "CN",
          sectorType: "energy",
          revenue: 0,
        },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    // ...and energy is designated strategic in CN.
    db.collection("strategicSectorDesignations");
    db.collectionMocks.strategicSectorDesignations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ countryId: "CN", sectorType: "energy" }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ corporationId: targetId.toHexString(), tier: "seizure" }),
      ctx()
    );
    expect(res.status).toBe(200);
    const { nationalizeWholeCorp } = await import("@/lib/nationalization/ownershipTransition");
    const params = vi.mocked(nationalizeWholeCorp).mock.calls[0][1] as {
      consequence: { triggers: string[] };
    };
    expect(params.consequence.triggers).toContain("distress");
    expect(params.consequence.triggers).toContain("strategic");
  });

  it("returns 403 when the target corp is headquartered in another country", async () => {
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    vi.mocked(isSittingLeader).mockResolvedValue(true);
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryId: "US", // foreign-HQ — route country is CN
      userId: new ObjectId(),
      liquidCapital: -1, // distressed, so only the jurisdiction guard can block it
      ceoVacant: false,
    });
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ corporationId: new ObjectId().toHexString(), tier: "seizure" }),
      ctx()
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/not headquartered in your country/i);
    const { nationalizeWholeCorp } = await import("@/lib/nationalization/ownershipTransition");
    expect(nationalizeWholeCorp).not.toHaveBeenCalled();
  });

  it("rejects a body with both corporationId and sectorId", async () => {
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    vi.mocked(isSittingLeader).mockResolvedValue(true);

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        corporationId: new ObjectId().toHexString(),
        sectorId: new ObjectId().toHexString(),
        tier: "seizure",
      }),
      ctx()
    );
    expect(res.status).toBe(400);
  });

  it("blocks targeting an already state-owned corporation", async () => {
    const { isSittingLeader } = await import("@/lib/governorOffice/isSittingLeader");
    vi.mocked(isSittingLeader).mockResolvedValue(true);
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: new ObjectId(),
      countryOwnerId: "CN",
      ownershipState: "stateOwned",
      liquidCapital: 0,
    });

    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({ corporationId: new ObjectId().toHexString(), tier: "seizure" }),
      ctx()
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already state-owned/i);
  });
});
