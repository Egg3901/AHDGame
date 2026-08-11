import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ProspectingSurvey } from "@/lib/db/types/prospectingSurvey";

export async function getProspectingSurveysCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<ProspectingSurvey>("prospectingSurveys");
}
