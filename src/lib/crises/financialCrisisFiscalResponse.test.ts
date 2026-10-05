import { expireFinancialCrisisAusterity } from "./financialCrisisBudgetPolicy";
import type { FederalBudget } from "@/lib/db/types";
import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getBankId } from "@/lib/centralBank/helpers";
import type { CrisisActionContext } from "./optionActions";
import {
  applyFinancialFiscalResponse,
  prepareFinancialFiscalResponse,
  type FinancialFiscalResponse,
} from "./financialCrisisFiscalResponse";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function world(response: FinancialFiscalResponse, treasuryCashLocal = 0) {
  const memory = createInMemoryDb();
  memory.seed("federalBudget", [
    {
      _id: "national-budget-us",
      countryId: "US",
      currencyCode: "USD",
      gdp: 10000,
      treasuryBalance: 1000,
      treasuryCashLocal,
      debt: { principal: 600 },
      revenue: { total: 500 },
      spending: {
        byCategory: { welfare: 500, health: 300 },
        stateGrants: 100,
        debtInterest: 100,
        total: 1000,
      },
    },
  ]);
  memory.seed("centralBanks", [{ _id: getBankId("US"), externalBroadMoney: 2000 }]);
  const ctx = {
    db: memory as unknown as Db,
    crisis: { _id: new ObjectId() },
    interaction: { _id: new ObjectId() },
    characterId: new ObjectId(),
    countryId: "US",
    currentTurn: 50,
    option: { treasuryCostPctGdp: 0.02, action: { kind: "financialCrisisResponse", response } },
  } as unknown as CrisisActionContext;
  return { memory, ctx };
}

describe("financial crisis fiscal transmission", () => {
  it("delivers funded household cash once and preserves bond-owned debt", async () => {
    const { ctx } = world("stimulus");
    await applyFinancialFiscalResponse(ctx, "stimulus");
    await applyFinancialFiscalResponse(ctx, "stimulus");
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    const bank = await ctx.db
      .collection<{ _id: string; externalBroadMoney: number }>("centralBanks")
      .findOne({ _id: getBankId("US") });
    expect(budget?.treasuryBalance).toBe(800);
    expect(bank?.externalBroadMoney).toBe(2200);
    expect(budget?.debt.principal).toBe(600);
    expect(budget?.treasuryBalance + bank!.externalBroadMoney).toBe(3000);
  });
  it("funds stimulus only from the spendable cash stock", async () => {
    const { ctx } = world("stimulus");
    ctx.treasuryCashLedgerEnabled = true;
    await expect(applyFinancialFiscalResponse(ctx, "stimulus")).rejects.toThrow();
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    const centralBank = await ctx.db
      .collection<{ _id: string; externalBroadMoney: number }>("centralBanks")
      .findOne({ _id: getBankId("US") });
    expect(budget?.treasuryBalance).toBe(1000);
    expect(budget?.treasuryCashLocal).toBe(0);
    expect(centralBank?.externalBroadMoney).toBe(2000);
  });
  it("settles funded stimulus once and updates signed position without minting cash", async () => {
    const { ctx } = world("stimulus", 250);
    ctx.treasuryCashLedgerEnabled = true;
    await applyFinancialFiscalResponse(ctx, "stimulus");
    await applyFinancialFiscalResponse(ctx, "stimulus");
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    const centralBank = await ctx.db
      .collection<{ _id: string; externalBroadMoney: number }>("centralBanks")
      .findOne({ _id: getBankId("US") });
    expect(budget?.treasuryCashLocal).toBe(50);
    expect(budget?.treasuryBalance).toBe(800);
    expect(centralBank?.externalBroadMoney).toBe(2200);
  });
  it("freezes the Treasury currency and monetary authority identity in funded journal legs", async () => {
    const { memory, ctx } = world("stimulus");
    await applyFinancialFiscalResponse(ctx, "stimulus");
    const move = memory.collection("bankMoneyMoves").docs[0] as unknown as {
      legs: { filter: Record<string, unknown> }[];
    };
    expect(move.legs[0]?.filter.currencyCode).toEqual({ $exists: true, $eq: "USD" });
    expect(move.legs[1]?.filter).toMatchObject({
      _id: getBankId("US"),
      monetaryAuthorityId: { $exists: false },
    });
  });
  it("routes a funded sovereign support grant from Treasury cash to the recipient", async () => {
    const { memory, ctx } = world("sovereign_support");
    ctx.treasuryCashLedgerEnabled = true;
    const donor = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    await ctx.db
      .collection("federalBudget")
      .updateOne({ countryId: "US" }, { $set: { treasuryCashLocal: 300 } });
    memory.seed("federalBudget", [
      {
        _id: "national-budget-fr",
        countryId: "FR",
        currencyCode: "USD",
        treasuryBalance: -500,
        treasuryCashLocal: 0,
        sovereignCrisisState: "crisisPending",
      },
    ]);
    await applyFinancialFiscalResponse(ctx, "sovereign_support");
    const updatedDonor = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    const recipient = await ctx.db.collection("federalBudget").findOne({ countryId: "FR" });
    expect(donor?.treasuryBalance).toBe(1000);
    expect(updatedDonor?.treasuryCashLocal).toBe(100);
    expect(updatedDonor?.treasuryBalance).toBe(800);
    expect(recipient?.treasuryCashLocal).toBe(200);
    expect(recipient?.treasuryBalance).toBe(-300);
  });
  it("cuts primary spending while preserving contractual coupons", async () => {
    const { ctx } = world("austerity");
    await applyFinancialFiscalResponse(ctx, "austerity");
    await applyFinancialFiscalResponse(ctx, "austerity");
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(budget?.spending.total).toBeCloseTo(500);
    expect(budget?.spending.debtInterest).toBe(100);
    await expireFinancialCrisisAusterity(
      ctx.db,
      budget as unknown as FederalBudget,
      budget!.financialCrisisAusterityUntilTurn
    );
    const expired = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(expired?.spending.total).toBe(1000);
    expect(expired?.financialCrisisAusterityUntilTurn).toBeUndefined();
    expect(budget?.treasuryBalance).toBe(1000);
    expect(budget?.debt.principal).toBe(600);
  });
  it("requires a real failed funding decision before offering default", async () => {
    const { ctx } = world("restructure");
    await expect(prepareFinancialFiscalResponse(ctx.db, "US", ctx.option)).rejects.toThrow(
      "open sovereign"
    );
  });
  it("opens actual legislative ratification without manufacturing a haircut", async () => {
    const { ctx, memory } = world("restructure");
    const id = new ObjectId();
    memory.seed("characters", [
      { _id: ctx.characterId, countryId: "US", currentOffice: { type: "president" } },
    ]);
    memory.seed("sovereignCrisisDecisions", [{ _id: id, countryCode: "US", state: "open" }]);
    await applyFinancialFiscalResponse(ctx, "restructure");
    const decision = await ctx.db.collection("sovereignCrisisDecisions").findOne({ _id: id });
    expect(decision?.state).toBe("executiveProposed");
    expect(decision?.legislativePhases[0].outcome).toBe("pending");
    expect(decision?.executiveChoice).toBe("restructure");
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(budget?.debt.principal).toBe(600);
  });
  it("requires a same-currency recipient and conserves a sovereign rescue grant", async () => {
    const { ctx, memory } = world("sovereign_support");
    await expect(prepareFinancialFiscalResponse(ctx.db, "US", ctx.option)).rejects.toThrow(
      "shares"
    );
    memory.seed("federalBudget", [
      {
        _id: "national-budget-ie",
        countryId: "IE",
        currencyCode: "USD",
        treasuryBalance: 50,
        sovereignCrisisState: "crisisPending",
        debt: { principal: 300 },
      },
    ]);
    await applyFinancialFiscalResponse(ctx, "sovereign_support");
    await applyFinancialFiscalResponse(ctx, "sovereign_support");
    const recipient = await ctx.db.collection("federalBudget").findOne({ countryId: "IE" });
    expect(recipient?.treasuryBalance).toBe(250);
    expect(recipient?.debt.principal).toBe(300);
    const donor = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(donor?.treasuryBalance + recipient?.treasuryBalance).toBe(1050);
  });
  it("freezes the recipient currency on a sovereign support grant", async () => {
    const { ctx, memory } = world("sovereign_support");
    memory.seed("federalBudget", [
      {
        _id: "national-budget-ie",
        countryId: "IE",
        currencyCode: "USD",
        treasuryBalance: 10,
        sovereignCrisisState: "crisisPending",
      },
    ]);
    await applyFinancialFiscalResponse(ctx, "sovereign_support");
    const move = memory.collection("bankMoneyMoves").docs[0] as unknown as {
      legs: { filter: Record<string, unknown> }[];
    };
    expect(move.legs[1]?.filter).toMatchObject({
      _id: "national-budget-ie",
      countryId: "IE",
      currencyCode: { $exists: true, $eq: "USD" },
    });
  });
});
