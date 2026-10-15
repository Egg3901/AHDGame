import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
vi.mock("@/lib/currency/corporationCapital", async (original) => ({
  ...(await original<typeof import("@/lib/currency/corporationCapital")>()),
  loadValuationFxRates: vi.fn(
    async () =>
      new Map([
        ["USD", 5],
        ["GBP", 2],
      ])
  ),
}));
vi.mock("@/lib/corporations/reservedCorporateHoldings", async (original) => ({
  ...(await original<typeof import("@/lib/corporations/reservedCorporateHoldings")>()),
  loadReservedCorporatePositionsByTarget: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { GET as list } from "@/app/api/market/subsidiary-groups/route";
import { GET as overview } from "@/app/api/corporations/[id]/group/overview/route";
const a = new ObjectId(),
  b = new ObjectId(),
  c = new ObjectId(),
  user = new ObjectId();
let db: ReturnType<typeof createInMemoryDb>;
beforeEach(() => {
  vi.clearAllMocks();
  db = createInMemoryDb();
  db.seed("gameState", [{ _id: "current", subsidiaryCorporationsEnabled: true }]);
  db.seed("corporations", [
    {
      _id: a,
      sequentialId: 1,
      name: "Parent",
      countryId: "US",
      liquidCurrencyCode: "USD",
      liquidCapital: 500,
      sharePrice: 50,
      totalShares: 100,
      shareholders: [],
      groupManagement: { name: "Harbor", logoUrl: "/group.png", supplyPolicy: "members" },
      ceoId: new ObjectId(),
      userId: user,
      ceoType: "player",
    },
    {
      _id: b,
      sequentialId: 2,
      name: "Nested",
      countryId: "US",
      liquidCurrencyCode: "USD",
      liquidCapital: 100,
      sharePrice: 10,
      totalShares: 100,
      shareholders: [{ corporationId: a, shares: 100 }],
      subsidiaryFormalizedAtTurn: 1,
    },
    {
      _id: c,
      sequentialId: 3,
      name: "Child",
      countryId: "UK",
      liquidCurrencyCode: "GBP",
      liquidCapital: 200,
      sharePrice: 20,
      totalShares: 100,
      shareholders: [{ corporationId: b, shares: 100 }],
      subsidiaryFormalizedAtTurn: 1,
    },
  ]);
  db.seed("corporateSectors", [
    {
      _id: new ObjectId(),
      corporationId: a,
      sectorType: "logistics",
      countryId: "UK",
      stateId: "S",
      revenue: 100,
    },
    {
      _id: new ObjectId(),
      corporationId: c,
      sectorType: "logistics",
      countryId: "UK",
      stateId: "S",
      revenue: 200,
    },
  ]);
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);
});
describe("public subsidiary-group APIs", () => {
  it("requires authentication on list and detail", async () => {
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({}, { status: 401 }),
    } as never);
    expect((await list()).status).toBe(401);
    expect(
      (await overview(new Request("https://game.test"), { params: Promise.resolve({ id: "1" }) }))
        .status
    ).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });
  it("batches nested group reads, converts FX and returns only public fields", async () => {
    const response = await list();
    expect(response.status).toBe(200);
    const { groups } = await response.json();
    expect(groups).toHaveLength(2);
    const top = groups.find((g: { id: string }) => g.id === a.toString());
    expect(top.name).toBe("Harbor");
    expect(top.cashAnchor).toBe(220);
    expect(top.revenueAnchor).toBe(150);
    expect(top.equityValueAnchor).toBe(1000);
    expect(top.regionCount).toBe(1);
    const serialized = JSON.stringify(groups);
    for (const key of [
      "userId",
      "ceoId",
      "groupDirection",
      "groupReceiving",
      "history",
      "supplyPolicy",
    ])
      expect(serialized).not.toContain(`"${key}"`);
  });
  it("resolves nested overview by its own sequential ID, not the highest ancestor", async () => {
    const response = await overview(new Request("https://game.test"), {
      params: Promise.resolve({ id: "2" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.group.id).toBe(b.toString());
    expect(body.group.members).toHaveLength(2);
    expect(body.canViewManagement).toBe(false);
  });
  it("preserves existing leaf links and enables the top-level owner's management view", async () => {
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: user.toString() },
    } as never);
    const body = await (
      await overview(new Request("https://game.test"), { params: Promise.resolve({ id: "3" }) })
    ).json();
    expect(body.group.id).toBe(a.toString());
    expect(body.canViewManagement).toBe(true);
  });
  it("preserves private access for a subsidiary's current player CEO", async () => {
    await (db as unknown as Db)
      .collection("corporations")
      .updateOne(
        { _id: c },
        { $set: { userId: user, ceoId: new ObjectId(), ceoType: "player", suspended: true } }
      );
    await (db as unknown as Db)
      .collection("corporations")
      .updateOne({ _id: a }, { $set: { userId: new ObjectId() } });
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: user.toString() },
    } as never);
    const body = await (
      await overview(new Request("https://game.test"), { params: Promise.resolve({ id: "1" }) })
    ).json();
    expect(body.canViewManagement).toBe(true);
  });
  it("returns 400 for invalid IDs and 404 for absent groups", async () => {
    expect(
      (
        await overview(new Request("https://game.test"), {
          params: Promise.resolve({ id: "invalid" }),
        })
      ).status
    ).toBe(400);
    expect(
      (await overview(new Request("https://game.test"), { params: Promise.resolve({ id: "99" }) }))
        .status
    ).toBe(404);
  });
});
