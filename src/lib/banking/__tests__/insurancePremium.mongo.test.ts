import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { settleInsurancePremiumForTurn } from "@/lib/banking/insurancePremium";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";

const BANK_ID = new ObjectId("66d000000000000000000002");
const TURN = 481;

describe.runIf(REAL_MONGO_ENABLED)("insurance premium retry on isolated real Mongo", () => {
  let fixture: IsolatedMongod | null = null;
  let db: Db;

  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-bank-insurance-premium-");
    db = fixture.db;
  });

  afterAll(async () => {
    await stopIsolatedMongod(fixture);
    fixture = null;
  });

  it("finishes the original premium after the debit acknowledgment is lost", async () => {
    await db.collection<{ _id: string } & Record<string, unknown>>("gameState").insertOne({
      _id: "current",
      preset: "2019-default",
      currentTurn: TURN,
    });
    await db
      .collection<{ _id: string } & Record<string, unknown>>("gameConfig")
      .insertOne({ _id: "default", ledgerShadow: false });
    await db.collection("corporations").insertOne({
      _id: BANK_ID,
      countryId: "US",
      liquidCurrencyCode: "USD",
      bankCharter: {
        status: "active",
        currency: "USD",
        charteredTurn: 17,
        cashReserves: 500,
      },
    });
    await db
      .collection<{ _id: string } & Record<string, unknown>>("depositInsuranceFunds")
      .insertOne({
        _id: "USD",
        balance: 10,
        insuredCap: 5_000_000,
        premiumsCollectedLifetime: 0,
        insuredDepositExposureTurnsLifetime: 0,
        pricingEvidenceStartTurn: TURN,
        measuredPaidClaimsSincePricingStart: 0,
        measuredGrossClaimsSincePricingStart: 0,
        measuredRecoveriesSincePricingStart: 0,
      });

    const input = {
      bankId: BANK_ID,
      countryId: "US",
      charteredTurn: 17,
      currency: "USD" as const,
      turn: TURN,
      insuredDeposits: 1_000_000,
      cashReserves: 500,
      reserveRatioActual: 0.1,
      reserveRatioRequired: 0.1,
    };
    let crashAfterDebit = true;
    const crashDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "collection") return Reflect.get(target, prop, receiver);
        return (name: string) => {
          const collection = target.collection(name);
          if (name !== "corporations") return collection;
          return new Proxy(collection, {
            get(col, operation, collectionReceiver) {
              if (operation !== "updateOne") return Reflect.get(col, operation, collectionReceiver);
              return async (...args: unknown[]) => {
                const result = await col.updateOne(
                  args[0] as Parameters<typeof col.updateOne>[0],
                  args[1] as Parameters<typeof col.updateOne>[1],
                  args[2] as Parameters<typeof col.updateOne>[2]
                );
                const update = args[1] as { $inc?: Record<string, number> };
                if (crashAfterDebit && (update.$inc?.["bankCharter.cashReserves"] ?? 0) < 0) {
                  crashAfterDebit = false;
                  throw new Error("injected lost Mongo acknowledgment after bank debit");
                }
                return result;
              };
            },
          });
        };
      },
    }) as unknown as Db;

    await expect(settleInsurancePremiumForTurn(crashDb, input)).rejects.toThrow(
      "injected lost Mongo acknowledgment after bank debit"
    );
    const frozen = await db.collection("bankMoneyMoves").findOne({ kind: "insurance_premium" });
    expect(frozen?.status).toBe("partial");
    const originalPaid = frozen?.event?.meta?.premiumPaid;
    expect(typeof originalPaid).toBe("number");
    expect(
      (await db.collection("corporations").findOne({ _id: BANK_ID }))?.bankCharter?.cashReserves
    ).toBe(500 - Number(originalPaid));

    await db
      .collection<{ _id: string } & Record<string, unknown>>("depositInsuranceFunds")
      .updateOne(
        { _id: "USD" },
        {
          $set: {
            balance: 1_000_000,
            measuredPaidClaimsSincePricingStart: 9,
          },
        }
      );
    const retry = await settleInsurancePremiumForTurn(db, {
      ...input,
      insuredDeposits: 0,
      cashReserves: 0,
      reserveRatioActual: 0,
      reserveRatioRequired: 0.2,
    });

    expect(retry).toEqual({
      insuredDeposits: input.insuredDeposits,
      premiumPaid: Number(originalPaid),
      premiumDue: Number(originalPaid),
      cashDebited: 0,
      cashReservesAfter: 500 - Number(originalPaid),
      shortfall: 0,
      applied: true,
    });
    const fund = await db
      .collection<{ _id: string } & Record<string, unknown>>("depositInsuranceFunds")
      .findOne({ _id: "USD" });
    expect(fund?.balance).toBe(1_000_000 + Number(originalPaid));
    expect(fund?.insuredDepositExposureTurnsLifetime).toBe(input.insuredDeposits);
    expect(
      await db.collection("bankMoneyMoves").countDocuments({ kind: "insurance_premium" })
    ).toBe(1);
  });
});
