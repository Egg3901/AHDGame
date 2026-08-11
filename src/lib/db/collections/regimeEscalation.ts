import type { Db } from "mongodb";
import type { EscalationState } from "@/lib/db/types/regimeEscalation";

export function getRegimeEscalationCollection(db: Db) {
  return db.collection<EscalationState>("regimeEscalation");
}
