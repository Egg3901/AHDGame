import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Bond } from "@/lib/db/types/bond";
import type { FederalBudget, FundedSovereignCouponClaim } from "@/lib/db/types/budget";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  couponBatchKey,
  settleFundedSovereignCoupons,
  type SovereignCouponClaimRecord,
} from "./fundedSovereignCoupons";
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

function openClaims(db: InMemoryDb): FundedSovereignCouponClaim[] {
  return (db.collection("sovereignCouponClaims").docs as unknown as SovereignCouponClaimRecord[])
    .filter((row) => row.settledTurn === undefined)
    .sort((a, b) => a.claim.dueTurn - b.claim.dueTurn || a.order - b.order)
    .map((row) => row.claim);
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
    expect(openClaims(db)).toEqual([]);
    expect(savedBudget(db).sovereignCouponFrozenThrough).toEqual({
      [`b${bondId.toHexString()}`]: 12,
    });
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    expect(savedBudget(db).treasuryCashLocal).toBe(1_000 - amount);
    expect(openClaims(db)).toEqual([]);
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
    expect(openClaims(db)).toEqual([]);
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
    const claims = openClaims(db) ?? [];
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
    expect(JSON.stringify(openClaims(db)?.[0])).toBe(frozen);
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
    expect(openClaims(db)).toEqual([]);
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
    expect(openClaims(db)).toEqual([]);
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
          currencyUsesCountryFallback: false,
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
    const claim = openClaims(db)?.[0];
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
    expect(openClaims(db)).toEqual([claim]);
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
    expect(openClaims(db)).toEqual([]);
  });

  it("guards country-derived corporate currency and batches recipient lookups across claims", async () => {
    const corpId = new ObjectId("650000000000000000000013");
    const secondCharacterId = new ObjectId("650000000000000000000014");
    const db = world();
    db.seed("corporations", [
      { _id: corpId, countryId: "US", liquidCurrencyCode: null, liquidCapital: 0 },
    ]);
    db.seed("characters", [
      { _id: characterId, cashOnHand: 0 },
      { _id: secondCharacterId, cashOnHand: 0 },
    ]);
    const characterFind = vi.spyOn(db.collection("characters"), "find");
    const corporateBond = {
      ...bond(),
      holders: [{ corporationId: corpId, units: 2 }],
    } as unknown as Bond;
    const secondBond = {
      ...bond(),
      _id: new ObjectId("650000000000000000000015"),
      publicFloat: 0,
      holders: [{ characterId: secondCharacterId, units: 1 }],
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
          currencyFieldValue: null,
          currencyUsesCountryFallback: true,
        },
      ],
    ]);
    const args = {
      turn: 12,
      bonds: [corporateBond, secondBond],
      anchorRate: 1,
      forexEnabled: false,
      corporateQuotes,
    };
    db.collection("federalBudget").docs[0].treasuryCashLocal = 0;
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    expect(characterFind).toHaveBeenCalledTimes(1);
    const claims = openClaims(db) ?? [];
    expect(claims).toHaveLength(2);
    db.collection("corporations").docs[0].countryId = "FR";
    savedBudget(db).treasuryCashLocal = 100;
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      bonds: [],
      turn: 13,
    });
    expect(savedBudget(db).treasuryCashLocal).toBe(100 - claims[1]!.amountLocal);
    expect((db.collection("corporations").docs[0] as { liquidCapital: number }).liquidCapital).toBe(
      0
    );
    expect(openClaims(db)).toEqual([claims[0]]);
    const secondCharacter = db
      .collection("characters")
      .docs.find((doc) => (doc._id as ObjectId).equals(secondCharacterId));
    expect((secondCharacter as { cashOnHand: number }).cashOnHand).toBeGreaterThan(0);
  });

  it("does not journal a rejected attempt per arrears claim when Treasury cannot cover it", async () => {
    const db = world(0);
    const bonds = Array.from({ length: 50 }, (_, i) => ({
      ...bond(),
      _id: new ObjectId(`6500000000000000000010${String(i).padStart(2, "0")}`),
    })) as Bond[];
    const args = { anchorRate: 1, forexEnabled: false, corporateQuotes: new Map() };
    for (let turn = 12; turn < 16; turn++)
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn,
        bonds,
      });
    const claims = openClaims(db) ?? [];
    expect(claims).toHaveLength(200);

    const writes = new Map<string, number>();
    const counted = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "collection") return Reflect.get(target, prop, receiver);
        return (name: string) => {
          const inner = target.collection(name);
          return new Proxy(inner, {
            get(c, method, r) {
              const value = Reflect.get(c, method, r);
              if (typeof value !== "function") return value;
              return (...callArgs: unknown[]) => {
                writes.set(name, (writes.get(name) ?? 0) + 1);
                return value.apply(c, callArgs);
              };
            },
          });
        };
      },
    });
    await settleFundedSovereignCoupons(counted as unknown as Db, savedBudget(db), {
      ...args,
      turn: 16,
      bonds: [],
    });
    expect(openClaims(db)).toHaveLength(200);
    expect(savedBudget(db).treasuryCashLocal).toBe(0);
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(0);
    const commands = [...writes.values()].reduce((sum, n) => sum + n, 0);
    expect(commands).toBeLessThan(10);

    // Cash for exactly two claims pays the first two in order and defers the rest.
    savedBudget(db).treasuryCashLocal = claims[0].amountLocal * 2;
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      turn: 17,
      bonds: [],
    });
    expect(savedBudget(db).treasuryCashLocal).toBeCloseTo(0, 9);
    expect(openClaims(db)).toEqual(claims.slice(2));
    expect(
      db.collection("bankMoneyMoves").docs.filter((doc) => doc.status === "rejected")
    ).toHaveLength(0);
  });

  it("keeps the budget document flat while unfunded arrears accumulate", async () => {
    const db = world(0);
    const bonds = Array.from({ length: 50 }, (_, i) => ({
      ...bond(),
      _id: new ObjectId(`6500000000000000000020${String(i).padStart(2, "0")}`),
    })) as Bond[];
    const args = { anchorRate: 1, forexEnabled: false, corporateQuotes: new Map() };
    const sizes: number[] = [];
    for (let turn = 12; turn < 16; turn++) {
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn,
        bonds,
      });
      sizes.push(JSON.stringify(savedBudget(db)).length);
    }
    expect(openClaims(db)).toHaveLength(200);
    expect(savedBudget(db).sovereignCouponClaims ?? []).toEqual([]);
    // Only the per-bond frozen-through mark lives on the budget, so it stops growing.
    expect(new Set(sizes).size).toBe(1);
    expect(Object.keys(savedBudget(db).sovereignCouponFrozenThrough ?? {})).toHaveLength(50);
    expect(savedBudget(db).sovereignCouponFrozenThrough?.[`b${bonds[0]._id.toHexString()}`]).toBe(
      15
    );
  });

  it("freezes a turn's claims with one batched install, not a write per bond", async () => {
    const db = world(0);
    const bonds = Array.from({ length: 40 }, (_, i) => ({
      ...bond(),
      _id: new ObjectId(`6500000000000000000030${String(i).padStart(2, "0")}`),
    })) as Bond[];
    const budgetWrites = vi.spyOn(db.collection("federalBudget"), "updateOne");
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      turn: 12,
      bonds,
      anchorRate: 1,
      forexEnabled: false,
      corporateQuotes: new Map(),
    });
    expect(openClaims(db)).toHaveLength(40);
    expect(budgetWrites).toHaveBeenCalledTimes(1);
    // A replay of the same turn freezes nothing twice.
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      turn: 12,
      bonds,
      anchorRate: 9,
      forexEnabled: false,
      corporateQuotes: new Map(),
    });
    expect(openClaims(db)).toHaveLength(40);
    expect(openClaims(db).every((claim) => claim.anchorRate === 1)).toBe(true);
  });

  it("moves legacy array claims into the store without changing their frozen terms", async () => {
    const db = world(0);
    const args = {
      turn: 12,
      bonds: [bond()],
      anchorRate: 1,
      forexEnabled: false,
      corporateQuotes: new Map(),
    };
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    const frozen = openClaims(db);
    expect(frozen).toHaveLength(1);
    // Put the world back in the pre-store shape: the claim on the budget array only.
    db.collection("sovereignCouponClaims").docs.length = 0;
    savedBudget(db).sovereignCouponClaims = frozen;

    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      turn: 13,
      bonds: [],
    });
    expect(savedBudget(db).sovereignCouponClaims).toEqual([]);
    expect(openClaims(db)).toEqual(frozen);
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(0);

    savedBudget(db).treasuryCashLocal = 100;
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      turn: 14,
      bonds: [],
    });
    expect(savedBudget(db).treasuryCashLocal).toBe(100 - frozen[0].amountLocal);
    expect(openClaims(db)).toEqual([]);
    expect((db.collection("characters").docs[0] as { cashOnHand: number }).cashOnHand).toBe(
      frozen[0].amountLocal / 6
    );
  });

  it("leaves a legacy claim with a journaled payout on the array for its own plan to finish", async () => {
    const db = world(0);
    const args = {
      turn: 12,
      bonds: [bond()],
      anchorRate: 1,
      forexEnabled: false,
      corporateQuotes: new Map(),
    };
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    const [claim] = openClaims(db);
    db.collection("sovereignCouponClaims").docs.length = 0;
    savedBudget(db).sovereignCouponClaims = [claim];
    db.seed("bankMoneyMoves", [
      { _id: `${claim.id}:attempt:12`, status: "partial", kind: "sovereign_coupon_funded_payout" },
    ]);
    const resume = vi.spyOn(await import("@/lib/banking/settlementJournal"), "resumeSettlement");
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      turn: 13,
      bonds: [],
    }).catch(() => undefined);
    expect(savedBudget(db).sovereignCouponClaims).toEqual([claim]);
    expect(openClaims(db)).toEqual([]);
    expect(resume).toHaveBeenCalledWith(expect.anything(), `${claim.id}:attempt:12`);
    resume.mockRestore();
  });

  it("prunes a paid claim record once its receipt is acknowledged", async () => {
    const db = world();
    const args = {
      turn: 12,
      bonds: [bond()],
      anchorRate: 1,
      forexEnabled: false,
      corporateQuotes: new Map(),
    };
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    const records = db.collection("sovereignCouponClaims")
      .docs as unknown as SovereignCouponClaimRecord[];
    expect(records).toHaveLength(1);
    expect(records[0].settledTurn).toBe(12);
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
      ...args,
      turn: 13,
      bonds: [],
    });
    expect(db.collection("sovereignCouponClaims").docs).toHaveLength(0);
    // The frozen-through mark still stops the paid turn from being frozen again.
    await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), args);
    expect(db.collection("sovereignCouponClaims").docs).toHaveLength(0);
  });

  describe("grouped public-float payout", () => {
    const floatBonds = (count: number, prefix: string, publicFloat = 10) =>
      Array.from({ length: count }, (_, i) => ({
        ...bond(),
        _id: new ObjectId(`${prefix}${String(i).padStart(2, "0")}`),
        holders: [],
        publicFloat,
      })) as Bond[];
    const args = { anchorRate: 1, forexEnabled: false, corporateQuotes: new Map() };
    const pool = (db: InMemoryDb) =>
      db.collection("bondMarketPools").docs[0] as unknown as {
        cashLocal: number;
        lifetime: { couponsIn: number };
      };
    const moves = (db: InMemoryDb) => db.collection("bankMoneyMoves").docs;

    it("pays every funded pure public-float claim through one receipt", async () => {
      const db = world(1_000_000);
      const bonds = floatBonds(32, "6500000000000000000040");
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 12,
        bonds,
      });
      const records = db.collection("sovereignCouponClaims")
        .docs as unknown as SovereignCouponClaimRecord[];
      const total = records.reduce((sum, row) => sum + row.claim.amountLocal, 0);
      expect(records).toHaveLength(32);
      expect(records.every((row) => row.settledTurn === 12)).toBe(true);
      expect(moves(db).map((doc) => doc._id)).toEqual([couponBatchKey("US", 12)]);
      expect(moves(db)[0].status).toBe("applied");
      expect(savedBudget(db).treasuryCashLocal).toBe(1_000_000 - total);
      expect(pool(db).cashLocal).toBe(total);
      expect(pool(db).lifetime.couponsIn).toBe(total);

      // An exact replay of the turn moves nothing and writes no second receipt.
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 12,
        bonds,
      });
      expect(moves(db)).toHaveLength(1);
      expect(savedBudget(db).treasuryCashLocal).toBe(1_000_000 - total);
      expect(pool(db).cashLocal).toBe(total);
      expect(pool(db).lifetime.couponsIn).toBe(total);
    });

    it("keeps frozen quotes per claim and values the receipt at their frozen sum", async () => {
      const db = world(0);
      const bonds = floatBonds(3, "6500000000000000000041");
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 12,
        bonds,
        anchorRate: 2,
      });
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 13,
        bonds,
        anchorRate: 5,
      });
      const claims = openClaims(db);
      expect(claims.map((claim) => claim.anchorRate)).toEqual([2, 2, 2, 5, 5, 5]);
      savedBudget(db).treasuryCashLocal = 1_000_000;
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 14,
        bonds: [],
        anchorRate: 9,
      });
      expect(openClaims(db)).toEqual([]);
      const receipt = moves(db)[0] as unknown as {
        legs: Array<{ amount: number; valuation: { localPerAnchor: number } }>;
      };
      const local = claims.reduce((sum, claim) => sum + claim.amountLocal, 0);
      const anchor = claims.reduce((sum, claim) => sum + claim.amountLocal / claim.anchorRate, 0);
      expect(receipt.legs[0].amount).toBe(local);
      expect(receipt.legs[0].valuation.localPerAnchor).toBeCloseTo(local / anchor, 12);
      const stored = (
        db.collection("sovereignCouponClaims").docs as unknown as SovereignCouponClaimRecord[]
      ).map((row) => row.claim);
      expect(stored).toEqual(claims);
    });

    it("pays the oldest arrears first and leaves what cash cannot cover queued", async () => {
      const db = world(0);
      const bonds = floatBonds(4, "6500000000000000000042");
      for (const turn of [12, 13])
        await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
          ...args,
          turn,
          bonds,
        });
      const claims = openClaims(db);
      expect(claims).toHaveLength(8);
      savedBudget(db).treasuryCashLocal = claims[0].amountLocal * 5;
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 14,
        bonds: [],
      });
      expect(openClaims(db)).toEqual(claims.slice(5));
      expect(savedBudget(db).treasuryCashLocal).toBe(0);
      expect(moves(db)).toHaveLength(1);
      expect(moves(db).filter((doc) => doc.status === "rejected")).toHaveLength(0);
    });

    it("closes claims from the landed receipt after a crash, without paying twice", async () => {
      const db = world(1_000_000);
      const bonds = floatBonds(5, "6500000000000000000043");
      const crash = withInjectedCrash(db, {
        collection: "sovereignCouponClaims",
        op: "bulkWrite",
        onCall: 1,
      });
      await expect(
        settleFundedSovereignCoupons(crash.db, savedBudget(db), { ...args, turn: 12, bonds })
      ).rejects.toThrow("crash");
      const cash = savedBudget(db).treasuryCashLocal;
      const poolCash = pool(db).cashLocal;
      expect(openClaims(db)).toHaveLength(5);
      expect(cash).toBeLessThan(1_000_000);

      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 13,
        bonds: [],
      });
      expect(openClaims(db)).toEqual([]);
      expect(savedBudget(db).treasuryCashLocal).toBe(cash);
      expect(pool(db).cashLocal).toBe(poolCash);
      expect(moves(db).map((doc) => doc._id)).toEqual([couponBatchKey("US", 12)]);
    });

    it("resumes a partial per-claim receipt on its own key and batches the rest", async () => {
      const db = world(1_000_000);
      const [first, ...rest] = floatBonds(3, "6500000000000000000044");
      const crash = withInjectedCrash(db, {
        collection: "bondMarketPools",
        op: "updateOne",
        matches: (callArgs) =>
          JSON.stringify(callArgs[1] ?? {}).includes("cashLocal") &&
          !JSON.stringify(callArgs[1] ?? {}).includes("setOnInsert"),
        onCall: 1,
      });
      // Seed a legacy per-claim attempt: a claim with a corporate holder takes
      // the per-claim path, crashing between its Treasury debit and pool credit.
      const corpId = new ObjectId("650000000000000000000016");
      db.seed("corporations", [
        { _id: corpId, countryId: "US", liquidCurrencyCode: "USD", liquidCapital: 0 },
      ]);
      await expect(
        settleFundedSovereignCoupons(crash.db, savedBudget(db), {
          ...args,
          corporateQuotes: new Map([
            [
              corpId.toHexString(),
              {
                id: corpId.toHexString(),
                countryId: "US",
                currencyCode: "USD" as CurrencyCode,
                localPerAnchor: 1,
                currencyFieldPresent: true,
                currencyFieldValue: "USD",
                currencyUsesCountryFallback: false,
              },
            ],
          ]),
          turn: 12,
          bonds: [{ ...first, holders: [{ corporationId: corpId, units: 2 }] } as unknown as Bond],
        })
      ).rejects.toThrow("crash");
      const legacyKey = moves(db)[0]._id as string;
      expect(legacyKey).toMatch(/:attempt:12$/);
      expect(moves(db)[0].status).toBe("partial");

      const resume = vi.spyOn(await import("./settlementJournal"), "resumeSettlement");
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 13,
        bonds: rest,
      });
      expect(resume).toHaveBeenCalledWith(expect.anything(), legacyKey);
      resume.mockRestore();
      expect(openClaims(db)).toEqual([]);
      expect(
        moves(db)
          .map((doc) => doc._id)
          .sort()
      ).toEqual([legacyKey, couponBatchKey("US", 13)].sort());
      const batch = moves(db).find((doc) => doc._id === couponBatchKey("US", 13)) as unknown as {
        event: { meta: { claimIds: string } };
      };
      expect(batch.event.meta.claimIds.split(",")).toHaveLength(2);
      expect(batch.event.meta.claimIds).not.toContain(first._id.toHexString());
    });

    // A batch receipt written but crashed before its Treasury debit landed.
    const unstartedBatch = async (db: InMemoryDb, bonds: Bond[], turn: number) => {
      const crash = withInjectedCrash(db, {
        collection: "federalBudget",
        op: "updateOne",
        matches: (callArgs) => JSON.stringify(callArgs[1] ?? {}).includes("treasuryCashLocal"),
        onCall: 1,
      });
      await expect(
        settleFundedSovereignCoupons(crash.db, savedBudget(db), { ...args, turn, bonds })
      ).rejects.toThrow("crash");
      const receipt = moves(db).find((doc) => doc._id === couponBatchKey("US", turn));
      expect(receipt?.status).toBe("partial");
      expect((receipt as unknown as { legs: { applied: boolean }[] }).legs).toEqual([
        expect.objectContaining({ applied: false }),
        expect.objectContaining({ applied: false }),
      ]);
    };

    it("keeps claims owed when a resumed batch is refused by its Treasury guard", async () => {
      const db = world(1_000_000);
      const bonds = floatBonds(4, "6500000000000000000046");
      await unstartedBatch(db, bonds, 12);
      const claims = openClaims(db);
      expect(claims).toHaveLength(4);

      // Cash drained before the resume: the stored debit guard refuses.
      savedBudget(db).treasuryCashLocal = 0;
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 13,
        bonds: [],
      });
      expect(moves(db).find((doc) => doc._id === couponBatchKey("US", 12))?.status).toBe(
        "rejected"
      );
      expect(openClaims(db)).toEqual(claims);
      expect(savedBudget(db).treasuryCashLocal).toBe(0);
      expect(pool(db).cashLocal).toBe(0);

      // Once funded, the same claims pay exactly once through a fresh receipt.
      const total = claims.reduce((sum, claim) => sum + claim.amountLocal, 0);
      savedBudget(db).treasuryCashLocal = total;
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 14,
        bonds: [],
      });
      expect(openClaims(db)).toEqual([]);
      expect(savedBudget(db).treasuryCashLocal).toBe(0);
      expect(pool(db).cashLocal).toBe(total);
    });

    it("sizes new claims against Treasury cash after a resumed batch lands", async () => {
      const db = world(1_000_000);
      const bonds = floatBonds(2, "6500000000000000000047");
      await unstartedBatch(db, bonds, 12);
      const owed = openClaims(db);
      const coupon = owed[0].amountLocal;
      // Enough for the resumed batch plus exactly one of the two new claims.
      savedBudget(db).treasuryCashLocal = coupon * 3;
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 13,
        bonds,
      });
      expect(moves(db).filter((doc) => doc.status === "rejected")).toHaveLength(0);
      expect(openClaims(db)).toHaveLength(1);
      expect(savedBudget(db).treasuryCashLocal).toBe(0);
      expect(pool(db).cashLocal).toBe(coupon * 3);
    });

    it("conserves cash exactly at national-currency scale", async () => {
      const db = world(1e15);
      const bonds = floatBonds(32, "6500000000000000000045", 7_777_777_777);
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 12,
        bonds,
        anchorRate: 1_234.567,
      });
      expect(openClaims(db)).toEqual([]);
      const before = 1e15 + 0;
      expect(savedBudget(db).treasuryCashLocal + pool(db).cashLocal).toBe(before);
      expect(pool(db).lifetime.couponsIn).toBe(pool(db).cashLocal);
    });
  });

  describe("grouped fund-held and mixed payout", () => {
    const fundIds = [
      new ObjectId("650000000000000000000050"),
      new ObjectId("650000000000000000000051"),
    ];
    const mixedBonds = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...bond(),
        _id: new ObjectId(`6500000000000000000060${String(i).padStart(2, "0")}`),
        holders: [{ fundId: fundIds[i % 2], units: 3 }],
        publicFloat: i % 3 === 0 ? 0 : 10,
      })) as unknown as Bond[];
    const args = { anchorRate: 1.37, forexEnabled: false, corporateQuotes: new Map() };
    const fundWorld = () => {
      const db = world(0);
      db.seed(
        "indexFunds",
        fundIds.map((_id) => ({ _id, cashAnchor: 0 }))
      );
      return db;
    };
    const fundCash = (db: InMemoryDb) =>
      (db.collection("indexFunds").docs as unknown as { cashAnchor: number }[]).reduce(
        (sum, fund) => sum + fund.cashAnchor,
        0
      );
    const pool = (db: InMemoryDb) =>
      db.collection("bondMarketPools").docs[0] as unknown as {
        cashLocal: number;
        lifetime: { couponsIn: number };
      };

    // Unfunded turns freeze one claim per bond per turn, then cash arrives.
    async function backlog(db: InMemoryDb, bonds: Bond[], turns: number) {
      for (let turn = 1; turn <= turns; turn++)
        await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
          ...args,
          turn,
          bonds,
        });
      return openClaims(db);
    }

    function countCommands(db: InMemoryDb) {
      const counts = new Map<string, number>();
      const tracked = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop !== "collection") return Reflect.get(target, prop, receiver);
          return (name: string) => {
            const collection = target.collection(name);
            return new Proxy(collection, {
              get(c, method, r) {
                const value = Reflect.get(c, method, r);
                if (typeof value !== "function") return value;
                return (...callArgs: unknown[]) => {
                  const key = `${String(method)} ${name}`;
                  counts.set(key, (counts.get(key) ?? 0) + 1);
                  return (value as (...a: unknown[]) => unknown).apply(c, callArgs);
                };
              },
            });
          };
        },
      });
      const total = () => [...counts.values()].reduce((sum, n) => sum + n, 0);
      return { db: tracked as unknown as Db, counts, total };
    }

    it("pays a fund-held and mixed backlog through one receipt and conserves cash", async () => {
      const db = fundWorld();
      const bonds = mixedBonds(6);
      const owed = await backlog(db, bonds, 5);
      expect(owed).toHaveLength(30);
      const total = owed.reduce((sum, claim) => sum + claim.amountLocal, 0);
      savedBudget(db).treasuryCashLocal = total;
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 6,
        bonds: [],
      });
      expect(openClaims(db)).toEqual([]);
      const receipts = db.collection("bankMoneyMoves").docs;
      expect(receipts.map((doc) => doc._id)).toEqual([couponBatchKey("US", 6)]);
      const legs = (receipts[0] as unknown as { legs: { collection: string }[] }).legs;
      // One Treasury debit, one pool credit and one credit per fund.
      expect(legs.map((leg) => leg.collection).sort()).toEqual(
        ["bondMarketPools", "federalBudget", "indexFunds", "indexFunds"].sort()
      );
      const paidToFunds = owed.flatMap((claim) =>
        claim.holders.filter((holder) => holder.kind === "fund")
      );
      expect(fundCash(db)).toBeCloseTo(
        paidToFunds.reduce((sum, holder) => sum + holder.amountAnchor, 0),
        9
      );
      expect(savedBudget(db).treasuryCashLocal).toBeCloseTo(0, 6);
      expect(pool(db).cashLocal + fundCash(db) * args.anchorRate).toBeCloseTo(total, 6);
      expect(pool(db).lifetime.couponsIn).toBe(pool(db).cashLocal);
    });

    it("settles a larger backlog in the same number of commands", async () => {
      const measure = async (turns: number) => {
        const db = fundWorld();
        const owed = await backlog(db, mixedBonds(6), turns);
        savedBudget(db).treasuryCashLocal = owed.reduce((sum, claim) => sum + claim.amountLocal, 0);
        const tracked = countCommands(db);
        await settleFundedSovereignCoupons(tracked.db, savedBudget(db), {
          ...args,
          turn: turns + 1,
          bonds: [],
        });
        expect(openClaims(db)).toEqual([]);
        return { claims: owed.length, commands: tracked.total() };
      };
      const small = await measure(2);
      const large = await measure(12);
      expect(large.claims).toBe(small.claims * 6);
      expect(large.commands).toBe(small.commands);
    });

    it("leaves batchable claims owed on a same-turn replay instead of paying them one by one", async () => {
      const db = fundWorld();
      const bonds = mixedBonds(3);
      const owed = await backlog(db, bonds, 2);
      savedBudget(db).treasuryCashLocal = owed[0].amountLocal;
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 3,
        bonds: [],
      });
      expect(openClaims(db)).toHaveLength(owed.length - 1);
      savedBudget(db).treasuryCashLocal = 1e9;
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 3,
        bonds: [],
      });
      expect(openClaims(db)).toHaveLength(owed.length - 1);
      expect(db.collection("bankMoneyMoves").docs.map((doc) => doc._id)).toEqual([
        couponBatchKey("US", 3),
      ]);
      await settleFundedSovereignCoupons(db as unknown as Db, savedBudget(db), {
        ...args,
        turn: 4,
        bonds: [],
      });
      expect(openClaims(db)).toEqual([]);
    });
  });
});
