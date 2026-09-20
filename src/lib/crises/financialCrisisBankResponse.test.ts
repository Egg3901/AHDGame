import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import type { Corporation } from "@/lib/db/types";
import type { CrisisActionContext } from "./optionActions";
import {
  applyFinancialCrisisBankResponse,
  rankBanksForFinancialIntervention,
} from "./financialCrisisBankResponse";

function bank(confidence: number): Pick<Corporation, "_id" | "bankCharter"> {
  return {
    _id: new ObjectId(),
    bankCharter: {
      type: "retail",
      status: "active",
      currency: "USD",
      charteredTurn: 1,
      postedCapital: 100,
      depositOffset: 0,
      lendingOffset: 0,
      confidence,
      cashReserves: 50,
    },
  };
}

describe("financial crisis bank responses", () => {
  it("ranks the weakest active charter first", () => {
    const strong = bank(0.8);
    const weak = bank(0.2);
    const failed = bank(0.1);
    failed.bankCharter!.status = "failed";

    expect(
      rankBanksForFinancialIntervention([strong, failed, weak]).map((item) => item._id)
    ).toEqual([weak._id, strong._id]);
  });

  it("moves the already-booked fiscal recapitalization into ring-fenced bank capital once", async () => {
    const banks = [bank(0.2), bank(0.4)];
    const updates: Array<{ filter: unknown; update: Record<string, unknown> }> = [];
    let actionDoc: unknown = null;
    const db = {
      collection(name: string) {
        if (name === "financialCrisisBankActions") {
          return {
            async findOne() {
              return actionDoc;
            },
            async insertOne(doc: unknown) {
              actionDoc = doc;
            },
          };
        }
        if (name === "corporations") {
          return {
            find() {
              return {
                async toArray() {
                  return banks;
                },
              };
            },
            async updateOne(filter: unknown, update: Record<string, unknown>) {
              updates.push({ filter, update });
            },
          };
        }
        if (name === "federalBudget") {
          return {
            async findOne() {
              return { gdp: 10_000, treasuryBalance: 1_000 };
            },
          };
        }
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Db;
    const ctx = {
      db,
      crisis: { _id: new ObjectId() },
      interaction: { _id: new ObjectId() },
      option: { treasuryCostPctGdp: 0.02 },
      characterId: new ObjectId(),
      countryId: "US",
      currentTurn: 50,
    } as unknown as CrisisActionContext;

    await applyFinancialCrisisBankResponse(ctx, "recapitalize");
    await applyFinancialCrisisBankResponse(ctx, "recapitalize");

    expect(updates).toHaveLength(2);
    expect(
      updates.reduce(
        (sum, item) =>
          sum + ((item.update.$inc as Record<string, number>)["bankCharter.cashReserves"] ?? 0),
        0
      )
    ).toBe(200);
  });
});
