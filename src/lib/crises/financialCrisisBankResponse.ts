import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CrisisActionContext } from "./optionActions";

export type FinancialCrisisBankResponse = "recapitalize" | "guarantee" | "resolve";

interface FinancialCrisisBankAction {
  _id: string;
  crisisId: ObjectId;
  interactionId: ObjectId;
  countryId: string;
  response: FinancialCrisisBankResponse;
  amount: number;
  bankIds: ObjectId[];
  turn: number;
  createdAt: Date;
}

function interventionAmount(budget: FederalBudget | null, pctGdp: number): number {
  const gdp =
    budget?.gdpSmoothed && budget.gdpSmoothed > 0 ? budget.gdpSmoothed : (budget?.gdp ?? 0);
  return Math.max(0, Math.round(gdp * Math.max(0, pctGdp)));
}

/** Weakest active domestic banks first; stable ordering makes retries deterministic. */
export function rankBanksForFinancialIntervention(
  banks: Pick<Corporation, "_id" | "bankCharter">[]
): Pick<Corporation, "_id" | "bankCharter">[] {
  return [...banks]
    .filter((bank) => bank.bankCharter?.status === "active")
    .sort(
      (a, b) =>
        (a.bankCharter?.confidence ?? 0.5) - (b.bankCharter?.confidence ?? 0.5) ||
        a._id.toString().localeCompare(b._id.toString())
    );
}

export async function applyFinancialCrisisBankResponse(
  ctx: CrisisActionContext,
  response: FinancialCrisisBankResponse
): Promise<void> {
  const actionId = [ctx.crisis._id, ctx.interaction._id, ctx.countryId, response].join(":");
  const prior = await ctx.db
    .collection<FinancialCrisisBankAction>("financialCrisisBankActions")
    .findOne({ _id: actionId });
  if (prior) return;

  const banks = rankBanksForFinancialIntervention(
    await ctx.db
      .collection<Corporation>("corporations")
      .find(
        {
          countryId: ctx.countryId as Corporation["countryId"],
          "bankCharter.status": "active",
        },
        { projection: { bankCharter: 1 } }
      )
      .toArray()
  ).slice(0, 3);
  if (banks.length === 0) return;

  const budget = await ctx.db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: ctx.countryId as FederalBudget["countryId"] });
  const amount = interventionAmount(budget, ctx.option.treasuryCostPctGdp ?? 0);
  const now = new Date();

  if (response === "recapitalize" && amount > 0) {
    const perBank = Math.floor(amount / banks.length);
    let remainder = amount - perBank * banks.length;
    for (const bank of banks) {
      const allocation = perBank + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      await ctx.db.collection<Corporation>("corporations").updateOne(
        { _id: bank._id, "bankCharter.status": "active" },
        {
          $inc: {
            "bankCharter.cashReserves": allocation,
            "bankCharter.postedCapital": allocation,
          },
          $set: {
            "bankCharter.confidence": Math.max(0.75, bank.bankCharter?.confidence ?? 0),
            "bankCharter.panicTurns": 0,
            "bankCharter.warningBand": "amber",
            updatedAt: now,
          },
        }
      );
    }
  } else if (response === "guarantee") {
    await ctx.db.collection("bankGuarantees").updateOne(
      { crisisActionId: actionId },
      {
        $setOnInsert: {
          crisisActionId: actionId,
          countryId: ctx.countryId,
          bankIds: banks.map((bank) => bank._id),
          guaranteeLimit: amount,
          status: "active",
          openedTurn: ctx.currentTurn,
          createdAt: now,
        },
      },
      { upsert: true }
    );
    await ctx.db.collection<Corporation>("corporations").updateMany(
      { _id: { $in: banks.map((bank) => bank._id) }, "bankCharter.status": "active" },
      {
        $set: {
          "bankCharter.confidence": 0.7,
          "bankCharter.warningBand": "amber",
          updatedAt: now,
        },
      }
    );
  } else if (response === "resolve") {
    const weakest = banks[0];
    if ((weakest.bankCharter?.confidence ?? 0.5) <= 0.35) {
      await ctx.db.collection<Corporation>("corporations").updateOne(
        { _id: weakest._id, "bankCharter.status": "active" },
        {
          $set: {
            "bankCharter.status": "failed",
            "bankCharter.failedTurn": ctx.currentTurn,
            updatedAt: now,
          },
        }
      );
    }
  }

  await ctx.db.collection<FinancialCrisisBankAction>("financialCrisisBankActions").insertOne({
    _id: actionId,
    crisisId: ctx.crisis._id,
    interactionId: ctx.interaction._id,
    countryId: ctx.countryId,
    response,
    amount,
    bankIds: banks.map((bank) => bank._id),
    turn: ctx.currentTurn,
    createdAt: now,
  });
}
