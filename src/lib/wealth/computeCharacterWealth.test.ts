import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Bond, Character, Corporation } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { DEFAULT_SHARE_PRICE } from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  computeCharacterWealth,
  sumBondValueByCharacter,
  sumStockValueByCharacter,
  type BondWealthSlice,
  type CorpWealthSlice,
  sumFundValueByCharacter,
} from "./computeCharacterWealth";

const charId = new ObjectId();
const idSet = new Set([charId.toString()]);
const noFx = new Map<CurrencyCode, number>();

function corp(overrides: Partial<CorpWealthSlice>): CorpWealthSlice {
  return {
    _id: new ObjectId(),
    sharePrice: 100,
    shareholders: [{ characterId: charId, shares: 10 }],
    ...overrides,
  } as CorpWealthSlice;
}

describe("sumStockValueByCharacter", () => {
  it("values a holding at shares x price", () => {
    const v = sumStockValueByCharacter([corp({})] as Corporation[], idSet, noFx);
    expect(v.get(charId.toString())).toBe(1000);
  });

  it("sums across corporations", () => {
    const v = sumStockValueByCharacter(
      [corp({}), corp({ sharePrice: 50 })] as Corporation[],
      idSet,
      noFx
    );
    expect(v.get(charId.toString())).toBe(1500);
  });

  it("skips an explicitly unpriced corporation rather than valuing it at zero", () => {
    // Every corporation in production that has no real price stores an explicit
    // 0 (SOEs, the NHS, national holdings), so this is the live path.
    const v = sumStockValueByCharacter([corp({ sharePrice: 0 })] as Corporation[], idSet, noFx);
    expect(v.get(charId.toString())).toBeUndefined();
  });

  it("resolves an ABSENT sharePrice through the market quote, not to zero", () => {
    // This is the divergence #592 predicted. The live route resolved the price
    // via getPublicShareQuote (which falls back to DEFAULT_SHARE_PRICE) while
    // the persisted snapshot read `sharePrice ?? 0` and dropped the holding.
    // Both now go through the same resolution, so the leaderboard and its own
    // 24h-change column cannot disagree.
    const v = sumStockValueByCharacter(
      [corp({ sharePrice: undefined })] as Corporation[],
      idSet,
      noFx
    );
    expect(v.get(charId.toString())).toBe(10 * DEFAULT_SHARE_PRICE);
  });

  it("ignores holders outside the requested set and non-positive holdings", () => {
    const other = new ObjectId();
    const v = sumStockValueByCharacter(
      [
        corp({ shareholders: [{ characterId: other, shares: 10 }] }),
        corp({ shareholders: [{ characterId: charId, shares: 0 }] }),
      ] as Corporation[],
      idSet,
      noFx
    );
    expect(v.size).toBe(0);
  });
});

describe("sumBondValueByCharacter", () => {
  function bond(overrides: Partial<BondWealthSlice>): BondWealthSlice {
    return {
      _id: new ObjectId(),
      marketPrice: 1,
      holders: [{ characterId: charId, units: 3 }],
      ...overrides,
    } as BondWealthSlice;
  }

  it("values units at face x market price", () => {
    const v = sumBondValueByCharacter([bond({})] as Bond[], idSet, noFx);
    expect(v.get(charId.toString())).toBe(3 * BOND_UNIT_FACE_VALUE);
  });

  it("discounts a bond trading below par", () => {
    const v = sumBondValueByCharacter([bond({ marketPrice: 0.5 })] as Bond[], idSet, noFx);
    expect(v.get(charId.toString())).toBe(1.5 * BOND_UNIT_FACE_VALUE);
  });

  it("converts a foreign-currency bond at its rate", () => {
    const fx = new Map<CurrencyCode, number>([["GBP" as CurrencyCode, 2]]);
    const v = sumBondValueByCharacter(
      [bond({ currencyCode: "GBP" as CurrencyCode })] as Bond[],
      idSet,
      fx
    );
    // 3 units at face, halved by a rate of 2 local per anchor.
    expect(v.get(charId.toString())).toBe((3 * BOND_UNIT_FACE_VALUE) / 2);
  });

  it("skips zero-unit holdings", () => {
    const v = sumBondValueByCharacter(
      [bond({ holders: [{ characterId: charId, units: 0 }] })] as Bond[],
      idSet,
      noFx
    );
    expect(v.size).toBe(0);
  });
});

describe("computeCharacterWealth", () => {
  const character = {
    _id: charId,
    countryId: "US",
    cashOnHand: 300,
    savingsOnHand: 200,
  } as unknown as Character;

  it("totals portfolio plus cash less line-of-credit debt", () => {
    const w = computeCharacterWealth(
      character,
      new Map([[charId.toString(), 1000]]),
      new Map([[charId.toString(), 250]]),
      false,
      undefined
    );
    expect(w.stockValue).toBe(1000);
    expect(w.bondValue).toBe(250);
    expect(w.portfolioValue).toBe(1250);
    expect(w.cashValue).toBe(500);
    expect(w.locDebtValue).toBe(0);
    expect(w.totalWealth).toBe(1750);
  });

  it("clamps a net-negative position to zero rather than ranking below everyone", () => {
    const indebted = {
      _id: charId,
      countryId: "US",
      cashOnHand: 10,
      lineOfCredit: { balances: { USD: 100_000 }, arrears: {} },
    } as unknown as Character;
    const w = computeCharacterWealth(indebted, new Map(), new Map(), false, undefined);
    expect(w.locDebtValue).toBeGreaterThan(0);
    expect(w.totalWealth).toBe(0);
  });

  it("treats a character with no holdings as pure cash", () => {
    const w = computeCharacterWealth(character, new Map(), new Map(), false, undefined);
    expect(w.portfolioValue).toBe(0);
    expect(w.totalWealth).toBe(500);
  });
});

describe("index fund positions in wealth", () => {
  it("values a fund position at units x quoted NAV and counts it in portfolio and total wealth", () => {
    const charId = new ObjectId();
    const fundId = new ObjectId();
    const fundValue = sumFundValueByCharacter(
      [{ fundId, characterId: charId, units: 12.5 }],
      new Map([[fundId.toString(), 80]]),
      new Set([charId.toString()])
    );
    expect(fundValue.get(charId.toString())).toBe(1000);

    const character = {
      _id: charId,
      funds: 0,
    } as unknown as Character;
    const wealth = computeCharacterWealth(
      character,
      new Map(),
      new Map(),
      false,
      undefined,
      fundValue
    );
    expect(wealth.fundValue).toBe(1000);
    expect(wealth.portfolioValue).toBe(1000);
    expect(wealth.totalWealth).toBe(1000);
  });

  it("ignores positions of characters outside the set and unpriced funds", () => {
    const inSet = new ObjectId();
    const outSet = new ObjectId();
    const fundId = new ObjectId();
    const fundValue = sumFundValueByCharacter(
      [
        { fundId, characterId: outSet, units: 5 },
        { fundId: new ObjectId(), characterId: inSet, units: 5 },
      ],
      new Map([[fundId.toString(), 80]]),
      new Set([inSet.toString()])
    );
    expect(fundValue.size).toBe(0);
  });
});
