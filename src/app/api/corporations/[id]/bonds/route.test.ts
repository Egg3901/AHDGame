/**
 * Integration tests for /api/corporations/[id]/bonds, covering ticket #1198:
 * the debt ceiling this route quotes and enforces is capped by EXIT equity, not
 * only by going-concern equity.
 *
 * The bug this pins down: under `marketSystemMode: "plants"` a built-out corp's
 * going-concern equity (cash + sector NPV + CIP) can run ~75x its realizable
 * equity (cash + sector book + bond portfolio). Corporation #624 was quoted a
 * ~A468bn ceiling on the first basis, drew under 1% of it, and was declared
 * insolvent on the second basis two turns later. Both halves are checked here:
 * the GET must quote the lower figure and the POST must enforce it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineBond: vi.fn().mockReturnValue("Bond issued"),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 500, currentYear: 1960 }),
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldEraUnitScale: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
  marketAtLeast: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/corporations/corpMoneyLock", () => ({
  withCorpLock: vi.fn(async (_id: unknown, fn: () => Promise<unknown>) => fn()),
}));
vi.mock("@/lib/corporations/redaction", () => ({
  shouldRedactCorporation: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/corporations/reservedCorporateHoldings", () => ({
  isSittingCeoOfControllingParent: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/corporations/turnReferenceData", () => ({
  getTurnReferenceData: vi.fn().mockResolvedValue({
    centralBanks: [{ countryId: "US", primeRate: 5 }],
  }),
}));

const CORP_ID = new ObjectId();
const USER_ID = new ObjectId().toString();

/**
 * A corp whose sectors carry a large realized revenue (so the NPV basis is
 * enormous) but only a small paid-for book. This is corporation #624's shape.
 */
const RICH_NPV_THIN_BOOK = {
  _id: new ObjectId(),
  corporationId: CORP_ID,
  countryId: "US",
  stateId: "NY",
  sectorType: "retail",
  capitalStock: 100,
  capacityBookAnchor: 10_000_000,
  constructionInProgressAnchor: 0,
  revenue: 50_000_000,
  realizedRevenue: 50_000_000,
  // Percent, not a fraction. At 35% the NPV basis lands around A233m against a
  // A10m book, reproducing #624's ~75x spread between the two bases.
  profitMargin: 35,
  effectiveProfitMargin: 35,
  currentGrowthRate: 0,
  targetGrowthRate: 0,
};

let db: MockDb;

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

/**
 * @param heldBondUnits creditor holdings, which count toward exit equity.
 */
function setupDb(opts: { heldBondUnits?: number } = {}) {
  const held =
    opts.heldBondUnits && opts.heldBondUnits > 0
      ? [
          {
            _id: new ObjectId(),
            corporationId: new ObjectId(),
            currencyCode: "USD",
            matured: false,
            defaulted: false,
            couponRate: 5,
            totalIssued: opts.heldBondUnits * 1000,
            publicFloat: 0,
            holders: [{ corporationId: CORP_ID, units: opts.heldBondUnits }],
          },
        ]
      : [];

  // `bonds.find` serves two different queries in this route: the corp's own
  // issues (none here) and its creditor holdings. Discriminate on the filter.
  db.collectionMocks["bonds"]!.find.mockImplementation((filter: Record<string, unknown>) =>
    makeCursor(filter && "holders.corporationId" in filter ? held : [])
  );
  db.collectionMocks["bonds"]!.findOne.mockResolvedValue(null); // no cooldown
  db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([RICH_NPV_THIN_BOOK]));
  db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({ income: 1_000_000 });
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "bonds",
    "corporations",
    "corporateSectors",
    "centralBanks",
    "corporationHistory",
    "exchangeRates",
    "gameState",
  ]) {
    db.collection(name);
  }
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId: USER_ID } } as never);

  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({
    ok: true,
    limit: 100,
    remaining: 99,
    resetAt: Date.now() + 60_000,
  });

  const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(requireCeo).mockReturnValue(null);

  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: {
      _id: CORP_ID,
      name: "Exit Basis Corp",
      countryId: "US",
      liquidCapital: 1_000_000,
      liquidCurrencyCode: "USD",
      totalShares: 1000,
      publicFloat: 0,
      shareholders: [],
      sequentialId: 624,
      isPrivate: false,
      ceoCharacterId: new ObjectId(),
    },
  } as never);
});

function postRequest(faceValue: number) {
  return new Request(`http://localhost/api/corporations/${CORP_ID.toString()}/bonds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ faceValue, maturityTurns: 96 }),
  });
}

describe("GET /api/corporations/[id]/bonds — ticket #1198 exit-equity ceiling", () => {
  it("quotes a ceiling no larger than realizable assets, and names the binding rule", async () => {
    setupDb();
    const { GET } = await import("./route");
    const res = await GET(
      new Request(`http://localhost/api/corporations/${CORP_ID.toString()}/bonds`),
      { params: Promise.resolve({ id: CORP_ID.toString() }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // Going-concern equity is far larger than realizable equity for this shape.
    expect(body.creditDiagnostics.totalEquity).toBeGreaterThan(body.exitEquity);
    // Cash 1,000,000 + book 10,000,000, no holdings.
    expect(body.exitEquity).toBe(11_000_000);
    expect(body.maxAllowedIssuance).toBeLessThanOrEqual(body.exitEquity);
    expect(body.debtHeadroom).toBeLessThanOrEqual(body.exitEquity);
    expect(body.issuanceLimitedBy).toBe("exitEquity");
  });

  it("counts the corp's bond portfolio toward the ceiling it quotes", async () => {
    setupDb({ heldBondUnits: 5_000 }); // A5,000,000 of face held as a creditor
    const { GET } = await import("./route");
    const res = await GET(
      new Request(`http://localhost/api/corporations/${CORP_ID.toString()}/bonds`),
      { params: Promise.resolve({ id: CORP_ID.toString() }) }
    );
    const body = await res.json();
    expect(body.exitEquity).toBe(16_000_000);
    expect(body.maxAllowedIssuance).toBe(16_000_000);
  });
});

describe("POST /api/corporations/[id]/bonds — ticket #1198 exit-equity ceiling", () => {
  it("refuses a raise that clears the 2x equity rule but exceeds realizable assets", async () => {
    setupDb();
    const { POST } = await import("./route");
    // Comfortably inside 2x going-concern equity, far outside A11,000,000 of
    // realizable assets. Pre-fix this returned 200 and issued the bond.
    const res = await POST(postRequest(50_000_000), {
      params: Promise.resolve({ id: CORP_ID.toString() }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/could realize by selling up/i);
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
  });

  it("allows a raise that fits inside realizable assets", async () => {
    setupDb();
    db.collectionMocks["bonds"]!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    const { POST } = await import("./route");
    const res = await POST(postRequest(5_000_000), {
      params: Promise.resolve({ id: CORP_ID.toString() }),
    });
    expect(res.status).toBe(200);
    expect(db.collectionMocks["bonds"]!.insertOne).toHaveBeenCalledTimes(1);
  });

  it("lets the bond portfolio raise the ceiling it enforces", async () => {
    setupDb({ heldBondUnits: 50_000 }); // A50,000,000 of face held
    db.collectionMocks["bonds"]!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    const { POST } = await import("./route");
    // The same A50,000,000 refused above now fits, because the portfolio is an
    // asset the insolvency test will also count.
    const res = await POST(postRequest(50_000_000), {
      params: Promise.resolve({ id: CORP_ID.toString() }),
    });
    expect(res.status).toBe(200);
  });
});
