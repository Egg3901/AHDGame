import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";

function cursor(rows: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(rows), project: vi.fn().mockReturnThis() };
}

describe("buildCorpNationalizationThreat", () => {
  let db: MockDb;
  const corpId = new ObjectId();
  const s1 = new ObjectId(); // energy
  const s2 = new ObjectId(); // energy
  const s3 = new ObjectId(); // media
  const corp = { _id: corpId, countryId: "CN" } as unknown as Corporation;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["corporateSectors", "pendingNationalizations", "bills"]) db.collection(n);
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        { _id: s1, sectorType: "energy" },
        { _id: s2, sectorType: "energy" },
        { _id: s3, sectorType: "media" },
      ])
    );
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(cursor([]));
    db.collectionMocks.bills.find.mockReturnValue(cursor([]));
  });

  async function run(turn = 100) {
    const { buildCorpNationalizationThreat } = await import("./corpNationalizationThreat");
    return buildCorpNationalizationThreat(db as unknown as Db, corp, turn);
  }

  it("returns null when there is no pending taking or active bill", async () => {
    expect(await run()).toBeNull();
  });

  it("flags a whole-corp pending taking with its countdown", async () => {
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(
      cursor([{ targetCorporationId: corpId, noticeDeadlineTurn: 110 }])
    );
    expect(await run(100)).toEqual({
      whole: true,
      sectorCount: 0,
      stage: "pending",
      soonestTakingDeadlineTurn: 110,
      turnsUntilTaking: 10,
    });
  });

  it("flags a single-sector pending taking", async () => {
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(
      cursor([{ targetSectorId: s1, noticeDeadlineTurn: 105 }])
    );
    const r = await run(100);
    expect(r).toMatchObject({
      whole: false,
      sectorCount: 1,
      stage: "pending",
      turnsUntilTaking: 5,
    });
  });

  it("flags a whole-corp bill still in voting (no taking deadline yet)", async () => {
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          status: "active",
          countryId: "CN",
          provisions: [{ type: "nationalize", targetCorporationId: corpId }],
        },
      ])
    );
    expect(await run()).toEqual({
      whole: true,
      sectorCount: 0,
      stage: "voting",
      soonestTakingDeadlineTurn: null,
      turnsUntilTaking: null,
    });
  });

  it("expands a sector-wide bill (targetSectorType) to every corp sector of that type", async () => {
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          status: "active",
          countryId: "CN",
          provisions: [{ type: "nationalize", targetSectorType: "energy" }],
        },
      ])
    );
    const r = await run();
    expect(r).toMatchObject({ whole: false, sectorCount: 2, stage: "voting" });
  });

  it("counts a legacy targetSectorId bill", async () => {
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          status: "active",
          countryId: "CN",
          provisions: [{ type: "nationalize", targetSectorId: s3 }],
        },
      ])
    );
    expect((await run())?.sectorCount).toBe(1);
  });

  it("reports stage 'both' when a pending taking and an active bill coexist", async () => {
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(
      cursor([{ targetSectorId: s1, noticeDeadlineTurn: 108 }])
    );
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          status: "active",
          countryId: "CN",
          provisions: [{ type: "nationalize", targetCorporationId: corpId }],
        },
      ])
    );
    expect(await run(100)).toMatchObject({
      whole: true,
      sectorCount: 1,
      stage: "both",
      turnsUntilTaking: 8,
    });
  });

  it("excludes a terminal-status bill", async () => {
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          status: "failed",
          countryId: "CN",
          provisions: [{ type: "nationalize", targetCorporationId: corpId }],
        },
      ])
    );
    expect(await run()).toBeNull();
  });

  it("does not match a country-less sector-wide bill to a country-less corp", async () => {
    const noCountryCorp = { _id: corpId } as unknown as Corporation;
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        { status: "active", provisions: [{ type: "nationalize", targetSectorType: "energy" }] },
      ])
    );
    const { buildCorpNationalizationThreat } = await import("./corpNationalizationThreat");
    expect(
      await buildCorpNationalizationThreat(db as unknown as Db, noCountryCorp, 100)
    ).toBeNull();
  });

  it("excludes a sector-wide bill from another country", async () => {
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          status: "active",
          countryId: "US",
          provisions: [{ type: "nationalize", targetSectorType: "energy" }],
        },
      ])
    );
    expect(await run()).toBeNull();
  });
});

describe("matchActiveNationalizationBills", () => {
  let db: MockDb;
  const corpId = new ObjectId();
  const s1 = new ObjectId();
  const s2 = new ObjectId();
  const corp = { _id: corpId, countryId: "CN" } as unknown as Corporation;
  const sectorIdStr = new Set([String(s1), String(s2)]);
  const typeToSectorIds = new Map([["energy", [s1, s2]]]);

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bills");
    db.collectionMocks.bills.find.mockReturnValue(cursor([]));
  });

  async function match() {
    const { matchActiveNationalizationBills } = await import("./corpNationalizationThreat");
    return matchActiveNationalizationBills(db as unknown as Db, corp, sectorIdStr, typeToSectorIds);
  }

  it("returns per-bill detail for a whole-corp bill", async () => {
    const billId = new ObjectId();
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          _id: billId,
          status: "active",
          countryId: "CN",
          title: "Nationalize Acme",
          provisions: [{ type: "nationalize", targetCorporationId: corpId }],
        },
      ])
    );
    expect(await match()).toEqual([
      { billId: String(billId), title: "Nationalize Acme", whole: true, sectorIds: [] },
    ]);
  });

  it("expands a sector-type bill to the corp's sectors of that type", async () => {
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          status: "active",
          countryId: "CN",
          title: "Nationalize Energy",
          provisions: [{ type: "nationalize", targetSectorType: "energy" }],
        },
      ])
    );
    const r = await match();
    expect(r).toHaveLength(1);
    expect(r[0].whole).toBe(false);
    expect(new Set(r[0].sectorIds)).toEqual(new Set([String(s1), String(s2)]));
  });

  it("falls back to a default title when the bill has none", async () => {
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          status: "active",
          countryId: "CN",
          provisions: [{ type: "nationalize", targetCorporationId: corpId }],
        },
      ])
    );
    expect((await match())[0].title).toBe("Nationalization bill");
  });

  it("returns nothing when no active bill targets the corp", async () => {
    db.collectionMocks.bills.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          status: "active",
          countryId: "CN",
          provisions: [{ type: "nationalize", targetCorporationId: new ObjectId() }],
        },
      ])
    );
    expect(await match()).toEqual([]);
  });
});
