import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Bond } from "@/lib/db/types/bond";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { settleFundedSovereignCoupons } from "./fundedSovereignCoupons";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";

const bondId = new ObjectId("650000000000000000000010");
const characterId = new ObjectId("650000000000000000000011");

function bond(): Bond {
  return {
    _id: bondId,
    issuerType: "sovereign",
    countryId: "US",
    currencyCode: "USD",
    couponRate: 4.8,
    holders: [{ characterId, units: 2 }],
    publicFloat: 10,
    defaulted: false,
    matured: false,
  } as unknown as Bond;
}

function world(treasuryCashLocal = 1_000): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("federalBudget", [{ _id: "US", countryId: "US", treasuryBalance: 0, treasuryCashLocal }]);
  db.seed("characters", [{ _id: characterId, cashOnHand: 0 }]);
  db.seed("bondMarketPools", [{ _id: "USD", cashLocal: 0, lifetime: { couponsIn: 0 } }]);
  return db;
}

function savedBudget(db: InMemoryDb): FederalBudget & { treasuryCashLocal: number } {
  return db.collection("federalBudget").docs[0] as unknown as FederalBudget & {
    treasuryCashLocal: number;
  };
}

describe("funded sovereign coupon claims", () => {
  it("debits Treasury once and pays public float plus frozen non-bank holders", async () => {
    const db = world();
    const args = {
      turn: 12,
      bonds: [bond()],
      anchorRate: 1,
      forexEnabled: false,
      corporateQuotes: new Map(),
    };
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    const amount = perTurnCouponPayment(4.8, BOND_UNIT_FACE_VALUE) * 12;
    expect(savedBudget(db).treasuryCashLocal).toBe(1_000 - amount);
    expect((db.collection("characters").docs[0] as { cashOnHand: number }).cashOnHand).toBe(
      amount / 6
    );
    expect(db.collection("bondMarketPools").docs[0].cashLocal).toBe((amount * 10) / 12);
    expect(
      (db.collection("bondMarketPools").docs[0] as { lifetime: { couponsIn: number } }).lifetime
        .couponsIn
    ).toBe((amount * 10) / 12);
    expect(savedBudget(db).sovereignCouponClaims).toEqual([]);
    expect(savedBudget(db).sovereignCouponFrozenThrough).toEqual({
      [`b${bondId.toHexString()}`]: 12,
    });
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    expect(savedBudget(db).treasuryCashLocal).toBe(1_000 - amount);
    expect(savedBudget(db).sovereignCouponClaims).toEqual([]);
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      bonds: [
        {
          ...bond(),
          holders: [{ characterId: new ObjectId("650000000000000000000099"), units: 50 }],
        },
      ],
      anchorRate: 8,
      forexEnabled: true,
    });
    expect(savedBudget(db).sovereignCouponClaims).toEqual([]);
    expect(savedBudget(db).treasuryCashLocal).toBe(1_000 - amount);
    expect((db.collection("characters").docs[0] as { cashOnHand: number }).cashOnHand).toBe(
      amount / 6
    );
  });

  it("retains an unfunded frozen claim, then pays its original quote once when cash arrives", async () => {
    const db = world(0);
    const original = bond();
    const args = {
      turn: 12,
      bonds: [original],
      anchorRate: 1,
      forexEnabled: false,
      corporateQuotes: new Map(),
    };
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    const claims = savedBudget(db).sovereignCouponClaims ?? [];
    expect(claims).toHaveLength(1);
    const frozen = JSON.stringify(claims[0]);
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      bonds: [
        {
          ...bond(),
          couponRate: 99,
          holders: [{ corporationId: new ObjectId("650000000000000000000099"), units: 80 }],
        } as unknown as Bond,
      ],
      anchorRate: 7,
      corporateQuotes: new Map(),
    });
    expect(JSON.stringify(savedBudget(db).sovereignCouponClaims?.[0])).toBe(frozen);
    savedBudget(db).treasuryCashLocal = 100;
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      turn: 13,
      bonds: [],
      anchorRate: 2,
      forexEnabled: true,
    });
    expect(savedBudget(db).treasuryCashLocal).toBe(100 - claims[0].amountLocal);
    expect((db.collection("characters").docs[0] as { cashOnHand: number }).cashOnHand).toBe(
      claims[0].amountLocal / 6
    );
    expect(savedBudget(db).sovereignCouponClaims).toEqual([]);
    expect(frozen).toContain('"anchorRate":1');
  });

  it("resumes the original partial payment after a recipient credit crash", async () => {
    const db = world();
    const args = {
      turn: 12,
      bonds: [bond()],
      anchorRate: 1,
      forexEnabled: false,
      corporateQuotes: new Map(),
    };
    const crash = withInjectedCrash(db, {
      collection: "characters",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(settleFundedSovereignCoupons(crash.db, savedBudget(db), args)).rejects.toThrow(
      "crash"
    );
    const cashAfterCrash = savedBudget(db).treasuryCashLocal;
    const poolAfterCrash = db.collection("bondMarketPools").docs[0].cashLocal;
    const characterAfterCrash = (db.collection("characters").docs[0] as { cashOnHand: number })
      .cashOnHand;
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      turn: 13,
      bonds: [
        {
          ...bond(),
          couponRate: 90,
          publicFloat: 100,
          holders: [],
          matured: true,
        },
      ],
      anchorRate: 25,
      forexEnabled: true,
    });
    expect(savedBudget(db).treasuryCashLocal).toBe(cashAfterCrash);
    expect(db.collection("bondMarketPools").docs[0].cashLocal).toBe(poolAfterCrash);
    expect((db.collection("characters").docs[0] as { cashOnHand: number }).cashOnHand).toBe(
      characterAfterCrash
    );
    expect(savedBudget(db).sovereignCouponClaims).toEqual([]);
  });

  it("keeps a frozen corporate denomination and leaves arrears when the target changes currency", async () => {
    const corpId = new ObjectId("650000000000000000000012");
    const db = world(0);
    db.seed("corporations", [
      { _id: corpId, countryId: "US", liquidCurrencyCode: "USD", liquidCapital: 0 },
    ]);
    const corporateBond = {
      ...bond(),
      holders: [{ corporationId: corpId, units: 2 }],
    } as unknown as Bond;
    const corporateQuotes = new Map([
      [
        corpId.toHexString(),
        {
          id: corpId.toHexString(),
          countryId: "US",
          currencyCode: "USD" as CurrencyCode,
          localPerAnchor: 1,
          currencyFieldPresent: true,
          currencyFieldValue: "USD",
        },
      ],
    ]);
    const args = {
      turn: 12,
      bonds: [corporateBond],
      anchorRate: 1,
      forexEnabled: true,
      corporateQuotes,
    };
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    const claim = savedBudget(db).sovereignCouponClaims?.[0];
    expect(claim?.holders.map((holder) => holder.kind)).toEqual(["publicFloat", "corporation"]);
    expect(claim?.holders[1].payeeCurrencyCode).toBe("USD");
    const treasuryAfterFirstAttempt = savedBudget(db).treasuryCashLocal;
    db.collection("corporations").docs[0].liquidCurrencyCode = "EUR";
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      turn: 13,
      bonds: [],
      corporateQuotes: new Map(),
    });
    expect(savedBudget(db).treasuryCashLocal).toBe(treasuryAfterFirstAttempt);
    expect((db.collection("corporations").docs[0] as { liquidCapital: number }).liquidCapital).toBe(
      0
    );
    expect(savedBudget(db).sovereignCouponClaims).toEqual([claim]);
    db.collection("corporations").docs[0].liquidCurrencyCode = "USD";
    savedBudget(db).treasuryCashLocal = 100;
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      turn: 14,
      bonds: [],
      corporateQuotes: new Map(),
    });
    expect((db.collection("corporations").docs[0] as { liquidCapital: number }).liquidCapital).toBe(
      claim!.holders[1].amountAnchor
    );
    expect(savedBudget(db).sovereignCouponClaims).toEqual([]);
  });
});
