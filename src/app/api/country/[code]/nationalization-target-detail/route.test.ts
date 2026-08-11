import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(3) }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn().mockResolvedValue({ ok: true, user: { userId: "u1" } }),
}));
vi.mock("@/lib/nationalization/nationalCorporation", () => ({
  isStateOwned: (c: { countryOwnerId?: string }) => !!c?.countryOwnerId,
}));
vi.mock("@/lib/nationalization/targetEligibility", () => ({
  resolveCorpEligibility: vi.fn().mockResolvedValue({
    ownerKind: "player",
    executivelyTakeable: false,
    result: { eligible: true, triggers: ["strategic", "monopoly"], isDistressed: false },
  }),
}));

function cursor<T>(rows: T[]) {
  const c = { toArray: vi.fn().mockResolvedValue(rows), project: vi.fn(() => c) };
  return c;
}
const params = (code: string) => ({ params: Promise.resolve({ code }) });
const corpId = new ObjectId();

describe("GET /api/country/[code]/nationalization-target-detail", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("states");
    db.collection("characters");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns owner, triggers, averages and per-region holdings for a target", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "Zhongtian Semiconductor",
      countryId: "CN",
      headquartersState: "DB",
      ceoVacant: false,
      ceoId: new ObjectId(),
      sharePrice: 8,
      totalShares: 10_000_000,
      liquidCapital: 120_000_000,
      liquidCurrencyCode: "CNY",
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          sectorType: "technology",
          stateId: "DB",
          revenue: 90_000_000,
          currentGrowthRate: 2,
          productionPolicyLevel: 10,
        },
        {
          sectorType: "technology",
          stateId: "HB",
          revenue: 10_000_000,
          currentGrowthRate: 4,
          productionPolicyLevel: 0,
        },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(
      cursor([
        { _id: "DB", name: "Dongbei" },
        { _id: "HB", name: "Huabei" },
      ])
    );
    db.collectionMocks.characters.findOne.mockResolvedValue({ name: "Lil Sis Nora" });

    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        `http://x/api/country/cn/nationalization-target-detail?corporationId=${corpId.toString()}`
      ),
      params("cn")
    );
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.name).toBe("Zhongtian Semiconductor");
    expect(b.ownerKind).toBe("player");
    expect(b.triggers).toEqual(["strategic", "monopoly"]);
    expect(b.executivelyTakeable).toBe(false);
    expect(b.ceoName).toBe("Lil Sis Nora");
    expect(b.totalRevenuePerTurn).toBe(100_000_000);
    expect(b.avgGrowthPct).toBe(3); // (2 + 4) / 2
    expect(b.avgProductionPct).toBe(5); // (10 + 0) / 2
    expect(b.sectorCount).toBe(2);
    expect(b.regionCount).toBe(2);
    expect(b.marketCapLocal).toBe(80_000_000);
    expect(b.sectors[0].stateName).toBe("Dongbei");
  });

  it("404s a state-owned corp (cannot nationalize a NatCorp)", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "China",
      countryId: "CN",
      countryOwnerId: "CN", // state-owned
    });
    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        `http://x/api/country/cn/nationalization-target-detail?corporationId=${corpId.toString()}`
      ),
      params("cn")
    );
    expect(res.status).toBe(400);
  });
});
