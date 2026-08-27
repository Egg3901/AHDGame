/**
 * Ticket #1198: a relocation bond is new borrowing, so it answers to the same
 * exit-equity ceiling as an ordinary issuance.
 *
 * Every route that calls `previewRelocationBond` mocks it out, so without this
 * file the cap on this path has no coverage at all, and it is precisely the
 * path a CEO would reach for if the ordinary route started refusing them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
  marketAtLeast: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 500, currentYear: 1960 }),
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldEraUnitScale: vi.fn().mockResolvedValue(1),
}));

import { previewRelocationBond } from "./issueRelocationBond";

const CORP_ID = new ObjectId();
const FX: ReadonlyMap<CurrencyCode, number> = new Map([["USD", 1]] as [CurrencyCode, number][]);

/** Big earnings, small book: going-concern equity dwarfs realizable equity. */
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
  profitMargin: 35,
  effectiveProfitMargin: 35,
  currentGrowthRate: 0,
};

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function makeDb(opts: { heldBondUnits?: number } = {}): Db {
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

  const collections: Record<string, unknown> = {
    bonds: {
      findOne: vi.fn().mockResolvedValue(null), // no prior issue, so no cooldown
      find: vi.fn((filter: Record<string, unknown>) =>
        makeCursor(filter && "holders.corporationId" in filter ? held : [])
      ),
    },
    corporateSectors: { find: vi.fn(() => makeCursor([RICH_NPV_THIN_BOOK])) },
    centralBanks: { find: vi.fn(() => makeCursor([{ countryId: "US", primeRate: 5 }])) },
    corporationHistory: { findOne: vi.fn().mockResolvedValue({ income: 1_000_000 }) },
  };
  return {
    collection: vi.fn((name: string) => collections[name] ?? { find: vi.fn(() => makeCursor([])) }),
  } as unknown as Db;
}

const CORP = {
  _id: CORP_ID,
  name: "Relocating Corp",
  countryId: "US",
  liquidCapital: 1_000_000,
  liquidCurrencyCode: "USD",
} as never;

describe("previewRelocationBond — ticket #1198 exit-equity ceiling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("caps available capacity at realizable equity, not going-concern equity", async () => {
    // Cash A1,000,000 + book A10,000,000 = A11,000,000 realizable.
    const preflight = await previewRelocationBond(makeDb(), CORP, 1, 500, FX);
    expect(preflight.totalEquity).toBeGreaterThan(11_000_000);
    expect(preflight.availableBondCapacity).toBe(11_000_000);
  });

  it("refuses a relocation costing more than the corp could realize", async () => {
    const preflight = await previewRelocationBond(makeDb(), CORP, 50_000_000, 500, FX);
    // Comfortably inside 2x going-concern equity, outside realizable assets.
    expect(preflight.totalEquity * 2).toBeGreaterThan(50_000_000);
    expect(preflight.ok).toBe(false);
  });

  it("allows a relocation that fits inside realizable equity", async () => {
    const preflight = await previewRelocationBond(makeDb(), CORP, 5_000_000, 500, FX);
    expect(preflight.ok).toBe(true);
  });

  it("counts the corp's bond portfolio toward the capacity", async () => {
    const preflight = await previewRelocationBond(
      makeDb({ heldBondUnits: 50_000 }), // A50,000,000 of face held as a creditor
      CORP,
      50_000_000,
      500,
      FX
    );
    expect(preflight.availableBondCapacity).toBe(61_000_000);
    expect(preflight.ok).toBe(true);
  });
});
