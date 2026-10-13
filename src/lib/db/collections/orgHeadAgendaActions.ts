import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { OrgHeadAgendaPool } from "../types/orgHeadAgendaAction";

/** Per-(organisation, head) agenda-action pools for organisation leaders. */
export async function getOrgHeadAgendaActionsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<OrgHeadAgendaPool>("orgHeadAgendaActions");
}
