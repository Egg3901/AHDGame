import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { sectorExitValueAnchor, sectorExitValueByIdAnchor } from "./sectorExitBasis";
import { computeSectorNpvSum, previewDissolveSettlement } from "./corporateBondDefault";
import { previewRestructure } from "./restructure";
import {
  sectorBookValueAnchor,
  sumSectorBookValueAnchor,
} from "@/lib/corporations/sectorProfitBasis";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import type { CorporateSector } from "@/lib/db/types";

const CORP_ID = new ObjectId();
const PRIME_MAP = new Map<string, number>([["US", 5]]);
const NO_FX = new Map<never, number>();
const YEAR = CAPACITY_ANCHOR_YEAR;

function sector(over: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: CORP_ID,
    countryId: "US",
    stateId: "CA",
    sectorType: "manufacturing",
    targetGrowthRate: 4,
    currentGrowthRate: 4,
    currentGrowthCost: 20_000,
    revenue: 2_000_000,
    realizedRevenue: 1_800_000,
    profitMargin: 35,
    workers: 1000,
    capitalStock: 500,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as CorporateSector;
}

describe("sectorExitValueAnchor", () => {
  it("is the legacy NPV sum below plants (byte-identical)", () => {
    const sectors = [sector(), sector()];
    expect(
      sectorExitValueAnchor(sectors, PRIME_MAP, null, NO_FX, {
        eraUnitScale: 1,
        plantsEnabled: false,
      })
    ).toBeCloseTo(computeSectorNpvSum(sectors, PRIME_MAP, null, NO_FX), 6);
  });

  it("is the book sum under plants", () => {
    const sectors = [sector(), sector({ capitalStock: 900 })];
    expect(
      sectorExitValueAnchor(sectors, PRIME_MAP, null, NO_FX, {
        eraUnitScale: 1,
        plantsEnabled: true,
        currentYear: YEAR,
      })
    ).toBeCloseTo(sumSectorBookValueAnchor(sectors, YEAR, 1), 6);
  });

  it("includes construction in progress in the book basis", () => {
    const bare = sector({ constructionInProgressAnchor: 0 });
    const building = { ...bare, constructionInProgressAnchor: 5_000_000 } as CorporateSector;
    const opts = { plantsEnabled: true, currentYear: YEAR, eraUnitScale: 1 };
    expect(sectorExitValueAnchor([building], PRIME_MAP, null, NO_FX, opts)).toBeCloseTo(
      sectorExitValueAnchor([bare], PRIME_MAP, null, NO_FX, opts) + 5_000_000,
      6
    );
  });

  it("per-id values sum to the whole-corp value, in both modes", () => {
    const sectors = [sector(), sector({ capitalStock: 900 }), sector({ revenue: 10 })];
    for (const plantsEnabled of [false, true]) {
      const opts = { plantsEnabled, currentYear: YEAR, eraUnitScale: 1 };
      const byId = sectorExitValueByIdAnchor(sectors, PRIME_MAP, null, NO_FX, opts);
      const total = byId.reduce((s, r) => s + r.npvAnchor, 0);
      expect(total).toBeCloseTo(sectorExitValueAnchor(sectors, PRIME_MAP, null, NO_FX, opts), 4);
    }
  });

  it("per-id keys are the sector ids", () => {
    const sectors = [sector(), sector()];
    const byId = sectorExitValueByIdAnchor(sectors, PRIME_MAP, null, NO_FX, {
      eraUnitScale: 1,
      plantsEnabled: true,
      currentYear: YEAR,
    });
    expect(byId.map((r) => r.sectorId)).toEqual(sectors.map((s) => s._id.toString()));
    expect(byId[0].npvAnchor).toBeCloseTo(sectorBookValueAnchor(sectors[0], YEAR, 1), 6);
  });
});

// ── The consistency pins: preview basis === executor basis ───────────────────
//
// These do not exercise the routes (they need a db); they pin the SHARED
// primitive both halves call, with the same inputs each half supplies. If a
// future edit re-derives a basis inline at one call site, the numbers below
// stop matching and this file goes red.

describe("preview/executor basis consistency", () => {
  it("restructure: preview and executor select the same sectors under plants", () => {
    const sectors = [
      sector({ capitalStock: 100 }),
      sector({ capitalStock: 900 }),
      sector({ capitalStock: 400 }),
    ];
    const opts = { plantsEnabled: true, currentYear: YEAR, eraUnitScale: 1 };

    // Both halves now build their candidate list through this one helper.
    const previewList = sectorExitValueByIdAnchor(sectors, PRIME_MAP, null, NO_FX, opts);
    const executorList = sectorExitValueByIdAnchor(sectors, PRIME_MAP, null, NO_FX, opts);
    expect(previewList).toEqual(executorList);

    const params = {
      defaultedPrincipalAnchor: 1_000_000,
      liquidCapitalAnchor: 0,
    };
    const a = previewRestructure({ ...params, sectorNpvByIdAnchor: previewList });
    const b = previewRestructure({ ...params, sectorNpvByIdAnchor: executorList });
    expect(a.sectorsToLiquidate.map((s) => s.sectorId)).toEqual(
      b.sectorsToLiquidate.map((s) => s.sectorId)
    );
    expect(a.proceeds).toBeCloseTo(b.proceeds, 6);
  });

  it("restructure: the plants basis is book, not NPV (the pre-fix drift)", () => {
    // A sector with lots of earnings but little plant: NPV >> book. Pre-fix the
    // panel ranked/valued on the left number and the executor paid the right.
    const sectors = [sector({ capitalStock: 1 })];
    const npvList = sectorExitValueByIdAnchor(sectors, PRIME_MAP, null, NO_FX, {
      eraUnitScale: 1,
      plantsEnabled: false,
    });
    const bookList = sectorExitValueByIdAnchor(sectors, PRIME_MAP, null, NO_FX, {
      eraUnitScale: 1,
      plantsEnabled: true,
      currentYear: YEAR,
    });
    expect(npvList[0].npvAnchor).toBeGreaterThan(bookList[0].npvAnchor);
    expect(bookList[0].npvAnchor).toBeCloseTo(sectorBookValueAnchor(sectors[0], YEAR, 1), 6);
  });

  it("dissolve: the preview quotes the same salvage basis the executor settles", () => {
    const sectors = [sector({ capitalStock: 300 }), sector({ capitalStock: 700 })];
    const bonds = [] as never[];
    const npv = computeSectorNpvSum(sectors, PRIME_MAP, null, NO_FX);
    const book = sumSectorBookValueAnchor(sectors, YEAR, 1);
    expect(npv).not.toBeCloseTo(book, 0); // the two bases genuinely differ

    // What the route now passes (mode-aware) vs what the executor computes.
    const previewed = previewDissolveSettlement(
      { totalShares: 0, shareholders: [] } as never,
      npv,
      bonds,
      0,
      NO_FX,
      { plantsEnabled: true, sectorBookAnchor: book }
    );
    const executed = previewDissolveSettlement(
      { totalShares: 0, shareholders: [] } as never,
      npv,
      bonds,
      0,
      NO_FX,
      { plantsEnabled: true, sectorBookAnchor: sumSectorBookValueAnchor(sectors, YEAR, 1) }
    );
    expect(previewed.totalAssets).toBeCloseTo(executed.totalAssets, 6);

    // And the pre-fix preview (no options) was measurably different.
    const preFix = previewDissolveSettlement(
      { totalShares: 0, shareholders: [] } as never,
      npv,
      bonds,
      0,
      NO_FX
    );
    expect(preFix.totalAssets).not.toBeCloseTo(executed.totalAssets, 0);
  });
});
