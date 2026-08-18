import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  allocateShareholderPool,
  canRefinanceDefaultedDebt,
  computeSectorNpvSum,
  previewDissolveSettlement,
  previewRefinanceIssuance,
  roundFaceToBondUnits,
  sumDefaultedBondPrincipal,
  sumNonMaturedBondPrincipal,
  totalEquityForBonds,
} from "./corporateBondDefault";
import type { Bond, Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { DISSOLUTION_SECTOR_SALVAGE_FRACTION } from "@/lib/constants/corporations";

const EMPTY_FX = new Map<CurrencyCode, number>();
const JPY_FX = new Map<CurrencyCode, number>([["JPY", 113.88]]);

describe("corporateBondDefault", () => {
  it("roundFaceToBondUnits floors to $1k units", () => {
    expect(roundFaceToBondUnits(100_000)).toBe(100_000);
    expect(roundFaceToBondUnits(100_499)).toBe(100_000);
    expect(roundFaceToBondUnits(100_500)).toBe(100_000);
  });

  it("totalEquityForBonds adds liquidCapitalAnchor + sectorNpv without mixing units", () => {
    expect(totalEquityForBonds(1_000_000, 500_000)).toBe(1_500_000);
  });

  it("sumNonMaturedBondPrincipal anchor-normalizes JPY bonds", () => {
    // ¥113,880,000 totalIssued = ₳1_000_000. Pre-A5 this returned raw ¥113_880_000
    // which produced ~114× inflated debt/equity ratios for non-USD corps.
    const bonds = [
      { totalIssued: 113_880_000, currencyCode: "JPY", matured: false } as unknown as Bond,
    ];
    expect(sumNonMaturedBondPrincipal(bonds, JPY_FX)).toBeCloseTo(1_000_000, 0);
  });

  it("sumDefaultedBondPrincipal filters non-defaulted + matured before summing", () => {
    const bonds = [
      { totalIssued: 113_880_000, currencyCode: "JPY", defaulted: true, matured: false },
      { totalIssued: 113_880_000, currencyCode: "JPY", defaulted: false, matured: false },
      { totalIssued: 113_880_000, currencyCode: "JPY", defaulted: true, matured: true },
    ] as unknown as Bond[];
    expect(sumDefaultedBondPrincipal(bonds, JPY_FX)).toBeCloseTo(1_000_000, 0);
  });

  it("previewDissolveSettlement uses liquidCapitalAnchor, not corp.liquidCapital", () => {
    // JP corp: local liquidCapital is ¥10_600_000 but anchor is ₳100_000.
    // previewDissolveSettlement must use the anchor value.
    const corp = { liquidCapital: 10_600_000, shareholders: [] } as unknown as Corporation;
    const preview = previewDissolveSettlement(corp, 0, [], 100_000, EMPTY_FX);
    expect(preview.liquidCapital).toBe(100_000);
    expect(preview.totalAssets).toBe(100_000);
  });

  it("previewDissolveSettlement caps bond pool at assets and claims (USD)", () => {
    const corp = {
      liquidCapital: 500_000,
    } as Corporation;
    const bonds = [
      {
        totalIssued: 1_000_000,
        matured: false,
      },
    ] as Bond[];
    // Unstamped bond passes through (rate=1 in corpCapitalToAnchor).
    // Sectors are salvage-haircut: assets = 500k LC + 20% × 1M NPV = 700k.
    const p = previewDissolveSettlement(corp, 1_000_000, bonds, 500_000, EMPTY_FX);
    expect(p.totalAssets).toBe(700_000);
    expect(p.totalBondClaims).toBe(1_000_000);
    expect(p.bondRecoveryPool).toBe(700_000);
    expect(p.shareholderPool).toBe(0);
  });

  it("previewDissolveSettlement salvage-haircuts sectorNPV (abandoned, not sold)", () => {
    const corp = { liquidCapital: 100_000 } as Corporation;
    // Pure NPV with no bonds: only the salvage fraction survives as cash.
    const p = previewDissolveSettlement(corp, 1_000_000, [], 100_000, EMPTY_FX);
    expect(p.totalAssets).toBe(100_000 + DISSOLUTION_SECTOR_SALVAGE_FRACTION * 1_000_000);
    expect(p.shareholderPool).toBe(100_000 + DISSOLUTION_SECTOR_SALVAGE_FRACTION * 1_000_000);
  });

  it("previewDissolveSettlement anchor-normalizes JP-bond claims", () => {
    // Dissolving JP corp with ¥113,880,000 bond issued → ₳1M bond claims vs ₳1.5M assets.
    // Pre-A5 the claims would have been ₳113M numerically, zeroing shareholderPool on any
    // non-USD corp with bonds. A10 downstream payout also depended on this fix.
    const corp = { liquidCapital: 113_880_000 } as Corporation;
    const bonds = [
      { totalIssued: 113_880_000, currencyCode: "JPY", matured: false } as unknown as Bond,
    ];
    // assets = 1M LC + 20% × 500k NPV = 1.1M.
    const p = previewDissolveSettlement(corp, 500_000, bonds, 1_000_000, JPY_FX);
    expect(p.totalAssets).toBeCloseTo(1_100_000, 0);
    expect(p.totalBondClaims).toBeCloseTo(1_000_000, 0);
    expect(p.bondRecoveryPool).toBeCloseTo(1_000_000, 0);
    expect(p.shareholderPool).toBeCloseTo(100_000, 0);
  });

  it("canRefinanceDefaultedDebt rejects when debt cap would be exceeded", () => {
    const r = canRefinanceDefaultedDebt({
      equity: 500_000,
      existingDebtAllNonMatured: 900_000,
      defaultedPrincipal: 200_000,
    });
    expect(r.ok).toBe(false);
    expect(r.requiredFace).toBe(200_000);
  });

  it("canRefinanceDefaultedDebt allows when within 2x equity", () => {
    const r = canRefinanceDefaultedDebt({
      equity: 1_000_000,
      existingDebtAllNonMatured: 500_000,
      defaultedPrincipal: 200_000,
    });
    expect(r.ok).toBe(true);
    expect(r.requiredFace).toBe(200_000);
  });

  it("previewRefinanceIssuance prices a defaulted-debt roll on fundamentals, not the post-default CCC floor", () => {
    // Ticket #1130. The default sets the CCC floor; pricing the roll that cures
    // that default off the same floor is circular and tripled a corp's debt
    // service while handing it no cash. A roll of existing principal is priced
    // on what the corp actually looks like.
    const corp = {
      liquidCapital: 2_000_000,
      bondDefaultCreditPenaltyUntilTurn: 500,
      headquartersState: "us-ca-test",
    } as Corporation;
    const bonds = [
      { totalIssued: 200_000, defaulted: true, couponRate: 5, matured: false },
    ] as Bond[];
    const p = previewRefinanceIssuance({
      corporation: corp,
      liquidCapitalAnchor: 2_000_000,
      allNonMaturedBonds: bonds,
      actualFaceAnchor: 200_000,
      sectorNpv: 0,
      annualIncome: 1_000_000,
      primeRate: 4,
      currentTurn: 100,
      fxByCurrency: EMPTY_FX,
    });
    // Healthy balance sheet (2M cash, 200k debt, 1M income) — the penalty would
    // otherwise force this to CCC and its 12-point spread regardless.
    expect(p.creditRating.rating).not.toBe("CCC");
    expect(p.creditRating.compositeScore).toBeGreaterThan(12);
    // Still a real coupon (prime + tier spread + corporate premium), just not
    // the distressed-tier one.
    expect(p.couponRate).toBeGreaterThan(4);
    expect(p.couponRate).toBeLessThan(4 + 12);
  });

  it("previewRefinanceIssuance still prices a genuinely weak corp poorly", () => {
    // The penalty is gone, not the rating. A corp with no equity and no income
    // must still land in the distressed tier on its own merits.
    const corp = {
      liquidCapital: 0,
      bondDefaultCreditPenaltyUntilTurn: 500,
      headquartersState: "us-ca-test",
    } as Corporation;
    const bonds = [
      { totalIssued: 500_000, defaulted: true, couponRate: 5, matured: false },
    ] as Bond[];
    const p = previewRefinanceIssuance({
      corporation: corp,
      liquidCapitalAnchor: 0,
      allNonMaturedBonds: bonds,
      actualFaceAnchor: 500_000,
      sectorNpv: 0,
      annualIncome: 0,
      primeRate: 4,
      currentTurn: 100,
      fxByCurrency: EMPTY_FX,
    });
    expect(p.creditRating.rating).toBe("CCC");
  });

  describe("allocateShareholderPool (bug #0540 — pro-rata across all buckets)", () => {
    const charA = new ObjectId();
    const charB = new ObjectId();
    const corpX = new ObjectId();
    const corpY = new ObjectId();

    function names(...entries: Array<[ObjectId, string]>): Map<string, string> {
      return new Map(entries.map(([id, name]) => [id.toString(), name]));
    }

    it("distributes pool pro-rata to character shareholders only when no corps/float", () => {
      const corp = {
        totalShares: 100,
        publicFloat: 0,
        shareholders: [
          { characterId: charA, shares: 70 },
          { characterId: charB, shares: 30 },
        ],
      } as unknown as Corporation;
      const result = allocateShareholderPool(
        corp,
        1_000_000,
        names([charA, "Alice"], [charB, "Bob"])
      );
      expect(result.characterRows).toHaveLength(2);
      expect(result.characterRows[0].payout).toBe(700_000);
      expect(result.characterRows[1].payout).toBe(300_000);
      expect(result.corporationRows).toHaveLength(0);
      expect(result.publicFloatRow).toBeNull();
    });

    it("includes corporate equity shareholders in the distribution (fixes bug #0540 dropped slice)", () => {
      const corp = {
        totalShares: 100,
        publicFloat: 0,
        shareholders: [
          { characterId: charA, shares: 52 },
          { corporationId: corpX, shares: 48 },
        ],
      } as unknown as Corporation;
      const result = allocateShareholderPool(
        corp,
        1_000_000,
        names([charA, "Alice"], [corpX, "Acme Holdings"])
      );
      expect(result.characterRows[0].payout).toBe(520_000);
      expect(result.corporationRows).toHaveLength(1);
      expect(result.corporationRows[0].corporationId).toBe(corpX.toString());
      expect(result.corporationRows[0].payout).toBe(480_000);
      // Reconciliation: pool fully distributed (within Math.floor dust)
      const total = result.characterRows[0].payout + result.corporationRows[0].payout;
      expect(total).toBe(1_000_000);
    });

    it("emits a publicFloat row routed to the central bank reserve", () => {
      const corp = {
        totalShares: 100,
        publicFloat: 25,
        shareholders: [{ characterId: charA, shares: 75 }],
      } as unknown as Corporation;
      const result = allocateShareholderPool(corp, 1_000_000, names([charA, "Alice"]));
      expect(result.characterRows[0].payout).toBe(750_000);
      expect(result.publicFloatRow).not.toBeNull();
      expect(result.publicFloatRow!.shares).toBe(25);
      expect(result.publicFloatRow!.payout).toBe(250_000);
    });

    it("reconciliation: full pool distributes across chars + corps + float (no money destroyed)", () => {
      // Repro of the Elevance Health bug shape: CEO ~52%, other char ~0.1%, corp ~48%, no float.
      const corp = {
        totalShares: 1_000,
        publicFloat: 50,
        shareholders: [
          { characterId: charA, shares: 518 }, // CEO ~51.8%
          { characterId: charB, shares: 1 }, // co-shareholder ~0.1%
          { corporationId: corpX, shares: 300 },
          { corporationId: corpY, shares: 131 },
        ],
      } as unknown as Corporation;
      const result = allocateShareholderPool(
        corp,
        56_000_000_000,
        names([charA, "CEO"], [charB, "Moshe"], [corpX, "X Inc"], [corpY, "Y Corp"])
      );
      const sum =
        result.characterRows.reduce((s, r) => s + r.payout, 0) +
        result.corporationRows.reduce((s, r) => s + r.payout, 0) +
        (result.publicFloatRow?.payout ?? 0);
      // Math.floor on each row may drop up to (rows-1) anchor units; well under $10.
      expect(56_000_000_000 - sum).toBeLessThan(10);
      expect(result.corporationRows).toHaveLength(2);
      expect(result.publicFloatRow).not.toBeNull();
    });

    it("#3451: emits a fund row for index-fund shareholders (previously dropped)", () => {
      const fundA = new ObjectId();
      const corp = {
        totalShares: 1_000,
        publicFloat: 0,
        shareholders: [
          { characterId: charA, shares: 900 },
          { fundId: fundA, shares: 100 }, // 10% held by an index fund
        ],
      } as unknown as Corporation;
      const result = allocateShareholderPool(corp, 1_000_000, names([charA, "Alice"]));
      expect(result.fundRows).toHaveLength(1);
      expect(result.fundRows[0].fundId).toBe(fundA.toString());
      expect(result.fundRows[0].payout).toBe(100_000); // 10% of the pool
      // Conservation: the fund's slice is now distributed, not silently dropped.
      const sum =
        result.characterRows.reduce((s, r) => s + r.payout, 0) +
        result.fundRows.reduce((s, r) => s + r.payout, 0);
      expect(sum).toBe(1_000_000);
    });

    it("returns empty allocation when totalShares is 0 or pool is 0", () => {
      const corp = {
        totalShares: 0,
        publicFloat: 0,
        shareholders: [{ characterId: charA, shares: 100 }],
      } as unknown as Corporation;
      expect(allocateShareholderPool(corp, 100, names([charA, "Alice"]))).toEqual({
        characterRows: [],
        corporationRows: [],
        fundRows: [],
        publicFloatRow: null,
      });
      const corp2 = {
        totalShares: 100,
        publicFloat: 0,
        shareholders: [{ characterId: charA, shares: 100 }],
      } as unknown as Corporation;
      expect(allocateShareholderPool(corp2, 0, names([charA, "Alice"]))).toEqual({
        characterRows: [],
        corporationRows: [],
        fundRows: [],
        publicFloatRow: null,
      });
    });
  });
});

describe("computeSectorNpvSum — steady-state nationalization valuation (Bug #0775)", () => {
  const primeRates = new Map<string, number>([["US", 5]]);
  const sectorAt = (currentGrowthRate: number): CorporateSector =>
    ({
      _id: new ObjectId(),
      revenue: 1_000_000,
      profitMargin: 35,
      currentGrowthRate,
      countryId: "US",
      stateId: "US_CA",
      sectorType: "technology",
    }) as unknown as CorporateSector;

  it("with no growth, steady-state equals going-concern (no growth cost either way)", () => {
    const sectors = [sectorAt(0)];
    const goingConcern = computeSectorNpvSum(sectors, primeRates);
    const steadyState = computeSectorNpvSum(sectors, primeRates, undefined, undefined, {
      excludeGrowthCost: true,
    });
    expect(steadyState).toBe(goingConcern);
    expect(steadyState).toBeGreaterThan(0);
  });

  it("at high growth, going-concern NPV is zeroed but steady-state stays positive", () => {
    // Growth cost scales with the growth rate; at an extreme rate it exceeds the
    // sector's operating profit, so the going-concern NPV is 0 — which paid the
    // owner nothing on nationalization. Steady-state values revenue − maintenance.
    const sectors = [sectorAt(200)];
    const goingConcern = computeSectorNpvSum(sectors, primeRates);
    const steadyState = computeSectorNpvSum(sectors, primeRates, undefined, undefined, {
      excludeGrowthCost: true,
    });
    expect(goingConcern).toBe(0);
    expect(steadyState).toBeGreaterThan(0);
  });

  it("steady-state is never below going-concern for a growing sector", () => {
    const sectors = [sectorAt(15)];
    const goingConcern = computeSectorNpvSum(sectors, primeRates);
    const steadyState = computeSectorNpvSum(sectors, primeRates, undefined, undefined, {
      excludeGrowthCost: true,
    });
    expect(steadyState).toBeGreaterThanOrEqual(goingConcern);
    expect(steadyState).toBeGreaterThan(0);
  });
});
