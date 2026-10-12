import { redenominatePublicRegion } from "./rules/publicCurrency";
/** Reunification redenominates regional public stocks without changing people, rates or turn stamps. */
import type { Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import { scaleDeep } from "../secede/docScale";

export async function convertPublicCurrency(
  db: Db,
  regionId: string,
  scale: number
): Promise<void> {
  if (scale === 1) return;
  const state = await db.collection<State>("states").findOne({ _id: regionId });
  if (!state) throw new Error("Missing transferred region");
  const set = redenominatePublicRegion(state, scale);
  await db.collection<State>("states").updateOne({ _id: regionId }, { $set: set });
  await convertBudgetMoney(
    db,
    "stateBudgets",
    regionId,
    ["revenue", "taxBases", "spending", "balance", "surplus", "stateGdp"],
    scale
  );
  await convertBudgetMoney(
    db,
    "regionalBudgets",
    regionId,
    [
      "councilTaxRevenue",
      "businessRatesRevenue",
      "westminsterGrant",
      "totalBudget",
      "enactedBillCosts",
      "subsidyCosts",
      "surplus",
    ],
    scale
  );
  await db
    .collection<{ _id: string }>("macroMetrics")
    .updateOne({ _id: regionId }, { $mul: { "economic.medianIncome.value": scale } });
  await db
    .collection("infraProjects")
    .updateMany({ regionId }, { $mul: { upkeepBase: scale, constructionCostBase: scale } });
  await db
    .collection("conflictCapacityObligations")
    .updateMany({ regionId }, { $mul: { capitalStockBefore: scale, destroyedCapital: scale } });
}

async function convertBudgetMoney(
  db: Db,
  name: "stateBudgets" | "regionalBudgets",
  regionId: string,
  fields: string[],
  scale: number
) {
  const doc = await db
    .collection<Record<string, unknown> & { _id: string }>(name)
    .findOne({ _id: regionId });
  if (!doc) return;
  const money = Object.fromEntries(
    fields
      .filter((field) => doc[field] !== undefined)
      .map((field) => [field, scaleDeep(doc[field], scale)])
  );
  await db
    .collection<Record<string, unknown> & { _id: string }>(name)
    .updateOne({ _id: regionId }, { $set: money });
}
