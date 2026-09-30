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

function world(response: "recapitalize" | "guarantee" | "resolve", treasury = 1000) {
  const db = createInMemoryDb();
  const id = new ObjectId();
  db.seed("corporations", [
    {
      _id: id,
      countryId: "US",
      bankCharter: {
        status: "active",
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
    const { ctx, id } = world("recapitalize");
    await applyFinancialCrisisBankResponse(ctx, "recapitalize");
    await applyFinancialCrisisBankResponse(ctx, "recapitalize");
    const bank = await ctx.db.collection("corporations").findOne({ _id: id });
    const budget = await ctx.db.collection("federalBudget").findOne({ countryId: "US" });
    expect(budget?.treasuryBalance).toBe(800);
    expect(bank?.bankCharter.cashReserves).toBe(250);
    expect(bank?.bankCharter.postedCapital).toBe(300);
    expect(bank?.bankCharter.publicRescueCapital).toBe(200);
    expect(budget?.treasuryBalance + bank?.bankCharter.cashReserves).toBe(1050);
  });
  it("refuses unfunded rescues before consent is claimed", async () => {
    const { ctx } = world("recapitalize", 20);
    await expect(prepareFinancialCrisisBankResponse(ctx.db, "US", ctx.option)).rejects.toThrow(
      "funded treasury"
    );
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
  it("cannot pay an unfunded legacy guarantee", async () => {
    const { db, id } = world("resolve");
    db.seed("bankGuarantees", [
      { _id: "legacy", status: "active", guaranteeLimit: 1000, bankIds: [id] },
    ]);
    expect(await processFinancialCrisisGuarantees(db as unknown as Db, 51, policy)).toEqual({
      paid: 0,
      refunded: 0,
    });
  });
});
