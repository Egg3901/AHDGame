import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  for (const name of ["financialTxLog", "bonds", "corporations"]) db.collection(name);
});

async function setup(corpId: ObjectId) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: corpId, name: "Kaviori Telecom Holdings" } as never,
  });
}

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("GET /api/corporations/[id]/bonds/history", () => {
  it("returns first page of 10 turns by default with pagination metadata", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    const bondId = new ObjectId();
    const issuerCorpId = new ObjectId();

    // Aggregate returns one row per distinct turn, sorted desc.
    const distinctTurns = [447, 446, 445, 444, 443, 442, 441, 440, 439, 438, 437, 436];
    db.collectionMocks["financialTxLog"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(distinctTurns.map((t) => ({ _id: t }))),
    });

    // Find returns the rows for the page's turns (first 10 of distinctTurns).
    db.collectionMocks["financialTxLog"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          type: "bond_purchase",
          turn: 444,
          createdAt: new Date("2026-04-29T17:50:22Z"),
          subjectType: "corporation",
          subjectId: corpId,
          amount: -457_905_098.89,
          anchorAmount: -440_293_364.32,
          currencyCode: "USD",
          counterpartyType: "system",
          counterpartyName: "Bond market",
          meta: { bondId: bondId.toString(), units: 40_000_000, bondCurrency: "JPY" },
        },
        {
          _id: new ObjectId(),
          type: "bond_coupon",
          turn: 447,
          createdAt: new Date("2026-04-29T16:00:00Z"),
          subjectType: "corporation",
          subjectId: corpId,
          amount: 963_541.67,
          anchorAmount: 1_211_904.65,
          currencyCode: "GBP",
          counterpartyType: "government",
          counterpartyName: "United Kingdom",
          meta: { bondId: bondId.toString(), units: 500_000, couponRate: 9.25 },
        },
      ])
    );

    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: bondId,
          issuerType: "sovereign",
          countryId: "UK",
          issuerName: "United Kingdom",
          corporationId: issuerCorpId,
          couponRate: 9.25,
          maturityTurn: 444,
        },
      ])
    );

    const { GET } = await import("./route");
    const req = new Request(`http://localhost/api/corporations/${corpId.toString()}/bonds/history`);
    const res = await GET(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Pagination metadata
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
    expect(body.totalTurns).toBe(12);
    expect(body.pageCount).toBe(2); // ceil(12/10)
    expect(typeof body.windowTurns).toBe("number");

    // Entries are the rows for the requested page's turns.
    expect(body.entries).toHaveLength(2);

    const couponRow = body.entries.find(
      (e: { type: string; amount: number }) => e.type === "bond_coupon" && e.amount > 0
    ) as {
      counterparty: { kind: string; name: string };
      bond: { issuerName: string; issuerType: string; issuerCountryId?: string };
      anchorAmount: number;
      units?: number;
    };
    expect(couponRow.counterparty.name).toBe("United Kingdom");
    expect(couponRow.bond.issuerName).toBe("United Kingdom");
    expect(couponRow.bond.issuerType).toBe("sovereign");
    expect(couponRow.bond.issuerCountryId).toBe("UK");
    expect(couponRow.anchorAmount).toBe(1_211_904.65);
  });

  it("synthesizes 'Bondholders' counterparty for issuer-side aggregate rows", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    const bondId = new ObjectId();
    db.collectionMocks["financialTxLog"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: 100 }]),
    });
    db.collectionMocks["financialTxLog"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          type: "bond_coupon",
          turn: 100,
          createdAt: new Date(),
          subjectType: "corporation",
          subjectId: corpId,
          amount: -1_000_000,
          currencyCode: "USD",
          meta: { bondId: bondId.toString(), source: "issuer_coupon" },
        },
      ])
    );
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));

    const { GET } = await import("./route");
    const req = new Request(`http://localhost/api/corporations/${corpId.toString()}/bonds/history`);
    const res = await GET(req, { params: Promise.resolve({ id: corpId.toString() }) });
    const body = await res.json();
    expect(body.entries[0].counterparty.kind).toBe("bondholders");
    expect(body.entries[0].counterparty.name).toBe("Bondholders");
    expect(body.entries[0].source).toBe("issuer_coupon");
  });

  it("surfaces meta.refinance as a top-level boolean on bond_issuance rows", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    const newBondId = new ObjectId();
    db.collectionMocks["financialTxLog"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: 200 }]),
    });
    db.collectionMocks["financialTxLog"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          type: "bond_issuance",
          turn: 200,
          createdAt: new Date(),
          subjectType: "corporation",
          subjectId: corpId,
          amount: 0,
          currencyCode: "USD",
          meta: {
            bondId: newBondId.toString(),
            refinance: true,
            faceValue: 1_000_000,
          },
        },
      ])
    );
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));

    const { GET } = await import("./route");
    const req = new Request(`http://localhost/api/corporations/${corpId.toString()}/bonds/history`);
    const res = await GET(req, { params: Promise.resolve({ id: corpId.toString() }) });
    const body = await res.json();
    expect(body.entries[0].refinance).toBe(true);
  });

  it("falls back to corporations.name when bond.issuerName is missing", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    const bondId = new ObjectId();
    const issuerCorpId = new ObjectId();
    db.collectionMocks["financialTxLog"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: 100 }]),
    });
    db.collectionMocks["financialTxLog"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          type: "bond_coupon",
          turn: 100,
          createdAt: new Date(),
          subjectType: "corporation",
          subjectId: corpId,
          amount: 100,
          currencyCode: "USD",
          meta: { bondId: bondId.toString() },
        },
      ])
    );
    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: bondId,
          issuerType: "corporation",
          // issuerName intentionally missing — should resolve via corp lookup
          corporationId: issuerCorpId,
          couponRate: 5,
          maturityTurn: 100,
        },
      ])
    );
    db.collectionMocks["corporations"]!.find.mockReturnValue(
      makeCursor([{ _id: issuerCorpId, name: "Acme Industries" }])
    );

    const { GET } = await import("./route");
    const req = new Request(`http://localhost/api/corporations/${corpId.toString()}/bonds/history`);
    const res = await GET(req, { params: Promise.resolve({ id: corpId.toString() }) });
    const body = await res.json();
    expect(body.entries[0].bond.issuerName).toBe("Acme Industries");
  });

  it("respects page and pageSize query params", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    const distinctTurns = Array.from({ length: 25 }, (_, i) => 500 - i);
    db.collectionMocks["financialTxLog"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(distinctTurns.map((t) => ({ _id: t }))),
    });
    db.collectionMocks["financialTxLog"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));

    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bonds/history?page=2&pageSize=5`
    );
    const res = await GET(req, { params: Promise.resolve({ id: corpId.toString() }) });
    const body = await res.json();
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(5);
    expect(body.totalTurns).toBe(25);
    expect(body.pageCount).toBe(5); // ceil(25/5)
  });

  it("returns empty entries when no bond tx rows exist", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    db.collectionMocks["financialTxLog"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["financialTxLog"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));

    const { GET } = await import("./route");
    const req = new Request(`http://localhost/api/corporations/${corpId.toString()}/bonds/history`);
    const res = await GET(req, { params: Promise.resolve({ id: corpId.toString() }) });
    const body = await res.json();
    expect(body.entries).toEqual([]);
    expect(body.totalTurns).toBe(0);
    expect(body.pageCount).toBe(1);
  });

  it("rejects invalid pageSize", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bonds/history?pageSize=999`
    );
    const res = await GET(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(400);
  });

  it("applies a server-side direction filter to the aggregate match (zero-amount rows included in both)", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    const aggregateMock = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: 100 }]),
    });
    db.collectionMocks["financialTxLog"]!.aggregate = aggregateMock;
    db.collectionMocks["financialTxLog"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));

    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bonds/history?direction=income`
    );
    const res = await GET(req, { params: Promise.resolve({ id: corpId.toString() }) });
    const body = await res.json();
    expect(body.direction).toBe("income");
    // `$gte: 0` (not `$gt: 0`) so zero-amount audit rows like refinance
    // bond_issuance still appear under directional filters.
    const pipeline = aggregateMock.mock.calls[0][0] as Array<Record<string, unknown>>;
    const matchStage = pipeline[0]["$match"] as Record<string, unknown>;
    expect(matchStage).toMatchObject({ amount: { $gte: 0 } });
  });

  it("normalizes case-insensitive direction values", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    db.collectionMocks["financialTxLog"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["financialTxLog"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));

    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bonds/history?direction=INCOME`
    );
    const res = await GET(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.direction).toBe("income");
  });

  it("clamps an out-of-range page request to the last valid page", async () => {
    const corpId = new ObjectId();
    await setup(corpId);
    // 3 distinct turns, pageSize 1 → pageCount 3. Request page 99.
    db.collectionMocks["financialTxLog"]!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: 300 }, { _id: 200 }, { _id: 100 }]),
    });
    db.collectionMocks["financialTxLog"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));

    const { GET } = await import("./route");
    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bonds/history?page=99&pageSize=1`
    );
    const res = await GET(req, { params: Promise.resolve({ id: corpId.toString() }) });
    const body = await res.json();
    expect(body.page).toBe(3); // clamped to pageCount
    expect(body.pageCount).toBe(3);
  });
});
