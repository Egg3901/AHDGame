import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Bond, Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";

vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
  marketAtLeast: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentYear: 1956 }),
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldEraUnitScale: vi.fn().mockResolvedValue(1),
}));

import { filterInsolventCorps } from "./bondTurnHelpers";

const FX: ReadonlyMap<CurrencyCode, number> = new Map([["USD", 1]]);

function makeDb(sectors: Record<string, unknown>[]): Db {
  return {
    collection: vi.fn().mockReturnValue({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(sectors) }),
    }),
  } as unknown as Db;
}

function makeCorp(id: ObjectId, liquidCapital: number): Corporation {
  return { _id: id, liquidCapital, countryId: "US", headquartersState: "DC" } as Corporation;
}

function makeBond(corpId: ObjectId, totalIssued: number): Bond {
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    totalIssued,
    matured: false,
    couponRate: 6.34,
    currencyCode: "USD",
  } as unknown as Bond;
}

describe("filterInsolventCorps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not default a cash-negative corp whose assets cover its debt", async () => {
    // Ticket #1130 to the number: COSTCO was 16.58 under with ₳232,591 of book
    // (mostly paid-for construction) against ₳163,000 of debt. Assets cover the
    // debt more than once over, so it is illiquid, not insolvent.
    const corpId = new ObjectId();
    const db = makeDb([
      {
        corporationId: corpId,
        capitalStock: 35.18,
        capacityBookAnchor: 9690,
        constructionInProgressAnchor: 222901,
      },
    ]);
    const out = await filterInsolventCorps(db, new Set([corpId.toString()]), {
      corpMap: new Map([[corpId.toString(), makeCorp(corpId, -16.58)]]),
      fxByCurrency: FX,
      centralBanks: [{ countryId: "US", primeRate: 4.42 }],
      activeBonds: [makeBond(corpId, 163000)],
    });
    expect(out.size).toBe(0);
  });

  it("still defaults a cash-negative corp whose assets fall short of its debt", async () => {
    const corpId = new ObjectId();
    const db = makeDb([
      {
        corporationId: corpId,
        capitalStock: 1,
        capacityBookAnchor: 500,
        constructionInProgressAnchor: 0,
      },
    ]);
    const out = await filterInsolventCorps(db, new Set([corpId.toString()]), {
      corpMap: new Map([[corpId.toString(), makeCorp(corpId, -200)]]),
      fxByCurrency: FX,
      centralBanks: [{ countryId: "US", primeRate: 4.42 }],
      activeBonds: [makeBond(corpId, 163000)],
    });
    expect(out.has(corpId.toString())).toBe(true);
  });

  it("defaults a corp with no sectors at all", async () => {
    const corpId = new ObjectId();
    const out = await filterInsolventCorps(db_empty(), new Set([corpId.toString()]), {
      corpMap: new Map([[corpId.toString(), makeCorp(corpId, -50)]]),
      fxByCurrency: FX,
      centralBanks: [{ countryId: "US", primeRate: 4.42 }],
      activeBonds: [makeBond(corpId, 10000)],
    });
    expect(out.has(corpId.toString())).toBe(true);
  });

  it("fails safe when the debt figure cannot be read", async () => {
    // A candidate only reaches here because it issued a live bond, so an
    // unreadable principal must not be treated as "no debt" and rescued.
    const corpId = new ObjectId();
    const db = makeDb([
      { corporationId: corpId, capacityBookAnchor: 999999, constructionInProgressAnchor: 0 },
    ]);
    const bond = { _id: new ObjectId(), corporationId: corpId, matured: false } as unknown as Bond;
    const out = await filterInsolventCorps(db, new Set([corpId.toString()]), {
      corpMap: new Map([[corpId.toString(), makeCorp(corpId, -5)]]),
      fxByCurrency: FX,
      centralBanks: [{ countryId: "US", primeRate: 4.42 }],
      activeBonds: [bond],
    });
    expect(out.has(corpId.toString())).toBe(true);
  });

  it("fails safe when the corp is not in the map", async () => {
    const corpId = new ObjectId();
    const out = await filterInsolventCorps(db_empty(), new Set([corpId.toString()]), {
      corpMap: new Map(),
      fxByCurrency: FX,
      centralBanks: [{ countryId: "US", primeRate: 4.42 }],
      activeBonds: [makeBond(corpId, 10000)],
    });
    expect(out.has(corpId.toString())).toBe(true);
  });

  it("returns an empty set unchanged without touching the database", async () => {
    const db = makeDb([]);
    const out = await filterInsolventCorps(db, new Set(), {
      corpMap: new Map(),
      fxByCurrency: FX,
      centralBanks: [],
      activeBonds: [],
    });
    expect(out.size).toBe(0);
    expect(db.collection).not.toHaveBeenCalled();
  });
});

function db_empty(): Db {
  return makeDb([]);
}
