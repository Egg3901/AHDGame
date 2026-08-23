/**
 * THE no-mint invariant for capacity (C1 regression).
 *
 * D11 claims: "a sector that is built and then immediately liquidated recovers
 * salvageFraction × build cost and never more: exits cannot mint." That claim
 * was FALSE for every discounted build. Book value was
 * `capitalStock × capacityPricePerUnit` — the RAW list price — while builds are
 * charged that price times founding 0.1×, CEO acumen down to 0.5×, tech 0.7×
 * and a cheap host state 0.6×. Measured on the original code: found a sector
 * for 3.0M ₳, book it at 30M ₳, restructure at the 0.85 salvage fraction and
 * receive 25.5M ₳ — 8.5× the cash spent. Salvage is CREDITED to the corp, so it
 * was money creation, not a transfer.
 *
 * The fix is `capacityBookAnchor`: the sector carries the cash actually PAID for
 * the capacity it holds, and every exit prices off that. These tests are the
 * invariant, stated for each acquisition path and for each exit:
 *
 *     exit proceeds  <  cash paid in
 *
 * strictly, because every salvage fraction is below 1.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  computeBuildCost,
  CAPACITY_BUILD_TURNS,
  type BuildCostInputs,
} from "@/lib/constants/capacityEconomy";
import {
  sectorBookValueAnchor,
  sectorCapacityBookAnchor,
  sectorCapacityListValueAnchor,
} from "@/lib/corporations/sectorProfitBasis";
import {
  DISSOLUTION_SECTOR_SALVAGE_FRACTION,
  RESTRUCTURE_SECTOR_SALVAGE_FRACTION,
} from "@/lib/constants/corporations";
import type { CorporateSector } from "@/lib/db/types";
import { buildMarketContext } from "@/lib/market/marketContext";
import { processSector, type SectorTurnEnv } from "@/lib/turn/corporation/sectorTurn";
import type { CorporationLookups } from "@/lib/turn/corporation/types";
import type { Corporation } from "@/lib/db/types";

const YEAR = 1953;
const UNITS = 10_000;
const TYPE = "manufacturing" as const;

/** Every acquisition path, named by the discount stack it applies. */
const PATHS: { name: string; inputs: Partial<BuildCostInputs> }[] = [
  { name: "plain build (no discounts)", inputs: {} },
  { name: "founding build (0.1x)", inputs: { founding: true } },
  { name: "high-acumen CEO", inputs: { acumen: 100 } },
  { name: "full tech discount", inputs: { techGrowthCostMultiplier: 0.7 } },
  { name: "cheap host state", inputs: { hostCostOfLivingIndex: 60 } },
  {
    name: "every discount stacked",
    inputs: {
      founding: true,
      acumen: 100,
      techGrowthCostMultiplier: 0.7,
      hostCostOfLivingIndex: 60,
    },
  },
  // A dominant builder pays MORE than list. Book must not follow it up either:
  // the paid basis is what was paid, and the salvage fraction does the rest.
  { name: "dominant builder (pays above list)", inputs: { marketSharePercent: 90 } },
];

describe("C1 — capacity exits cannot mint", () => {
  for (const path of PATHS) {
    it(`${path.name}: every exit returns less than the cash paid in`, () => {
      const paidAnchor = computeBuildCost({
        eraUnitScale: 1,
        sectorType: TYPE,
        units: UNITS,
        year: YEAR,
        ...path.inputs,
      }).totalAnchor;
      expect(paidAnchor).toBeGreaterThan(0);

      // The sector as it stands the moment the order lands: capacity online,
      // CIP released, paid basis recorded.
      const landed = {
        sectorType: TYPE,
        capitalStock: UNITS,
        capacityBookAnchor: paidAnchor,
        constructionInProgressAnchor: 0,
      };
      const book = sectorBookValueAnchor(landed, YEAR, 1);

      // Book IS the cash paid — not the list price it was discounted from.
      expect(book).toBeCloseTo(paidAnchor, 6);
      // ...and every exit takes a haircut off that, so all of them lose money.
      expect(book * DISSOLUTION_SECTOR_SALVAGE_FRACTION).toBeLessThan(paidAnchor);
      expect(book * RESTRUCTURE_SECTOR_SALVAGE_FRACTION).toBeLessThan(paidAnchor);
    });
  }

  it("the founding path was the worst case, and is no longer a mint", () => {
    const paid = computeBuildCost({
      eraUnitScale: 1,
      sectorType: TYPE,
      units: UNITS,
      year: YEAR,
      founding: true,
    }).totalAnchor;
    const list = sectorCapacityListValueAnchor({ sectorType: TYPE, capitalStock: UNITS }, YEAR, 1);
    // The wedge that used to be minted: list is 10x what founding paid.
    expect(list / paid).toBeCloseTo(10, 6);
    // Restructuring used to return 0.85 x list = 8.5x the spend. Now:
    const book = sectorBookValueAnchor(
      {
        sectorType: TYPE,
        capitalStock: UNITS,
        capacityBookAnchor: paid,
        constructionInProgressAnchor: 0,
      },
      YEAR,
      1
    );
    expect(book * RESTRUCTURE_SECTOR_SALVAGE_FRACTION).toBeLessThan(paid);
  });

  it("a build still in flight books at its paid cost, not at list", () => {
    const paid = computeBuildCost({
      eraUnitScale: 1,
      sectorType: TYPE,
      units: UNITS,
      year: YEAR,
      founding: true,
    }).totalAnchor;
    // capitalStock 0 + CIP: exactly what `expandSector` writes for a newborn.
    const book = sectorBookValueAnchor(
      {
        sectorType: TYPE,
        capitalStock: 0,
        capacityBookAnchor: 0,
        constructionInProgressAnchor: paid,
      },
      YEAR,
      1
    );
    expect(book).toBeCloseTo(paid, 6);
  });

  it("free capacity DILUTES the basis rather than adding to it", () => {
    const paid = computeBuildCost({
      eraUnitScale: 1,
      sectorType: TYPE,
      units: UNITS,
      year: YEAR,
    }).totalAnchor;
    // An R&D breakthrough doubles the capacity and pays nothing for it.
    const book = sectorBookValueAnchor(
      {
        sectorType: TYPE,
        capitalStock: UNITS * 2,
        capacityBookAnchor: paid,
        constructionInProgressAnchor: 0,
      },
      YEAR,
      1
    );
    expect(book).toBeCloseTo(paid, 6);
    expect(book * RESTRUCTURE_SECTOR_SALVAGE_FRACTION).toBeLessThan(paid);
  });

  it("falls back to the list value for a row with no recorded basis", () => {
    // Legacy / pre-P5 rows must keep working, at exactly the old behaviour.
    const sector = { sectorType: TYPE, capitalStock: UNITS };
    expect(sectorCapacityBookAnchor(sector, YEAR, 1)).toBeCloseTo(
      sectorCapacityListValueAnchor(sector, YEAR, 1),
      6
    );
    // A negative or non-finite stored value is treated as absent, not trusted.
    expect(sectorCapacityBookAnchor({ ...sector, capacityBookAnchor: -5 }, YEAR, 1)).toBeCloseTo(
      sectorCapacityListValueAnchor(sector, YEAR, 1),
      6
    );
    expect(
      sectorCapacityBookAnchor({ ...sector, capacityBookAnchor: Number.NaN }, YEAR, 1)
    ).toBeCloseTo(sectorCapacityListValueAnchor(sector, YEAR, 1), 6);
  });
});

// ─── The turn processor actually stamps the basis ───────────────────────────

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();

function makeCorp(): Corporation {
  return {
    _id: CORP_ID,
    name: "Basis Test Corp",
    countryId: "US",
    sectorType: TYPE,
    liquidCapital: 10_000_000,
    createdAt: new Date(),
  } as unknown as Corporation;
}

function makeLookups(): CorporationLookups {
  return {
    corporations: [],
    sectorsByCorp: new Map(),
    corpById: new Map(),
    ceoBusinessAcumenByCorpId: new Map(),
    bondsByCorpId: new Map(),
    bondsHeldByCorpId: new Map(),
    portfolioAnchorValueByCorpId: new Map(),
    bondAndImfPortfolioAnchorByCorpId: new Map(),
    issuedBondDebtByCorpId: new Map(),
    crossCorpStockHoldingsByHolderCorpId: new Map(),
    primeRateByCountry: new Map(),
    macroInflationByCountry: new Map(),
    investorConfidenceByCountry: new Map(),
    macroDebtToGdpByCountry: new Map(),
    macroDeficitByCountry: new Map(),
    sovereignDefaultMarginByCorpId: new Map(),
    marketShareBySectorId: new Map([[SECTOR_ID.toString(), 0]]),
    allTariffs: [],
    activeFtaPairs: new Set(),
    ftaCoverage: { byCountryEconomyWide: new Map(), bySectorType: new Map() },
    activeSubsidies: [],
    priceRatioByCommodity: new Map(),
    globalCommodityBalances: new Map(),
    stateInputAvailabilityByState: new Map(),
    nationalCommodityBalancesByCountry: new Map(),
    rawStateBalances: new Map(),
    extractionCapacityUtilBySector: new Map(),
    stateResourceCapacityByState: new Map(),
    stateSectorSpecializationByState: new Map(),
    rawWorkforceSkillByState: new Map(),
    labourTightnessByState: new Map(),
    regionalConditionMarginByState: new Map(),
    sectorPresenceKeys: new Set(),
    exportIntensityByCountry: new Map(),
    activeDisasterEffectsByState: new Map(),
    politicalBoardByState: new Map(),
  } as unknown as CorporationLookups;
}

function runTurn(sector: CorporateSector, currentTurn: number) {
  const env = {
    lookups: makeLookups(),
    turn: currentTurn,
    currentTurn,
    currentYear: YEAR,
    now: new Date("2026-08-01T00:00:00Z"),
    techTreesEnabled: false,
    labour: { wagesEnabled: false },
    market: buildMarketContext("plants"),
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    labourDemandByState: new Map(),
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps: [],
  } as unknown as SectorTurnEnv;
  processSector(env, makeCorp(), sector, 1, undefined, 1);
  const op = env.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
  return op.updateOne.update.$set;
}

describe("C1 — sectorTurn maintains the paid basis", () => {
  const paid = computeBuildCost({
    eraUnitScale: 1,
    sectorType: TYPE,
    units: UNITS,
    year: YEAR,
    founding: true,
  }).totalAnchor;

  function newborn(currentTurn: number): CorporateSector {
    return {
      _id: SECTOR_ID,
      corporationId: CORP_ID,
      stateId: "US-TX",
      countryId: "US",
      sectorType: TYPE,
      strategyId: "standard",
      revenue: 1_000_000,
      profitMargin: 20,
      effectiveProfitMargin: 20,
      currentGrowthRate: 0,
      targetGrowthRate: 0,
      currentGrowthCost: 0,
      productionPolicy: 0,
      productionPolicyLevel: 0,
      workers: 100,
      capitalStock: 0,
      capacityBookAnchor: 0,
      constructionInProgressAnchor: paid,
      plantsStartTurn: currentTurn - 1,
      buildQueue: [
        {
          unitsOrdered: UNITS,
          costPaidAnchor: paid,
          startTurn: 1000,
          onlineTurn: 1000 + CAPACITY_BUILD_TURNS(TYPE),
        },
      ],
      createdAt: new Date(),
    } as unknown as CorporateSector;
  }

  it("holds the basis at 0 while the build is in flight", () => {
    const set = runTurn(newborn(1001), 1001);
    expect(set.capacityBookAnchor).toBe(0);
  });

  it("moves the order's PAID cash into the basis on the turn it lands", () => {
    const landTurn = 1000 + CAPACITY_BUILD_TURNS(TYPE);
    const set = runTurn(newborn(landTurn), landTurn);
    const book = set.capacityBookAnchor as number;
    const stock = set.capitalStock as number;
    expect(stock).toBeGreaterThan(0);
    // The basis is the discounted cash, less that turn's depreciation — NOT the
    // list price the discount was taken off.
    expect(book).toBeGreaterThan(paid * 0.99);
    expect(book).toBeLessThanOrEqual(paid);
    expect(book).toBeLessThan(
      sectorCapacityListValueAnchor({ sectorType: TYPE, capitalStock: stock }, YEAR, 1)
    );
    // ...and the whole point: liquidating right now loses money.
    expect(
      sectorBookValueAnchor(
        {
          sectorType: TYPE,
          capitalStock: stock,
          capacityBookAnchor: book,
          constructionInProgressAnchor: 0,
        },
        YEAR,
        1
      ) * RESTRUCTURE_SECTOR_SALVAGE_FRACTION
    ).toBeLessThan(paid);
  });

  it("depreciates the basis in lockstep with the capacity (per-unit basis held)", () => {
    const landTurn = 1000 + CAPACITY_BUILD_TURNS(TYPE);
    const first = runTurn(newborn(landTurn), landTurn);
    const stock0 = first.capitalStock as number;
    const book0 = first.capacityBookAnchor as number;
    const next = runTurn(
      { ...newborn(landTurn + 1), ...first, buildQueue: [] } as unknown as CorporateSector,
      landTurn + 1
    );
    const stock1 = next.capitalStock as number;
    const book1 = next.capacityBookAnchor as number;
    expect(stock1).toBeLessThan(stock0);
    expect(book1).toBeLessThan(book0);
    // Per-unit basis is invariant under depreciation — that is what stops a
    // worn-out plant booking at full replacement cost.
    expect(book1 / stock1).toBeCloseTo(book0 / stock0, 6);
  });

  it("seeds a pre-plants sector's basis at list value on its flip turn", () => {
    const legacy = {
      ...newborn(1001),
      plantsStartTurn: undefined,
      capitalStock: UNITS,
      capacityBookAnchor: undefined,
      constructionInProgressAnchor: 0,
      buildQueue: [],
    } as unknown as CorporateSector;
    const set = runTurn(legacy, 1001);
    const stock = set.capitalStock as number;
    const book = set.capacityBookAnchor as number;
    // Legacy capacity was bought through the growth stack at exactly list price
    // (identity B), so the flip stamp is the list value of the stock it starts
    // with — i.e. the fallback, made explicit. No write-up, no write-down.
    expect(book / stock).toBeCloseTo(
      sectorCapacityListValueAnchor({ sectorType: TYPE, capitalStock: 1 }, YEAR, 1),
      6
    );
  });
});
