import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { SPHERE_FLOW_LEDGER_COLLECTION, type SphereFlowLedgerEntry } from "@/lib/world/spheres";

export async function getSphereFlowLedgerCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<SphereFlowLedgerEntry>(SPHERE_FLOW_LEDGER_COLLECTION);
}
