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

function savedBudget(db: InMemoryDb): FederalBudget {
  return db.collection("federalBudget").docs[0] as unknown as FederalBudget;
}

describe("funded sovereign coupon claims", () => {
  it("debits Treasury once and pays public float plus frozen non-bank holders", async () => {
    const db = world();
    const args = {
      turn: 12,
      bonds: [bond()],
      anchorRate: 1,
      forexEnabled: false,
      fxByCurrency: new Map<CurrencyCode, number>([["USD", 1]]),
    };
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    const amount = perTurnCouponPayment(4.8, BOND_UNIT_FACE_VALUE) * 12;
    expect(db.collection("federalBudget").docs[0].treasuryCashLocal).toBe(1_000 - amount);
    expect(db.collection("characters").docs[0].cashOnHand).toBe(amount / 6);
    expect(db.collection("bondMarketPools").docs[0].cashLocal).toBe((amount * 10) / 12);
    expect(db.collection("bondMarketPools").docs[0].lifetime.couponsIn).toBe((amount * 10) / 12);
    expect(db.collection("federalBudget").docs[0].sovereignCouponClaims).toEqual([]);
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    expect(db.collection("federalBudget").docs[0].treasuryCashLocal).toBe(1_000 - amount);
  });

  it("retains an unfunded frozen claim, then pays its original quote once when cash arrives", async () => {
    const db = world(0);
    const original = bond();
    const args = {
      turn: 12,
      bonds: [original],
      anchorRate: 1,
      forexEnabled: false,
      fxByCurrency: new Map<CurrencyCode, number>([["USD", 1]]),
    };
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    const claims = db.collection("federalBudget").docs[0].sovereignCouponClaims;
    expect(claims).toHaveLength(1);
    const frozen = JSON.stringify(claims[0]);
    db.collection("federalBudget").docs[0].treasuryCashLocal = 100;
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      turn: 13,
      bonds: [],
      anchorRate: 2,
    });
    expect(db.collection("federalBudget").docs[0].treasuryCashLocal).toBe(
      100 - claims[0].amountLocal
    );
    expect(db.collection("characters").docs[0].cashOnHand).toBe(claims[0].amountLocal / 6);
    expect(db.collection("federalBudget").docs[0].sovereignCouponClaims).toEqual([]);
    expect(frozen).toContain('"anchorRate":1');
  });

  it("resumes the original partial payment after a recipient credit crash", async () => {
    const db = world();
    const args = {
      turn: 12,
      bonds: [bond()],
      anchorRate: 1,
      forexEnabled: false,
      fxByCurrency: new Map<CurrencyCode, number>([["USD", 1]]),
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
    const cashAfterCrash = db.collection("federalBudget").docs[0].treasuryCashLocal;
    const poolAfterCrash = db.collection("bondMarketPools").docs[0].cashLocal;
    const characterAfterCrash = db.collection("characters").docs[0].cashOnHand;
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    expect(db.collection("federalBudget").docs[0].treasuryCashLocal).toBe(cashAfterCrash);
    expect(db.collection("bondMarketPools").docs[0].cashLocal).toBe(poolAfterCrash);
    expect(db.collection("characters").docs[0].cashOnHand).toBe(characterAfterCrash);
    expect(db.collection("federalBudget").docs[0].sovereignCouponClaims).toEqual([]);
  });
});
