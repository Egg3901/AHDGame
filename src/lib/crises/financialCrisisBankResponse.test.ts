import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { CrisisActionContext } from "./optionActions";
import {
  applyFinancialCrisisBankResponse,
  prepareFinancialCrisisBankResponse,
} from "./financialCrisisBankResponse";
import { processFinancialCrisisGuarantees } from "./financialCrisisGuarantees";
import { resolveBankingPolicy } from "@/lib/banking/rules/policy";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function world(
  response: "recapitalize" | "guarantee" | "resolve",
  treasury = 1000,
  treasuryCashLocal = 0
) {
  const db = createInMemoryDb();
  const id = new ObjectId();
  db.seed("corporations", [
    {
      _id: id,
      countryId: "US",
      bankCharter: {
        status: "active",
        charteredTurn: 1,
        currency: "USD",
        cashReserves: 50,
        postedCapital: 100,
        confidence: 0.2,
        npcDeposits: 200,
        playerDeposits: 0,
        totalDeposits: 200,
      },
    },
  ]);
  db.seed("federalBudget", [
    {
      _id: "national-budget-us",
      countryId: "US",
      currencyCode: "USD",
      gdp: 10_000,
      treasuryBalance: treasury,
      treasuryCashLocal,
    },
  ]);
  const ctx = {
    db: db as unknown as Db,
    crisis: { _id: new ObjectId() },
    interaction: { _id: new ObjectId() },
    option: {
      treasuryCostPctGdp: response === "resolve" ? 0 : 0.02,
      action: { kind: "financialCrisisResponse", response },
    },
    countryId: "US",
    currentTurn: 50,
  } as unknown as CrisisActionContext;
  return { db, ctx, id };
}
const policy = resolveBankingPolicy({ privateBankingEnabled: true });

describe("funded financial crisis interventions", () => {
  it("settles taxpayer cash and bank capital once across retries", async () => {
    const { db, ctx, id } = world("recapitalize");
    await applyFinancialCrisisBankResponse(ctx, "recapitalize");
    await applyFinancialCrisisBankResponse(ctx, "recapitalize");
    const bank = await ctx.db.collection("corporations").findOne({ _id: id });
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(budget?.treasuryBalance).toBe(800);
    expect(bank?.bankCharter.cashReserves).toBe(250);
    expect(bank?.bankCharter.postedCapital).toBe(300);
    expect(bank?.bankCharter.publicRescueCapital).toBe(200);
    expect(budget?.treasuryBalance + bank?.bankCharter.cashReserves).toBe(1050);
    const move = db.collection("bankMoneyMoves").docs[0] as unknown as {
      legs: { filter: Record<string, unknown> }[];
    };
    expect(move.legs[1]?.filter).toMatchObject({
      countryId: "US",
      "bankCharter.status": "active",
      "bankCharter.charteredTurn": 1,
      "bankCharter.currency": "USD",
    });
  });
  it("refuses unfunded rescues before consent is claimed", async () => {
    const { ctx } = world("recapitalize", 20);
    await expect(prepareFinancialCrisisBankResponse(ctx.db, "US", ctx.option)).rejects.toThrow(
      "funded treasury"
    );
  });
  it("uses funded Treasury cash and keeps signed fiscal position separate", async () => {
    const { ctx, id } = world("recapitalize", 4_000, 300);
    ctx.treasuryCashLedgerEnabled = true;
    await applyFinancialCrisisBankResponse(ctx, "recapitalize");
    const bank = await ctx.db.collection("corporations").findOne({ _id: id });
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(budget?.treasuryCashLocal).toBe(100);
    expect(budget?.treasuryBalance).toBe(3_800);
    expect(bank?.bankCharter.cashReserves).toBe(250);
  });
  it("pays a real failed-bank cash shortfall and refunds unused escrow once", async () => {
    const { db, ctx, id } = world("guarantee");
    await applyFinancialCrisisBankResponse(ctx, "guarantee");
    await ctx.db
      .collection("corporations")
      .updateOne(
        { _id: id },
        { $set: { "bankCharter.status": "failed", "bankCharter.failedTurn": 51 } }
      );
    expect(await processFinancialCrisisGuarantees(db as unknown as Db, 51, policy)).toEqual({
      paid: 150,
      refunded: 0,
    });
    const claim = db
      .collection("bankMoneyMoves")
      .docs.find((row) => row.kind === "financial_crisis_guarantee_claim") as unknown as {
      legs: { filter: Record<string, unknown> }[];
    };
    expect(claim.legs[1]?.filter).toMatchObject({
      countryId: "US",
      "bankCharter.charteredTurn": 1,
      "bankCharter.status": "failed",
    });
    expect(await processFinancialCrisisGuarantees(db as unknown as Db, 51, policy)).toEqual({
      paid: 0,
      refunded: 0,
    });
    expect(
      await processFinancialCrisisGuarantees(db as unknown as Db, 51 + TURNS_PER_YEAR, policy)
    ).toEqual({
      paid: 0,
      refunded: 50,
    });
    expect(
      await processFinancialCrisisGuarantees(db as unknown as Db, 52 + TURNS_PER_YEAR, policy)
    ).toEqual({
      paid: 0,
      refunded: 0,
    });
    const bank = await ctx.db.collection("corporations").findOne({ _id: id });
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(bank?.bankCharter.cashReserves).toBe(200);
    expect(budget?.treasuryBalance).toBe(850);
    expect(bank?.bankCharter.cashReserves + budget?.treasuryBalance).toBe(1050);
  });
  it("will not pay an old funded guarantee to a replacement charter on the same corporation", async () => {
    const { db, ctx, id } = world("guarantee");
    await applyFinancialCrisisBankResponse(ctx, "guarantee");
    await ctx.db.collection("corporations").updateOne(
      { _id: id },
      {
        $set: {
          "bankCharter.status": "failed",
          "bankCharter.failedTurn": 51,
          "bankCharter.charteredTurn": 52,
        },
      }
    );
    expect(await processFinancialCrisisGuarantees(db as unknown as Db, 51, policy)).toEqual({
      paid: 0,
      refunded: 0,
    });
    const guarantee = await ctx.db.collection("bankGuarantees").findOne({ status: "active" });
    expect(guarantee?.escrowBalance).toBe(200);
  });
  it("reuses an unfunded guarantee shell after a crash without requoting the source or cohort", async () => {
    const { ctx, id } = world("guarantee", 1000);
    ctx.currentTurn = 55;
    ctx.treasuryCashLedgerEnabled = true;
    const key = [ctx.crisis._id, ctx.interaction._id, ctx.countryId, "guarantee"].join(":");
    await ctx.db.collection("bankGuarantees").insertOne({
      _id: key,
      crisisActionId: key,
      countryId: "US",
      currency: "USD",
      bankIds: [id],
      bankEpochs: [{ bankId: id, charteredTurn: 1, currency: "USD" }],
      openedTurn: 50,
      treasuryId: "national-budget-us",
      treasuryCurrencyCodePresent: true,
      treasuryCurrencyCode: "USD",
      treasuryCashLedgerEnabled: false,
      amount: 125,
      guaranteeLimit: 125,
      escrowBalance: 0,
      status: "pending",
      expiresTurn: 50 + TURNS_PER_YEAR,
    } as never);
    await applyFinancialCrisisBankResponse(ctx, "guarantee");
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    const guarantee = await ctx.db
      .collection<{ _id: string; escrowBalance: number; amount: number; openedTurn: number }>(
        "bankGuarantees"
      )
      .findOne({ _id: key });
    expect(budget?.treasuryBalance).toBe(875);
    expect(budget?.treasuryCashLocal).toBe(0);
    expect(guarantee?.escrowBalance).toBe(125);
    expect(guarantee?.amount).toBe(125);
    expect(guarantee?.openedTurn).toBe(50);
  });
  it("returns expired funded guarantee escrow to cash, keeping fiscal position noncash", async () => {
    const { db, ctx, id } = world("guarantee", 4_000, 1_000);
    ctx.treasuryCashLedgerEnabled = true;
    await applyFinancialCrisisBankResponse(ctx, "guarantee");
    await ctx.db
      .collection("corporations")
      .updateOne(
        { _id: id },
        { $set: { "bankCharter.status": "failed", "bankCharter.failedTurn": 51 } }
      );
    const cashPolicy = resolveBankingPolicy({
      privateBankingEnabled: true,
      treasuryCashLedgerEnabled: true,
    });
    expect(
      await processFinancialCrisisGuarantees(db as unknown as Db, 51 + TURNS_PER_YEAR, cashPolicy)
    ).toEqual({ paid: 150, refunded: 50 });
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(budget?.treasuryCashLocal).toBe(850);
    expect(budget?.treasuryBalance).toBe(3_850);
    expect(
      await processFinancialCrisisGuarantees(db as unknown as Db, 52 + TURNS_PER_YEAR, cashPolicy)
    ).toEqual({ paid: 0, refunded: 0 });
  });
  it("cannot pay an unfunded legacy guarantee", async () => {
    const { db, id } = world("resolve");
    await db.collection("corporations").updateOne(
      { _id: id },
      {
        $set: {
          "bankCharter.status": "failed",
          "bankCharter.failedTurn": 51,
        },
      }
    );
    db.seed("bankGuarantees", [
      {
        _id: "legacy",
        status: "active",
        guaranteeLimit: 1000,
        bankIds: [id],
        currency: "USD",
        escrowBalance: 150,
        expiresTurn: 60,
        countryId: "US",
      },
    ]);
    expect(await processFinancialCrisisGuarantees(db as unknown as Db, 51, policy)).toEqual({
      paid: 0,
      refunded: 0,
    });
    const legacy = await db.collection("bankGuarantees").findOne({ _id: "legacy" });
    expect(legacy?.escrowBalance).toBe(150);
    expect(await processFinancialCrisisGuarantees(db as unknown as Db, 61, policy)).toEqual({
      paid: 0,
      refunded: 150,
    });
    const treasury = await db.collection("federalBudget").findOne({ countryId: "US" });
    expect(treasury?.treasuryBalance).toBe(1150);
  });
});
