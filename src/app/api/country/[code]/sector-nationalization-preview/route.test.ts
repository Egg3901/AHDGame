import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn().mockResolvedValue({ ok: true, user: { userId: "u1" } }),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["CNY", 1]])),
}));
vi.mock("@/lib/currency/govBudgetFields", () => ({ writeGovBudgetLocal: (v: number) => v }));
vi.mock("@/lib/bonds/corporateBondDefault", () => ({
  buildPrimeRateMap: vi.fn(() => new Map()),
  computeSectorNpvSum: vi.fn(() => 1000),
}));
vi.mock("@/lib/nationalization/compensation", () => ({
  applyTier: (v: number) => v,
  // D11 base selector: below plants it passes the caller's NPV through.
  sectorCompensationValuationAnchor: (
    _sector: unknown,
    npvAnchor: number,
    opts: { fraction?: number }
  ) => npvAnchor * (opts.fraction ?? 1),
}));
vi.mock("@/lib/nationalization/nationalCorporation", () => ({
  isStateOwned: (c: { countryOwnerId?: string }) => !!c?.countryOwnerId,
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(5) }));

function cursor<T>(rows: T[]) {
  const c = { toArray: vi.fn().mockResolvedValue(rows), project: vi.fn(() => c) };
  return c;
}
const params = (code: string) => ({ params: Promise.resolve({ code }) });
const playerCorpId = new ObjectId();
const stateCorpId = new ObjectId();

describe("GET /api/country/[code]/sector-nationalization-preview", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["centralBanks", "corporateSectors", "corporations", "unownedSectors"])
      db.collection(n);
    db.collectionMocks.centralBanks.find.mockReturnValue(cursor([]));
    // Corps for the sector pool arrive in ONE batched `$in` query (perf audit
    // 2026-08-03); this was a findOne per corp.
    db.collectionMocks.corporations.find.mockImplementation((q: { _id?: { $in?: ObjectId[] } }) => {
      const known = [
        { _id: playerCorpId, name: "Tech Co", liquidCurrencyCode: "CNY" },
        { _id: stateCorpId, name: "State Co", countryOwnerId: "CN" },
      ];
      const requested = (q?._id?.$in ?? []).map((id) => id.toString());
      return cursor(known.filter((c) => requested.includes(c._id.toString())));
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("estimates per-corp compensation + the free unowned slice for the whole industry", async () => {
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: playerCorpId,
          countryId: "CN",
          stateId: "DB",
          sectorType: "technology",
          revenue: 100,
        },
        {
          _id: new ObjectId(),
          corporationId: playerCorpId,
          countryId: "CN",
          stateId: "HB",
          sectorType: "technology",
          revenue: 100,
        },
        {
          _id: new ObjectId(),
          corporationId: stateCorpId,
          countryId: "CN",
          stateId: "XB",
          sectorType: "technology",
          revenue: 999,
        },
      ])
    );
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          countryId: "CN",
          stateId: "DB",
          sectorType: "technology",
          revenue: 500,
        },
      ])
    );

    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        "http://x/api/country/cn/sector-nationalization-preview?sectorType=technology&carveFraction=1&scope=all"
      ),
      params("cn")
    );
    expect(res.status).toBe(200);
    const b = await res.json();
    // Only the player corp is affected (state-owned skipped); 2 sectors × NPV 1000 = 2000.
    expect(b.affectedCount).toBe(1);
    expect(b.affectedCorps[0]).toMatchObject({
      name: "Tech Co",
      sectorCount: 2,
      regionCount: 2,
      estCompensationLocal: 2000,
    });
    expect(b.totalCompensationLocal).toBe(2000);
    // Unowned slice (free) = revenue × fraction.
    expect(b.unownedSliceRevenuePerTurn).toBe(500);
  });

  it("excludes a corp within the re-nationalization cooldown (matches the engine)", async () => {
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([
        {
          _id: playerCorpId,
          name: "Recently Privatized Co",
          liquidCurrencyCode: "CNY",
          privatizedAtTurn: 5, // == currentTurn ⇒ cooldown active
        },
      ])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: playerCorpId,
          countryId: "CN",
          stateId: "DB",
          sectorType: "technology",
          revenue: 100,
        },
      ])
    );
    db.collectionMocks.unownedSectors.find.mockReturnValue(cursor([]));
    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        "http://x/api/country/cn/sector-nationalization-preview?sectorType=technology&carveFraction=1&scope=corporations"
      ),
      params("cn")
    );
    const b = await res.json();
    expect(b.affectedCount).toBe(0);
    expect(b.totalCompensationLocal).toBe(0);
  });

  it("scope=unowned reports no affected corps and zero compensation", async () => {
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([]));
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          countryId: "CN",
          stateId: "DB",
          sectorType: "technology",
          revenue: 400,
        },
      ])
    );
    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        "http://x/api/country/cn/sector-nationalization-preview?sectorType=technology&carveFraction=0.5&scope=unowned"
      ),
      params("cn")
    );
    const b = await res.json();
    expect(b.affectedCount).toBe(0);
    expect(b.totalCompensationLocal).toBe(0);
    expect(b.unownedSliceRevenuePerTurn).toBe(200); // 400 × 0.5
  });
});
