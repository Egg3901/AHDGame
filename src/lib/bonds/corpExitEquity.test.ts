import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Bond, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpExitEquityAnchor, sumHeldBondFaceAnchor } from "./corpExitEquity";

// USD floats at 1.2 against ₳ and TRL at 3, so a test that mixed the holder's
// rate into a holding's face value would come out visibly wrong rather than
// coincidentally right.
const FX: ReadonlyMap<CurrencyCode, number> = new Map([
  ["USD", 1.2],
  ["TRL", 3],
  ["GBP", 0.5],
] as [CurrencyCode, number][]);

const PRIME = new Map<string, number>([["US", 0.05]]);

const CORP_ID = new ObjectId();
const OTHER_ID = new ObjectId();

function heldBond(holderId: ObjectId | null, units: number, overrides: Partial<Bond> = {}): Bond {
  return {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    totalIssued: units * 1000,
    couponRate: 5,
    currencyCode: "USD",
    matured: false,
    defaulted: false,
    publicFloat: 0,
    holders: holderId ? [{ corporationId: holderId, units }] : [],
    ...overrides,
  } as unknown as Bond;
}

function sector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: CORP_ID,
    countryId: "US",
    sectorType: "retail",
    capacityBookAnchor: 0,
    constructionInProgressAnchor: 0,
    revenue: 0,
    ...overrides,
  } as unknown as CorporateSector;
}

describe("sumHeldBondFaceAnchor", () => {
  it("values a holding at face, converted through the BOND's currency", () => {
    // 1,000 units x ₳1,000 face = 1,000,000 USD -> /1.2 = ₳833,333.33
    const got = sumHeldBondFaceAnchor([heldBond(CORP_ID, 1_000)], CORP_ID, FX);
    expect(got).toBeCloseTo(1_000_000 / 1.2, 6);
  });

  it("converts each bond through its own currency, not a shared one", () => {
    const got = sumHeldBondFaceAnchor(
      [
        heldBond(CORP_ID, 1_000, { currencyCode: "USD" } as Partial<Bond>),
        heldBond(CORP_ID, 1_000, { currencyCode: "TRL" } as Partial<Bond>),
      ],
      CORP_ID,
      FX
    );
    expect(got).toBeCloseTo(1_000_000 / 1.2 + 1_000_000 / 3, 6);
  });

  it("ignores holdings belonging to other corporations", () => {
    expect(sumHeldBondFaceAnchor([heldBond(OTHER_ID, 5_000)], CORP_ID, FX)).toBe(0);
  });

  it("excludes matured issues", () => {
    const bond = heldBond(CORP_ID, 1_000, { matured: true } as Partial<Bond>);
    expect(sumHeldBondFaceAnchor([bond], CORP_ID, FX)).toBe(0);
  });

  it("excludes DEFAULTED issues: a defaulted bond will not pay face", () => {
    const bond = heldBond(CORP_ID, 1_000, { defaulted: true } as Partial<Bond>);
    expect(sumHeldBondFaceAnchor([bond], CORP_ID, FX)).toBe(0);
  });

  it("counts a sovereign holding (no issuing corporation) like any other claim", () => {
    const sovereign = heldBond(CORP_ID, 1_000, {
      corporationId: undefined,
      countryId: "US",
    } as unknown as Partial<Bond>);
    expect(sumHeldBondFaceAnchor([sovereign], CORP_ID, FX)).toBeCloseTo(1_000_000 / 1.2, 6);
  });

  it("sums duplicate holder rows rather than taking the first", () => {
    const bond = heldBond(CORP_ID, 0, {
      holders: [
        { corporationId: CORP_ID, units: 600 },
        { corporationId: CORP_ID, units: 400 },
      ],
    } as unknown as Partial<Bond>);
    expect(sumHeldBondFaceAnchor([bond], CORP_ID, FX)).toBeCloseTo(1_000_000 / 1.2, 6);
  });

  it("skips zero, negative and non-finite unit counts", () => {
    const bonds = [heldBond(CORP_ID, 0), heldBond(CORP_ID, -50), heldBond(CORP_ID, Number.NaN)];
    expect(sumHeldBondFaceAnchor(bonds, CORP_ID, FX)).toBe(0);
  });

  it("passes an unpriced or missing currency through at rate 1, like every other bond-FX site", () => {
    const noCode = heldBond(CORP_ID, 10, { currencyCode: undefined } as unknown as Partial<Bond>);
    const unknownCode = heldBond(CORP_ID, 10, { currencyCode: "XXX" } as unknown as Partial<Bond>);
    expect(sumHeldBondFaceAnchor([noCode], CORP_ID, FX)).toBe(10_000);
    expect(sumHeldBondFaceAnchor([unknownCode], CORP_ID, FX)).toBe(10_000);
  });

  it("tolerates an absent holders array and an empty bond list", () => {
    const headless = heldBond(CORP_ID, 0, { holders: undefined } as unknown as Partial<Bond>);
    expect(sumHeldBondFaceAnchor([headless], CORP_ID, FX)).toBe(0);
    expect(sumHeldBondFaceAnchor([], CORP_ID, FX)).toBe(0);
    expect(sumHeldBondFaceAnchor(undefined, CORP_ID, FX)).toBe(0);
  });

  it("accepts a string corporation id as well as an ObjectId", () => {
    const byString = sumHeldBondFaceAnchor([heldBond(CORP_ID, 1_000)], CORP_ID.toString(), FX);
    expect(byString).toBeCloseTo(1_000_000 / 1.2, 6);
  });
});

describe("corpExitEquityAnchor", () => {
  const base = {
    corporationId: CORP_ID,
    corp: { countryId: "US", liquidCurrencyCode: "USD" },
    fxByCurrency: FX,
    primeRateByCountry: PRIME,
    eraUnitScale: 1,
    currentYear: 1956,
  };

  it("under plants: book carries CIP, so the CIP leg is NOT added a second time", () => {
    const got = corpExitEquityAnchor({
      ...base,
      liquidCapitalAnchor: 0,
      sectors: [sector({ capacityBookAnchor: 800, constructionInProgressAnchor: 200 })],
      bonds: [],
      plantsEnabled: true,
    });
    // sectorBookValueAnchor = 800 x 1.0 + 200 = 1,000. Not 1,200.
    expect(got.sectorExitAnchor).toBe(1_000);
    expect(got.constructionInProgressAnchor).toBe(0);
    expect(got.exitEquityAnchor).toBe(1_000);
  });

  it("below plants: NPV omits CIP, so the CIP leg IS added", () => {
    const got = corpExitEquityAnchor({
      ...base,
      liquidCapitalAnchor: 0,
      // No revenue, so the NPV branch contributes nothing and the CIP leg is
      // the only thing under test.
      sectors: [sector({ capacityBookAnchor: 800, constructionInProgressAnchor: 200 })],
      bonds: [],
      plantsEnabled: false,
    });
    expect(got.sectorExitAnchor).toBe(0);
    expect(got.constructionInProgressAnchor).toBe(200);
    expect(got.exitEquityAnchor).toBe(200);
  });

  it("adds the bond portfolio at face on top of cash and sectors", () => {
    const got = corpExitEquityAnchor({
      ...base,
      liquidCapitalAnchor: 500,
      sectors: [sector({ capacityBookAnchor: 1_000 })],
      bonds: [heldBond(CORP_ID, 1_000)],
      plantsEnabled: true,
    });
    const portfolio = 1_000_000 / 1.2;
    expect(got.heldBondFaceAnchor).toBeCloseTo(portfolio, 6);
    expect(got.exitEquityAnchor).toBeCloseTo(500 + 1_000 + portfolio, 6);
  });

  it("counts only the corporation's OWN sectors out of a world-wide list", () => {
    const got = corpExitEquityAnchor({
      ...base,
      liquidCapitalAnchor: 0,
      sectors: [
        sector({ capacityBookAnchor: 1_000 }),
        sector({ corporationId: OTHER_ID, capacityBookAnchor: 9_999_999 }),
      ],
      bonds: [],
      plantsEnabled: true,
    });
    expect(got.exitEquityAnchor).toBe(1_000);
  });

  it("lets negative cash pull equity down, since a cash hole is a real claim", () => {
    const got = corpExitEquityAnchor({
      ...base,
      liquidCapitalAnchor: -400,
      sectors: [sector({ capacityBookAnchor: 1_000 })],
      bonds: [],
      plantsEnabled: true,
    });
    expect(got.exitEquityAnchor).toBe(600);
  });

  it("returns zero for a corp with nothing, rather than throwing", () => {
    const got = corpExitEquityAnchor({
      ...base,
      liquidCapitalAnchor: 0,
      sectors: undefined,
      bonds: undefined,
      plantsEnabled: true,
    });
    expect(got.exitEquityAnchor).toBe(0);
  });

  it("ticket #1198: corporation #624's portfolio is what makes it solvent", () => {
    // Live figures at turn 415, in ₳: the gate saw cash + book only and found a
    // ₳1.40bn shortfall against ₳4.52bn of debt. The portfolio it ignored was
    // ₳1.79bn, which is more than the shortfall.
    const DEBT = 4_522_737_824;
    const cash = -236_151;
    const book = 3_121_026_466;
    const portfolioAnchor = 1_792_376_780;

    const withoutPortfolio = corpExitEquityAnchor({
      ...base,
      liquidCapitalAnchor: cash,
      sectors: [sector({ capacityBookAnchor: book })],
      bonds: [],
      plantsEnabled: true,
    });
    expect(withoutPortfolio.exitEquityAnchor).toBeLessThan(DEBT);

    // ₳1.79bn of GBP-denominated face at rate 0.5 == portfolioAnchor.
    const withPortfolio = corpExitEquityAnchor({
      ...base,
      liquidCapitalAnchor: cash,
      sectors: [sector({ capacityBookAnchor: book })],
      bonds: [
        heldBond(CORP_ID, (portfolioAnchor * 0.5) / 1000, {
          currencyCode: "GBP",
        } as Partial<Bond>),
      ],
      plantsEnabled: true,
    });
    expect(withPortfolio.heldBondFaceAnchor).toBeCloseTo(portfolioAnchor, 4);
    expect(withPortfolio.exitEquityAnchor).toBeGreaterThan(DEBT);
  });
});
