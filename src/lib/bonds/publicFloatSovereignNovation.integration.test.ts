import { afterAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { BASE_DEMAND } from "@/lib/sovereignDefault/constants";
import type { Bond } from "@/lib/db/types/bond";
import { settleFundedSovereignBondMaturity } from "./sovereign";

const enabled = process.env.AHD_SOVEREIGN_PUBLIC_FLOAT_NOVATION_REAL_MONGO === "1";
const uri = new URL(
  process.env.AHD_SOVEREIGN_PUBLIC_FLOAT_NOVATION_MONGO_URI ?? "mongodb://127.0.0.1:27018"
);
if (
  enabled &&
  (uri.protocol !== "mongodb:" ||
    !["127.0.0.1", "localhost"].includes(uri.hostname) ||
    !["27018", "27020", "27021"].includes(uri.port) ||
    uri.username ||
    uri.password ||
    (uri.pathname && uri.pathname !== "/") ||
    uri.search)
)
  throw new Error("Sovereign novation fixtures require a local sandbox Mongo endpoint");

let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});

function crashAfterSourceWrite(db: Db): Db {
  let crashed = false;
  return {
    collection(name: string) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (name === "bonds" && property === "updateOne") {
            return async (...args: unknown[]) => {
              const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(
                target,
                args
              );
              const update = args[1] as { $inc?: Record<string, unknown> } | undefined;
              if (!crashed && Number(update?.$inc?.totalIssued) < 0) {
                crashed = true;
                throw new Error("simulated crash after source stock update in transaction");
              }
              return result;
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  } as unknown as Db;
}

function crashBeforeFundingReceipt(db: Db, turn: number): Db {
  let crashed = false;
  return {
    collection(name: string) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (name === "bankMoneyMoves" && property === "insertOne") {
            return async (...args: unknown[]) => {
              const document = args[0] as { _id?: unknown } | undefined;
              if (!crashed && String(document?._id).endsWith(`:fund:${turn}`)) {
                crashed = true;
                throw new Error("simulated crash after atomic novation and before cash funding");
              }
              return (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  } as unknown as Db;
}

function changeTreasuryCurrencyBeforeFunding(db: Db, turn: number): Db {
  let changed = false;
  return {
    collection(name: string) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (name === "bankMoneyMoves" && property === "insertOne") {
            return async (...args: unknown[]) => {
              const document = args[0] as { _id?: unknown } | undefined;
              if (!changed && String(document?._id).endsWith(`:fund:${turn}`)) {
                changed = true;
                await db
                  .collection<{ _id: string; [key: string]: unknown }>("federalBudget")
                  .updateOne({ _id: "federal" }, { $set: { currencyCode: "GBP" } });
              }
              return (value as (...args: unknown[]) => Promise<unknown>).apply(target, args);
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  } as unknown as Db;
}

describe.skipIf(!enabled)("public-float sovereign novation on sandbox Mongo", () => {
  it("rolls back a mid-swap crash and replays the original partial quote exactly once", async () => {
    client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1 });
    const db = client.db(`ahd_fixture_public_float_novation_${new ObjectId().toHexString()}`);
    const now = new Date("2026-10-05T00:00:00.000Z");
    const federalBudgets = db.collection<{ _id: string; [key: string]: unknown }>("federalBudget");
    const centralBanks = db.collection<{ _id: string; [key: string]: unknown }>("centralBanks");
    const bondPools = db.collection<{ _id: string; [key: string]: unknown }>("bondMarketPools");
    const holderId = new ObjectId();
    const source = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      issuerName: "Fixture Treasury",
      corporationId: new ObjectId(),
      countryId: "US",
      currencyCode: "USD",
      faceValue: 1_000,
      marketPrice: 1,
      couponRate: 5,
      totalIssued: 6_000,
      publicFloat: 4,
      maturityTurn: 48,
      maturityTurns: 48,
      issuedAtTurn: 0,
      holders: [
        { characterId: holderId, units: 1 },
        { bankId: new ObjectId(), charteredTurn: 33, units: 1 },
      ],
      defaulted: false,
      defaultedAtTurn: null,
      matured: false,
      restructureHaircutPercent: null,
      restructureExtendedMaturityTurn: null,
      originalMaturityTurn: null,
      originalTotalIssued: null,
      createdAt: now,
      updatedAt: now,
    } as unknown as Bond;
    await federalBudgets.insertOne({
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      treasuryBalance: 10_000,
      treasuryCashLocal: 3_000,
      debt: { principal: 6_000 },
      spending: { total: 2_050, debtInterest: 300 },
      revenue: { total: 3_000 },
      surplus: 1_000,
      gdp: 50_000,
    });
    await centralBanks.insertOne({ _id: "US", primeRate: 7 });
    await bondPools.insertOne({
      _id: "USD",
      cashLocal: 25_000,
      appetiteByCountry: { US: BASE_DEMAND * 0.5 },
    });
    await db.collection("characters").insertOne({ _id: holderId, cashOnHand: 0 });
    await db.collection<Bond>("bonds").insertOne(source);

    const args = {
      bond: source,
      turn: 48,
      dueTurn: 48,
      currencyCode: "USD" as const,
      treasuryLocalPerAnchor: 1,
      nonBankRepaymentLocal: 5_000,
      holderLegs: [
        {
          collection: "characters",
          filter: { _id: holderId },
          path: "cashOnHand",
          amount: 1_000,
          currencyCode: "USD" as const,
          localPerAnchor: 1,
          note: "Pay the frozen character holder in native currency",
        },
        {
          collection: "bondMarketPools",
          filter: { _id: "USD" },
          path: "cashLocal",
          amount: 4_000,
          currencyCode: "USD" as const,
          localPerAnchor: 1,
          note: "Pay only residual public float after par novation",
        },
      ],
      now,
      transactionClient: client,
    };
    await expect(
      settleFundedSovereignBondMaturity(crashAfterSourceWrite(db), args)
    ).rejects.toThrow("simulated crash after source stock update in transaction");

    expect(await db.collection("bonds").countDocuments({ issuerType: "sovereign" })).toBe(1);
    expect(await db.collection("bonds").findOne({ _id: source._id })).toMatchObject({
      totalIssued: 6_000,
      publicFloat: 4,
      holders: [
        { characterId: holderId, units: 1 },
        expect.objectContaining({ charteredTurn: 33, units: 1 }),
      ],
      matured: false,
      sovereignMaturityClaim: {
        amountLocal: 5_000,
        publicFloatDisposition: { status: "reserved", acceptedUnits: 2 },
      },
    });
    expect(await federalBudgets.findOne({ _id: "federal" })).toMatchObject({
      treasuryCashLocal: 3_000,
      debt: { principal: 6_000 },
    });

    await db
      .collection<Bond>("bonds")
      .updateOne(
        { _id: source._id },
        { $set: { countryId: "UK", currencyCode: "GBP", issuerName: "Wrong Issuer" } }
      );
    const wrongBeforeCommit = (await db.collection<Bond>("bonds").findOne({ _id: source._id }))!;
    await expect(
      settleFundedSovereignBondMaturity(db, { ...args, bond: wrongBeforeCommit })
    ).rejects.toThrow("source changed before novation commit");
    expect(await db.collection("bonds").countDocuments({ issuerType: "sovereign" })).toBe(1);
    await db
      .collection<Bond>("bonds")
      .updateOne(
        { _id: source._id },
        { $set: { countryId: "US", currencyCode: "USD", issuerName: "Fixture Treasury" } }
      );
    await federalBudgets.updateOne({ _id: "federal" }, { $set: { currencyCode: "GBP" } });
    const sourceBeforeBudgetMismatch = (await db
      .collection<Bond>("bonds")
      .findOne({ _id: source._id }))!;
    await expect(
      settleFundedSovereignBondMaturity(db, { ...args, bond: sourceBeforeBudgetMismatch })
    ).rejects.toThrow("Sovereign maturity currency differs from its treasury");
    expect(await db.collection("bonds").countDocuments({ issuerType: "sovereign" })).toBe(1);
    await federalBudgets.updateOne({ _id: "federal" }, { $set: { currencyCode: "USD" } });

    await bondPools.updateOne({ _id: "USD" }, { $set: { appetiteByCountry: { US: BASE_DEMAND } } });
    const latestSourceBeforeCommit = (await db
      .collection<Bond>("bonds")
      .findOne({ _id: source._id }))!;
    await expect(
      settleFundedSovereignBondMaturity(crashBeforeFundingReceipt(db, 49), {
        ...args,
        bond: latestSourceBeforeCommit,
        turn: 49,
        treasuryLocalPerAnchor: 99,
        nonBankRepaymentLocal: 99_000,
        holderLegs: [],
        now: new Date("2026-10-06T00:00:00.000Z"),
      })
    ).rejects.toThrow("simulated crash after atomic novation and before cash funding");
    expect(await db.collection("bonds").countDocuments({ issuerType: "sovereign" })).toBe(2);
    expect(await db.collection("bonds").findOne({ _id: source._id })).toMatchObject({
      totalIssued: 4_000,
      publicFloat: 2,
      matured: false,
      holders: [
        { characterId: holderId, units: 1 },
        expect.objectContaining({ charteredTurn: 33, units: 1 }),
      ],
      sovereignMaturityClaim: {
        amountLocal: 5_000,
        publicFloatDisposition: {
          status: "applied",
          acceptedUnits: 2,
          novationTurn: 48,
          residualAmountLocal: 3_000,
        },
      },
    });
    expect(await federalBudgets.findOne({ _id: "federal" })).toMatchObject({
      treasuryCashLocal: 3_000,
      debt: { principal: 6_000 },
      spending: { debtInterest: 340 },
    });
    const latestReducedSource = (await db.collection<Bond>("bonds").findOne({ _id: source._id }))!;
    const racedFunding = await settleFundedSovereignBondMaturity(
      changeTreasuryCurrencyBeforeFunding(db, 50),
      {
        ...args,
        bond: latestReducedSource,
        currencyCode: "GBP",
        turn: 50,
        treasuryLocalPerAnchor: 99,
        nonBankRepaymentLocal: 99_000,
        holderLegs: [],
      }
    );
    expect(racedFunding?.status).toBe("rejected");
    expect(await federalBudgets.findOne({ _id: "federal" })).toMatchObject({
      treasuryCashLocal: 3_000,
      debt: { principal: 6_000 },
      currencyCode: "GBP",
    });
    expect(await db.collection<Bond>("bonds").findOne({ _id: source._id })).toMatchObject({
      matured: false,
      sovereignMaturityClaim: { escrowLocal: 0 },
    });
    await federalBudgets.updateOne({ _id: "federal" }, { $set: { currencyCode: "USD" } });
    await db
      .collection<Bond>("bonds")
      .updateOne(
        { _id: source._id },
        { $set: { countryId: "UK", currencyCode: "GBP", issuerName: "Wrong Issuer" } }
      );
    const wrongAfterCommit = (await db.collection<Bond>("bonds").findOne({ _id: source._id }))!;
    await expect(
      settleFundedSovereignBondMaturity(db, {
        ...args,
        bond: wrongAfterCommit,
        currencyCode: "GBP",
        turn: 50,
      })
    ).rejects.toThrow("source identity changed before maturity payout");
    expect(await federalBudgets.findOne({ _id: "federal" })).toMatchObject({
      treasuryCashLocal: 3_000,
      debt: { principal: 6_000 },
    });
    await db
      .collection<Bond>("bonds")
      .updateOne(
        { _id: source._id },
        { $set: { countryId: "US", currencyCode: "USD", issuerName: "Fixture Treasury" } }
      );
    await federalBudgets.updateOne({ _id: "federal" }, { $set: { currencyCode: "GBP" } });
    await expect(
      settleFundedSovereignBondMaturity(db, {
        ...args,
        bond: latestReducedSource,
        currencyCode: "GBP",
        turn: 50,
      })
    ).rejects.toThrow("Sovereign maturity currency differs from its treasury");
    expect(await federalBudgets.findOne({ _id: "federal" })).toMatchObject({
      treasuryCashLocal: 3_000,
      debt: { principal: 6_000 },
    });
    await federalBudgets.updateOne({ _id: "federal" }, { $set: { currencyCode: "USD" } });
    const replay = await settleFundedSovereignBondMaturity(db, {
      ...args,
      bond: latestReducedSource,
      turn: 51,
      currencyCode: "GBP",
      treasuryLocalPerAnchor: 99,
      nonBankRepaymentLocal: 99_000,
      holderLegs: [],
      now: new Date("2026-10-06T00:00:00.000Z"),
    });
    expect(replay?.status).toBe("applied");
    expect(await db.collection("bonds").countDocuments({ issuerType: "sovereign" })).toBe(2);
    expect(await bondPools.findOne({ _id: "USD" })).toMatchObject({
      cashLocal: 27_000,
    });
    expect(await db.collection("characters").findOne({ _id: holderId })).toMatchObject({
      cashOnHand: 1_000,
    });
    expect(await federalBudgets.findOne({ _id: "federal" })).toMatchObject({
      treasuryCashLocal: 0,
      debt: { principal: 2_000 },
      spending: { debtInterest: 140 },
    });
    expect(await db.collection("bonds").findOne({ _id: source._id })).toMatchObject({
      totalIssued: 4_000,
      publicFloat: 0,
      matured: true,
      sovereignMaturityClaim: {
        amountLocal: 5_000,
        paid: true,
        publicFloatDisposition: {
          status: "applied",
          acceptedUnits: 2,
          novationTurn: 48,
          residualAmountLocal: 3_000,
        },
      },
    });
    const replacement = await db.collection<Bond>("bonds").findOne({ _id: { $ne: source._id } });
    expect(replacement).toMatchObject({
      issuedAtTurn: 48,
      maturityTurn: 96,
      totalIssued: 2_000,
      publicFloat: 2,
      currencyCode: "USD",
    });
    await db.dropDatabase();
  });
});
