import { describe, it, expect } from "vitest";
import {
  computeWholeCorpValuation,
  applyTier,
  sectorCompensationValuationAnchor,
  wholeCorpCompensationAnchor,
} from "./compensation";
import {
  NATIONALIZATION_BOOK_PREMIUM,
  NATIONALIZATION_COMPENSATION_PREMIUM,
  TIER_MULTIPLIER,
} from "./constants";
import { sectorBookValueAnchor } from "@/lib/corporations/sectorProfitBasis";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { DISSOLUTION_SECTOR_SALVAGE_FRACTION } from "@/lib/constants/corporations";

describe("computeWholeCorpValuation", () => {
  it("uses the greater of market cap and balance-sheet equity", () => {
    // marketCap = sharePrice * totalShares = 2 * 1000 = 2000; equity = 5000 → 5000
    expect(
      computeWholeCorpValuation({
        sharePrice: 2,
        totalShares: 1000,
        balanceSheetEquity: 5000,
        debt: 0,
      })
    ).toBe(5000);
  });

  it("nets out debt the state is assuming", () => {
    // max(2000, 5000) = 5000; minus debt 1500 = 3500
    expect(
      computeWholeCorpValuation({
        sharePrice: 2,
        totalShares: 1000,
        balanceSheetEquity: 5000,
        debt: 1500,
      })
    ).toBe(3500);
  });

  it("floors at zero for an underwater corp", () => {
    expect(
      computeWholeCorpValuation({
        sharePrice: 1,
        totalShares: 100,
        balanceSheetEquity: 100,
        debt: 9999,
      })
    ).toBe(0);
  });
});

describe("applyTier", () => {
  // Fair value pays the buyout premium (NATIONALIZATION_COMPENSATION_PREMIUM = 5)
  // over the bare valuation; discounted pays half of fair; seizure pays nothing.
  it("fair pays the buyout premium over valuation (5×)", () => {
    expect(applyTier(4000, "fair")).toBe(20000);
  });
  it("discounted pays half of fair (2.5× valuation)", () => {
    expect(applyTier(4000, "discounted")).toBe(10000);
  });
  it("seizure pays nothing", () => {
    expect(applyTier(4000, "seizure")).toBe(0);
  });
});

describe("applyTier — D11 book premium under plants", () => {
  it("uses the earnings premium below plants and the book premium at/above it", () => {
    expect(applyTier(100, "fair")).toBe(100 * NATIONALIZATION_COMPENSATION_PREMIUM);
    expect(applyTier(100, "fair", { plantsEnabled: false })).toBe(
      100 * NATIONALIZATION_COMPENSATION_PREMIUM
    );
    expect(applyTier(100, "fair", { plantsEnabled: true })).toBe(
      100 * NATIONALIZATION_BOOK_PREMIUM
    );
  });

  it("still scales the whole tier ladder, and a seizure still pays nothing", () => {
    expect(applyTier(100, "discounted", { plantsEnabled: true })).toBe(
      100 * 0.5 * NATIONALIZATION_BOOK_PREMIUM
    );
    expect(applyTier(100, "seizure", { plantsEnabled: true })).toBe(0);
  });

  it("pays book and NOT ONE UNIT MORE — a premium on fresh capacity is a mint", () => {
    // This assertion was `toBeGreaterThan(1)`, pinning a 1.5 "taken against your
    // will" premium. That premium is a money printer. `capitalStock` is
    // depreciated by the turn processor, but capacity built THIS turn has taken
    // no depreciation, so its book is exactly what the owner just paid. At 1.5
    // build-then-get-nationalized returns 1.5x cost with certainty, funded by the
    // treasury, and the gain accrues to the party being taken FROM — so no
    // political cost on the taking side can price it away.
    //
    // A fairness premium is defensible only against capacity the owner has
    // actually held and depreciated, which needs per-unit capacity AGE tracking
    // (a build cohort on `capitalStock`, not today's single scalar). Until that
    // lands, flat 1.0 is the only setting that cannot be farmed — see the TODO
    // on the constant.
    expect(NATIONALIZATION_BOOK_PREMIUM).toBe(1);
    // The ordering the 1.5 was reached for survives at 1.0: a targeted corp
    // still prefers being nationalized to liquidating itself.
    expect(NATIONALIZATION_BOOK_PREMIUM).toBeGreaterThan(DISSOLUTION_SECTOR_SALVAGE_FRACTION);
  });
});

describe("sectorCompensationValuationAnchor — D11 base selection", () => {
  const sector = { sectorType: "manufacturing" as const, capitalStock: 100 };

  it("passes the caller's NPV straight through below plants", () => {
    expect(
      sectorCompensationValuationAnchor(sector, 4_000, { eraUnitScale: 1, plantsEnabled: false })
    ).toBe(4_000);
    expect(
      sectorCompensationValuationAnchor(sector, 4_000, {
        eraUnitScale: 1,
        plantsEnabled: false,
        fraction: 0.25,
      })
    ).toBe(1_000);
  });

  it("switches to replacement-cost book under plants, ignoring the NPV entirely", () => {
    const book = sectorBookValueAnchor(sector, CAPACITY_ANCHOR_YEAR, 1);
    expect(
      sectorCompensationValuationAnchor(sector, 4_000, {
        eraUnitScale: 1,
        plantsEnabled: true,
        currentYear: CAPACITY_ANCHOR_YEAR,
      })
    ).toBeCloseTo(book, 8);
    // A carve takes a slice of the book, not of the NPV.
    expect(
      sectorCompensationValuationAnchor(sector, 4_000, {
        eraUnitScale: 1,
        plantsEnabled: true,
        currentYear: CAPACITY_ANCHOR_YEAR,
        fraction: 0.4,
      })
    ).toBeCloseTo(book * 0.4, 8);
  });

  it("includes construction in progress — the state cannot seize a half-built plant for free", () => {
    const bare = sectorCompensationValuationAnchor(sector, 0, {
      eraUnitScale: 1,
      plantsEnabled: true,
      currentYear: CAPACITY_ANCHOR_YEAR,
    });
    const building = sectorCompensationValuationAnchor(
      { ...sector, constructionInProgressAnchor: 9_000 },
      0,
      { eraUnitScale: 1, plantsEnabled: true, currentYear: CAPACITY_ANCHOR_YEAR }
    );
    expect(building - bare).toBeCloseTo(9_000, 6);
  });
});

describe("wholeCorpCompensationAnchor (D11 — base/premium consistency)", () => {
  const BOOK = 10_000_000;
  const CASH = 2_000_000;

  it("pays the BOOK premium on plants and par on cash", () => {
    const { payoutAnchor, valuationAnchor } = wholeCorpCompensationAnchor({
      sectorBookAnchor: BOOK,
      nonSectorAssetsAnchor: CASH,
      debtAnchor: 0,
      tier: "fair",
    });
    expect(valuationAnchor).toBeCloseTo(BOOK + CASH, 6);
    expect(payoutAnchor).toBeCloseTo(BOOK * NATIONALIZATION_BOOK_PREMIUM + CASH, 6);
    // The bug this replaces: the whole net asset value taking the book premium.
    //
    // With NATIONALIZATION_BOOK_PREMIUM now 1.0, `book × P + cash` and
    // `(book + cash) × P` are numerically identical, so the old
    // `not.toBeCloseTo` here asserted nothing and failed as a tautology. The
    // structural claim it was making — the premium multiplies the BOOK leg only,
    // never the cash leg — is asserted directly instead, by scaling the book leg
    // and checking only the book part of the payout moves. That discriminates at
    // any premium, including 1.0, so raising the premium again later cannot
    // silently reintroduce the mint.
    const doubleBook = wholeCorpCompensationAnchor({
      sectorBookAnchor: BOOK * 2,
      nonSectorAssetsAnchor: CASH,
      debtAnchor: 0,
      tier: "fair",
    });
    expect(doubleBook.payoutAnchor - payoutAnchor).toBeCloseTo(
      BOOK * NATIONALIZATION_BOOK_PREMIUM,
      6
    );
    const doubleCash = wholeCorpCompensationAnchor({
      sectorBookAnchor: BOOK,
      nonSectorAssetsAnchor: CASH * 2,
      debtAnchor: 0,
      tier: "fair",
    });
    // Cash moves the payout one-for-one — never premium-scaled.
    expect(doubleCash.payoutAnchor - payoutAnchor).toBeCloseTo(CASH, 6);
  });

  it("never pays a premium on cash — a taking cannot mint money on the cash leg", () => {
    const onlyCash = wholeCorpCompensationAnchor({
      sectorBookAnchor: 0,
      nonSectorAssetsAnchor: CASH,
      debtAnchor: 0,
      tier: "fair",
    });
    expect(onlyCash.payoutAnchor).toBeCloseTo(CASH, 6);
  });

  it("is immune to the share price — the marketCap/book mismatch cannot recur", () => {
    // There is no sharePrice input at all: a manipulated (high OR low) quote
    // cannot move the payout, which was the whole failure mode.
    const a = wholeCorpCompensationAnchor({
      sectorBookAnchor: BOOK,
      nonSectorAssetsAnchor: CASH,
      debtAnchor: 0,
      tier: "fair",
    });
    expect(Object.keys(a)).toEqual(["valuationAnchor", "payoutAnchor"]);
  });

  it("nets debt off cash first, then off book", () => {
    // Debt below cash: book leg untouched.
    const small = wholeCorpCompensationAnchor({
      sectorBookAnchor: BOOK,
      nonSectorAssetsAnchor: CASH,
      debtAnchor: 500_000,
      tier: "fair",
    });
    expect(small.payoutAnchor).toBeCloseTo(
      BOOK * NATIONALIZATION_BOOK_PREMIUM + (CASH - 500_000),
      6
    );

    // Debt above cash: the excess eats into book, at 1× before the premium is
    // applied — shareholders cannot extract 1.5× the debt they are relieved of.
    const big = wholeCorpCompensationAnchor({
      sectorBookAnchor: BOOK,
      nonSectorAssetsAnchor: CASH,
      debtAnchor: CASH + 3_000_000,
      tier: "fair",
    });
    expect(big.payoutAnchor).toBeCloseTo((BOOK - 3_000_000) * NATIONALIZATION_BOOK_PREMIUM, 6);
  });

  it("floors at zero when debt exceeds every asset", () => {
    const r = wholeCorpCompensationAnchor({
      sectorBookAnchor: BOOK,
      nonSectorAssetsAnchor: CASH,
      debtAnchor: 999_000_000,
      tier: "fair",
    });
    expect(r.valuationAnchor).toBe(0);
    expect(r.payoutAnchor).toBe(0);
  });

  it("scales by the tier ladder and pays nothing on a seizure", () => {
    const base = { sectorBookAnchor: BOOK, nonSectorAssetsAnchor: CASH, debtAnchor: 0 };
    const fair = wholeCorpCompensationAnchor({ ...base, tier: "fair" }).payoutAnchor;
    expect(wholeCorpCompensationAnchor({ ...base, tier: "discounted" }).payoutAnchor).toBeCloseTo(
      fair * TIER_MULTIPLIER.discounted,
      6
    );
    expect(wholeCorpCompensationAnchor({ ...base, tier: "seizure" }).payoutAnchor).toBe(0);
  });
});

describe("privatization symmetry (D11 — the state sells on the basis it buys)", () => {
  const sector = { sectorType: "manufacturing" as const, capitalStock: 100 };

  it("a nationalize -> privatize round trip is cash-neutral under plants", () => {
    // Nationalization pays premium x book (sectorCompensationValuationAnchor +
    // applyTier at the fair tier); privatizeAsset now prices the sale at the
    // SAME premium x book. The state's net cash on a full round trip is 0.
    const book = sectorBookValueAnchor(sector, CAPACITY_ANCHOR_YEAR, 1);
    const paidOut = applyTier(
      sectorCompensationValuationAnchor(sector, 999_999, {
        eraUnitScale: 1,
        plantsEnabled: true,
        currentYear: CAPACITY_ANCHOR_YEAR,
      }),
      "fair",
      { plantsEnabled: true }
    );
    // The expression privatizeAsset uses for a full (fraction 1) carve.
    const takenIn = book * NATIONALIZATION_BOOK_PREMIUM * 1;
    expect(takenIn).toBeCloseTo(paidOut, 6);
  });

  it("selling at NPV instead would have been a directional arbitrage", () => {
    // A profitable sector's NPV sits well above 1.5x its book, so the pre-fix
    // sale side handed the state a spread it could farm at will.
    const book = sectorBookValueAnchor(sector, CAPACITY_ANCHOR_YEAR, 1);
    const npvLikeSalePrice = 50_000_000; // any going-concern figure >> book
    expect(npvLikeSalePrice).toBeGreaterThan(book * NATIONALIZATION_BOOK_PREMIUM);
  });
});
