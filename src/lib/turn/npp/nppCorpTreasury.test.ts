import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  pickNppCorpBond,
  nppTreasurySurplus,
  NPP_TREASURY_INVEST_FRACTION,
  type NppTreasuryBond,
} from "./nppCorpTreasury";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";

const MEYER_CASH = 1_400_000;
const MEYER_REVENUE = 25_000;
const CORP_ID = new ObjectId().toString();

function bond(over: Partial<NppTreasuryBond> = {}): NppTreasuryBond {
  return {
    id: "us-4",
    currencyCode: "USD",
    couponRate: 4,
    marketPrice: 1,
    publicFloat: 10_000,
    issuerType: "sovereign",
    totalIssued: 50_000_000,
    faceValue: BOND_UNIT_FACE_VALUE,
    ...over,
  };
}

function pick(over: Partial<Parameters<typeof pickNppCorpBond>[0]> = {}) {
  return pickNppCorpBond({
    corpId: CORP_ID,
    cashLocal: MEYER_CASH,
    dailyRevenueLocal: MEYER_REVENUE,
    income: 7_000,
    currencyCode: "USD",
    bonds: [bond()],
    ...over,
  });
}

describe("nppTreasurySurplus", () => {
  it("treats Meyer-scale cash against daily revenue as idle", () => {
    expect(nppTreasurySurplus(MEYER_CASH, MEYER_REVENUE)).toBe(MEYER_CASH - MEYER_REVENUE);
  });
});

describe("pickNppCorpBond (ticket 1060)", () => {
  it("parks a quarter of Meyer surplus in the highest-yield home-currency bond", () => {
    const result = pick({
      bonds: [
        bond({ id: "us-2", couponRate: 2 }),
        bond({ id: "us-4", couponRate: 4 }),
        bond({ id: "itl-8", currencyCode: "ITL", couponRate: 8 }),
      ],
    });
    const invest = (MEYER_CASH - MEYER_REVENUE) * NPP_TREASURY_INVEST_FRACTION;
    const units = Math.floor(invest / BOND_UNIT_FACE_VALUE);
    expect(result).toEqual({
      bondId: "us-4",
      units,
      costLocal: units * BOND_UNIT_FACE_VALUE,
    });
  });

  it("keeps cash as runway while the corp is losing money", () => {
    expect(pick({ income: -424_000 })).toBeNull();
  });

  it("does not buy when cash is inside one day of revenue", () => {
    expect(pick({ cashLocal: 20_000 })).toBeNull();
  });

  it("skips the corp's own issue even when it yields more", () => {
    const result = pick({
      bonds: [
        bond({ id: "own", issuerCorpId: CORP_ID, couponRate: 12 }),
        bond({ id: "us-4", couponRate: 4 }),
      ],
    });
    expect(result?.bondId).toBe("us-4");
  });

  it("uses FX-normalized home revenue for the idle-cash buffer (ticket 1060)", () => {
    // ITL 1m / 1000 + JPY 1m / 100 = USD 11k. Raw 2m host units would
    // swallow the $1.4M treasury and look like there was no surplus.
    expect(pick({ dailyRevenueLocal: 11_000, cashLocal: MEYER_CASH })).not.toBeNull();
    expect(pick({ dailyRevenueLocal: 2_000_000, cashLocal: MEYER_CASH })).toBeNull();
  });
});
