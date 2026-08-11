import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { DiplomaticActionBudget } from "../types/diplomaticAction";

/** Per-country diplomatic-action budgets for the International Organizations page. */
export async function getDiplomaticActionsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<DiplomaticActionBudget>("diplomaticActions");
}
