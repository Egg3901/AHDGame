import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { GameState } from "@/lib/db/types";
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
import { loadReservedCorporatePositionsByTarget } from "@/lib/corporations/reservedCorporateHoldings";
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
    expect(body.group.parentGroupId).toBe(a.toString());
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
  it("limits a nested detail read to the requested group's sectors", async () => {
    const find = vi.spyOn(db.collection("corporateSectors"), "find");
    await overview(new Request("https://game.test"), { params: Promise.resolve({ id: "2" }) });
    const query = find.mock.calls[0][0] as { corporationId: { $in: ObjectId[] } };
    expect(query.corporationId.$in.map((id) => id.toString()).sort()).toEqual(
      [b.toString(), c.toString()].sort()
    );
    expect(find).toHaveBeenCalledTimes(1);
  });
  it("uses the canonical home currency for unstamped legacy corporations", async () => {
    await (db as unknown as Db)
      .collection("corporations")
      .updateOne({ _id: a }, { $unset: { liquidCurrencyCode: "" } });
    const { groups } = await (await list()).json();
    const top = groups.find((group: { id: string }) => group.id === a.toString());
    expect(top.cashAnchor).toBe(220);
    expect(top.equityValueAnchor).toBe(1000);
  });
  it("keeps reserved control blocks in membership and equity netting", async () => {
    await (db as unknown as Db)
      .collection("corporations")
      .updateOne({ _id: b }, { $set: { shareholders: [] } });
    vi.mocked(loadReservedCorporatePositionsByTarget).mockResolvedValueOnce(
      new Map([[b.toString(), [{ corporationId: a, shares: 100 }]]])
    );
    const { groups } = await (await list()).json();
    const top = groups.find((group: { id: string }) => group.id === a.toString());
    expect(top.members).toHaveLength(3);
    expect(top.equityValueAnchor).toBe(1000);
  });
  it("returns no groups when the system is disabled without reading corporations", async () => {
    await (db as unknown as Db)
      .collection<GameState>("gameState")
      .updateOne({ _id: "current" }, { $set: { subsidiaryCorporationsEnabled: false } });
    const find = vi.spyOn(db.collection("corporations"), "find");
    expect(await (await list()).json()).toEqual({ groups: [] });
    expect(find).not.toHaveBeenCalled();
  });
  it("does not turn a standalone corporation into a group", async () => {
    const standalone = new ObjectId();
    db.seed("corporations", [
      {
        _id: standalone,
        sequentialId: 4,
        name: "Standalone",
        countryId: "US",
        shareholders: [],
        totalShares: 100,
      },
    ]);
    expect(
      (await overview(new Request("https://game.test"), { params: Promise.resolve({ id: "4" }) }))
        .status
    ).toBe(404);
  });
  it("fills missing legacy sector host countries from their owning corporation", async () => {
    await (db as unknown as Db)
      .collection("corporateSectors")
      .updateMany({ corporationId: a }, { $unset: { countryId: "" } });
    const { groups } = await (await list()).json();
    const top = groups.find((group: { id: string }) => group.id === a.toString());
    expect(top.regionCount).toBe(2);
    expect(top.revenueAnchor).toBe(120);
  });
  it("redacts private finances in both member rows and totals, even from a parent CEO's public response", async () => {
    await (db as unknown as Db)
      .collection("corporations")
      .updateOne({ _id: b }, { $set: { isPrivate: true } });
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: user.toString() },
    } as never);
    const { groups } = await (await list()).json();
    const top = groups.find((group: { id: string }) => group.id === a.toString());
    const privateMember = top.members.find((member: { id: string }) => member.id === b.toString());
    expect(privateMember.cashAnchor).toBeNull();
    expect(privateMember.revenueAnchor).toBeNull();
    expect(top.cashAnchor).toBeNull();
    expect(top.revenueAnchor).toBeNull();
    expect(top.equityValueAnchor).toBeNull();
    const detail = await (
      await overview(new Request("https://game.test"), { params: Promise.resolve({ id: "2" }) })
    ).json();
    expect(detail.group.id).toBe(b.toString());
    expect(detail.group.cashAnchor).toBeNull();
    expect(detail.group.revenueAnchor).toBeNull();
    expect(detail.group.equityValueAnchor).toBeNull();
    expect(detail.group.members[0].name).toBe("Nested");
  });
  it("uses the canonical redaction policy for legacy truthy private flags", async () => {
    await (db as unknown as Db)
      .collection("corporations")
      .updateOne({ _id: a }, { $set: { isPrivate: "true" } });
    const { groups } = await (await list()).json();
    const top = groups.find((group: { id: string }) => group.id === a.toString());
    expect(top.members[0].cashAnchor).toBeNull();
    expect(top.members[0].revenueAnchor).toBeNull();
    expect(top.equityValueAnchor).toBeNull();
  });
  it("keeps the overview readable for an owner whose formalized parent was deleted", async () => {
    await (db as unknown as Db).collection("corporations").updateOne(
      { _id: a },
      {
        $set: {
          subsidiaryFormalizedAtTurn: 1,
          shareholders: [{ corporationId: new ObjectId(), shares: 100 }],
        },
      }
    );
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: user.toString() },
    } as never);
    const response = await overview(new Request("https://game.test"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.group.id).toBe(a.toString());
    expect(body.group.members).toHaveLength(3);
    expect(body.group.managementAvailable).toBe(false);
    expect(body.canViewManagement).toBe(false);
  });
  it("preserves bookmarked group reads when the subsidiary system is disabled", async () => {
    await (db as unknown as Db)
      .collection<GameState>("gameState")
      .updateOne({ _id: "current" }, { $set: { subsidiaryCorporationsEnabled: false } });
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: user.toString() },
    } as never);
    const response = await overview(new Request("https://game.test"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.group.id).toBe(a.toString());
    expect(body.canViewManagement).toBe(true);
    expect(await (await list()).json()).toEqual({ groups: [] });
  });
  it("resolves sequential ID zero and ObjectId links identically", async () => {
    await (db as unknown as Db)
      .collection("corporations")
      .updateOne({ _id: a }, { $set: { sequentialId: 0 } });
    for (const id of ["0", a.toString()]) {
      const response = await overview(new Request("https://game.test"), {
        params: Promise.resolve({ id }),
      });
      expect(response.status).toBe(200);
      const { group } = await response.json();
      expect(group.id).toBe(a.toString());
      expect(group.pathId).toBe("0");
    }
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
